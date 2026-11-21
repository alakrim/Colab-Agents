import crypto from 'node:crypto';
import type { AppDatabase } from '../db/database.js';
import type { EffortLevel, Task, TaskDeliverable, TaskPriority, TaskStatus } from '../domain/types.js';
import { isValidEffort } from '../domain/effort.js';
import type { AuditService } from './auditService.js';
import type { OrgService } from './orgService.js';
import type { RealtimeHub } from './realtime.js';

export class TaskService {
  constructor(
    private readonly appDb: AppDatabase,
    private readonly org: OrgService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeHub,
  ) {}

  private mapTask(r: Record<string, unknown>): Task {
    const depIds: string[] = JSON.parse(String(r.dependency_ids_json || '[]'));
    let blockedByOpenDeps = false;
    if (depIds.length > 0) {
      const placeholders = depIds.map(() => '?').join(',');
      const openDep = this.appDb.db
        .prepare(`SELECT COUNT(*) as cnt FROM tasks WHERE id IN (${placeholders}) AND status != 'completed'`)
        .get(...depIds) as { cnt: number };
      blockedByOpenDeps = Number(openDep?.cnt ?? 0) > 0;
    }

    const repoRow = r.github_repo_id
      ? (this.appDb.db.prepare('SELECT full_name FROM github_repos WHERE id = ?').get(String(r.github_repo_id)) as
          | { full_name: string }
          | undefined)
      : undefined;

    return {
      id: String(r.id),
      title: String(r.title),
      description: String(r.description || ''),
      status: r.status as TaskStatus,
      priority: r.priority as TaskPriority,
      effort: r.effort as EffortLevel,
      departmentId: r.department_id ? String(r.department_id) : null,
      channelId: r.channel_id ? String(r.channel_id) : null,
      createdByType: r.created_by_type as 'human' | 'agent',
      createdById: String(r.created_by_id),
      assignedAgentId: r.assigned_agent_id ? String(r.assigned_agent_id) : null,
      claimedByAgentId: r.claimed_by_agent_id ? String(r.claimed_by_agent_id) : null,
      parentTaskId: r.parent_task_id ? String(r.parent_task_id) : null,
      dependencyIds: depIds,
      deliverables: JSON.parse(String(r.deliverables_json || '[]')),
      githubRepoId: r.github_repo_id ? String(r.github_repo_id) : null,
      githubRepoName: repoRow?.full_name ?? null,
      githubIssueNumber: r.github_issue_number != null ? Number(r.github_issue_number) : null,
      githubBranch: r.github_branch ? String(r.github_branch) : null,
      githubPrNumber: r.github_pr_number != null ? Number(r.github_pr_number) : null,
      githubPrUrl: r.github_pr_url ? String(r.github_pr_url) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      blockedByOpenDeps,
    };
  }

  public list(filter?: { status?: string; agentId?: string; departmentId?: string }): Task[] {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (filter?.status && filter.status !== 'all') {
      clauses.push('status = ?');
      values.push(filter.status);
    }
    if (filter?.agentId) {
      clauses.push('(assigned_agent_id = ? OR claimed_by_agent_id = ?)');
      values.push(filter.agentId, filter.agentId);
    }
    if (filter?.departmentId) {
      clauses.push('department_id = ?');
      values.push(filter.departmentId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.appDb.db.prepare(`SELECT * FROM tasks ${where} ORDER BY created_at DESC`).all(...values);
    return rows.map((r) => this.mapTask(r));
  }

  public getById(id: string): Task | null {
    const row = this.appDb.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    return row ? this.mapTask(row) : null;
  }

  private assertWorkloadCapacity(agentId: string, excludeTaskId?: string): void {
    const agent = this.org.getAgentById(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found.`);
    if (agent.lifecycleState === 'position_open') {
      throw new Error(`Cannot assign work to vacant position "${agent.name}". Fill the position first.`);
    }
    const rows = this.appDb.db
      .prepare(
        `SELECT id FROM tasks
         WHERE (assigned_agent_id = ? OR claimed_by_agent_id = ?)
           AND status IN ('open', 'claimed', 'in_progress', 'in_review')`,
      )
      .all(agentId, agentId);
    const activeCount = rows.filter((r) => String(r.id) !== excludeTaskId).length;
    if (activeCount >= agent.maxConcurrentWorkload) {
      const err = new Error(
        `Workload limit enforced: "${agent.name}" is at capacity (${activeCount}/${agent.maxConcurrentWorkload} concurrent tasks).`,
      ) as Error & { statusCode?: number };
      err.statusCode = 409;
      throw err;
    }
  }

  public create(input: {
    title: string;
    description?: string;
    priority?: TaskPriority;
    effort?: EffortLevel;
    departmentId?: string | null;
    createdByType?: 'human' | 'agent';
    createdById?: string;
    assignedAgentId?: string | null;
    parentTaskId?: string | null;
    dependencyIds?: string[];
    githubRepoId?: string | null;
    githubIssueNumber?: number | null;
    githubBranch?: string | null;
    githubPrNumber?: number | null;
    githubPrUrl?: string | null;
    createDedicatedChannel?: boolean;
  }): Task {
    if (input.assignedAgentId) {
      this.assertWorkloadCapacity(input.assignedAgentId);
    }

    const now = new Date().toISOString();
    const id = `task-${crypto.randomUUID().slice(0, 8)}`;
    const effort: EffortLevel = input.effort && isValidEffort(input.effort) ? input.effort : 'medium';

    let channelId: string | null = null;
    const slugBase = input.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 28);

    const autoBranch =
      input.githubBranch ??
      (input.githubRepoId
        ? `agent/${
            (input.assignedAgentId ? this.org.getAgentById(input.assignedAgentId)?.name : 'team')
              ?.toLowerCase()
              .replace(/[^a-z0-9]+/g, '-') || 'team'
          }/${slugBase || id}`
        : null);

    this.appDb.transaction(() => {
      if (input.createDedicatedChannel !== false) {
        channelId = `ch-${id}`;
        const slug = `task-${slugBase || 'work'}-${id.slice(-4)}`;
        this.appDb.db
          .prepare(
            `INSERT INTO channels (id, name, slug, kind, department_id, task_id, participant_ids_json, description, created_at)
             VALUES (?, ?, ?, 'task', ?, ?, '[]', ?, ?)`,
          )
          .run(channelId, slug.replace(/^task-/, ''), slug, input.departmentId ?? null, id, `Dedicated task discussion for: ${input.title.trim()}`, now);
      }

      const deps = input.dependencyIds ?? [];
      let initialStatus: TaskStatus = 'open';
      if (deps.length > 0) {
        const placeholders = deps.map(() => '?').join(',');
        const openDep = this.appDb.db
          .prepare(`SELECT COUNT(*) as cnt FROM tasks WHERE id IN (${placeholders}) AND status != 'completed'`)
          .get(...deps) as { cnt: number };
        if (Number(openDep?.cnt ?? 0) > 0) initialStatus = 'blocked';
      }

      this.appDb.db
        .prepare(
          `INSERT INTO tasks (
            id, title, description, status, priority, effort, department_id, channel_id,
            created_by_type, created_by_id, assigned_agent_id, claimed_by_agent_id,
            parent_task_id, dependency_ids_json, deliverables_json,
            github_repo_id, github_issue_number, github_branch, github_pr_number, github_pr_url,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.title.trim(),
          (input.description || '').trim(),
          initialStatus,
          input.priority ?? 'medium',
          effort,
          input.departmentId ?? null,
          channelId,
          input.createdByType ?? 'human',
          input.createdById ?? 'human-exec',
          input.assignedAgentId ?? null,
          input.parentTaskId ?? null,
          JSON.stringify(deps),
          input.githubRepoId ?? null,
          input.githubIssueNumber ?? null,
          autoBranch,
          input.githubPrNumber ?? null,
          input.githubPrUrl ?? null,
          now,
          now,
        );
    });

    const task = this.getById(id)!;
    const creatorName =
      task.createdByType === 'agent'
        ? this.org.getAgentById(task.createdById)?.name ?? task.createdById
        : 'Executive Supervisor';
    const assigneeName = task.assignedAgentId
      ? this.org.getAgentById(task.assignedAgentId)?.name ?? task.assignedAgentId
      : 'Unassigned';

    this.audit.record({
      actorType: task.createdByType,
      actorId: task.createdById,
      actorName: creatorName,
      category: 'task',
      action: 'task.created',
      targetType: 'task',
      targetId: task.id,
      summary: `Created task "${task.title}" (effort: ${task.effort}, assignee: ${assigneeName}).`,
      details: { priority: task.priority, effort: task.effort, dependencyIds: task.dependencyIds },
    });
    this.realtime.broadcast('tasks:updated', task);
    this.realtime.broadcast('org:updated', { reason: 'task.created' });
    if (channelId) {
      this.realtime.broadcast('channels:updated', { channelId });
    }
    return task;
  }

  public update(
    id: string,
    patch: Partial<{
      title: string;
      description: string;
      status: TaskStatus;
      priority: TaskPriority;
      effort: EffortLevel;
      assignedAgentId: string | null;
      claimedByAgentId: string | null;
      dependencyIds: string[];
    }>,
  ): Task {
    const cur = this.getById(id);
    if (!cur) throw new Error(`Task ${id} not found.`);

    if (patch.assignedAgentId && patch.assignedAgentId !== cur.assignedAgentId) {
      this.assertWorkloadCapacity(patch.assignedAgentId, id);
    }
    if (patch.claimedByAgentId && patch.claimedByAgentId !== cur.claimedByAgentId) {
      this.assertWorkloadCapacity(patch.claimedByAgentId, id);
    }

    if (
      patch.status &&
      (patch.status === 'in_progress' || patch.status === 'completed') &&
      cur.blockedByOpenDeps
    ) {
      throw new Error(`Task "${cur.title}" is blocked by incomplete dependencies.`);
    }

    const now = new Date().toISOString();
    const next: Task = {
      ...cur,
      title: patch.title !== undefined ? patch.title.trim() : cur.title,
      description: patch.description !== undefined ? patch.description.trim() : cur.description,
      status: patch.status ?? cur.status,
      priority: patch.priority ?? cur.priority,
      effort: patch.effort && isValidEffort(patch.effort) ? patch.effort : cur.effort,
      assignedAgentId: patch.assignedAgentId !== undefined ? patch.assignedAgentId : cur.assignedAgentId,
      claimedByAgentId: patch.claimedByAgentId !== undefined ? patch.claimedByAgentId : cur.claimedByAgentId,
      dependencyIds: patch.dependencyIds ?? cur.dependencyIds,
      updatedAt: now,
    };

    this.appDb.db
      .prepare(
        `UPDATE tasks SET
          title = ?, description = ?, status = ?, priority = ?, effort = ?,
          assigned_agent_id = ?, claimed_by_agent_id = ?, dependency_ids_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.title,
        next.description,
        next.status,
        next.priority,
        next.effort,
        next.assignedAgentId,
        next.claimedByAgentId,
        JSON.stringify(next.dependencyIds),
        next.updatedAt,
        id,
      );

    // If completed, unblock any dependent tasks whose deps are now all completed
    if (next.status === 'completed') {
      const blockedTasks = this.appDb.db.prepare(`SELECT * FROM tasks WHERE status = 'blocked'`).all();
      for (const bt of blockedTasks) {
        const mapped = this.mapTask(bt);
        if (!mapped.blockedByOpenDeps) {
          this.appDb.db.prepare(`UPDATE tasks SET status = 'open', updated_at = ? WHERE id = ?`).run(now, mapped.id);
        }
      }
    }

    const updated = this.getById(id)!;
    this.audit.record({
      actorType: 'human',
      actorId: 'human-exec',
      actorName: 'Executive Supervisor',
      category: 'task',
      action: 'task.updated',
      targetType: 'task',
      targetId: id,
      summary: `Updated task "${updated.title}" → status: ${updated.status}.`,
    });
    this.realtime.broadcast('tasks:updated', updated);
    this.realtime.broadcast('org:updated', { reason: 'task.updated' });
    return updated;
  }

  public claimTask(taskId: string, agentId: string): Task {
    const task = this.getById(taskId);
    if (!task) throw new Error(`Task ${taskId} not found.`);
    if (task.blockedByOpenDeps) {
      throw new Error(`Cannot claim task "${task.title}" while prerequisite dependencies remain open.`);
    }
    if (task.claimedByAgentId && task.claimedByAgentId !== agentId) {
      const owner = this.org.getAgentById(task.claimedByAgentId);
      throw new Error(`Task "${task.title}" is already claimed by ${owner?.name ?? task.claimedByAgentId}.`);
    }
    this.assertWorkloadCapacity(agentId, taskId);
    return this.update(taskId, {
      claimedByAgentId: agentId,
      assignedAgentId: task.assignedAgentId ?? agentId,
      status: task.status === 'open' ? 'claimed' : task.status,
    });
  }

  public addDeliverable(
    taskId: string,
    input: { title: string; kind: TaskDeliverable['kind']; ref: string; submittedBy: string },
  ): Task {
    const task = this.getById(taskId);
    if (!task) throw new Error(`Task ${taskId} not found.`);

    const deliverable: TaskDeliverable = {
      id: `deliv-${crypto.randomUUID().slice(0, 8)}`,
      title: input.title.trim(),
      kind: input.kind,
      ref: input.ref.trim(),
      submittedBy: input.submittedBy,
      submittedAt: new Date().toISOString(),
    };
    const nextDeliverables = [...task.deliverables, deliverable];
    const now = new Date().toISOString();

    this.appDb.db
      .prepare('UPDATE tasks SET deliverables_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(nextDeliverables), now, taskId);

    const updated = this.getById(taskId)!;
    this.audit.record({
      actorType: 'agent',
      actorId: input.submittedBy,
      actorName: input.submittedBy,
      category: 'task',
      action: 'task.deliverable_added',
      targetType: 'task',
      targetId: taskId,
      summary: `Attached deliverable "${deliverable.title}" to task "${task.title}".`,
    });
    this.realtime.broadcast('tasks:updated', updated);
    return updated;
  }
}
