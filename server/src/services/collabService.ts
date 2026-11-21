import crypto from 'node:crypto';
import type { AppDatabase } from '../db/database.js';
import type {
  AgentNode,
  Channel,
  ChannelKind,
  Dispatch,
  EffortLevel,
  Message,
  PacketMode,
  ParsedDirective,
  ProviderFuelStatus,
  ProviderKind,
  SystemTelemetry,
  WorkflowStepStatus,
} from '../domain/types.js';
import { getEffortPolicy, isValidEffort, resolveEffectiveEffort } from '../domain/effort.js';
import { hasPermission } from '../domain/permissions.js';
import { PROVIDER_WINDOW_BUDGETS } from '../domain/tokenBudget.js';
import { buildContextPacket } from '../adapters/contextBuilder.js';
import { extractMentions, parseDirectives, parseTodoList, parseWorkflowBoxes } from '../adapters/protocolParser.js';
import type { AdapterRegistry } from '../adapters/registry.js';
import type { ApprovalService } from './approvalService.js';
import type { AuditService } from './auditService.js';
import type { DebateService } from './debateService.js';
import type { FileLeaseService } from './fileLeaseService.js';
import type { MemoryService } from './memoryService.js';
import type { OrgService } from './orgService.js';
import type { RealtimeHub } from './realtime.js';
import type { TaskService } from './taskService.js';
import type { WorkflowService } from './workflowService.js';

export class CollabService {
  private workflow?: WorkflowService;
  private debate?: DebateService;

  constructor(
    private readonly appDb: AppDatabase,
    private readonly org: OrgService,
    private readonly tasks: TaskService,
    private readonly files: FileLeaseService,
    private readonly memory: MemoryService,
    private readonly approvals: ApprovalService,
    private readonly adapters: AdapterRegistry,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeHub,
  ) {}

  public setWorkflowAndDebate(workflow: WorkflowService, debate: DebateService): void {
    this.workflow = workflow;
    this.debate = debate;
  }

  public isCompanyPaused(): boolean {
    const row = this.appDb.db.prepare(`SELECT value FROM system_state WHERE key = 'company_paused'`).get() as
      | { value: string }
      | undefined;
    return row?.value === 'true';
  }

  public setCompanyPaused(paused: boolean): SystemTelemetry {
    const now = new Date().toISOString();
    this.appDb.db
      .prepare(
        `INSERT INTO system_state (key, value, updated_at) VALUES ('company_paused', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(paused ? 'true' : 'false', now);

    if (!paused) {
      // Release paused dispatches to awaiting_handoff so work resumes cleanly
      this.appDb.db.prepare(`UPDATE dispatches SET status = 'awaiting_handoff' WHERE status = 'paused'`).run();
    }

    this.audit.record({
      actorType: 'human',
      actorId: 'human-exec',
      actorName: 'Product Manager',
      category: 'org',
      action: paused ? 'company.paused' : 'company.resumed',
      severity: 'warning',
      summary: paused ? 'Global Pause All activated — autonomous dispatches halted.' : 'Company resumed — queued dispatches active.',
    });
    const telemetry = this.getTelemetry();
    this.realtime.broadcast('telemetry:updated', telemetry);
    return telemetry;
  }

  public getTelemetry(): SystemTelemetry {
    const providers: ProviderKind[] = ['claude', 'gemini', 'openai'];
    const fuel: ProviderFuelStatus[] = providers.map((provider) => {
      const cfg = PROVIDER_WINDOW_BUDGETS[provider];
      const since = new Date(Date.now() - cfg.windowHours * 3600 * 1000).toISOString();
      const row = this.appDb.db
        .prepare(
          `SELECT COUNT(*) as cnt,
                  COALESCE(SUM(estimated_tokens), 0) as tok,
                  COALESCE(SUM(saved_tokens_estimate), 0) as saved
           FROM dispatches WHERE provider = ? AND created_at >= ?`,
        )
        .get(provider, since) as { cnt: number; tok: number; saved: number };

      const dispatchesInWindow = Number(row?.cnt ?? 0);
      const tokensInWindow = Number(row?.tok ?? 0);
      const savedTokensTotal = Number(row?.saved ?? 0);
      const pctMsg = (dispatchesInWindow / cfg.softMessageCap) * 100;
      const pctTok = (tokensInWindow / cfg.softTokenCap) * 100;
      const fuelUsedPercent = Math.min(100, Math.round(Math.max(pctMsg, pctTok)));

      return {
        provider,
        windowHours: cfg.windowHours,
        dispatchesInWindow,
        softMessageCap: cfg.softMessageCap,
        tokensInWindow,
        softTokenCap: cfg.softTokenCap,
        savedTokensTotal,
        fuelUsedPercent,
        warning: fuelUsedPercent >= 80,
      };
    });

    const totals = this.appDb.db
      .prepare(
        `SELECT
           SUM(CASE WHEN packet_mode = 'delta' THEN 1 ELSE 0 END) as delta_cnt,
           SUM(CASE WHEN packet_mode = 'bootstrap' THEN 1 ELSE 0 END) as boot_cnt,
           COALESCE(SUM(saved_tokens_estimate), 0) as total_saved
         FROM dispatches`,
      )
      .get() as { delta_cnt: number; boot_cnt: number; total_saved: number };

    return {
      companyPaused: this.isCompanyPaused(),
      fuel,
      totalDeltaDispatches: Number(totals?.delta_cnt ?? 0),
      totalBootstrapDispatches: Number(totals?.boot_cnt ?? 0),
      totalEstimatedTokensSaved: Number(totals?.total_saved ?? 0),
    };
  }

  private mapChannel(r: Record<string, unknown>): Channel {
    const id = String(r.id);
    const cnt = this.appDb.db
      .prepare('SELECT COUNT(*) as cnt FROM messages WHERE channel_id = ?')
      .get(id) as { cnt: number };
    return {
      id,
      name: String(r.name),
      slug: String(r.slug),
      kind: r.kind as ChannelKind,
      departmentId: r.department_id ? String(r.department_id) : null,
      taskId: r.task_id ? String(r.task_id) : null,
      participantIds: JSON.parse(String(r.participant_ids_json || '[]')),
      description: String(r.description || ''),
      createdAt: String(r.created_at),
      messageCount: Number(cnt?.cnt ?? 0),
    };
  }

  private mapMessage(r: Record<string, unknown>): Message {
    const id = String(r.id);
    const replyRow = this.appDb.db
      .prepare('SELECT COUNT(*) as cnt FROM messages WHERE parent_message_id = ?')
      .get(id) as { cnt: number };
    return {
      id,
      channelId: String(r.channel_id),
      parentMessageId: r.parent_message_id ? String(r.parent_message_id) : null,
      senderType: r.sender_type as Message['senderType'],
      senderId: String(r.sender_id),
      senderName: String(r.sender_name),
      senderProvider: r.sender_provider ? (r.sender_provider as ProviderKind) : null,
      senderModel: r.sender_model ? String(r.sender_model) : null,
      senderEffort: r.sender_effort ? (r.sender_effort as EffortLevel) : null,
      content: String(r.content),
      mentions: JSON.parse(String(r.mentions_json || '[]')),
      directives: JSON.parse(String(r.directives_json || '[]')),
      dispatchId: r.dispatch_id ? String(r.dispatch_id) : null,
      createdAt: String(r.created_at),
      replyCount: Number(replyRow?.cnt ?? 0),
    };
  }

  private mapDispatch(r: Record<string, unknown>): Dispatch {
    const agent = this.org.getAgentById(String(r.agent_id));
    const channelRow = this.appDb.db.prepare('SELECT name FROM channels WHERE id = ?').get(String(r.channel_id)) as
      | { name: string }
      | undefined;
    return {
      id: String(r.id),
      agentId: String(r.agent_id),
      channelId: String(r.channel_id),
      parentMessageId: r.parent_message_id ? String(r.parent_message_id) : null,
      taskId: r.task_id ? String(r.task_id) : null,
      triggerMessageId: r.trigger_message_id ? String(r.trigger_message_id) : null,
      adapterKind: r.adapter_kind as Dispatch['adapterKind'],
      provider: r.provider as ProviderKind,
      model: String(r.model),
      enforcedEffort: r.enforced_effort as EffortLevel,
      packetMode: (r.packet_mode as PacketMode) || 'bootstrap',
      estimatedTokens: Number(r.estimated_tokens ?? 0),
      savedTokensEstimate: Number(r.saved_tokens_estimate ?? 0),
      status: r.status as Dispatch['status'],
      contextPacket: String(r.context_packet),
      responseText: r.response_text ? String(r.response_text) : null,
      errorMessage: r.error_message ? String(r.error_message) : null,
      hopDepth: Number(r.hop_depth ?? 0),
      createdAt: String(r.created_at),
      dispatchedAt: r.dispatched_at ? String(r.dispatched_at) : null,
      completedAt: r.completed_at ? String(r.completed_at) : null,
      agentName: agent?.name ?? String(r.agent_id),
      channelName: channelRow?.name ?? String(r.channel_id),
      conversationUrl: agent?.adapterConfig?.conversationUrl,
    };
  }

  public listChannels(): Channel[] {
    const rows = this.appDb.db.prepare('SELECT * FROM channels ORDER BY kind ASC, created_at ASC').all();
    return rows.map((r) => this.mapChannel(r));
  }

  public getChannel(id: string): Channel | null {
    const row = this.appDb.db.prepare('SELECT * FROM channels WHERE id = ?').get(id);
    return row ? this.mapChannel(row) : null;
  }

  public createChannel(input: {
    name: string;
    kind: ChannelKind;
    departmentId?: string | null;
    participantIds?: string[];
    description?: string;
  }): Channel {
    const now = new Date().toISOString();
    const id = `ch-${crypto.randomUUID().slice(0, 8)}`;
    const slug = `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'channel'}-${id.slice(-4)}`;

    this.appDb.db
      .prepare(
        `INSERT INTO channels (id, name, slug, kind, department_id, task_id, participant_ids_json, description, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      )
      .run(
        id,
        input.name.trim(),
        slug,
        input.kind,
        input.departmentId ?? null,
        JSON.stringify(input.participantIds ?? []),
        (input.description || '').trim(),
        now,
      );

    const channel = this.getChannel(id)!;
    this.realtime.broadcast('channels:updated', channel);
    return channel;
  }

  public getOrCreateDirectChannel(agentIds: string[], customName?: string): Channel {
    const sorted = Array.from(new Set(agentIds)).sort();
    const existing = this.listChannels().find(
      (c) => c.kind === 'dm' && c.participantIds.length === sorted.length && sorted.every((id) => c.participantIds.includes(id)),
    );
    if (existing) return existing;

    const names = sorted.map((id) => (id === 'human-exec' ? 'Supervisor' : this.org.getAgentById(id)?.name ?? id));
    return this.createChannel({
      name: customName || names.join(' ↔ '),
      kind: 'dm',
      participantIds: sorted,
      description: `Private direct conversation between ${names.join(' and ')}.`,
    });
  }

  public listMessages(channelId: string, parentMessageId: string | null = null): Message[] {
    const rows =
      parentMessageId === null
        ? this.appDb.db
            .prepare('SELECT * FROM messages WHERE channel_id = ? AND parent_message_id IS NULL ORDER BY created_at ASC')
            .all(channelId)
        : this.appDb.db
            .prepare('SELECT * FROM messages WHERE channel_id = ? AND parent_message_id = ? ORDER BY created_at ASC')
            .all(channelId, parentMessageId);

    return rows.map((r) => this.mapMessage(r));
  }

  public listDispatches(filter?: { status?: string; agentId?: string }): Dispatch[] {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (filter?.status && filter.status !== 'all') {
      clauses.push('status = ?');
      values.push(filter.status);
    }
    if (filter?.agentId) {
      clauses.push('agent_id = ?');
      values.push(filter.agentId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.appDb.db
      .prepare(`SELECT * FROM dispatches ${where} ORDER BY created_at DESC LIMIT 100`)
      .all(...values);
    return rows.map((r) => this.mapDispatch(r));
  }

  public getDispatch(id: string): Dispatch | null {
    const row = this.appDb.db.prepare('SELECT * FROM dispatches WHERE id = ?').get(id);
    return row ? this.mapDispatch(row) : null;
  }

  /**
   * Sends a message into a channel/thread, parses @mentions and structured inter-agent directives,
   * executes directives (cross-provider delegations, file claims, edits, decisions, approvals),
   * and automatically dispatches target agents via their configured provider adapter.
   */
  public async postMessage(input: {
    channelId: string;
    parentMessageId?: string | null;
    senderType: 'human' | 'agent' | 'system';
    senderId: string;
    senderName?: string;
    content: string;
    dispatchId?: string | null;
    hopDepth?: number;
    targetAgentId?: string | null;
  }): Promise<{ message: Message; createdDispatches: Dispatch[] }> {
    const channel = this.getChannel(input.channelId);
    if (!channel) throw new Error(`Channel ${input.channelId} not found.`);

    const senderAgent = input.senderType === 'agent' ? this.org.getAgentById(input.senderId) : null;
    const senderName =
      input.senderName ||
      senderAgent?.name ||
      (input.senderType === 'human' ? 'Executive Supervisor' : 'System');

    const mentions = extractMentions(input.content);
    const directives = input.senderType === 'system' ? [] : parseDirectives(input.content);
    const hopDepth = input.hopDepth ?? 0;

    const msgId = `msg-${crypto.randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();

    const createdDispatches: Dispatch[] = [];
    const dispatchedAgentIds = new Set<string>();

    // Execute directives embedded in the message (works for both real Claude/Gemini replies and human slash/directive commands)
    for (const dir of directives) {
      await this.executeDirective(dir, {
        senderType: input.senderType,
        senderAgent,
        senderName,
        channel,
        parentMessageId: input.parentMessageId ?? null,
        triggerMessageId: msgId,
        hopDepth,
        createdDispatches,
        dispatchedAgentIds,
      });
    }

    // Persist the message with directive execution outcomes
    this.appDb.db
      .prepare(
        `INSERT INTO messages (
          id, channel_id, parent_message_id, sender_type, sender_id, sender_name,
          sender_provider, sender_model, sender_effort, content, mentions_json, directives_json,
          dispatch_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        msgId,
        channel.id,
        input.parentMessageId ?? null,
        input.senderType,
        input.senderId,
        senderName,
        senderAgent?.provider ?? null,
        senderAgent?.model ?? null,
        senderAgent?.effort ?? null,
        input.content.trim(),
        JSON.stringify(mentions),
        JSON.stringify(directives),
        input.dispatchId ?? null,
        now,
      );

    const savedMessage = this.mapMessage(this.appDb.db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId)!);
    this.realtime.broadcast('messages:created', savedMessage);

    // Route @mentions (including cross-provider Claude <-> Gemini mentions!)
    const candidateTargets: AgentNode[] = [];
    for (const handle of mentions) {
      const target = this.org.findAgentByName(handle);
      if (target && target.id !== input.senderId && target.lifecycleState !== 'position_open') {
        candidateTargets.push(target);
      }
    }

    // If explicitly targeted or DM channel with a single other agent participant
    if (input.targetAgentId) {
      const explicit = this.org.getAgentById(input.targetAgentId);
      if (explicit && explicit.id !== input.senderId && explicit.lifecycleState !== 'position_open') {
        candidateTargets.push(explicit);
      }
    } else if (channel.kind === 'dm' && candidateTargets.length === 0) {
      for (const pid of channel.participantIds) {
        if (pid !== input.senderId && pid !== 'human-exec') {
          const peer = this.org.getAgentById(pid);
          if (peer && peer.lifecycleState !== 'position_open') {
            candidateTargets.push(peer);
          }
        }
      }
    }

    for (const target of candidateTargets) {
      if (dispatchedAgentIds.has(target.id)) continue;

      // Cross-provider permission & effort hop-depth guard when an agent initiates routing
      if (senderAgent) {
        const senderPolicy = getEffortPolicy(senderAgent.effort);
        if (hopDepth + 1 > senderPolicy.maxDelegationHops) {
          this.postSystemNotice(
            channel.id,
            input.parentMessageId ?? null,
            `Delegation hop cap reached (${hopDepth}/${senderPolicy.maxDelegationHops} for ${senderAgent.effort.toUpperCase()} effort). Supervisor can manually dispatch @${target.name}.`,
          );
          continue;
        }
        if (senderAgent.provider !== target.provider && !hasPermission(senderAgent, 'cross_provider:communicate')) {
          this.audit.record({
            actorType: 'agent',
            actorId: senderAgent.id,
            actorName: senderAgent.name,
            category: 'security',
            action: 'comms.cross_provider_denied',
            severity: 'security',
            targetType: 'agent',
            targetId: target.id,
            summary: `Blocked cross-provider message from ${senderAgent.name} (${senderAgent.provider}) to ${target.name} (${target.provider}): missing "cross_provider:communicate" permission.`,
          });
          continue;
        }
      }

      const dispatch = await this.dispatchAgent({
        agentId: target.id,
        channelId: channel.id,
        parentMessageId: input.parentMessageId ?? null,
        taskId: channel.taskId,
        triggerMessageId: savedMessage.id,
        hopDepth: senderAgent ? hopDepth + 1 : 0,
      });
      if (dispatch) {
        createdDispatches.push(dispatch);
        dispatchedAgentIds.add(target.id);
      }
    }

    return { message: savedMessage, createdDispatches };
  }

  private async executeDirective(
    dir: ParsedDirective,
    ctx: {
      senderType: 'human' | 'agent' | 'system';
      senderAgent: AgentNode | null;
      senderName: string;
      channel: Channel;
      parentMessageId: string | null;
      triggerMessageId: string;
      hopDepth: number;
      createdDispatches: Dispatch[];
      dispatchedAgentIds: Set<string>;
    },
  ): Promise<void> {
    try {
      if (dir.type === 'delegate') {
        const toName = dir.params.to || dir.params.agent || '';
        const title = dir.params.title || 'Delegated Task';
        const description = dir.body || dir.params.description || '';
        const target = this.org.findAgentByName(toName);

        if (!target) {
          dir.executionStatus = 'failed';
          dir.executionNote = `Agent "${toName}" not found.`;
          return;
        }
        if (ctx.senderAgent && !hasPermission(ctx.senderAgent, 'tasks:delegate')) {
          dir.executionStatus = 'blocked';
          dir.executionNote = `${ctx.senderAgent.name} lacks "tasks:delegate" permission.`;
          return;
        }
        if (
          ctx.senderAgent &&
          ctx.senderAgent.provider !== target.provider &&
          !hasPermission(ctx.senderAgent, 'cross_provider:communicate')
        ) {
          dir.executionStatus = 'blocked';
          dir.executionNote = `Cross-provider communication denied for ${ctx.senderAgent.name}.`;
          return;
        }

        const requestedEffort = dir.params.effort && isValidEffort(dir.params.effort) ? dir.params.effort : target.effort;

        const task = this.tasks.create({
          title,
          description,
          effort: requestedEffort,
          departmentId: target.departmentId ?? ctx.channel.departmentId,
          createdByType: ctx.senderType === 'agent' ? 'agent' : 'human',
          createdById: ctx.senderAgent?.id ?? 'human-exec',
          assignedAgentId: target.id,
          createDedicatedChannel: true,
        });

        const dispatch = await this.dispatchAgent({
          agentId: target.id,
          channelId: task.channelId ?? ctx.channel.id,
          parentMessageId: null,
          taskId: task.id,
          triggerMessageId: null,
          hopDepth: ctx.senderAgent ? ctx.hopDepth + 1 : 0,
        });
        if (dispatch) {
          ctx.createdDispatches.push(dispatch);
          ctx.dispatchedAgentIds.add(target.id);
        }

        dir.executionStatus = 'executed';
        dir.executionNote = `Delegated task "${task.title}" (${task.id}) to ${target.name} [${target.provider}/${target.model}] (effort: ${task.effort}).`;

        this.audit.record({
          actorType: ctx.senderType === 'agent' ? 'agent' : 'human',
          actorId: ctx.senderAgent?.id ?? 'human-exec',
          actorName: ctx.senderName,
          category: 'comms',
          action: 'comms.cross_provider_delegation',
          severity: 'info',
          targetType: 'task',
          targetId: task.id,
          summary: `${ctx.senderName} (${ctx.senderAgent?.provider ?? 'human'}) delegated "${task.title}" to ${target.name} (${target.provider}).`,
        });
      } else if (dir.type === 'claim_file') {
        const filePath = dir.params.path || '';
        if (!ctx.senderAgent) {
          dir.executionStatus = 'failed';
          dir.executionNote = 'File claim directives must be sent by an agent identity.';
          return;
        }
        const lease = this.files.claimFile({
          filePath,
          agentId: ctx.senderAgent.id,
          taskId: ctx.channel.taskId,
        });
        dir.executionStatus = 'executed';
        dir.executionNote = `Acquired exclusive lease ${lease.id} on "${lease.filePath}" (expires ${lease.expiresAt}).`;
      } else if (dir.type === 'propose_edit') {
        const filePath = dir.params.path || '';
        if (!ctx.senderAgent) {
          dir.executionStatus = 'failed';
          dir.executionNote = 'File edit proposals must be sent by an agent identity.';
          return;
        }
        let lease = this.files.getActiveLeaseForPath(filePath);
        if (!lease) {
          lease = this.files.claimFile({ filePath, agentId: ctx.senderAgent.id, taskId: ctx.channel.taskId });
        } else if (lease.agentId !== ctx.senderAgent.id) {
          dir.executionStatus = 'blocked';
          dir.executionNote = `Cannot edit "${filePath}": actively leased by ${lease.agentName}.`;
          return;
        }
        this.files.writeSandbox(lease.id, dir.body ?? '');
        const integration = this.files.integrateLease(lease.id);
        if (integration.status === 'pending_approval') {
          dir.executionStatus = 'queued_approval';
          dir.executionNote = `Sandbox edit staged for "${filePath}" — awaiting Human Approval (${integration.approval?.id}).`;
        } else {
          dir.executionStatus = 'executed';
          dir.executionNote = `Integrated edit to "${filePath}" (${integration.status}).`;
        }
      } else if (dir.type === 'record_decision') {
        const title = dir.params.title || 'Recorded Decision';
        const kind = (dir.params.kind as 'decision' | 'spec' | 'runbook' | 'note') || 'decision';
        if (ctx.senderAgent && !hasPermission(ctx.senderAgent, 'decisions:publish')) {
          dir.executionStatus = 'blocked';
          dir.executionNote = `${ctx.senderAgent.name} lacks "decisions:publish" permission.`;
          return;
        }
        const entry = this.memory.create({
          kind,
          title,
          content: dir.body || dir.params.content || title,
          departmentId: ctx.channel.departmentId,
          authorType: ctx.senderType === 'agent' ? 'agent' : 'human',
          authorId: ctx.senderAgent?.id ?? 'human-exec',
          authorName: ctx.senderName,
          pinned: kind === 'decision',
        });
        dir.executionStatus = 'executed';
        dir.executionNote = `Saved to Project Memory (${entry.id}).`;
      } else if (dir.type === 'request_approval') {
        const title = dir.params.title || 'Agent Approval Request';
        const reason = dir.params.reason || dir.body || 'Requested human executive review.';
        const req = this.approvals.create({
          kind: 'agent_request',
          requestedByAgentId: ctx.senderAgent?.id ?? null,
          requestedByName: ctx.senderName,
          title,
          summary: reason,
          payload: { channelId: ctx.channel.id },
        });
        dir.executionStatus = 'queued_approval';
        dir.executionNote = `Created Human Approval Request (${req.id}).`;
      } else if (dir.type === 'spawn_subagent') {
        if (!ctx.senderAgent) {
          dir.executionStatus = 'failed';
          dir.executionNote = 'Only a manager agent can invoke SPAWN_SUBAGENT.';
          return;
        }
        const sub = this.org.spawnSubagent(ctx.senderAgent.id, {
          name: dir.params.name || `${ctx.senderAgent.name}-Sub`,
          role: dir.params.role || ctx.senderAgent.subagentRoles[0] || 'Specialist',
          provider: dir.params.provider as ProviderKind | undefined,
          model: dir.params.model,
        });
        dir.executionStatus = 'executed';
        dir.executionNote = `Spawned dynamic subagent "${sub.name}" (${sub.provider}/${sub.model}).`;
      } else if (dir.type === 'workflow_plan' && this.workflow) {
        const boxes = parseWorkflowBoxes(dir.body || '');
        const plan = this.workflow.createPlanFromTemplate({
          title: dir.params.title || 'AI-Planned Workflow',
          originalPrompt: dir.params.prompt || '',
          templateId: dir.params.template || 'feature',
          status: 'draft',
          customBoxes: boxes.length > 0 ? boxes : undefined,
        });
        dir.executionStatus = 'executed';
        dir.executionNote = `Populated Workflow "${plan.title}" (${plan.steps.length} boxes) in Draft mode on Screen 2.`;
      } else if (dir.type === 'step_update' && this.workflow) {
        const stepId = dir.params.id || '';
        if (!stepId) {
          dir.executionStatus = 'failed';
          dir.executionNote = 'STEP_UPDATE requires id="step-...".';
          return;
        }
        const updated = await this.workflow.updateStep(
          stepId,
          {
            progress: dir.params.progress !== undefined ? Number(dir.params.progress) : undefined,
            status: dir.params.status as WorkflowStepStatus | undefined,
            latestSummary: dir.params.summary || dir.body,
            nextSteps: dir.params.next || dir.params.nextsteps,
            todos: dir.params.todos ? parseTodoList(dir.params.todos) : undefined,
          },
          'agent',
        );
        dir.executionStatus = 'executed';
        dir.executionNote = `Updated Workflow box "${updated.title}" → ${updated.progress}% (${updated.status}).`;
      }
    } catch (err) {
      dir.executionStatus = 'failed';
      dir.executionNote = err instanceof Error ? err.message : 'Directive execution failed';
    }
  }

  public postSystemNotice(channelId: string, parentMessageId: string | null, content: string): Message {
    const id = `msg-${crypto.randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    this.appDb.db
      .prepare(
        `INSERT INTO messages (
          id, channel_id, parent_message_id, sender_type, sender_id, sender_name,
          sender_provider, sender_model, sender_effort, content, mentions_json, directives_json,
          dispatch_id, created_at
        ) VALUES (?, ?, ?, 'system', 'system', 'Agent Company OS', NULL, NULL, NULL, ?, '[]', '[]', NULL, ?)`,
      )
      .run(id, channelId, parentMessageId, content, now);
    const saved = this.mapMessage(this.appDb.db.prepare('SELECT * FROM messages WHERE id = ?').get(id)!);
    this.realtime.broadcast('messages:created', saved);
    return saved;
  }

  /**
   * Creates a token-efficient, effort-enforced Dispatch (Bootstrap on first turn, Delta-Only thereafter)
   * and routes it via the agent's Provider Adapter (respecting the global Pause All kill switch).
   */
  public async dispatchAgent(input: {
    agentId: string;
    channelId: string;
    parentMessageId?: string | null;
    taskId?: string | null;
    triggerMessageId?: string | null;
    hopDepth?: number;
    customPromptOverride?: string;
    forceBootstrap?: boolean;
  }): Promise<Dispatch | null> {
    const agent = this.org.getAgentById(input.agentId);
    const channel = this.getChannel(input.channelId);
    if (!agent || !channel || agent.lifecycleState === 'position_open') {
      return null;
    }

    const activeTask = input.taskId ? this.tasks.getById(input.taskId) : null;
    const enforcedEffort = resolveEffectiveEffort(agent.effort, activeTask?.effort);
    const policy = getEffortPolicy(enforcedEffort);

    const allChannelMsgs = this.listMessages(channel.id, input.parentMessageId ?? null);
    const recentMessages = allChannelMsgs.slice(-policy.contextMessageLimit);
    const triggerMsgRow = input.triggerMessageId
      ? this.appDb.db.prepare('SELECT * FROM messages WHERE id = ?').get(input.triggerMessageId)
      : undefined;
    const triggerMessage = triggerMsgRow ? this.mapMessage(triggerMsgRow) : null;

    // Check persistent session state to decide Bootstrap vs Delta-Only packet mode!
    const sessionRow = this.appDb.db
      .prepare('SELECT * FROM agent_sessions WHERE agent_id = ? AND channel_id = ?')
      .get(agent.id, channel.id) as
      | { last_message_id: string | null; last_message_created_at: string | null; turn_count: number }
      | undefined;

    const packetMode: PacketMode = !sessionRow || input.forceBootstrap ? 'bootstrap' : 'delta';
    const deltaMessages =
      packetMode === 'delta' && sessionRow?.last_message_created_at
        ? allChannelMsgs.filter((m) => m.createdAt > sessionRow.last_message_created_at!)
        : undefined;

    const teammates = this.org.getFullOrg().agents;
    const knowledge = this.memory.getRelevantForContext(
      agent.departmentId ?? channel.departmentId,
      policy.knowledgeRecordLimit,
    );
    const activeLeases = this.files.listLeases({ status: 'active' });
    const repoFilePaths = this.files.listFiles().map((f) => f.path);

    const built = buildContextPacket({
      agent,
      enforcedEffort,
      packetMode,
      channel,
      recentMessages,
      deltaMessages,
      triggerMessage,
      teammates,
      knowledge,
      activeTask,
      activeLeases,
      repoFilePaths,
      hopDepth: input.hopDepth ?? 0,
      customPromptOverride: input.customPromptOverride,
    });

    const dispatchId = `disp-${crypto.randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    const latestMsg = allChannelMsgs[allChannelMsgs.length - 1] ?? null;

    // Record session bookmark so the NEXT dispatch in this channel uses Delta-Only mode!
    this.appDb.db
      .prepare(
        `INSERT INTO agent_sessions (agent_id, channel_id, bootstrapped_at, last_message_id, last_message_created_at, turn_count)
         VALUES (?, ?, ?, ?, ?, 1)
         ON CONFLICT(agent_id, channel_id) DO UPDATE SET
           last_message_id = excluded.last_message_id,
           last_message_created_at = excluded.last_message_created_at,
           turn_count = agent_sessions.turn_count + 1`,
      )
      .run(agent.id, channel.id, now, latestMsg?.id ?? null, latestMsg?.createdAt ?? now);

    this.appDb.db
      .prepare(
        `INSERT INTO dispatches (
          id, agent_id, channel_id, parent_message_id, task_id, trigger_message_id,
          adapter_kind, provider, model, enforced_effort, packet_mode, estimated_tokens, saved_tokens_estimate,
          status, context_packet, response_text, error_message, hop_depth, created_at, dispatched_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, NULL, NULL, ?, ?, NULL, NULL)`,
      )
      .run(
        dispatchId,
        agent.id,
        channel.id,
        input.parentMessageId ?? null,
        input.taskId ?? null,
        input.triggerMessageId ?? null,
        agent.adapterKind,
        agent.provider,
        agent.model,
        enforcedEffort,
        built.packetMode,
        built.estimatedTokens,
        built.savedTokensEstimate,
        built.packet,
        input.hopDepth ?? 0,
        now,
      );

    // Honor Global Pause All Kill Switch
    if (this.isCompanyPaused()) {
      this.appDb.db.prepare(`UPDATE dispatches SET status = 'paused' WHERE id = ?`).run(dispatchId);
      const pausedDispatch = this.getDispatch(dispatchId)!;
      this.realtime.broadcast('dispatches:updated', pausedDispatch);
      this.realtime.broadcast('telemetry:updated', this.getTelemetry());
      return pausedDispatch;
    }

    // Dispatch through the configured provider-independent adapter
    const adapter = this.adapters.get(agent.adapterKind);
    const result = await adapter.dispatch({
      dispatchId,
      agentId: agent.id,
      agentName: agent.name,
      provider: agent.provider,
      model: agent.model,
      enforcedEffort,
      channelId: channel.id,
      channelName: channel.name,
      parentMessageId: input.parentMessageId ?? null,
      taskId: input.taskId ?? null,
      adapterConfig: agent.adapterConfig,
      contextPacket: built.packet,
    });

    const dispatchedAt = new Date().toISOString();
    this.appDb.db
      .prepare('UPDATE dispatches SET status = ?, error_message = ?, dispatched_at = ? WHERE id = ?')
      .run(result.status, result.errorMessage ?? null, dispatchedAt, dispatchId);

    if (result.status === 'dispatched') {
      this.org.setRuntimeStatus(agent.id, 'dispatched', 'running');
    } else if (result.status === 'awaiting_handoff') {
      this.org.setRuntimeStatus(agent.id, 'awaiting_handoff');
    } else if (result.status === 'failed') {
      this.org.setRuntimeStatus(agent.id, 'error');
    }

    const saved = this.getDispatch(dispatchId)!;
    this.audit.record({
      actorType: 'system',
      actorId: 'router',
      actorName: 'Message Router',
      category: 'adapter',
      action: `dispatch.${result.status}`,
      severity: result.status === 'failed' ? 'warning' : 'info',
      targetType: 'dispatch',
      targetId: dispatchId,
      summary: `${agent.name} (${agent.provider}/${enforcedEffort} · ${built.packetMode} ~${built.estimatedTokens} tok${
        built.savedTokensEstimate > 0 ? `, saved ~${built.savedTokensEstimate}` : ''
      }) → ${result.status}.`,
      details: { adapterKind: agent.adapterKind, packetMode: built.packetMode, estimatedTokens: built.estimatedTokens },
    });
    this.realtime.broadcast('dispatches:updated', saved);
    this.realtime.broadcast('telemetry:updated', this.getTelemetry());
    return saved;
  }

  public async completeDispatch(
    dispatchId: string,
    responseText: string,
    source: 'human_handoff' | 'browser_bridge' | 'webhook_relay',
  ): Promise<{ dispatch: Dispatch; message: Message; downstreamDispatches: Dispatch[] }> {
    const dispatch = this.getDispatch(dispatchId);
    if (!dispatch) throw new Error(`Dispatch ${dispatchId} not found.`);
    if (dispatch.status === 'responded' || dispatch.status === 'cancelled') {
      throw new Error(`Dispatch ${dispatchId} is already ${dispatch.status}.`);
    }

    const now = new Date().toISOString();
    this.appDb.db
      .prepare('UPDATE dispatches SET status = ?, response_text = ?, completed_at = ? WHERE id = ?')
      .run('responded', responseText.trim(), now, dispatchId);

    const pendingForAgent = this.appDb.db
      .prepare(`SELECT COUNT(*) as cnt FROM dispatches WHERE agent_id = ? AND status IN ('awaiting_handoff', 'dispatched')`)
      .get(dispatch.agentId) as { cnt: number };

    this.org.setRuntimeStatus(
      dispatch.agentId,
      Number(pendingForAgent?.cnt ?? 0) > 0 ? 'awaiting_handoff' : 'idle',
      'running',
    );

    const { message, createdDispatches } = await this.postMessage({
      channelId: dispatch.channelId,
      parentMessageId: dispatch.parentMessageId,
      senderType: 'agent',
      senderId: dispatch.agentId,
      content: responseText.trim(),
      dispatchId: dispatch.id,
      hopDepth: dispatch.hopDepth,
    });

    // If this reply came in #management, feed it automatically to the active 3-Round Debate!
    if (dispatch.channelId === 'ch-management' && this.debate) {
      await this.debate.ingestAgentReply(dispatch.agentId, responseText.trim());
    }

    const updatedDispatch = this.getDispatch(dispatchId)!;
    this.audit.record({
      actorType: 'agent',
      actorId: dispatch.agentId,
      actorName: dispatch.agentName ?? dispatch.agentId,
      category: 'adapter',
      action: 'dispatch.responded',
      targetType: 'dispatch',
      targetId: dispatchId,
      summary: `Received real response from ${dispatch.agentName} via ${source}${
        createdDispatches.length > 0 ? ` (triggered ${createdDispatches.length} follow-up dispatch(es))` : ''
      }.`,
    });
    this.realtime.broadcast('dispatches:updated', updatedDispatch);
    this.realtime.broadcast('telemetry:updated', this.getTelemetry());

    return { dispatch: updatedDispatch, message, downstreamDispatches: createdDispatches };
  }

  public failDispatch(dispatchId: string, errorMessage: string): Dispatch {
    const now = new Date().toISOString();
    this.appDb.db
      .prepare('UPDATE dispatches SET status = ?, error_message = ?, completed_at = ? WHERE id = ?')
      .run('failed', errorMessage, now, dispatchId);
    const updated = this.getDispatch(dispatchId)!;
    if (updated) {
      this.org.setRuntimeStatus(updated.agentId, 'error');
      this.realtime.broadcast('dispatches:updated', updated);
    }
    return updated;
  }

  public cancelDispatch(dispatchId: string): Dispatch {
    const now = new Date().toISOString();
    this.appDb.db
      .prepare('UPDATE dispatches SET status = ?, completed_at = ? WHERE id = ?')
      .run('cancelled', now, dispatchId);
    const updated = this.getDispatch(dispatchId)!;
    if (updated) {
      this.realtime.broadcast('dispatches:updated', updated);
    }
    return updated;
  }
}
