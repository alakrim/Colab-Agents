import crypto from 'node:crypto';
import type { AppDatabase } from '../db/database.js';
import type { DebateSession, Dispatch, WorkflowPlan } from '../domain/types.js';
import { parseWorkflowBoxes } from '../adapters/protocolParser.js';
import type { AuditService } from './auditService.js';
import type { OrgService } from './orgService.js';
import type { RealtimeHub } from './realtime.js';
import type { WorkflowService } from './workflowService.js';

export interface DebateDispatchFn {
  (input: {
    agentId: string;
    channelId: string;
    customPromptOverride: string;
  }): Promise<Dispatch | null>;
}

/**
 * Bounded 3-Round Management AAA Debate Service (#management).
 * Coordinates the strongest Claude orchestrator + strongest Gemini orchestrator:
 * - Round 1: Blind parallel critique & AAA expansion (zero anchoring)
 * - Round 2: Adversarial cross-critique (cut bloat, resolve disagreements)
 * - Round 3: Compact convergence -> auto-populates Screen 2 (Workflow) as Draft for PM approval
 */
export class DebateService {
  private dispatchFn?: DebateDispatchFn;
  private postNoticeFn?: (channelId: string, content: string) => void;

  constructor(
    private readonly appDb: AppDatabase,
    private readonly org: OrgService,
    private readonly workflow: WorkflowService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeHub,
  ) {}

  public setHooks(hooks: {
    dispatchFn: DebateDispatchFn;
    postNoticeFn: (channelId: string, content: string) => void;
  }): void {
    this.dispatchFn = hooks.dispatchFn;
    this.postNoticeFn = hooks.postNoticeFn;
  }

  private mapRow(r: Record<string, unknown>): DebateSession {
    return {
      id: String(r.id),
      title: String(r.title),
      originalPrompt: String(r.original_prompt),
      templateId: String(r.template_id || 'feature'),
      githubRepoId: r.github_repo_id ? String(r.github_repo_id) : null,
      channelId: String(r.channel_id),
      claudeAgentId: String(r.claude_agent_id),
      geminiAgentId: String(r.gemini_agent_id),
      currentRound: Number(r.current_round ?? 1) as 1 | 2 | 3,
      status: r.status as DebateSession['status'],
      workflowPlanId: r.workflow_plan_id ? String(r.workflow_plan_id) : null,
      round1Claude: r.round1_claude ? String(r.round1_claude) : null,
      round1Gemini: r.round1_gemini ? String(r.round1_gemini) : null,
      round2Claude: r.round2_claude ? String(r.round2_claude) : null,
      round2Gemini: r.round2_gemini ? String(r.round2_gemini) : null,
      finalSynthesis: r.final_synthesis ? String(r.final_synthesis) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  public list(): DebateSession[] {
    return this.appDb.db
      .prepare('SELECT * FROM debates ORDER BY updated_at DESC')
      .all()
      .map((r) => this.mapRow(r));
  }

  public get(id: string): DebateSession | null {
    const row = this.appDb.db.prepare('SELECT * FROM debates WHERE id = ?').get(id);
    return row ? this.mapRow(row) : null;
  }

  public async startDebate(input: {
    title: string;
    originalPrompt: string;
    templateId?: string;
    githubRepoId?: string | null;
    claudeAgentId?: string;
    geminiAgentId?: string;
  }): Promise<{ debate: DebateSession; dispatches: Dispatch[] }> {
    const agents = this.org.getFullOrg().agents.filter((a) => a.lifecycleState !== 'position_open');
    const claude =
      (input.claudeAgentId ? this.org.getAgentById(input.claudeAgentId) : null) ??
      agents.find((a) => a.provider === 'claude');
    const gemini =
      (input.geminiAgentId ? this.org.getAgentById(input.geminiAgentId) : null) ??
      agents.find((a) => a.provider === 'gemini');

    if (!claude || !gemini) {
      throw new Error('Management Debate requires at least one configured Claude agent and one configured Gemini agent.');
    }

    const now = new Date().toISOString();
    const id = `deb-${crypto.randomUUID().slice(0, 8)}`;
    const channelId = 'ch-management';

    this.appDb.db
      .prepare(
        `INSERT INTO debates (
          id, title, original_prompt, template_id, github_repo_id, channel_id,
          claude_agent_id, gemini_agent_id, current_round, status, workflow_plan_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'round_1', NULL, ?, ?)`,
      )
      .run(
        id,
        input.title.trim(),
        input.originalPrompt.trim(),
        input.templateId || 'feature',
        input.githubRepoId ?? null,
        channelId,
        claude.id,
        gemini.id,
        now,
        now,
      );

    this.postNoticeFn?.(
      channelId,
      `Started AAA Management Debate "${input.title.trim()}" — Round 1 (Blind Parallel Critique) dispatched to ${claude.name} (${claude.model}) & ${gemini.name} (${gemini.model}).`,
    );

    const buildRound1Prompt = (agentName: string, peerName: string) =>
      [
        `=== #MANAGEMENT AAA DEBATE :: ROUND 1 (BLIND INDEPENDENT CRITIQUE) ===`,
        `Debate ID: ${id} | You are ${agentName}. Your peer ${peerName} is answering independently in parallel.`,
        `USER PROMPT: ${input.originalPrompt.trim()}`,
        `INSTRUCTIONS (Token-efficient, max ~250 words):`,
        `1. FLAWS & GAPS: What is missing, risky, or underspecified?`,
        `2. AAA UPGRADES: Concrete ideas that elevate this beyond the original prompt to AAA quality.`,
        `3. CORE vs AAA SPLIT: Clearly separate must-have Core steps from optional AAA Polish steps.`,
        `Do NOT write code yet. Be sharp, concise, and practical.`,
      ].join('\n');

    const dispatches: Dispatch[] = [];
    if (this.dispatchFn) {
      const d1 = await this.dispatchFn({
        agentId: claude.id,
        channelId,
        customPromptOverride: buildRound1Prompt(claude.name, gemini.name),
      });
      const d2 = await this.dispatchFn({
        agentId: gemini.id,
        channelId,
        customPromptOverride: buildRound1Prompt(gemini.name, claude.name),
      });
      if (d1) dispatches.push(d1);
      if (d2) dispatches.push(d2);
    }

    const debate = this.get(id)!;
    this.audit.record({
      actorType: 'human',
      actorId: 'human-exec',
      actorName: 'Product Manager',
      category: 'comms',
      action: 'debate.started',
      severity: 'decision',
      targetType: 'debate',
      targetId: id,
      summary: `Started AAA Management Debate "${debate.title}" (${claude.name} vs ${gemini.name}).`,
    });
    this.realtime.broadcast('debates:updated', debate);
    return { debate, dispatches };
  }

  /**
   * Called automatically whenever Claude or Gemini replies in #management,
   * recording their round contribution and advancing rounds automatically!
   */
  public async ingestAgentReply(agentId: string, content: string): Promise<void> {
    const activeRow = this.appDb.db
      .prepare(`SELECT * FROM debates WHERE status IN ('round_1', 'round_2', 'round_3') ORDER BY updated_at DESC LIMIT 1`)
      .get();
    if (!activeRow) return;

    const debate = this.mapRow(activeRow);
    const now = new Date().toISOString();

    if (debate.status === 'round_1') {
      if (agentId === debate.claudeAgentId && !debate.round1Claude) {
        this.appDb.db.prepare('UPDATE debates SET round1_claude = ?, updated_at = ? WHERE id = ?').run(content, now, debate.id);
      } else if (agentId === debate.geminiAgentId && !debate.round1Gemini) {
        this.appDb.db.prepare('UPDATE debates SET round1_gemini = ?, updated_at = ? WHERE id = ?').run(content, now, debate.id);
      }
      const refreshed = this.get(debate.id)!;
      if (refreshed.round1Claude && refreshed.round1Gemini) {
        await this.advanceToRound2(debate.id);
      } else {
        this.realtime.broadcast('debates:updated', refreshed);
      }
    } else if (debate.status === 'round_2') {
      if (agentId === debate.claudeAgentId && !debate.round2Claude) {
        this.appDb.db.prepare('UPDATE debates SET round2_claude = ?, updated_at = ? WHERE id = ?').run(content, now, debate.id);
      } else if (agentId === debate.geminiAgentId && !debate.round2Gemini) {
        this.appDb.db.prepare('UPDATE debates SET round2_gemini = ?, updated_at = ? WHERE id = ?').run(content, now, debate.id);
      }
      const refreshed = this.get(debate.id)!;
      if (refreshed.round2Claude && refreshed.round2Gemini) {
        await this.advanceToRound3(debate.id);
      } else {
        this.realtime.broadcast('debates:updated', refreshed);
      }
    } else if (debate.status === 'round_3') {
      await this.convergeDebateToWorkflow(debate.id, content);
    }
  }

  public async advanceToRound2(debateId: string): Promise<{ debate: DebateSession; dispatches: Dispatch[] }> {
    const debate = this.get(debateId);
    if (!debate) throw new Error(`Debate ${debateId} not found.`);
    const claude = this.org.getAgentById(debate.claudeAgentId)!;
    const gemini = this.org.getAgentById(debate.geminiAgentId)!;
    const now = new Date().toISOString();

    this.appDb.db
      .prepare(`UPDATE debates SET current_round = 2, status = 'round_2', updated_at = ? WHERE id = ?`)
      .run(now, debateId);

    this.postNoticeFn?.(
      debate.channelId,
      `Debate "${debate.title}" advancing to Round 2 (Adversarial Cross-Critique) — each orchestrator challenges the other's brief.`,
    );

    const dispatches: Dispatch[] = [];
    if (this.dispatchFn) {
      const d1 = await this.dispatchFn({
        agentId: claude.id,
        channelId: debate.channelId,
        customPromptOverride: [
          `=== #MANAGEMENT DEBATE :: ROUND 2 (CROSS-CRITIQUE) ===`,
          `Challenge ${gemini.name}'s Round 1 proposal. Cut bloat, spot flaws, keep only high-ROI AAA upgrades (max 180 words).`,
          `${gemini.name}'s Round 1:\n${debate.round1Gemini || '(pending)'}`,
        ].join('\n\n'),
      });
      const d2 = await this.dispatchFn({
        agentId: gemini.id,
        channelId: debate.channelId,
        customPromptOverride: [
          `=== #MANAGEMENT DEBATE :: ROUND 2 (CROSS-CRITIQUE) ===`,
          `Challenge ${claude.name}'s Round 1 proposal. Cut bloat, spot flaws, keep only high-ROI AAA upgrades (max 180 words).`,
          `${claude.name}'s Round 1:\n${debate.round1Claude || '(pending)'}`,
        ].join('\n\n'),
      });
      if (d1) dispatches.push(d1);
      if (d2) dispatches.push(d2);
    }

    const updated = this.get(debateId)!;
    this.realtime.broadcast('debates:updated', updated);
    return { debate: updated, dispatches };
  }

  public async advanceToRound3(debateId: string): Promise<{ debate: DebateSession; dispatches: Dispatch[] }> {
    const debate = this.get(debateId);
    if (!debate) throw new Error(`Debate ${debateId} not found.`);
    const synthesizer = this.org.getAgentById(debate.claudeAgentId)!;
    const now = new Date().toISOString();

    this.appDb.db
      .prepare(`UPDATE debates SET current_round = 3, status = 'round_3', updated_at = ? WHERE id = ?`)
      .run(now, debateId);

    this.postNoticeFn?.(
      debate.channelId,
      `Debate "${debate.title}" entering Round 3 (Convergence) — ${synthesizer.name} will populate the pre-made Workflow boxes for PM approval.`,
    );

    const dispatches: Dispatch[] = [];
    if (this.dispatchFn) {
      const d = await this.dispatchFn({
        agentId: synthesizer.id,
        channelId: debate.channelId,
        customPromptOverride: [
          `=== #MANAGEMENT DEBATE :: ROUND 3 (CONVERGE TO WORKFLOW BOXES) ===`,
          `Synthesize the debate into compact pre-made Workflow boxes for a non-technical Product Manager.`,
          `Round 2 Critiques:\n- Claude: ${debate.round2Claude || debate.round1Claude || ''}\n- Gemini: ${debate.round2Gemini || debate.round1Gemini || ''}`,
          `OUTPUT EXACTLY THIS COMPACT FORMAT (fills Screen 2 Workflow cards for a non-technical PM — NO technical jargon):`,
          `[WORKFLOW_PLAN title="${debate.title}"]`,
          `[BOX stage="blueprint" tier="core" owner="Atlas" effort="high" title="Short step name" next="Confirm plan with PM" todos="[ ] Confirm user flow; [ ] Split branches"]Plain-English goal | Why it matters to users[/BOX]`,
          `[BOX stage="build" tier="core" owner="Vega" effort="high" title="Core build step" next="Run automated checks" todos="[ ] Build core screens; [ ] Add safety checks"]Plain-English goal | User impact[/BOX]`,
          `[BOX stage="build" tier="aaa_polish" owner="Vega" effort="medium" title="AAA Polish step" next="Polish empty states" todos="[ ] Smooth transitions; [ ] Helpful hints"]Plain-English goal | User impact[/BOX]`,
          `[BOX stage="review" tier="core" owner="Cipher" effort="high" title="Dual-Model Audit" next="Prepare Draft PR for PM" todos="[ ] Cross-check bugs; [ ] Security review"]Plain-English goal | User impact[/BOX]`,
          `[/WORKFLOW_PLAN]`,
        ].join('\n\n'),
      });
      if (d) dispatches.push(d);
    }

    const updated = this.get(debateId)!;
    this.realtime.broadcast('debates:updated', updated);
    return { debate: updated, dispatches };
  }

  public async convergeDebateToWorkflow(
    debateId: string,
    synthesisText: string,
  ): Promise<{ debate: DebateSession; plan: WorkflowPlan }> {
    const debate = this.get(debateId);
    if (!debate) throw new Error(`Debate ${debateId} not found.`);
    const now = new Date().toISOString();

    const boxes = parseWorkflowBoxes(synthesisText);
    const plan = this.workflow.createPlanFromTemplate({
      title: debate.title,
      originalPrompt: debate.originalPrompt,
      templateId: debate.templateId,
      githubRepoId: debate.githubRepoId,
      debateSessionId: debate.id,
      status: 'draft',
      customBoxes: boxes.length > 0 ? boxes : undefined,
    });

    this.appDb.db
      .prepare(
        `UPDATE debates SET status = 'converged', final_synthesis = ?, workflow_plan_id = ?, updated_at = ? WHERE id = ?`,
      )
      .run(synthesisText, plan.id, now, debateId);

    this.postNoticeFn?.(
      debate.channelId,
      `Debate "${debate.title}" converged! Populated Workflow "${plan.title}" (${plan.steps.length} boxes) in Draft mode — open the Workflow screen to review, edit goals, toggle AAA Polish, and click Approve & Launch.`,
    );

    const updated = this.get(debateId)!;
    this.realtime.broadcast('debates:updated', updated);
    return { debate: updated, plan };
  }
}
