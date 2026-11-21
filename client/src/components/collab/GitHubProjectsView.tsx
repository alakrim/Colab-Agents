import React, { useState } from 'react';
import type { AgentNode, GitHubIssueSummary, GitHubPrSummary, GitHubRepo, Task } from '../../types';
import { api } from '../../api/client';
import { ExternalIcon, PlusIcon, ShieldIcon } from '../Icons';

interface GitHubProjectsViewProps {
  repos: GitHubRepo[];
  tasks: Task[];
  agents: AgentNode[];
  onRefresh: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
  onOpenChannel: (channelId: string) => void;
}

export const GitHubProjectsView: React.FC<GitHubProjectsViewProps> = ({
  repos,
  tasks,
  agents,
  onRefresh,
  onNotify,
  onOpenChannel,
}) => {
  const activeAgents = agents.filter((a) => a.lifecycleState !== 'position_open');
  const [selectedRepoId, setSelectedRepoId] = useState<string>(repos[0]?.id ?? '');
  const [showConnect, setShowConnect] = useState(false);
  const [fullName, setFullName] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [reviewPolicy, setReviewPolicy] = useState<'standard' | 'cross_provider_required'>('cross_provider_required');

  const [syncing, setSyncing] = useState(false);
  const [syncState, setSyncState] = useState<{
    ghAvailable: boolean;
    error?: string;
    issues: GitHubIssueSummary[];
    pullRequests: GitHubPrSummary[];
  } | null>(null);
  const [assignAgentId, setAssignAgentId] = useState<string>(activeAgents[0]?.id ?? '');

  const selectedRepo = repos.find((r) => r.id === selectedRepoId) ?? repos[0] ?? null;
  const repoTasks = tasks.filter((t) => selectedRepo && t.githubRepoId === selectedRepo.id);
  const agentMap = new Map(agents.map((a) => [a.id, a]));

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await api.connectGitHubRepo({ fullName, defaultBranch, reviewPolicy });
      setFullName('');
      setShowConnect(false);
      setSelectedRepoId(created.id);
      onNotify(`Connected GitHub project ${created.fullName}.`);
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to connect repo', true);
    }
  };

  const handleSync = async () => {
    if (!selectedRepo) return;
    setSyncing(true);
    try {
      const res = await api.syncGitHubRepo(selectedRepo.id);
      setSyncState({
        ghAvailable: res.ghAvailable,
        error: res.error,
        issues: res.issues,
        pullRequests: res.pullRequests,
      });
      onRefresh();
      if (res.ghAvailable) {
        onNotify(`Synced ${res.issues.length} open issue(s) and ${res.pullRequests.length} open PR(s) from ${selectedRepo.fullName}.`);
      } else {
        onNotify(res.error || 'GitHub CLI unavailable on host.', true);
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Sync failed', true);
    } finally {
      setSyncing(false);
    }
  };

  const handleImportIssue = async (issue: GitHubIssueSummary) => {
    if (!selectedRepo) return;
    try {
      const res = await api.importGitHubIssue(selectedRepo.id, {
        issueNumber: issue.number,
        title: issue.title,
        assignedAgentId: assignAgentId || null,
        dispatchImmediately: true,
      });
      onNotify(
        `Created task on isolated branch "${res.task.githubBranch}"${
          res.dispatch ? ` & dispatched to ${res.dispatch.agentName}` : ''
        }.`,
      );
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Import failed', true);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="stage-header">
        <div className="stage-header-title">
          <h1>GitHub Projects & Branch Isolation</h1>
          <span className="stage-header-desc">Coordinate dual/multi-agent branches, issue assignments, and cross-provider PR review rules</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {selectedRepo && (
            <button type="button" className="btn btn-sm" disabled={syncing} onClick={handleSync}>
              {syncing ? 'Syncing…' : 'Sync Live Issues & PRs'}
            </button>
          )}
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowConnect((s) => !s)}>
            <PlusIcon size={13} /> Connect Repo
          </button>
        </div>
      </div>

      <div className="subview-scroll">
        {showConnect && (
          <form onSubmit={handleConnect} className="doc-card">
            <div style={{ fontWeight: 600 }}>Connect GitHub Repository</div>
            <div className="grid-2">
              <div className="field-group">
                <label className="field-label">Repository (owner/repo)</label>
                <input
                  className="input mono"
                  required
                  placeholder="alakrim/Colab-Agents"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
              <div className="field-group">
                <label className="field-label">Default Branch</label>
                <input className="input mono" value={defaultBranch} onChange={(e) => setDefaultBranch(e.target.value)} />
              </div>
            </div>
            <div className="field-group">
              <label className="field-label">Cross-Provider PR Review Policy</label>
              <select
                className="select"
                value={reviewPolicy}
                onChange={(e) => setReviewPolicy(e.target.value as 'standard' | 'cross_provider_required')}
              >
                <option value="cross_provider_required">
                  Cross-Provider Two-Model Rule (Claude work reviewed by Gemini & vice versa)
                </option>
                <option value="standard">Standard Single-Reviewer Policy</option>
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-sm" onClick={() => setShowConnect(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-sm">
                Connect Project
              </button>
            </div>
          </form>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {repos.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`btn ${selectedRepo?.id === r.id ? 'btn-primary' : ''}`}
              onClick={() => {
                setSelectedRepoId(r.id);
                setSyncState(null);
              }}
            >
              <span className="mono">{r.fullName}</span>
            </button>
          ))}
        </div>

        {selectedRepo && (
          <>
            <div className="doc-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong className="mono" style={{ fontSize: 14.5 }}>
                      {selectedRepo.fullName}
                    </strong>
                    <a
                      href={`https://github.com/${selectedRepo.fullName}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}
                    >
                      <ExternalIcon size={12} /> GitHub
                    </a>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 3 }}>
                    Default branch: <code className="mono">{selectedRepo.defaultBranch}</code> · Protected:{' '}
                    <code className="mono">{selectedRepo.protectedBranches.join(', ')}</code>
                    {selectedRepo.lastSyncedAt ? ` · Last synced ${new Date(selectedRepo.lastSyncedAt).toLocaleTimeString()}` : ''}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`badge ${selectedRepo.reviewPolicy === 'cross_provider_required' ? 'badge-running' : ''}`}>
                    <ShieldIcon size={11} />
                    {selectedRepo.reviewPolicy === 'cross_provider_required'
                      ? 'Two-Model PR Review Active'
                      : 'Standard PR Review'}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={async () => {
                      const next =
                        selectedRepo.reviewPolicy === 'cross_provider_required' ? 'standard' : 'cross_provider_required';
                      await api.updateGitHubRepo(selectedRepo.id, { reviewPolicy: next });
                      onNotify(`Updated review policy to ${next}.`);
                      onRefresh();
                    }}
                  >
                    Toggle Policy
                  </button>
                </div>
              </div>
            </div>

            {/* Active Isolated Agent Branches for this Repo */}
            <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>
                Active Agent Branches & Linked Tasks ({repoTasks.length})
              </h2>
              {repoTasks.length === 0 ? (
                <div className="doc-card" style={{ color: 'var(--text-tertiary)', fontSize: 12.5 }}>
                  No tasks linked to {selectedRepo.fullName} yet. Sync live GitHub Issues below or create a task in <strong>Tasks & Deps</strong> linked to this repo — each task gets its own isolated <code className="mono">agent/&lt;name&gt;/&lt;slug&gt;</code> branch.
                </div>
              ) : (
                repoTasks.map((t) => {
                  const assignee = t.assignedAgentId ? agentMap.get(t.assignedAgentId) : null;
                  return (
                    <div key={t.id} className="task-row">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                          <strong>{t.title}</strong>
                          {t.githubBranch && <span className="badge mono">{t.githubBranch}</span>}
                          <span className="badge badge-effort">{t.effort}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                          {assignee ? `Owner: ${assignee.name} (${assignee.provider}/${assignee.model})` : 'Unassigned'} · Status: {t.status}
                        </div>
                      </div>
                      {t.channelId && (
                        <button type="button" className="btn btn-sm" onClick={() => onOpenChannel(t.channelId!)}>
                          Open Channel
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </section>

            {/* Live Synced Issues & Pull Requests */}
            {syncState && (
              <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {!syncState.ghAvailable ? (
                  <div className="doc-card" style={{ color: 'var(--status-handoff)' }}>
                    {syncState.error}
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>
                        Open GitHub Issues ({syncState.issues.length})
                      </h2>
                      <select
                        className="select"
                        style={{ width: 200, height: 28, padding: '0 8px', fontSize: 12 }}
                        value={assignAgentId}
                        onChange={(e) => setAssignAgentId(e.target.value)}
                      >
                        {activeAgents.map((a) => (
                          <option key={a.id} value={a.id}>
                            Assign to: {a.name} ({a.provider})
                          </option>
                        ))}
                      </select>
                    </div>
                    {syncState.issues.length === 0 ? (
                      <div className="doc-card" style={{ color: 'var(--text-tertiary)', fontSize: 12.5 }}>
                        No open issues found on {selectedRepo.fullName}.
                      </div>
                    ) : (
                      syncState.issues.map((iss) => (
                        <div key={iss.number} className="task-row">
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span className="mono" style={{ color: 'var(--text-tertiary)' }}>
                                #{iss.number}
                              </span>
                              <strong>{iss.title}</strong>
                              {iss.labels.map((l) => (
                                <span key={l} className="role-chip">
                                  {l}
                                </span>
                              ))}
                            </div>
                            <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>Opened by {iss.author}</span>
                          </div>
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => handleImportIssue(iss)}>
                            Assign & Branch
                          </button>
                        </div>
                      ))
                    )}

                    <h2 style={{ margin: '8px 0 0', fontSize: 13.5, fontWeight: 600 }}>
                      Open Pull Requests ({syncState.pullRequests.length})
                    </h2>
                    {syncState.pullRequests.length === 0 ? (
                      <div className="doc-card" style={{ color: 'var(--text-tertiary)', fontSize: 12.5 }}>
                        No open pull requests found on {selectedRepo.fullName}.
                      </div>
                    ) : (
                      syncState.pullRequests.map((pr) => (
                        <div key={pr.number} className="task-row">
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span className="mono" style={{ color: 'var(--text-tertiary)' }}>
                                PR #{pr.number}
                              </span>
                              <strong>{pr.title}</strong>
                              <span className="badge mono">
                                {pr.headRefName} → {pr.baseRefName}
                              </span>
                            </div>
                            <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                              By {pr.author} · {pr.isDraft ? 'Draft' : pr.reviewDecision}
                            </span>
                          </div>
                          <a href={pr.url} target="_blank" rel="noreferrer" className="btn btn-sm">
                            <ExternalIcon size={12} /> View PR
                          </a>
                        </div>
                      ))
                    )}
                  </>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
};
