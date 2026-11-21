import React, { useState } from 'react';
import type { AgentNode, Department, EffortLevel, GitHubRepo, Task } from '../../types';
import { api } from '../../api/client';
import { CollabIcon, LockIcon, PlusIcon } from '../Icons';

interface TasksViewProps {
  tasks: Task[];
  agents: AgentNode[];
  departments: Department[];
  githubRepos: GitHubRepo[];
  onRefresh: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
  onOpenChannel: (channelId: string) => void;
}

export const TasksView: React.FC<TasksViewProps> = ({
  tasks,
  agents,
  departments,
  githubRepos,
  onRefresh,
  onNotify,
  onOpenChannel,
}) => {
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Task['priority']>('medium');
  const [effort, setEffort] = useState<EffortLevel>('medium');
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? '');
  const [assignedAgentId, setAssignedAgentId] = useState('');
  const [githubRepoId, setGithubRepoId] = useState(githubRepos[0]?.id ?? '');
  const [dependencyIds, setDependencyIds] = useState<string[]>([]);
  const [dispatchImmediately, setDispatchImmediately] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const activeAgents = agents.filter((a) => a.lifecycleState !== 'position_open');
  const agentMap = new Map(agents.map((a) => [a.id, a]));

  const filteredTasks = tasks.filter((t) => statusFilter === 'all' || t.status === statusFilter);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.createTask({
        title,
        description,
        priority,
        effort,
        departmentId: departmentId || null,
        assignedAgentId: assignedAgentId || null,
        githubRepoId: githubRepoId || null,
        dependencyIds,
        dispatchImmediately,
      });
      setTitle('');
      setDescription('');
      setDependencyIds([]);
      setShowCreate(false);
      onNotify(
        `Created task "${res.task.title}"${res.dispatch ? ` & dispatched to ${res.dispatch.agentName}` : ''}.`,
      );
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to create task', true);
    }
  };

  const handleStatusChange = async (task: Task, nextStatus: Task['status']) => {
    try {
      await api.updateTask(task.id, { status: nextStatus });
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Status update blocked', true);
    }
  };

  const handleClaim = async (taskId: string, agentId: string) => {
    try {
      await api.claimTask(taskId, agentId);
      onNotify('Task claimed and workload counter updated.');
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Claim failed', true);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="stage-header">
        <div className="stage-header-title">
          <h1>Tasks & Dependencies</h1>
          <span className="stage-header-desc">Enforced workload caps, prerequisite locks, and dedicated discussion threads</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            className="select"
            style={{ width: 'auto', height: 29, padding: '0 8px', fontSize: 12 }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Statuses ({tasks.length})</option>
            <option value="open">Open</option>
            <option value="claimed">Claimed</option>
            <option value="in_progress">In Progress</option>
            <option value="blocked">Blocked</option>
            <option value="in_review">In Review</option>
            <option value="completed">Completed</option>
          </select>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowCreate((s) => !s)}>
            <PlusIcon size={13} /> New Task
          </button>
        </div>
      </div>

      <div className="subview-scroll">
        {showCreate && (
          <form onSubmit={handleCreate} className="doc-card">
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>Create & Delegate Task</div>
            <div className="field-group">
              <label className="field-label">Task Title</label>
              <input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Audit file lease conflict recovery path" />
            </div>
            <div className="field-group">
              <label className="field-label">Description & Acceptance Criteria</label>
              <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="grid-2">
              <div className="field-group">
                <label className="field-label">Assign Agent (enforces workload cap)</label>
                <select className="select" value={assignedAgentId} onChange={(e) => setAssignedAgentId(e.target.value)}>
                  <option value="">Unassigned</option>
                  {activeAgents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.provider} · {a.activeWorkload ?? 0}/{a.maxConcurrentWorkload} load)
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label className="field-label">Department</label>
                <select className="select" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                  <option value="">Company-wide</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid-2">
              <div className="field-group">
                <label className="field-label">Enforced Effort</label>
                <select className="select" value={effort} onChange={(e) => setEffort(e.target.value as EffortLevel)}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="max">Max</option>
                </select>
              </div>
              <div className="field-group">
                <label className="field-label">Priority</label>
                <select className="select" value={priority} onChange={(e) => setPriority(e.target.value as Task['priority'])}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>

            {tasks.length > 0 && (
              <div className="field-group">
                <label className="field-label">Blocked By Prerequisite Tasks</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {tasks
                    .filter((t) => t.status !== 'completed')
                    .map((t) => {
                      const active = dependencyIds.includes(t.id);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          className={`btn btn-sm ${active ? 'btn-primary' : ''}`}
                          onClick={() =>
                            setDependencyIds(active ? dependencyIds.filter((x) => x !== t.id) : [...dependencyIds, t.id])
                          }
                        >
                          {t.title}
                        </button>
                      );
                    })}
                </div>
              </div>
            )}

            {githubRepos.length > 0 && (
              <div className="field-group">
                <label className="field-label">GitHub Project (auto-creates isolated agent branch)</label>
                <select className="select" value={githubRepoId} onChange={(e) => setGithubRepoId(e.target.value)}>
                  <option value="">No linked repository</option>
                  {githubRepos.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.fullName} (base: {r.defaultBranch})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={dispatchImmediately}
                onChange={(e) => setDispatchImmediately(e.target.checked)}
              />
              Immediately dispatch effort-enforced Context Packet to assigned agent
            </label>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-sm" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-sm">
                Create Task
              </button>
            </div>
          </form>
        )}

        {filteredTasks.length === 0 ? (
          <div className="empty-state">
            <h3>No tasks yet</h3>
            <p>Create a task here or let Claude / Gemini agents delegate tasks directly in channels using [DELEGATE ...].</p>
          </div>
        ) : (
          filteredTasks.map((task) => {
            const assignee = task.assignedAgentId ? agentMap.get(task.assignedAgentId) : null;
            const claimer = task.claimedByAgentId ? agentMap.get(task.claimedByAgentId) : null;
            return (
              <div key={task.id} className="task-row">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                      {task.id}
                    </span>
                    <strong style={{ fontSize: 13.5 }}>{task.title}</strong>
                    <span className="badge badge-effort">{task.effort}</span>
                    <span className={`badge ${task.priority === 'urgent' ? 'badge-danger' : ''}`}>{task.priority}</span>
                    {task.githubRepoName && <span className="badge mono">{task.githubRepoName}</span>}
                    {task.githubBranch && <span className="badge badge-gemini mono">{task.githubBranch}</span>}
                    {task.blockedByOpenDeps && (
                      <span className="badge badge-handoff">
                        <LockIcon size={11} /> Blocked by {task.dependencyIds.length} dep(s)
                      </span>
                    )}
                  </div>
                  {task.description && (
                    <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{task.description}</div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                    {assignee && (
                      <span className={`badge badge-${assignee.provider}`}>
                        Assigned: {assignee.name} ({assignee.provider})
                      </span>
                    )}
                    {claimer && <span className="badge badge-running">Claimed by {claimer.name}</span>}
                    {task.deliverables.length > 0 && <span>{task.deliverables.length} deliverable(s)</span>}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
                  {!task.claimedByAgentId && activeAgents.length > 0 && (
                    <select
                      className="select"
                      style={{ width: 130, height: 27, padding: '0 6px', fontSize: 11.5 }}
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) handleClaim(task.id, e.target.value);
                      }}
                    >
                      <option value="">Claim as…</option>
                      {activeAgents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  )}

                  <select
                    className="select"
                    style={{ width: 118, height: 27, padding: '0 6px', fontSize: 11.5 }}
                    value={task.status}
                    onChange={(e) => handleStatusChange(task, e.target.value as Task['status'])}
                  >
                    <option value="open">Open</option>
                    <option value="claimed">Claimed</option>
                    <option value="in_progress">In Progress</option>
                    <option value="blocked">Blocked</option>
                    <option value="in_review">In Review</option>
                    <option value="completed">Completed</option>
                  </select>

                  {task.channelId && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => onOpenChannel(task.channelId!)}
                      title="Open dedicated task discussion channel"
                    >
                      <CollabIcon size={12} /> Thread
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
