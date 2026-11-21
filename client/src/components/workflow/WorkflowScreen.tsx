import React, { useMemo, useState } from 'react';
import type {
  AgentNode,
  DebateSession,
  EffortLevel,
  GitHubRepo,
  StepAutonomyMode,
  StepScopeTier,
  WorkflowPlan,
  WorkflowStage,
  WorkflowStep,
  WorkflowTemplate,
} from '../../types';
import { api } from '../../api/client';
import { CloseIcon, CollabIcon, PlusIcon, SparkIcon } from '../Icons';

const STAGE_META: Array<{ id: WorkflowStage; label: string; subtitle: string }> = [
  { id: 'discovery', label: '1. Discovery', subtitle: 'Clarify goals & blind spots' },
  { id: 'blueprint', label: '2. Blueprint', subtitle: 'Plan contracts & branches' },
  { id: 'build', label: '3. Build', subtitle: 'Isolated agent execution' },
  { id: 'review', label: '4. Dual-Model Review', subtitle: 'Cross-provider QA & audit' },
  { id: 'ship', label: '5. Ship', subtitle: 'PM approval & GitHub PR' },
];

interface WorkflowScreenProps {
  plans: WorkflowPlan[];
  templates: WorkflowTemplate[];
  debates: DebateSession[];
  agents: AgentNode[];
  githubRepos: GitHubRepo[];
  onRefresh: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
  onOpenManagementChat: () => void;
}

export const WorkflowScreen: React.FC<WorkflowScreenProps> = ({
  plans,
  templates,
  debates,
  agents,
  githubRepos,
  onRefresh,
  onNotify,
  onOpenManagementChat,
}) => {
  const activeAgents = useMemo(() => agents.filter((a) => a.lifecycleState !== 'position_open'), [agents]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>(plans[0]?.id ?? '');
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState<'debate' | 'template' | null>(null);

  // Debate / Template form state
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? 'feature');
  const [githubRepoId, setGithubRepoId] = useState(githubRepos[0]?.id ?? '');
  const [claudeAgentId, setClaudeAgentId] = useState(
    activeAgents.find((a) => a.provider === 'claude')?.id ?? activeAgents[0]?.id ?? '',
  );
  const [geminiAgentId, setGeminiAgentId] = useState(
    activeAgents.find((a) => a.provider === 'gemini')?.id ?? activeAgents[1]?.id ?? '',
  );

  // Step inspector state
  const activePlan = plans.find((p) => p.id === selectedPlanId) ?? plans[0] ?? null;
  const selectedStep = activePlan?.steps.find((s) => s.id === selectedStepId) ?? null;
  const activeDebate = debates.find((d) => d.status !== 'converged' && d.status !== 'cancelled') ?? null;

  const [editGoal, setEditGoal] = useState('');
  const [editImpact, setEditImpact] = useState('');
  const [editPmNotes, setEditPmNotes] = useState('');
  const [editNextSteps, setEditNextSteps] = useState('');
  const [editTodosText, setEditTodosText] = useState('');
  const [editOwner, setEditOwner] = useState('');
  const [editEffort, setEditEffort] = useState<EffortLevel>('medium');
  const [editAutonomy, setEditAutonomy] = useState<StepAutonomyMode>('autonomous');
  const [editTier, setEditTier] = useState<StepScopeTier>('core');
  const [editProgress, setEditProgress] = useState(0);

  const openStepEditor = (step: WorkflowStep) => {
    setSelectedStepId(step.id);
    setEditGoal(step.plainGoal);
    setEditImpact(step.userImpact);
    setEditPmNotes(step.pmNotes);
    setEditNextSteps(step.nextSteps || '');
    setEditTodosText((step.todos || []).map((t) => `${t.done ? '[x]' : '[ ]'} ${t.text}`).join('\n'));
    setEditOwner(step.assignedAgentId ?? '');
    setEditEffort(step.effort);
    setEditAutonomy(step.autonomyMode);
    setEditTier(step.scopeTier);
    setEditProgress(step.progress);
  };

  const handleSaveStep = async () => {
    if (!selectedStep) return;
    try {
      const parsedTodos = editTodosText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) =>
          /^\[x\]/i.test(l)
            ? { text: l.replace(/^\[x\]\s*/i, ''), done: true }
            : { text: l.replace(/^\[\s?\]\s*/, ''), done: false },
        );
      await api.updateWorkflowStep(selectedStep.id, {
        plainGoal: editGoal,
        userImpact: editImpact,
        pmNotes: editPmNotes,
        nextSteps: editNextSteps,
        todos: parsedTodos,
        assignedAgentId: editOwner || null,
        effort: editEffort,
        autonomyMode: editAutonomy,
        scopeTier: editTier,
        progress: editProgress,
      });
      onNotify(
        `Updated "${selectedStep.title}"${selectedStep.linkedTaskId ? ' · sent compact PM Delta update to assigned agent.' : '.'}`,
      );
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to update step', true);
    }
  };

  const handleToggleTodo = async (step: WorkflowStep, idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const nextTodos = (step.todos || []).map((t, i) => (i === idx ? { ...t, done: !t.done } : t));
    const doneCount = nextTodos.filter((t) => t.done).length;
    const autoProgress = nextTodos.length > 0 ? Math.round((doneCount / nextTodos.length) * 100) : step.progress;
    await api.updateWorkflowStep(step.id, { todos: nextTodos, progress: autoProgress });
    onRefresh();
  };

  const handleToggleStepEnabled = async (step: WorkflowStep, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.updateWorkflowStep(step.id, { enabled: !step.enabled });
      onNotify(`${step.enabled ? 'Paused/Skipped' : 'Enabled'} "${step.title}".`);
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Toggle failed', true);
    }
  };

  const handleLaunchPlan = async () => {
    if (!activePlan) return;
    try {
      await api.launchWorkflowPlan(activePlan.id);
      onNotify(`Approved & launched "${activePlan.title}"! Tasks & isolated GitHub branches created.`);
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Launch failed', true);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (showModal === 'debate') {
        const res = await api.startDebate({
          title,
          originalPrompt: prompt,
          templateId,
          githubRepoId: githubRepoId || null,
          claudeAgentId,
          geminiAgentId,
        });
        setShowModal(null);
        setTitle('');
        setPrompt('');
        onNotify(
          `Started 3-Round AAA Debate "${res.debate.title}" in #management (${res.dispatches.length} blind Round 1 dispatches queued).`,
        );
        onRefresh();
      } else {
        const created = await api.createWorkflowPlan({
          title,
          originalPrompt: prompt,
          templateId,
          githubRepoId: githubRepoId || null,
          status: 'draft',
        });
        setSelectedPlanId(created.id);
        setShowModal(null);
        setTitle('');
        setPrompt('');
        onNotify(`Created pre-made Workflow "${created.title}" (${created.steps.length} boxes ready to customize).`);
        onRefresh();
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to start', true);
    }
  };

  return (
    <div style={{ display: 'flex', flex: 1, minWidth: 0, height: '100%' }}>
      <main className="workflow-screen">
        <div className="workflow-toolbar">
          <div className="org-toolbar-left">
            <h1 className="org-heading">Product Workflow</h1>
            {plans.length > 0 && (
              <select
                className="select"
                style={{ width: 220, height: 30, padding: '0 8px', fontSize: 12.5 }}
                value={activePlan?.id ?? ''}
                onChange={(e) => {
                  setSelectedPlanId(e.target.value);
                  setSelectedStepId(null);
                }}
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} ({p.status})
                  </option>
                ))}
              </select>
            )}
            {activePlan && (
              <span className={`badge ${activePlan.status === 'active' ? 'badge-running' : 'badge-handoff'}`}>
                {activePlan.status.toUpperCase()}
              </span>
            )}
          </div>

          <div className="org-toolbar-right">
            <button type="button" className="btn btn-sm" onClick={() => setShowModal('template')}>
              <PlusIcon size={13} /> Pre-Made Template
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowModal('debate')}>
              <SparkIcon size={13} /> Start Claude ↔ Gemini AAA Debate
            </button>
            {activePlan && activePlan.status === 'draft' && (
              <button type="button" className="btn btn-primary btn-sm" onClick={handleLaunchPlan}>
                Approve &amp; Launch Workflow
              </button>
            )}
          </div>
        </div>

        {activeDebate && (
          <div className="debate-banner">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="badge badge-claude">Round {activeDebate.currentRound} / 3</span>
                <strong>#management AAA Debate: {activeDebate.title}</strong>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>
                Strongest Claude &amp; Gemini orchestrators are challenging your prompt to fill in these Workflow boxes cleanly.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-sm" onClick={onOpenManagementChat}>
                <CollabIcon size={12} /> Open #management
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={async () => {
                  const r = await api.advanceDebate(activeDebate.id);
                  if (r.plan) {
                    setSelectedPlanId(r.plan.id);
                    onNotify(`Debate converged → populated Draft Workflow "${r.plan.title}"!`);
                  } else {
                    onNotify(`Advanced debate to Round ${r.debate.currentRound}.`);
                  }
                  onRefresh();
                }}
              >
                {activeDebate.status === 'round_3' ? 'Converge to Draft Boxes' : `Advance to Round ${activeDebate.currentRound + 1}`}
              </button>
            </div>
          </div>
        )}

        {!activePlan ? (
          <div className="empty-state" style={{ flex: 1 }}>
            <h3>Pre-Made Visual Workflow for Non-Technical Product Management</h3>
            <p>
              Start a <strong>Claude ↔ Gemini AAA Debate</strong> from any plain-English idea — your two strongest models will critique gaps, elevate quality, and auto-fill these boxes for your approval. Or pick a pre-made template immediately.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button type="button" className="btn btn-primary" onClick={() => setShowModal('debate')}>
                <SparkIcon size={14} /> Start AAA Debate
              </button>
              <button type="button" className="btn" onClick={() => setShowModal('template')}>
                <PlusIcon size={14} /> Load Pre-Made Feature Flow
              </button>
            </div>
          </div>
        ) : (
          <div className="workflow-board-wrap">
            {activePlan.originalPrompt && (
              <div className="doc-card" style={{ marginBottom: 14, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
                  Original Product Prompt
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{activePlan.originalPrompt}</div>
              </div>
            )}

            <div className="workflow-stages-grid">
              {STAGE_META.map((stage) => {
                const steps = activePlan.steps.filter((s) => s.stage === stage.id);
                return (
                  <section key={stage.id} className="workflow-stage-col">
                    <div className="workflow-stage-head">
                      <div>
                        <div className="workflow-stage-title">{stage.label}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{stage.subtitle}</div>
                      </div>
                      <span className="badge">{steps.length}</span>
                    </div>

                    {steps.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '10px 2px' }}>
                        No steps in this stage.
                      </div>
                    ) : (
                      steps.map((step) => (
                        <div
                          key={step.id}
                          role="button"
                          tabIndex={0}
                          className={`workflow-box-card ${selectedStepId === step.id ? 'selected' : ''} ${
                            !step.enabled ? 'disabled' : ''
                          }`}
                          onClick={() => openStepEditor(step)}
                        >
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
                            <strong style={{ fontSize: 13, lineHeight: 1.35 }}>{step.title}</strong>
                            <button
                              type="button"
                              className={`badge ${step.scopeTier === 'aaa_polish' ? 'badge-claude' : 'badge-running'}`}
                              title="Click to toggle step On/Off"
                              onClick={(e) => handleToggleStepEnabled(step, e)}
                            >
                              {step.enabled ? (step.scopeTier === 'aaa_polish' ? 'AAA Polish' : 'Core') : 'Skipped'}
                            </button>
                          </div>

                          <div className="workflow-goal-text">{step.plainGoal}</div>
                          {step.nextSteps && (
                            <div className="workflow-impact-text">
                              <strong>Next:</strong> {step.nextSteps}
                            </div>
                          )}
                          {step.todos && step.todos.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                              {step.todos.slice(0, 4).map((todo, ti) => (
                                <label
                                  key={ti}
                                  onClick={(e) => handleToggleTodo(step, ti, e)}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    fontSize: 11.5,
                                    color: todo.done ? 'var(--text-tertiary)' : 'var(--text-secondary)',
                                    textDecoration: todo.done ? 'line-through' : 'none',
                                    cursor: 'pointer',
                                  }}
                                >
                                  <input type="checkbox" checked={todo.done} readOnly />
                                  <span>{todo.text}</span>
                                </label>
                              ))}
                            </div>
                          )}

                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                            {step.assignedAgentName && (
                              <span className={`badge badge-${step.assignedAgentProvider || 'custom'}`}>
                                {step.assignedAgentName}
                              </span>
                            )}
                            <span className="badge badge-effort">{step.effort}</span>
                            <span className="badge">
                              {step.autonomyMode === 'autonomous'
                                ? 'Auto'
                                : step.autonomyMode === 'checkpoint'
                                  ? 'PM Check'
                                  : 'Manual'}
                            </span>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-tertiary)' }}>
                              <span>{step.status}</span>
                              <span className="mono">{step.progress}%</span>
                            </div>
                            <div className="progress-bar-track">
                              <div
                                className={`progress-bar-fill ${step.progress >= 100 || step.status === 'done' ? 'done' : ''}`}
                                style={{ width: `${step.progress}%` }}
                              />
                            </div>
                          </div>

                          {step.githubBranch && (
                            <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              ⎇ {step.githubBranch}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </section>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* Non-Technical PM Box Editor Slide-Over */}
      {selectedStep && (
        <aside className="inspector-drawer" aria-label="Edit workflow step">
          <div className="inspector-header">
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{selectedStep.title}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                Non-technical PM editor — updates sync directly to the assigned agent
              </div>
            </div>
            <button type="button" className="btn btn-ghost btn-icon" onClick={() => setSelectedStepId(null)}>
              <CloseIcon size={15} />
            </button>
          </div>

          <div className="inspector-body">
            <div className="field-group">
              <label className="field-label">Plain-English Goal (what this step should achieve)</label>
              <textarea className="textarea" rows={3} value={editGoal} onChange={(e) => setEditGoal(e.target.value)} />
            </div>

            <div className="field-group">
              <label className="field-label">Next Step (what happens right now)</label>
              <input className="input" value={editNextSteps} onChange={(e) => setEditNextSteps(e.target.value)} />
            </div>

            <div className="field-group">
              <label className="field-label">To-Do Checklist (one item per line, prefix [x] when done)</label>
              <textarea className="textarea mono" rows={4} value={editTodosText} onChange={(e) => setEditTodosText(e.target.value)} />
            </div>

            <div className="field-group">
              <label className="field-label">Why It Matters to Users</label>
              <input className="input" value={editImpact} onChange={(e) => setEditImpact(e.target.value)} />
            </div>

            <div className="field-group">
              <label className="field-label">Product Manager Redirect / Special Notes</label>
              <textarea
                className="textarea"
                rows={3}
                placeholder="Write plain instructions here — no technical jargon needed. Saving sends a compact Delta update to the agent."
                value={editPmNotes}
                onChange={(e) => setEditPmNotes(e.target.value)}
              />
            </div>

            <div className="grid-2">
              <div className="field-group">
                <label className="field-label">Assigned Agent</label>
                <select className="select" value={editOwner} onChange={(e) => setEditOwner(e.target.value)}>
                  <option value="">Unassigned</option>
                  {activeAgents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.provider})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label className="field-label">Enforced Effort</label>
                <select className="select" value={editEffort} onChange={(e) => setEditEffort(e.target.value as EffortLevel)}>
                  <option value="low">Low (fast / cheap)</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="max">Max (Approval gated)</option>
                </select>
              </div>
            </div>

            <div className="grid-2">
              <div className="field-group">
                <label className="field-label">Scope Tier</label>
                <select className="select" value={editTier} onChange={(e) => setEditTier(e.target.value as StepScopeTier)}>
                  <option value="core">Core MVP (Required)</option>
                  <option value="aaa_polish">AAA Polish (Optional)</option>
                </select>
              </div>
              <div className="field-group">
                <label className="field-label">Autonomy Mode</label>
                <select
                  className="select"
                  value={editAutonomy}
                  onChange={(e) => setEditAutonomy(e.target.value as StepAutonomyMode)}
                >
                  <option value="autonomous">Autonomous (Auto-run)</option>
                  <option value="checkpoint">PM Checkpoint (Pause for OK)</option>
                  <option value="manual_handoff">Manual Step-by-Step</option>
                </select>
              </div>
            </div>

            <div className="field-group">
              <label className="field-label">Progress ({editProgress}%)</label>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={editProgress}
                onChange={(e) => setEditProgress(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="inspector-footer">
            <button type="button" className="btn btn-sm" onClick={() => setSelectedStepId(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleSaveStep}>
              Save &amp; Sync Agent
            </button>
          </div>
        </aside>
      )}

      {/* Modal: Start AAA Debate or Load Pre-Made Template */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                {showModal === 'debate'
                  ? 'Start #management AAA Debate (Claude ↔ Gemini)'
                  : 'Create Workflow from Pre-Made Template'}
              </h2>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setShowModal(null)}>
                <CloseIcon size={15} />
              </button>
            </div>
            <form onSubmit={handleCreateSubmit}>
              <div className="modal-body">
                <div className="field-group">
                  <label className="field-label">Initiative / Feature Name</label>
                  <input
                    className="input"
                    required
                    placeholder="e.g., One-Click GitHub PR Automation"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>
                <div className="field-group">
                  <label className="field-label">
                    {showModal === 'debate'
                      ? 'Your Idea / Prompt (Claude & Gemini will critique flaws, expand to AAA & fill Workflow boxes)'
                      : 'Plain-English Project Goal'}
                  </label>
                  <textarea
                    className="textarea"
                    required={showModal === 'debate'}
                    rows={4}
                    placeholder="Describe what you want to build in simple terms..."
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                </div>
                <div className="grid-2">
                  <div className="field-group">
                    <label className="field-label">Pre-Made Box Template</label>
                    <select className="select" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-group">
                    <label className="field-label">Target GitHub Repo</label>
                    <select className="select" value={githubRepoId} onChange={(e) => setGithubRepoId(e.target.value)}>
                      <option value="">None</option>
                      {githubRepos.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.fullName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {showModal === 'debate' && (
                  <div className="grid-2">
                    <div className="field-group">
                      <label className="field-label">Claude Lead Orchestrator</label>
                      <select className="select" value={claudeAgentId} onChange={(e) => setClaudeAgentId(e.target.value)}>
                        {activeAgents.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} ({a.model})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field-group">
                      <label className="field-label">Gemini Lead Orchestrator</label>
                      <select className="select" value={geminiAgentId} onChange={(e) => setGeminiAgentId(e.target.value)}>
                        {activeAgents.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} ({a.model})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn" onClick={() => setShowModal(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  {showModal === 'debate' ? 'Launch Round 1 Debate' : 'Create Draft Workflow'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
