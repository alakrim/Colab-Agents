import crypto from 'node:crypto';
import type { AppDatabase } from '../db/database.js';
import type {
  EffortLevel,
  StepAutonomyMode,
  StepScopeTier,
  WorkflowPlan,
  WorkflowStage,
  WorkflowStep,
  WorkflowStepStatus,
} from '../domain/types.js';
import type { ParsedWorkflowBox } from '../adapters/protocolParser.js';
import type { AuditService } from './auditService.js';
import type { OrgService } from './orgService.js';
import type { RealtimeHub } from './realtime.js';
import type { TaskService } from './taskService.js';

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  defaultSteps: Array<{
    stage: WorkflowStage;
    title: string;
    plainGoal: string;
    userImpact: string;
    scopeTier: StepScopeTier;
    effort: EffortLevel;
    autonomyMode: StepAutonomyMode;
  }>;
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'feature',
    name: 'New Feature Delivery',
    description: 'Pre-made 5-stage flow from Dual-Orchestrator Blueprint to Build, Two-Model Review, and Ship.',
    defaultSteps: [
      {
        stage: 'discovery',
        title: 'Scope & Edge-Case Audit',
        plainGoal: 'Clarify exact user requirements, edge cases, and acceptance criteria before coding.',
        userImpact: 'Prevents rework and ensures the feature solves the real user problem.',
        scopeTier: 'core',
        effort: 'medium',
        autonomyMode: 'autonomous',
      },
      {
        stage: 'blueprint',
        title: 'Architecture & Interface Contract',
        plainGoal: 'Define data models, API routes, and file ownership boundaries cleanly.',
        userImpact: 'Lets multiple AIs build in parallel without stepping on each other.',
        scopeTier: 'core',
        effort: 'high',
        autonomyMode: 'checkpoint',
      },
      {
        stage: 'build',
        title: 'Core Implementation & Tests',
        plainGoal: 'Implement the core feature on an isolated agent branch with automated tests.',
        userImpact: 'Delivers working, verified functionality safely off main.',
        scopeTier: 'core',
        effort: 'high',
        autonomyMode: 'autonomous',
      },
      {
        stage: 'build',
        title: 'AAA UX & Edge-Case Polish',
        plainGoal: 'Elevate micro-interactions, empty states, keyboard shortcuts, and visual clarity.',
        userImpact: 'Makes the product feel effortless and premium instead of a rough prototype.',
        scopeTier: 'aaa_polish',
        effort: 'medium',
        autonomyMode: 'autonomous',
      },
      {
        stage: 'review',
        title: 'Cross-Provider Two-Model Review',
        plainGoal: 'Have the opposite AI provider audit diffs, security, and test coverage.',
        userImpact: 'Catches blind spots that a single model misses.',
        scopeTier: 'core',
        effort: 'high',
        autonomyMode: 'checkpoint',
      },
      {
        stage: 'ship',
        title: 'Human Sign-Off & GitHub PR',
        plainGoal: 'Approve final diff and publish Draft PR with agent co-author attribution.',
        userImpact: 'Clean, auditable release into your GitHub repository.',
        scopeTier: 'core',
        effort: 'low',
        autonomyMode: 'manual_handoff',
      },
    ],
  },
  {
    id: 'bugfix',
    name: 'Bug Investigation & Fix',
    description: 'Tight 4-box flow to reproduce, patch safely on an isolated branch, cross-review, and ship.',
    defaultSteps: [
      {
        stage: 'discovery',
        title: 'Reproduce & Pinpoint Root Cause',
        plainGoal: 'Identify the exact failing condition and write a failing regression test.',
        userImpact: 'Guarantees we fix the real cause, not a symptom.',
        scopeTier: 'core',
        effort: 'medium',
        autonomyMode: 'autonomous',
      },
      {
        stage: 'build',
        title: 'Minimal Safe Fix',
        plainGoal: 'Apply the cleanest minimal fix on an isolated branch until tests pass.',
        userImpact: 'Resolves the bug with zero unintended side effects.',
        scopeTier: 'core',
        effort: 'high',
        autonomyMode: 'autonomous',
      },
      {
        stage: 'review',
        title: 'Independent Regression Check',
        plainGoal: 'Opposite AI provider checks for related edge cases and security impact.',
        userImpact: 'Prevents regressions in adjacent flows.',
        scopeTier: 'core',
        effort: 'medium',
        autonomyMode: 'checkpoint',
      },
      {
        stage: 'ship',
        title: 'Release PR & Summary',
        plainGoal: 'Summarize root cause + fix in plain English and open GitHub PR.',
        userImpact: 'Fast, documented turnaround.',
        scopeTier: 'core',
        effort: 'low',
        autonomyMode: 'manual_handoff',
      },
    ],
  },
  {
    id: 'ui_polish',
    name: 'AAA UI & UX Upgrade',
    description: 'Product-focused visual and usability overhaul with optional AAA polish toggles.',
    defaultSteps: [
      {
        stage: 'discovery',
        title: 'Friction & Usability Audit',
        plainGoal: 'List the top 5 user pain points and remove visual clutter.',
        userImpact: 'Makes the interface intuitive for non-technical users immediately.',
        scopeTier: 'core',
        effort: 'medium',
        autonomyMode: 'checkpoint',
      },
      {
        stage: 'build',
        title: 'Layout, Hierarchy & Controls',
        plainGoal: 'Refine spacing, clear action labels, dark/light contrast, and responsive flow.',
        userImpact: 'Every core task becomes obvious in 1-2 clicks.',
        scopeTier: 'core',
        effort: 'high',
        autonomyMode: 'autonomous',
      },
      {
        stage: 'build',
        title: 'Micro-Animations & Keyboard Flow',
        plainGoal: 'Add subtle hover transitions, shortcuts, and helpful inline hints.',
        userImpact: 'Delivers Linear/Discord-grade responsiveness.',
        scopeTier: 'aaa_polish',
        effort: 'medium',
        autonomyMode: 'autonomous',
      },
      {
        stage: 'review',
        title: 'Cross-Provider Visual & A11y QA',
        plainGoal: 'Verify light/dark readability, keyboard navigation, and zero layout bugs.',
        userImpact: 'Polished experience on every screen size.',
        scopeTier: 'core',
        effort: 'medium',
        autonomyMode: 'checkpoint',
      },
    ],
  },
];

export class WorkflowService {
  private onPmStepChanged?: (step: WorkflowStep, summary: string) => Promise<void>;
  private onLaunchDispatch?: (agentId: string, channelId: string, taskId: string) => Promise<void>;

  constructor(
    private readonly appDb: AppDatabase,
    private readonly org: OrgService,
    private readonly tasks: TaskService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeHub,
  ) {}

  public setHooks(hooks: {
    onPmStepChanged?: (step: WorkflowStep, summary: string) => Promise<void>;
    onLaunchDispatch?: (agentId: string, channelId: string, taskId: string) => Promise<void>;
  }): void {
    this.onPmStepChanged = hooks.onPmStepChanged;
    this.onLaunchDispatch = hooks.onLaunchDispatch;
  }

  private mapStep(r: Record<string, unknown>): WorkflowStep {
    const agent = r.assigned_agent_id ? this.org.getAgentById(String(r.assigned_agent_id)) : null;
    return {
      id: String(r.id),
      planId: String(r.plan_id),
      stage: r.stage as WorkflowStage,
      orderIndex: Number(r.order_index ?? 0),
      title: String(r.title),
      plainGoal: String(r.plain_goal || ''),
      userImpact: String(r.user_impact || ''),
      pmNotes: String(r.pm_notes || ''),
      nextSteps: String(r.next_steps || ''),
      todos: JSON.parse(String(r.todos_json || '[]')),
      scopeTier: (r.scope_tier as StepScopeTier) || 'core',
      enabled: Boolean(r.enabled),
      autonomyMode: (r.autonomy_mode as StepAutonomyMode) || 'autonomous',
      assignedAgentId: r.assigned_agent_id ? String(r.assigned_agent_id) : null,
      effort: (r.effort as EffortLevel) || 'medium',
      progress: Number(r.progress ?? 0),
      status: (r.status as WorkflowStepStatus) || 'pending',
      linkedTaskId: r.linked_task_id ? String(r.linked_task_id) : null,
      githubBranch: r.github_branch ? String(r.github_branch) : null,
      latestSummary: String(r.latest_summary || ''),
      updatedAt: String(r.updated_at),
      assignedAgentName: agent?.name ?? null,
      assignedAgentProvider: agent?.provider ?? null,
    };
  }

  private mapPlan(r: Record<string, unknown>): WorkflowPlan {
    const id = String(r.id);
    const stepRows = this.appDb.db
      .prepare('SELECT * FROM workflow_steps WHERE plan_id = ? ORDER BY order_index ASC, id ASC')
      .all(id);
    return {
      id,
      title: String(r.title),
      originalPrompt: String(r.original_prompt || ''),
      templateId: String(r.template_id || 'feature'),
      githubRepoId: r.github_repo_id ? String(r.github_repo_id) : null,
      status: r.status as WorkflowPlan['status'],
      debateSessionId: r.debate_session_id ? String(r.debate_session_id) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      steps: stepRows.map((s) => this.mapStep(s)),
    };
  }

  public listPlans(): WorkflowPlan[] {
    const rows = this.appDb.db.prepare('SELECT * FROM workflow_plans ORDER BY updated_at DESC').all();
    return rows.map((r) => this.mapPlan(r));
  }

  public getPlan(id: string): WorkflowPlan | null {
    const row = this.appDb.db.prepare('SELECT * FROM workflow_plans WHERE id = ?').get(id);
    return row ? this.mapPlan(row) : null;
  }

  public createPlanFromTemplate(input: {
    title: string;
    originalPrompt?: string;
    templateId?: string;
    githubRepoId?: string | null;
    debateSessionId?: string | null;
    status?: WorkflowPlan['status'];
    customBoxes?: ParsedWorkflowBox[];
  }): WorkflowPlan {
    const now = new Date().toISOString();
    const id = `wf-${crypto.randomUUID().slice(0, 8)}`;
    const tpl = WORKFLOW_TEMPLATES.find((t) => t.id === input.templateId) ?? WORKFLOW_TEMPLATES[0];

    const agents = this.org.getFullOrg().agents.filter((a) => a.lifecycleState !== 'position_open');
    const claudeLead = agents.find((a) => a.provider === 'claude') ?? agents[0] ?? null;
    const geminiBuilder = agents.find((a) => a.provider === 'gemini') ?? agents[1] ?? claudeLead;

    this.appDb.transaction(() => {
      this.appDb.db
        .prepare(
          `INSERT INTO workflow_plans (id, title, original_prompt, template_id, github_repo_id, status, debate_session_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.title.trim(),
          (input.originalPrompt || '').trim(),
          tpl.id,
          input.githubRepoId ?? null,
          input.status ?? 'draft',
          input.debateSessionId ?? null,
          now,
          now,
        );

      const insertStep = this.appDb.db.prepare(`
        INSERT INTO workflow_steps (
          id, plan_id, stage, order_index, title, plain_goal, user_impact, pm_notes,
          next_steps, todos_json, scope_tier, enabled, autonomy_mode, assigned_agent_id, effort, progress, status,
          linked_task_id, github_branch, latest_summary, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, 1, ?, ?, ?, 0, 'pending', NULL, NULL, '', ?)
      `);

      if (input.customBoxes && input.customBoxes.length > 0) {
        input.customBoxes.forEach((b, idx) => {
          const owner =
            (b.ownerName ? this.org.findAgentByName(b.ownerName) : null) ??
            (b.stage === 'build' ? geminiBuilder : claudeLead);
          insertStep.run(
            `step-${crypto.randomUUID().slice(0, 8)}`,
            id,
            b.stage,
            idx,
            b.title,
            b.plainGoal,
            b.userImpact,
            b.nextSteps || 'Begin work on isolated branch.',
            JSON.stringify(b.todos && b.todos.length > 0 ? b.todos : [{ text: b.plainGoal.slice(0, 60), done: false }]),
            b.scopeTier,
            b.stage === 'review' || b.stage === 'ship' ? 'checkpoint' : 'autonomous',
            owner?.id ?? null,
            b.effort,
            now,
          );
        });
      } else {
        tpl.defaultSteps.forEach((s, idx) => {
          const defaultOwner = s.stage === 'build' ? geminiBuilder : claudeLead;
          insertStep.run(
            `step-${crypto.randomUUID().slice(0, 8)}`,
            id,
            s.stage,
            idx,
            s.title,
            s.plainGoal,
            s.userImpact,
            'Approve & Launch workflow to start this box.',
            JSON.stringify([{ text: s.plainGoal, done: false }]),
            s.scopeTier,
            s.autonomyMode,
            defaultOwner?.id ?? null,
            s.effort,
            now,
          );
        });
      }
    });

    const plan = this.getPlan(id)!;
    this.audit.record({
      actorType: 'human',
      actorId: 'human-exec',
      actorName: 'Product Manager',
      category: 'task',
      action: 'workflow.created',
      severity: 'decision',
      targetType: 'workflow',
      targetId: plan.id,
      summary: `Created Workflow "${plan.title}" (${plan.steps.length} pre-structured boxes, status: ${plan.status}).`,
    });
    this.realtime.broadcast('workflow:updated', plan);
    return plan;
  }

  public addStep(
    planId: string,
    input: {
      stage: WorkflowStage;
      title: string;
      plainGoal: string;
      userImpact?: string;
      scopeTier?: StepScopeTier;
      effort?: EffortLevel;
      assignedAgentId?: string | null;
      autonomyMode?: StepAutonomyMode;
    },
  ): WorkflowPlan {
    const plan = this.getPlan(planId);
    if (!plan) throw new Error(`Workflow plan ${planId} not found.`);
    const now = new Date().toISOString();
    const id = `step-${crypto.randomUUID().slice(0, 8)}`;

      this.appDb.db
        .prepare(
          `INSERT INTO workflow_steps (
            id, plan_id, stage, order_index, title, plain_goal, user_impact, pm_notes,
            next_steps, todos_json, scope_tier, enabled, autonomy_mode, assigned_agent_id, effort, progress, status,
            linked_task_id, github_branch, latest_summary, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, 1, ?, ?, ?, 0, 'pending', NULL, NULL, '', ?)`,
        )
        .run(
          id,
          planId,
          input.stage,
          plan.steps.length,
          input.title.trim(),
          input.plainGoal.trim(),
          (input.userImpact || 'Supports project milestone.').trim(),
          'Ready to begin.',
          JSON.stringify([{ text: input.plainGoal.trim(), done: false }]),
          input.scopeTier ?? 'core',
          input.autonomyMode ?? 'autonomous',
          input.assignedAgentId ?? null,
          input.effort ?? 'medium',
          now,
        );

    this.appDb.db.prepare('UPDATE workflow_plans SET updated_at = ? WHERE id = ?').run(now, planId);
    const updated = this.getPlan(planId)!;
    this.realtime.broadcast('workflow:updated', updated);
    return updated;
  }

  /**
   * Non-technical PM edits a Workflow box's plain-English goal, PM notes, AAA toggle,
   * effort, owner, or autonomy mode — automatically sending a compact delta alert if active!
   */
  public async updateStep(
    stepId: string,
    patch: Partial<{
      title: string;
      plainGoal: string;
      userImpact: string;
      pmNotes: string;
      nextSteps: string;
      todos: Array<{ text: string; done: boolean }>;
      scopeTier: StepScopeTier;
      enabled: boolean;
      autonomyMode: StepAutonomyMode;
      assignedAgentId: string | null;
      effort: EffortLevel;
      progress: number;
      status: WorkflowStepStatus;
      latestSummary: string;
    }>,
    actor: 'pm' | 'agent' = 'pm',
  ): Promise<WorkflowStep> {
    const row = this.appDb.db.prepare('SELECT * FROM workflow_steps WHERE id = ?').get(stepId);
    if (!row) throw new Error(`Workflow step ${stepId} not found.`);
    const cur = this.mapStep(row);
    const now = new Date().toISOString();

    const next: WorkflowStep = {
      ...cur,
      title: patch.title !== undefined ? patch.title.trim() : cur.title,
      plainGoal: patch.plainGoal !== undefined ? patch.plainGoal.trim() : cur.plainGoal,
      userImpact: patch.userImpact !== undefined ? patch.userImpact.trim() : cur.userImpact,
      pmNotes: patch.pmNotes !== undefined ? patch.pmNotes.trim() : cur.pmNotes,
      nextSteps: patch.nextSteps !== undefined ? patch.nextSteps.trim() : cur.nextSteps,
      todos: patch.todos ?? cur.todos,
      scopeTier: patch.scopeTier ?? cur.scopeTier,
      enabled: patch.enabled !== undefined ? patch.enabled : cur.enabled,
      autonomyMode: patch.autonomyMode ?? cur.autonomyMode,
      assignedAgentId: patch.assignedAgentId !== undefined ? patch.assignedAgentId : cur.assignedAgentId,
      effort: patch.effort ?? cur.effort,
      progress: patch.progress !== undefined ? Math.max(0, Math.min(100, Number(patch.progress))) : cur.progress,
      status: patch.status ?? cur.status,
      latestSummary: patch.latestSummary !== undefined ? patch.latestSummary.trim() : cur.latestSummary,
      updatedAt: now,
    };

    this.appDb.db
      .prepare(
        `UPDATE workflow_steps SET
          title = ?, plain_goal = ?, user_impact = ?, pm_notes = ?, next_steps = ?, todos_json = ?,
          scope_tier = ?, enabled = ?, autonomy_mode = ?, assigned_agent_id = ?, effort = ?,
          progress = ?, status = ?, latest_summary = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.title,
        next.plainGoal,
        next.userImpact,
        next.pmNotes,
        next.nextSteps,
        JSON.stringify(next.todos),
        next.scopeTier,
        next.enabled ? 1 : 0,
        next.autonomyMode,
        next.assignedAgentId,
        next.effort,
        next.progress,
        next.status,
        next.latestSummary,
        now,
        stepId,
      );

    this.appDb.db.prepare('UPDATE workflow_plans SET updated_at = ? WHERE id = ?').run(now, cur.planId);

    const updated = this.mapStep(this.appDb.db.prepare('SELECT * FROM workflow_steps WHERE id = ?').get(stepId)!);

    if (actor === 'pm' && updated.linkedTaskId && (patch.plainGoal !== undefined || patch.pmNotes !== undefined)) {
      const deltaNote = `PM updated Workflow Box "${updated.title}": Goal="${updated.plainGoal}"${
        updated.pmNotes ? ` | PM Note="${updated.pmNotes}"` : ''
      }`;
      await this.onPmStepChanged?.(updated, deltaNote);
    }

    this.realtime.broadcast('workflow:updated', this.getPlan(cur.planId));
    return updated;
  }

  /**
   * 1-Click PM "Approve & Launch Workflow":
   * Creates branch-isolated Tasks for every enabled box and dispatches the initial step(s).
   */
  public async approveAndLaunchPlan(planId: string): Promise<WorkflowPlan> {
    const plan = this.getPlan(planId);
    if (!plan) throw new Error(`Workflow plan ${planId} not found.`);
    const now = new Date().toISOString();

    const enabledSteps = plan.steps.filter((s) => s.enabled);
    let launchedFirst = false;

    for (const step of enabledSteps) {
      let taskId = step.linkedTaskId;
      let branch = step.githubBranch;
      let channelId: string | null = null;

      if (!taskId) {
        const assignee = step.assignedAgentId ? this.org.getAgentById(step.assignedAgentId) : null;
        const slug = step.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 22) || step.id;
        branch = `agent/${(assignee?.name || 'team').toLowerCase().replace(/[^a-z0-9]+/g, '-')}/${slug}`;
        const task = this.tasks.create({
          title: step.title,
          description: `${step.plainGoal}\n\nUser Impact: ${step.userImpact}${step.pmNotes ? `\nPM Notes: ${step.pmNotes}` : ''}`,
          effort: step.effort,
          assignedAgentId: step.assignedAgentId,
          githubRepoId: plan.githubRepoId,
          githubBranch: branch,
          createDedicatedChannel: true,
        });
        taskId = task.id;
        channelId = task.channelId;
      } else {
        const existingTask = this.tasks.getById(taskId);
        channelId = existingTask?.channelId ?? null;
      }

      const nextStatus: WorkflowStepStatus = !launchedFirst ? 'active' : 'pending';
      this.appDb.db
        .prepare('UPDATE workflow_steps SET linked_task_id = ?, github_branch = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(taskId, branch, nextStatus, now, step.id);

      if (!launchedFirst && step.assignedAgentId && channelId && taskId) {
        launchedFirst = true;
        await this.onLaunchDispatch?.(step.assignedAgentId, channelId, taskId);
      }
    }

    this.appDb.db
      .prepare(`UPDATE workflow_plans SET status = 'active', updated_at = ? WHERE id = ?`)
      .run(now, planId);

    const updated = this.getPlan(planId)!;
    this.audit.record({
      actorType: 'human',
      actorId: 'human-exec',
      actorName: 'Product Manager',
      category: 'task',
      action: 'workflow.launched',
      severity: 'decision',
      targetType: 'workflow',
      targetId: planId,
      summary: `Approved & launched Workflow "${updated.title}" (${enabledSteps.length} active boxes on isolated branches).`,
    });
    this.realtime.broadcast('workflow:updated', updated);
    return updated;
  }

  public setPlanStatus(planId: string, status: WorkflowPlan['status']): WorkflowPlan {
    const now = new Date().toISOString();
    this.appDb.db.prepare('UPDATE workflow_plans SET status = ?, updated_at = ? WHERE id = ?').run(status, now, planId);
    const updated = this.getPlan(planId)!;
    this.realtime.broadcast('workflow:updated', updated);
    return updated;
  }
}
