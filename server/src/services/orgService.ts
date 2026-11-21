import crypto from 'node:crypto';
import type { AppDatabase } from '../db/database.js';
import {
  DEFAULT_AGENT_PERMISSIONS,
  MANAGER_PERMISSIONS,
  type AdapterConfig,
  type AdapterKind,
  type AgentNode,
  type Department,
  type EffortLevel,
  type LifecycleState,
  type PermissionKey,
  type ProviderKind,
  type RuntimeStatus,
  type Team,
} from '../domain/types.js';
import { getEffortPolicy, isValidEffort } from '../domain/effort.js';
import { hasPermission } from '../domain/permissions.js';
import type { AuditService } from './auditService.js';
import type { RealtimeHub } from './realtime.js';

export interface TeamBlueprint {
  id: string;
  name: string;
  description: string;
  departmentName: string;
  members: Array<{
    name: string;
    title: string;
    provider: ProviderKind;
    model: string;
    effort: EffortLevel;
    roles: string[];
    responsibilities: string[];
    personality: string;
    customInstructions: string;
    maxSubagents: number;
    subagentRoles: string[];
    maxConcurrentWorkload: number;
    lifecycleState: LifecycleState;
    isLead?: boolean;
  }>;
}

export const PREDEFINED_TEAM_BLUEPRINTS: TeamBlueprint[] = [
  {
    id: 'blueprint-cross-provider-pod',
    name: 'Claude + Gemini Delivery Pod',
    description: 'Claude architect orchestrating a Gemini builder and a vacant QA reviewer seat.',
    departmentName: 'Engineering',
    members: [
      {
        name: 'Orion',
        title: 'Pod Lead & Systems Designer',
        provider: 'claude',
        model: 'claude-sonnet-4-6',
        effort: 'high',
        roles: ['Pod Lead', 'API Architect'],
        responsibilities: ['Scope sprint tickets', 'Review Gemini implementation diffs'],
        personality: 'Structured, crisp, quality-first.',
        customInstructions: 'Break specs into clear deliverables and delegate implementation to teammates.',
        maxSubagents: 2,
        subagentRoles: ['Spec Checker', 'Migration Assistant'],
        maxConcurrentWorkload: 4,
        lifecycleState: 'planned',
        isLead: true,
      },
      {
        name: 'Lyra',
        title: 'Full-Stack Implementation Engineer',
        provider: 'gemini',
        model: 'gemini-2.5-pro',
        effort: 'high',
        roles: ['Backend Engineer', 'UI Builder'],
        responsibilities: ['Claim files safely', 'Implement features and tests'],
        personality: 'Fast, pragmatic, detail-aware.',
        customInstructions: 'Always acquire file leases before editing and post concise summaries.',
        maxSubagents: 2,
        subagentRoles: ['Unit Test Writer', 'Docs Updater'],
        maxConcurrentWorkload: 4,
        lifecycleState: 'planned',
      },
      {
        name: 'Open Seat: QA Verifier',
        title: 'Quality & Regression Specialist',
        provider: 'claude',
        model: 'claude-haiku-4-5',
        effort: 'medium',
        roles: ['QA Verifier'],
        responsibilities: ['Verify edge cases and acceptance criteria'],
        personality: 'Methodical, thorough.',
        customInstructions: 'Validate deliverables against specs and flag regressions.',
        maxSubagents: 0,
        subagentRoles: [],
        maxConcurrentWorkload: 3,
        lifecycleState: 'position_open',
      },
    ],
  },
  {
    id: 'blueprint-red-team-review',
    name: 'Adversarial Dual-Model Review Pod',
    description: 'Cross-provider Claude & Gemini pair built for security audits and high-effort reviews.',
    departmentName: 'Engineering',
    members: [
      {
        name: 'Aegis',
        title: 'Security Review Lead',
        provider: 'claude',
        model: 'claude-opus-4-6',
        effort: 'max',
        roles: ['Security Lead', 'Threat Modeler'],
        responsibilities: ['Audit sensitive file integrations', 'Approve elevated permissions'],
        personality: 'Rigorous, zero-trust, clear.',
        customInstructions: 'Evaluate all changes for privilege escalation, race conditions, and data leaks.',
        maxSubagents: 2,
        subagentRoles: ['Dependency Auditor', 'Auth Flow Checker'],
        maxConcurrentWorkload: 3,
        lifecycleState: 'planned',
        isLead: true,
      },
      {
        name: 'Prism',
        title: 'Independent Second-Opinion Reviewer',
        provider: 'gemini',
        model: 'gemini-2.5-pro',
        effort: 'high',
        roles: ['Architecture Critic', 'Performance Reviewer'],
        responsibilities: ['Challenge assumptions from Claude peers', 'Verify scalability'],
        personality: 'Independent, analytical, direct.',
        customInstructions: 'Provide an independent cross-provider critique and cite concrete evidence.',
        maxSubagents: 1,
        subagentRoles: ['Benchmark Profiler'],
        maxConcurrentWorkload: 3,
        lifecycleState: 'planned',
      },
    ],
  },
];

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `item-${crypto.randomUUID().slice(0, 6)}`
  );
}

export class OrgService {
  private bridgeStatusResolver: (agentId: string) => boolean = () => false;

  constructor(
    private readonly appDb: AppDatabase,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeHub,
  ) {}

  public setBridgeStatusResolver(fn: (agentId: string) => boolean): void {
    this.bridgeStatusResolver = fn;
  }

  private mapDepartment(r: Record<string, unknown>): Department {
    return {
      id: String(r.id),
      name: String(r.name),
      slug: String(r.slug),
      description: String(r.description || ''),
      color: String(r.color || '#2563eb'),
      effortBudget: Number(r.effort_budget ?? 12),
      directorAgentId: r.director_agent_id ? String(r.director_agent_id) : null,
      createdAt: String(r.created_at),
    };
  }

  private mapTeam(r: Record<string, unknown>): Team {
    return {
      id: String(r.id),
      departmentId: String(r.department_id),
      name: String(r.name),
      purpose: String(r.purpose || ''),
      leadAgentId: r.lead_agent_id ? String(r.lead_agent_id) : null,
      isPredefined: Boolean(r.is_predefined),
      createdAt: String(r.created_at),
    };
  }

  private mapAgent(r: Record<string, unknown>): AgentNode {
    const id = String(r.id);
    const activeTasks = this.appDb.db
      .prepare(
        `SELECT effort FROM tasks
         WHERE (assigned_agent_id = ? OR claimed_by_agent_id = ?)
           AND status IN ('open', 'claimed', 'in_progress', 'in_review')`,
      )
      .all(id, id);

    const activeEffortLoad = activeTasks.reduce(
      (sum, t) => sum + getEffortPolicy((String(t.effort) as EffortLevel) || 'medium').budgetWeight,
      0,
    );

    const subagentRow = this.appDb.db
      .prepare(`SELECT COUNT(*) as cnt FROM agents WHERE spawned_by_agent_id = ? AND lifecycle_state != 'position_open'`)
      .get(id) as { cnt: number };

    const directReportsRow = this.appDb.db
      .prepare(`SELECT COUNT(*) as cnt FROM agents WHERE reports_to_id = ?`)
      .get(id) as { cnt: number };

    const pendingDispatchesRow = this.appDb.db
      .prepare(`SELECT COUNT(*) as cnt FROM dispatches WHERE agent_id = ? AND status IN ('queued', 'awaiting_handoff', 'dispatched')`)
      .get(id) as { cnt: number };

    return {
      id,
      name: String(r.name),
      title: String(r.title),
      avatarColor: String(r.avatar_color || '#2563eb'),
      lifecycleState: r.lifecycle_state as LifecycleState,
      runtimeStatus: r.runtime_status as RuntimeStatus,
      provider: r.provider as ProviderKind,
      model: String(r.model),
      adapterKind: r.adapter_kind as AdapterKind,
      adapterConfig: JSON.parse(String(r.adapter_config_json || '{}')),
      effort: r.effort as EffortLevel,
      roles: JSON.parse(String(r.roles_json || '[]')),
      responsibilities: JSON.parse(String(r.responsibilities_json || '[]')),
      directedDepartmentIds: JSON.parse(String(r.directed_departments_json || '[]')),
      customInstructions: String(r.custom_instructions || ''),
      personality: String(r.personality || ''),
      departmentId: r.department_id ? String(r.department_id) : null,
      teamId: r.team_id ? String(r.team_id) : null,
      reportsToId: r.reports_to_id ? String(r.reports_to_id) : null,
      isDynamicSubagent: Boolean(r.is_dynamic_subagent),
      spawnedByAgentId: r.spawned_by_agent_id ? String(r.spawned_by_agent_id) : null,
      maxSubagents: Number(r.max_subagents ?? 0),
      subagentRoles: JSON.parse(String(r.subagent_roles_json || '[]')),
      maxConcurrentWorkload: Number(r.max_concurrent_workload ?? 3),
      permissions: JSON.parse(String(r.permissions_json || '[]')),
      allowedPathGlobs: JSON.parse(String(r.allowed_path_globs_json || '["**"]')),
      restrictedPathGlobs: JSON.parse(String(r.restricted_path_globs_json || '["config/security/**",".env*"]')),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      activeWorkload: activeTasks.length,
      activeEffortLoad,
      activeSubagentCount: Number(subagentRow?.cnt ?? 0),
      directReportCount: Number(directReportsRow?.cnt ?? 0),
      pendingDispatchCount: Number(pendingDispatchesRow?.cnt ?? 0),
      bridgeConnected: this.bridgeStatusResolver(id),
    };
  }

  public getFullOrg(): {
    departments: Department[];
    teams: Team[];
    agents: AgentNode[];
    blueprints: TeamBlueprint[];
  } {
    const departments = this.appDb.db
      .prepare('SELECT * FROM departments ORDER BY created_at ASC')
      .all()
      .map((r) => this.mapDepartment(r));
    const teams = this.appDb.db
      .prepare('SELECT * FROM teams ORDER BY created_at ASC')
      .all()
      .map((r) => this.mapTeam(r));
    const agents = this.appDb.db
      .prepare('SELECT * FROM agents ORDER BY is_dynamic_subagent ASC, created_at ASC')
      .all()
      .map((r) => this.mapAgent(r));

    return { departments, teams, agents, blueprints: PREDEFINED_TEAM_BLUEPRINTS };
  }

  public getAgentById(id: string): AgentNode | null {
    const row = this.appDb.db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
    return row ? this.mapAgent(row) : null;
  }

  public findAgentByName(name: string): AgentNode | null {
    const clean = name.trim().toLowerCase();
    const rows = this.appDb.db.prepare('SELECT * FROM agents').all();
    for (const r of rows) {
      const n = String(r.name).toLowerCase();
      if (n === clean || n.replace(/\s+/g, '') === clean || n.split(' ')[0] === clean) {
        return this.mapAgent(r);
      }
    }
    return null;
  }

  public createDepartment(input: {
    name: string;
    description?: string;
    color?: string;
    effortBudget?: number;
    directorAgentId?: string | null;
  }): Department {
    const now = new Date().toISOString();
    const id = `dept-${crypto.randomUUID().slice(0, 8)}`;
    const slug = `${slugify(input.name)}-${id.slice(-4)}`;
    const budget = Math.max(2, Math.min(100, Number(input.effortBudget ?? 12)));

    this.appDb.transaction(() => {
      this.appDb.db
        .prepare(
          `INSERT INTO departments (id, name, slug, description, color, effort_budget, director_agent_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.name.trim(),
          slug,
          (input.description || '').trim(),
          input.color || '#2563eb',
          budget,
          input.directorAgentId ?? null,
          now,
        );

      // Automatically create a matching department channel in Collaboration workspace
      const chId = `ch-${slug}`;
      this.appDb.db
        .prepare(
          `INSERT OR IGNORE INTO channels (id, name, slug, kind, department_id, task_id, participant_ids_json, description, created_at)
           VALUES (?, ?, ?, 'department', ?, NULL, '[]', ?, ?)`,
        )
        .run(chId, slugify(input.name), slug, id, `${input.name.trim()} department channel`, now);

      if (input.directorAgentId) {
        const director = this.getAgentById(input.directorAgentId);
        if (director && !director.directedDepartmentIds.includes(id)) {
          const updatedDirs = [...director.directedDepartmentIds, id];
          this.appDb.db
            .prepare('UPDATE agents SET directed_departments_json = ?, updated_at = ? WHERE id = ?')
            .run(JSON.stringify(updatedDirs), now, director.id);
        }
      }
    });

    const dept = this.mapDepartment(this.appDb.db.prepare('SELECT * FROM departments WHERE id = ?').get(id)!);
    this.audit.record({
      actorType: 'human',
      actorId: 'human-exec',
      actorName: 'Executive Supervisor',
      category: 'org',
      action: 'department.created',
      targetType: 'department',
      targetId: dept.id,
      summary: `Created department "${dept.name}" (effort budget: ${dept.effortBudget}).`,
      details: { dept },
    });
    this.realtime.broadcast('org:updated', { reason: 'department.created', departmentId: dept.id });
    return dept;
  }

  public updateDepartment(
    id: string,
    patch: Partial<Pick<Department, 'name' | 'description' | 'color' | 'effortBudget' | 'directorAgentId'>>,
  ): Department {
    const existing = this.appDb.db.prepare('SELECT * FROM departments WHERE id = ?').get(id);
    if (!existing) throw new Error(`Department ${id} not found`);
    const cur = this.mapDepartment(existing);
    const updated = {
      ...cur,
      name: patch.name !== undefined ? patch.name.trim() : cur.name,
      description: patch.description !== undefined ? patch.description.trim() : cur.description,
      color: patch.color ?? cur.color,
      effortBudget: patch.effortBudget !== undefined ? Math.max(2, Number(patch.effortBudget)) : cur.effortBudget,
      directorAgentId: patch.directorAgentId !== undefined ? patch.directorAgentId : cur.directorAgentId,
    };

    this.appDb.db
      .prepare(
        `UPDATE departments SET name = ?, description = ?, color = ?, effort_budget = ?, director_agent_id = ? WHERE id = ?`,
      )
      .run(updated.name, updated.description, updated.color, updated.effortBudget, updated.directorAgentId, id);

    this.realtime.broadcast('org:updated', { reason: 'department.updated', departmentId: id });
    return updated;
  }

  public deleteDepartment(id: string): void {
    this.appDb.db.prepare('DELETE FROM departments WHERE id = ?').run(id);
    this.audit.record({
      actorType: 'human',
      actorId: 'human-exec',
      actorName: 'Executive Supervisor',
      category: 'org',
      action: 'department.deleted',
      severity: 'warning',
      targetType: 'department',
      targetId: id,
      summary: `Deleted department ${id}.`,
    });
    this.realtime.broadcast('org:updated', { reason: 'department.deleted', departmentId: id });
  }

  public createTeam(input: {
    departmentId: string;
    name: string;
    purpose?: string;
    leadAgentId?: string | null;
    isPredefined?: boolean;
  }): Team {
    const now = new Date().toISOString();
    const id = `team-${crypto.randomUUID().slice(0, 8)}`;
    this.appDb.db
      .prepare(
        `INSERT INTO teams (id, department_id, name, purpose, lead_agent_id, is_predefined, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.departmentId,
        input.name.trim(),
        (input.purpose || '').trim(),
        input.leadAgentId ?? null,
        input.isPredefined ? 1 : 0,
        now,
      );

    const team = this.mapTeam(this.appDb.db.prepare('SELECT * FROM teams WHERE id = ?').get(id)!);
    this.audit.record({
      actorType: 'human',
      actorId: 'human-exec',
      actorName: 'Executive Supervisor',
      category: 'org',
      action: 'team.created',
      targetType: 'team',
      targetId: team.id,
      summary: `Created team "${team.name}".`,
    });
    this.realtime.broadcast('org:updated', { reason: 'team.created', teamId: team.id });
    return team;
  }

  private assertNoReportingCycle(agentId: string, candidateManagerId: string | null): void {
    if (!candidateManagerId) return;
    if (candidateManagerId === agentId) {
      throw new Error('An agent cannot report to itself.');
    }
    const visited = new Set<string>([agentId]);
    let cursor: string | null = candidateManagerId;
    while (cursor) {
      if (visited.has(cursor)) {
        throw new Error('Reporting hierarchy cycle detected. Choose a superior outside this agent’s subordinate tree.');
      }
      visited.add(cursor);
      const row = this.appDb.db.prepare('SELECT reports_to_id FROM agents WHERE id = ?').get(cursor) as
        | { reports_to_id: string | null }
        | undefined;
      cursor = row?.reports_to_id ? String(row.reports_to_id) : null;
    }
  }

  public createAgentOrPosition(input: {
    name: string;
    title: string;
    avatarColor?: string;
    lifecycleState?: LifecycleState;
    provider?: ProviderKind;
    model?: string;
    adapterKind?: AdapterKind;
    adapterConfig?: AdapterConfig;
    effort?: EffortLevel;
    roles?: string[];
    responsibilities?: string[];
    directedDepartmentIds?: string[];
    customInstructions?: string;
    personality?: string;
    departmentId?: string | null;
    teamId?: string | null;
    reportsToId?: string | null;
    isDynamicSubagent?: boolean;
    spawnedByAgentId?: string | null;
    maxSubagents?: number;
    subagentRoles?: string[];
    maxConcurrentWorkload?: number;
    permissions?: PermissionKey[];
    allowedPathGlobs?: string[];
    restrictedPathGlobs?: string[];
  }): AgentNode {
    const now = new Date().toISOString();
    const id = `${input.lifecycleState === 'position_open' ? 'pos' : 'agent'}-${crypto.randomUUID().slice(0, 8)}`;
    const lifecycleState: LifecycleState = input.lifecycleState ?? 'planned';
    const effort: EffortLevel = input.effort && isValidEffort(input.effort) ? input.effort : 'medium';

    // Honest runtime status based on lifecycle state
    const runtimeStatus: RuntimeStatus =
      lifecycleState === 'position_open' ? 'vacant' : lifecycleState === 'running' ? 'idle' : 'offline';

    const maxSubagents = Math.max(0, Number(input.maxSubagents ?? 0));
    const permissions =
      input.permissions ?? (maxSubagents > 0 ? MANAGER_PERMISSIONS : DEFAULT_AGENT_PERMISSIONS);

    this.appDb.db
      .prepare(
        `INSERT INTO agents (
          id, name, title, avatar_color, lifecycle_state, runtime_status,
          provider, model, adapter_kind, adapter_config_json, effort,
          roles_json, responsibilities_json, directed_departments_json,
          custom_instructions, personality, department_id, team_id, reports_to_id,
          is_dynamic_subagent, spawned_by_agent_id, max_subagents, subagent_roles_json,
          max_concurrent_workload, permissions_json, allowed_path_globs_json, restricted_path_globs_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name.trim(),
        input.title.trim(),
        input.avatarColor || (input.provider === 'gemini' ? '#2563eb' : '#d97706'),
        lifecycleState,
        runtimeStatus,
        input.provider ?? 'claude',
        input.model ?? (input.provider === 'gemini' ? 'gemini-2.5-pro' : 'claude-sonnet-4-6'),
        input.adapterKind ?? 'human_handoff',
        JSON.stringify(input.adapterConfig ?? {}),
        effort,
        JSON.stringify(input.roles && input.roles.length > 0 ? input.roles : [input.title.trim()]),
        JSON.stringify(input.responsibilities ?? []),
        JSON.stringify(input.directedDepartmentIds ?? []),
        (input.customInstructions || '').trim(),
        (input.personality || '').trim(),
        input.departmentId ?? null,
        input.teamId ?? null,
        input.reportsToId ?? null,
        input.isDynamicSubagent ? 1 : 0,
        input.spawnedByAgentId ?? null,
        maxSubagents,
        JSON.stringify(input.subagentRoles ?? []),
        Math.max(1, Number(input.maxConcurrentWorkload ?? 3)),
        JSON.stringify(permissions),
        JSON.stringify(input.allowedPathGlobs ?? ['**']),
        JSON.stringify(input.restrictedPathGlobs ?? ['config/security/**', '.env*']),
        now,
        now,
      );

    const created = this.getAgentById(id)!;
    this.audit.record({
      actorType: input.spawnedByAgentId ? 'agent' : 'human',
      actorId: input.spawnedByAgentId ?? 'human-exec',
      actorName: input.spawnedByAgentId
        ? this.getAgentById(input.spawnedByAgentId)?.name || input.spawnedByAgentId
        : 'Executive Supervisor',
      category: 'org',
      action: lifecycleState === 'position_open' ? 'position.opened' : 'agent.created',
      targetType: 'agent',
      targetId: created.id,
      summary: `Created ${lifecycleState === 'position_open' ? 'open position' : 'agent'} "${created.name}" (${created.provider}/${created.model}, effort: ${created.effort}).`,
      details: { roles: created.roles, effort: created.effort, provider: created.provider },
    });
    this.realtime.broadcast('org:updated', { reason: 'agent.created', agentId: created.id });
    return created;
  }

  public updateAgent(
    id: string,
    patch: Partial<{
      name: string;
      title: string;
      avatarColor: string;
      lifecycleState: LifecycleState;
      runtimeStatus: RuntimeStatus;
      provider: ProviderKind;
      model: string;
      adapterKind: AdapterKind;
      adapterConfig: AdapterConfig;
      effort: EffortLevel;
      roles: string[];
      responsibilities: string[];
      directedDepartmentIds: string[];
      customInstructions: string;
      personality: string;
      departmentId: string | null;
      teamId: string | null;
      reportsToId: string | null;
      maxSubagents: number;
      subagentRoles: string[];
      maxConcurrentWorkload: number;
      permissions: PermissionKey[];
      allowedPathGlobs: string[];
      restrictedPathGlobs: string[];
    }>,
  ): AgentNode {
    const cur = this.getAgentById(id);
    if (!cur) throw new Error(`Agent/Position ${id} not found`);

    if (patch.reportsToId !== undefined) {
      this.assertNoReportingCycle(id, patch.reportsToId);
    }

    const nextLifecycle = patch.lifecycleState ?? cur.lifecycleState;
    let nextStatus = patch.runtimeStatus ?? cur.runtimeStatus;
    if (patch.lifecycleState && !patch.runtimeStatus) {
      if (nextLifecycle === 'position_open') nextStatus = 'vacant';
      else if (nextLifecycle === 'planned') nextStatus = 'offline';
      else if (nextLifecycle === 'running' && (cur.runtimeStatus === 'vacant' || cur.runtimeStatus === 'offline')) {
        nextStatus = 'idle';
      }
    }

    const nextEffort = patch.effort && isValidEffort(patch.effort) ? patch.effort : cur.effort;
    const now = new Date().toISOString();

    const merged: AgentNode = {
      ...cur,
      name: patch.name !== undefined ? patch.name.trim() : cur.name,
      title: patch.title !== undefined ? patch.title.trim() : cur.title,
      avatarColor: patch.avatarColor ?? cur.avatarColor,
      lifecycleState: nextLifecycle,
      runtimeStatus: nextStatus,
      provider: patch.provider ?? cur.provider,
      model: patch.model ?? cur.model,
      adapterKind: patch.adapterKind ?? cur.adapterKind,
      adapterConfig: patch.adapterConfig ?? cur.adapterConfig,
      effort: nextEffort,
      roles: patch.roles ?? cur.roles,
      responsibilities: patch.responsibilities ?? cur.responsibilities,
      directedDepartmentIds: patch.directedDepartmentIds ?? cur.directedDepartmentIds,
      customInstructions: patch.customInstructions !== undefined ? patch.customInstructions : cur.customInstructions,
      personality: patch.personality !== undefined ? patch.personality : cur.personality,
      departmentId: patch.departmentId !== undefined ? patch.departmentId : cur.departmentId,
      teamId: patch.teamId !== undefined ? patch.teamId : cur.teamId,
      reportsToId: patch.reportsToId !== undefined ? patch.reportsToId : cur.reportsToId,
      maxSubagents: patch.maxSubagents !== undefined ? Math.max(0, Number(patch.maxSubagents)) : cur.maxSubagents,
      subagentRoles: patch.subagentRoles ?? cur.subagentRoles,
      maxConcurrentWorkload:
        patch.maxConcurrentWorkload !== undefined
          ? Math.max(1, Number(patch.maxConcurrentWorkload))
          : cur.maxConcurrentWorkload,
      permissions: patch.permissions ?? cur.permissions,
      allowedPathGlobs: patch.allowedPathGlobs ?? cur.allowedPathGlobs,
      restrictedPathGlobs: patch.restrictedPathGlobs ?? cur.restrictedPathGlobs,
      updatedAt: now,
    };

    this.appDb.db
      .prepare(
        `UPDATE agents SET
          name = ?, title = ?, avatar_color = ?, lifecycle_state = ?, runtime_status = ?,
          provider = ?, model = ?, adapter_kind = ?, adapter_config_json = ?, effort = ?,
          roles_json = ?, responsibilities_json = ?, directed_departments_json = ?,
          custom_instructions = ?, personality = ?, department_id = ?, team_id = ?, reports_to_id = ?,
          max_subagents = ?, subagent_roles_json = ?, max_concurrent_workload = ?,
          permissions_json = ?, allowed_path_globs_json = ?, restricted_path_globs_json = ?,
          updated_at = ?
         WHERE id = ?`,
      )
      .run(
        merged.name,
        merged.title,
        merged.avatarColor,
        merged.lifecycleState,
        merged.runtimeStatus,
        merged.provider,
        merged.model,
        merged.adapterKind,
        JSON.stringify(merged.adapterConfig),
        merged.effort,
        JSON.stringify(merged.roles),
        JSON.stringify(merged.responsibilities),
        JSON.stringify(merged.directedDepartmentIds),
        merged.customInstructions,
        merged.personality,
        merged.departmentId,
        merged.teamId,
        merged.reportsToId,
        merged.maxSubagents,
        JSON.stringify(merged.subagentRoles),
        merged.maxConcurrentWorkload,
        JSON.stringify(merged.permissions),
        JSON.stringify(merged.allowedPathGlobs),
        JSON.stringify(merged.restrictedPathGlobs),
        merged.updatedAt,
        id,
      );

    // Keep departments.director_agent_id synchronized if directedDepartmentIds changed
    if (patch.directedDepartmentIds !== undefined) {
      for (const deptId of merged.directedDepartmentIds) {
        this.appDb.db.prepare('UPDATE departments SET director_agent_id = ? WHERE id = ?').run(id, deptId);
      }
    }

    const updated = this.getAgentById(id)!;
    this.audit.record({
      actorType: 'human',
      actorId: 'human-exec',
      actorName: 'Executive Supervisor',
      category: 'org',
      action: 'agent.updated',
      targetType: 'agent',
      targetId: id,
      summary: `Updated "${updated.name}" (${updated.lifecycleState} · ${updated.provider}/${updated.model} · effort: ${updated.effort}).`,
      details: { changedKeys: Object.keys(patch) },
    });
    this.realtime.broadcast('org:updated', { reason: 'agent.updated', agentId: id });
    return updated;
  }

  public promoteAgent(
    agentId: string,
    opts: { newTitle?: string; directDepartmentId?: string | null; newReportsToId?: string | null; extraSubagents?: number },
  ): AgentNode {
    const agent = this.getAgentById(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);

    const nextDirected = new Set(agent.directedDepartmentIds);
    if (opts.directDepartmentId) nextDirected.add(opts.directDepartmentId);

    const nextPerms = new Set<PermissionKey>(agent.permissions);
    for (const p of MANAGER_PERMISSIONS) nextPerms.add(p);

    const promoted = this.updateAgent(agentId, {
      title: opts.newTitle || `Director — ${agent.title}`,
      reportsToId: opts.newReportsToId !== undefined ? opts.newReportsToId : null,
      directedDepartmentIds: Array.from(nextDirected),
      maxSubagents: Math.max(agent.maxSubagents + (opts.extraSubagents ?? 2), 2),
      permissions: Array.from(nextPerms),
    });

    this.audit.record({
      actorType: 'human',
      actorId: 'human-exec',
      actorName: 'Executive Supervisor',
      category: 'org',
      action: 'agent.promoted',
      severity: 'decision',
      targetType: 'agent',
      targetId: agentId,
      summary: `Promoted "${promoted.name}" to "${promoted.title}" with subagent quota ${promoted.maxSubagents}.`,
    });
    return promoted;
  }

  public spawnSubagent(
    managerId: string,
    input: {
      name: string;
      role: string;
      provider?: ProviderKind;
      model?: string;
      effort?: EffortLevel;
      customInstructions?: string;
    },
  ): AgentNode {
    const manager = this.getAgentById(managerId);
    if (!manager) throw new Error(`Manager agent ${managerId} not found`);

    if (!hasPermission(manager, 'org:spawn_subagents')) {
      throw new Error(`Agent "${manager.name}" does not have permission "org:spawn_subagents".`);
    }

    const activeCount = manager.activeSubagentCount ?? 0;
    if (activeCount >= manager.maxSubagents) {
      throw new Error(
        `Subagent quota exceeded: "${manager.name}" already has ${activeCount}/${manager.maxSubagents} active subagents.`,
      );
    }

    if (
      manager.subagentRoles.length > 0 &&
      !manager.subagentRoles.some((r) => r.toLowerCase() === input.role.trim().toLowerCase())
    ) {
      // Still allow if explicitly created by human, or enforce role catalog — let's warn/enforce cleanly:
      // Actually allow role if non-empty, or validate against subagentRoles when defined
      const allowed = manager.subagentRoles.join(', ');
      throw new Error(
        `Role "${input.role}" is not in ${manager.name}'s authorized subagent roles (${allowed}). Update the manager's allowed subagent roles first.`,
      );
    }

    const subagent = this.createAgentOrPosition({
      name: input.name,
      title: input.role,
      lifecycleState: 'planned',
      provider: input.provider ?? manager.provider,
      model: input.model ?? manager.model,
      adapterKind: manager.adapterKind,
      effort: input.effort ?? 'medium',
      roles: [input.role],
      responsibilities: [`Dynamic subagent spawned by ${manager.name} for ${input.role}`],
      customInstructions:
        input.customInstructions ||
        `You are a dynamic subagent (${input.role}) reporting directly to ${manager.name}. Stay scoped to your assigned task and report deliverables clearly.`,
      personality: 'Focused, responsive, scoped.',
      departmentId: manager.departmentId,
      teamId: manager.teamId,
      reportsToId: manager.id,
      isDynamicSubagent: true,
      spawnedByAgentId: manager.id,
      maxSubagents: 0,
      maxConcurrentWorkload: 2,
      permissions: DEFAULT_AGENT_PERMISSIONS,
      allowedPathGlobs: manager.allowedPathGlobs,
      restrictedPathGlobs: manager.restrictedPathGlobs,
    });

    return subagent;
  }

  public instantiateBlueprint(blueprintId: string, departmentId: string, reportsToId: string | null): {
    team: Team;
    agents: AgentNode[];
  } {
    const bp = PREDEFINED_TEAM_BLUEPRINTS.find((b) => b.id === blueprintId);
    if (!bp) throw new Error(`Blueprint ${blueprintId} not found`);

    const team = this.createTeam({
      departmentId,
      name: bp.name,
      purpose: bp.description,
      isPredefined: true,
    });

    const createdAgents: AgentNode[] = [];
    let leadId: string | null = null;

    for (const m of bp.members) {
      const agent = this.createAgentOrPosition({
        name: m.name,
        title: m.title,
        lifecycleState: m.lifecycleState,
        provider: m.provider,
        model: m.model,
        effort: m.effort,
        roles: m.roles,
        responsibilities: m.responsibilities,
        personality: m.personality,
        customInstructions: m.customInstructions,
        departmentId,
        teamId: team.id,
        reportsToId: m.isLead ? reportsToId : leadId ?? reportsToId,
        maxSubagents: m.maxSubagents,
        subagentRoles: m.subagentRoles,
        maxConcurrentWorkload: m.maxConcurrentWorkload,
      });
      if (m.isLead) {
        leadId = agent.id;
        this.appDb.db.prepare('UPDATE teams SET lead_agent_id = ? WHERE id = ?').run(leadId, team.id);
      }
      createdAgents.push(agent);
    }

    return { team, agents: createdAgents };
  }

  public deleteAgent(id: string): void {
    const existing = this.getAgentById(id);
    if (!existing) throw new Error(`Agent ${id} not found`);

    this.appDb.transaction(() => {
      // Reparent direct reports up to the deleted agent's superior so the org tree never orphans subordinates
      this.appDb.db
        .prepare('UPDATE agents SET reports_to_id = ? WHERE reports_to_id = ?')
        .run(existing.reportsToId, id);
      this.appDb.db.prepare('DELETE FROM agents WHERE id = ?').run(id);
    });

    this.audit.record({
      actorType: 'human',
      actorId: 'human-exec',
      actorName: 'Executive Supervisor',
      category: 'org',
      action: 'agent.removed',
      severity: 'warning',
      targetType: 'agent',
      targetId: id,
      summary: `Removed "${existing.name}" from organization (direct reports reassigned to superior).`,
    });
    this.realtime.broadcast('org:updated', { reason: 'agent.removed', agentId: id });
  }

  public setRuntimeStatus(agentId: string, status: RuntimeStatus, lifecycleOverride?: LifecycleState): void {
    const now = new Date().toISOString();
    if (lifecycleOverride) {
      this.appDb.db
        .prepare('UPDATE agents SET runtime_status = ?, lifecycle_state = ?, updated_at = ? WHERE id = ?')
        .run(status, lifecycleOverride, now, agentId);
    } else {
      this.appDb.db
        .prepare('UPDATE agents SET runtime_status = ?, updated_at = ? WHERE id = ?')
        .run(status, now, agentId);
    }
    this.realtime.broadcast('org:status', { agentId, runtimeStatus: status, lifecycleState: lifecycleOverride });
  }
}
