import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AdapterHealth,
  AgentNode,
  ApprovalRequest,
  Channel,
  Dispatch,
  FileLease,
  GitHubRepo,
  KnowledgeEntry,
  Message,
  OrgPayload,
  ProjectFileInfo,
  Task,
} from '../../types';
import { api } from '../../api/client';
import {
  BookIcon,
  CheckSquareIcon,
  CloseIcon,
  CollabIcon,
  FileIcon,
  GitBranchIcon,
  HashIcon,
  PlusIcon,
  SendIcon,
  ShieldIcon,
  UsersIcon,
} from '../Icons';
import { HandoffQueuePanel } from './HandoffQueuePanel';
import { TasksView } from './TasksView';
import { FilesLeasesView } from './FilesLeasesView';
import { KnowledgeView } from './KnowledgeView';
import { ApprovalsAuditView } from './ApprovalsAuditView';
import { GitHubProjectsView } from './GitHubProjectsView';

type CollabMode = 'chat' | 'github' | 'tasks' | 'files' | 'knowledge' | 'governance';
type RightRailTab = 'handoff' | 'roster' | 'thread';

interface CollaborationScreenProps {
  org: OrgPayload;
  channels: Channel[];
  dispatches: Dispatch[];
  adapters: AdapterHealth[];
  tasks: Task[];
  files: ProjectFileInfo[];
  leases: FileLease[];
  knowledge: KnowledgeEntry[];
  approvals: ApprovalRequest[];
  githubRepos: GitHubRepo[];
  initialChannelId?: string | null;
  onRefreshAll: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

function renderFormattedContent(content: string): React.ReactNode {
  const parts = content.split(/(@[A-Za-z][A-Za-z0-9_-]{1,32}\b)/g);
  return parts.map((part, idx) =>
    part.startsWith('@') ? (
      <span key={idx} className="mention-highlight">
        {part}
      </span>
    ) : (
      <React.Fragment key={idx}>{part}</React.Fragment>
    ),
  );
}

export const CollaborationScreen: React.FC<CollaborationScreenProps> = ({
  org,
  channels,
  dispatches,
  adapters,
  tasks,
  files,
  leases,
  knowledge,
  approvals,
  githubRepos,
  initialChannelId,
  onRefreshAll,
  onNotify,
}) => {
  const [mode, setMode] = useState<CollabMode>('chat');
  const [activeChannelId, setActiveChannelId] = useState<string>(initialChannelId || channels[0]?.id || 'ch-general');
  const [messages, setMessages] = useState<Message[]>([]);
  const [composerText, setComposerText] = useState('');
  const [sending, setSending] = useState(false);

  // Thread state
  const [activeThreadRoot, setActiveThreadRoot] = useState<Message | null>(null);
  const [threadReplies, setThreadReplies] = useState<Message[]>([]);
  const [threadComposer, setThreadComposer] = useState('');

  // Right rail tab
  const [rightTab, setRightTab] = useState<RightRailTab>('handoff');

  // New channel / DM quick creation
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [showNewDm, setShowNewDm] = useState(false);
  const [dmAgentA, setDmAgentA] = useState('human-exec');
  const [dmAgentB, setDmAgentB] = useState(org.agents[0]?.id ?? '');

  const messageEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialChannelId) {
      setActiveChannelId(initialChannelId);
      setMode('chat');
    }
  }, [initialChannelId]);

  const activeChannel = useMemo(
    () => channels.find((c) => c.id === activeChannelId) ?? channels[0] ?? null,
    [channels, activeChannelId],
  );

  const loadChannelMessages = async (chId: string) => {
    try {
      const res = await api.getMessages(chId, null);
      setMessages(res.messages);
    } catch {
      // ignore
    }
  };

  const loadThreadReplies = async (chId: string, parentId: string) => {
    try {
      const res = await api.getMessages(chId, parentId);
      setThreadReplies(res.messages);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (activeChannel) {
      void loadChannelMessages(activeChannel.id);
      setActiveThreadRoot(null);
      setThreadReplies([]);
    }
  }, [activeChannel?.id, dispatches.length]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const activeAgents = useMemo(
    () => org.agents.filter((a) => a.lifecycleState !== 'position_open'),
    [org.agents],
  );

  // @mention autocomplete
  const mentionQueryMatch = composerText.match(/@([A-Za-z0-9_-]*)$/);
  const mentionSuggestions = useMemo(() => {
    if (!mentionQueryMatch) return [];
    const q = mentionQueryMatch[1].toLowerCase();
    return activeAgents.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 6);
  }, [mentionQueryMatch, activeAgents]);

  const insertMention = (agentName: string) => {
    setComposerText((prev) => prev.replace(/@([A-Za-z0-9_-]*)$/, `@${agentName} `));
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!activeChannel || !composerText.trim() || sending) return;
    setSending(true);
    try {
      const res = await api.postMessage(activeChannel.id, {
        senderType: 'human',
        senderId: 'human-exec',
        content: composerText.trim(),
      });
      setComposerText('');
      await loadChannelMessages(activeChannel.id);
      onRefreshAll();
      if (res.createdDispatches.length > 0) {
        setRightTab('handoff');
        onNotify(
          `Dispatched to ${res.createdDispatches.map((d) => `${d.agentName} (${d.provider})`).join(', ')}.`,
        );
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to send message', true);
    } finally {
      setSending(false);
    }
  };

  const handleSendThreadReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChannel || !activeThreadRoot || !threadComposer.trim()) return;
    try {
      const res = await api.postMessage(activeChannel.id, {
        parentMessageId: activeThreadRoot.id,
        senderType: 'human',
        senderId: 'human-exec',
        content: threadComposer.trim(),
      });
      setThreadComposer('');
      await loadThreadReplies(activeChannel.id, activeThreadRoot.id);
      await loadChannelMessages(activeChannel.id);
      onRefreshAll();
      if (res.createdDispatches.length > 0) {
        onNotify(`Dispatched thread reply to ${res.createdDispatches.map((d) => d.agentName).join(', ')}.`);
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Reply failed', true);
    }
  };

  const handleOpenDmWithAgent = async (agent: AgentNode) => {
    try {
      const ch = await api.openDmChannel(['human-exec', agent.id], `Supervisor ↔ ${agent.name}`);
      onRefreshAll();
      setActiveChannelId(ch.id);
      setMode('chat');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not open DM', true);
    }
  };

  const handleRequestFileHandoff = async (owner: AgentNode, filePath: string) => {
    const targetCh = channels.find((c) => c.kind === 'company') ?? channels[0];
    if (!targetCh) return;
    try {
      await api.postMessage(targetCh.id, {
        senderType: 'human',
        senderId: 'human-exec',
        content: `@${owner.name} Please wrap up or release your active lease on \`${filePath}\` when ready so a teammate can continue.`,
      });
      setActiveChannelId(targetCh.id);
      setMode('chat');
      setRightTab('handoff');
      onNotify(`Sent lease handoff request to @${owner.name}.`);
      onRefreshAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to request handoff', true);
    }
  };

  const pendingHandoffs = dispatches.filter((d) => d.status === 'awaiting_handoff' || d.status === 'dispatched').length;
  const pendingApprovals = approvals.filter((a) => a.status === 'pending').length;

  const groupedChannels = useMemo(
    () => ({
      company: channels.filter((c) => c.kind === 'company'),
      department: channels.filter((c) => c.kind === 'department'),
      task: channels.filter((c) => c.kind === 'task'),
      dm: channels.filter((c) => c.kind === 'dm'),
    }),
    [channels],
  );

  const agentColor = (id: string, type: string) => {
    if (type === 'human') return '#334155';
    return org.agents.find((a) => a.id === id)?.avatarColor ?? '#2563eb';
  };

  return (
    <div className="collab-screen">
      {/* LEFT RAIL */}
      <aside className="collab-sidebar" aria-label="Workspace channels and tools">
        <div className="workspace-mode-list">
          <button
            type="button"
            className={`mode-nav-btn ${mode === 'chat' ? 'active' : ''}`}
            onClick={() => setMode('chat')}
          >
            <span className="mode-nav-left">
              <CollabIcon size={14} /> Channels & DMs
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{channels.length}</span>
          </button>
          <button
            type="button"
            className={`mode-nav-btn ${mode === 'github' ? 'active' : ''}`}
            onClick={() => setMode('github')}
          >
            <span className="mode-nav-left">
              <GitBranchIcon size={14} /> GitHub Repos
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{githubRepos.length}</span>
          </button>
          <button
            type="button"
            className={`mode-nav-btn ${mode === 'tasks' ? 'active' : ''}`}
            onClick={() => setMode('tasks')}
          >
            <span className="mode-nav-left">
              <CheckSquareIcon size={14} /> Tasks & Deps
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{tasks.length}</span>
          </button>
          <button
            type="button"
            className={`mode-nav-btn ${mode === 'files' ? 'active' : ''}`}
            onClick={() => setMode('files')}
          >
            <span className="mode-nav-left">
              <FileIcon size={14} /> Files & Leases
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              {leases.filter((l) => l.status === 'active').length} locked
            </span>
          </button>
          <button
            type="button"
            className={`mode-nav-btn ${mode === 'knowledge' ? 'active' : ''}`}
            onClick={() => setMode('knowledge')}
          >
            <span className="mode-nav-left">
              <BookIcon size={14} /> Memory & ADRs
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{knowledge.length}</span>
          </button>
          <button
            type="button"
            className={`mode-nav-btn ${mode === 'governance' ? 'active' : ''}`}
            onClick={() => setMode('governance')}
          >
            <span className="mode-nav-left">
              <ShieldIcon size={14} /> Approvals & Log
            </span>
            {pendingApprovals > 0 && <span className="tab-count">{pendingApprovals}</span>}
          </button>
        </div>

        <div className="channel-scroll">
          {/* Company Channels */}
          <div>
            <div className="channel-section-header">
              <span>Company</span>
              <button type="button" className="btn btn-ghost btn-sm" style={{ height: 20 }} onClick={() => setShowNewChannel((s) => !s)}>
                <PlusIcon size={12} />
              </button>
            </div>
            {showNewChannel && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!newChannelName.trim()) return;
                  const ch = await api.createChannel({ name: newChannelName.trim(), kind: 'company' });
                  setNewChannelName('');
                  setShowNewChannel(false);
                  onRefreshAll();
                  setActiveChannelId(ch.id);
                  setMode('chat');
                }}
                style={{ padding: '4px 4px 8px', display: 'flex', gap: 4 }}
              >
                <input
                  className="input"
                  style={{ height: 26, fontSize: 12 }}
                  placeholder="channel-name"
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                />
                <button type="submit" className="btn btn-primary btn-sm">
                  Add
                </button>
              </form>
            )}
            {groupedChannels.company.map((ch) => (
              <button
                key={ch.id}
                type="button"
                className={`channel-btn ${mode === 'chat' && activeChannel?.id === ch.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveChannelId(ch.id);
                  setMode('chat');
                }}
              >
                <span className="channel-name-wrap">
                  <HashIcon size={13} />
                  <span className="channel-name-text">{ch.name}</span>
                </span>
                {(ch.messageCount ?? 0) > 0 && <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>{ch.messageCount}</span>}
              </button>
            ))}
          </div>

          {/* Department Channels */}
          <div>
            <div className="channel-section-header">
              <span>Departments</span>
            </div>
            {groupedChannels.department.map((ch) => (
              <button
                key={ch.id}
                type="button"
                className={`channel-btn ${mode === 'chat' && activeChannel?.id === ch.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveChannelId(ch.id);
                  setMode('chat');
                }}
              >
                <span className="channel-name-wrap">
                  <HashIcon size={13} />
                  <span className="channel-name-text">{ch.name}</span>
                </span>
              </button>
            ))}
          </div>

          {/* Task Discussion Channels */}
          {groupedChannels.task.length > 0 && (
            <div>
              <div className="channel-section-header">
                <span>Task Discussions</span>
              </div>
              {groupedChannels.task.map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  className={`channel-btn ${mode === 'chat' && activeChannel?.id === ch.id ? 'active' : ''}`}
                  onClick={() => {
                    setActiveChannelId(ch.id);
                    setMode('chat');
                  }}
                >
                  <span className="channel-name-wrap">
                    <CheckSquareIcon size={12} />
                    <span className="channel-name-text">{ch.name}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Direct / Agent-to-Agent Private Conversations */}
          <div>
            <div className="channel-section-header">
              <span>Direct Conversations</span>
              <button type="button" className="btn btn-ghost btn-sm" style={{ height: 20 }} onClick={() => setShowNewDm((s) => !s)}>
                <PlusIcon size={12} />
              </button>
            </div>
            {showNewDm && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!dmAgentB || dmAgentA === dmAgentB) return;
                  const ch = await api.openDmChannel([dmAgentA, dmAgentB]);
                  setShowNewDm(false);
                  onRefreshAll();
                  setActiveChannelId(ch.id);
                  setMode('chat');
                }}
                className="doc-card"
                style={{ padding: 8, marginBottom: 8, gap: 6 }}
              >
                <select className="select" style={{ height: 26, fontSize: 11.5, padding: '0 6px' }} value={dmAgentA} onChange={(e) => setDmAgentA(e.target.value)}>
                  <option value="human-exec">Executive Supervisor</option>
                  {activeAgents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.provider})
                    </option>
                  ))}
                </select>
                <select className="select" style={{ height: 26, fontSize: 11.5, padding: '0 6px' }} value={dmAgentB} onChange={(e) => setDmAgentB(e.target.value)}>
                  {activeAgents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.provider})
                    </option>
                  ))}
                </select>
                <button type="submit" className="btn btn-primary btn-sm">
                  Open DM
                </button>
              </form>
            )}
            {groupedChannels.dm.map((ch) => (
              <button
                key={ch.id}
                type="button"
                className={`channel-btn ${mode === 'chat' && activeChannel?.id === ch.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveChannelId(ch.id);
                  setMode('chat');
                }}
              >
                <span className="channel-name-wrap">
                  <span className="status-dot running" />
                  <span className="channel-name-text">{ch.name}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* CENTER STAGE */}
      <main className="collab-main">
        {mode === 'chat' && activeChannel && (
          <>
            <div className="stage-header">
              <div className="stage-header-title">
                {activeChannel.kind === 'dm' ? <UsersIcon size={15} /> : <HashIcon size={15} />}
                <h1>{activeChannel.name}</h1>
                <span className="stage-header-desc">{activeChannel.description}</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <select
                  aria-label="Dispatch agent directly to this channel"
                  className="select"
                  style={{ width: 165, height: 29, padding: '0 8px', fontSize: 12 }}
                  defaultValue=""
                  onChange={async (e) => {
                    const targetId = e.target.value;
                    e.target.value = '';
                    if (!targetId) return;
                    const d = await api.createDispatch({ agentId: targetId, channelId: activeChannel.id, taskId: activeChannel.taskId });
                    setRightTab('handoff');
                    onNotify(`Dispatched Context Packet to ${d.agentName} (${d.provider}/${d.enforcedEffort}).`);
                    onRefreshAll();
                  }}
                >
                  <option value="">Dispatch agent…</option>
                  {activeAgents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.provider} · {a.effort})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="message-list">
              {messages.length === 0 ? (
                <div className="empty-state">
                  <h3>#{activeChannel.name} is ready</h3>
                  <p>
                    Mention any teammate like <code className="mono">@Atlas</code> (Claude) or <code className="mono">@Vega</code> (Gemini) to trigger a real, effort-enforced Context Packet in the Handoff Queue or live Browser Bridge.
                  </p>
                </div>
              ) : (
                messages.map((msg) => (
                  <div key={msg.id} className={`message-item ${msg.senderType === 'system' ? 'system' : ''}`}>
                    {msg.senderType !== 'system' && (
                      <div className="message-avatar" style={{ background: agentColor(msg.senderId, msg.senderType) }}>
                        {msg.senderName.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="message-body">
                      <div className="message-meta">
                        <span className="message-author">{msg.senderName}</span>
                        {msg.senderProvider && (
                          <span className={`badge badge-${msg.senderProvider}`}>
                            {msg.senderProvider.toUpperCase()} · {msg.senderModel}
                          </span>
                        )}
                        {msg.senderEffort && <span className="badge badge-effort">{msg.senderEffort}</span>}
                        {msg.senderType === 'human' && <span className="badge">Supervisor</span>}
                        <span className="message-time">{new Date(msg.createdAt).toLocaleTimeString()}</span>
                      </div>

                      <div className="message-content">{renderFormattedContent(msg.content)}</div>

                      {msg.directives && msg.directives.length > 0 && (
                        <div className="directive-cards">
                          {msg.directives.map((d, i) => (
                            <div key={i} className={`directive-card ${d.executionStatus ?? ''}`}>
                              <div>
                                <strong className="mono" style={{ fontSize: 11, textTransform: 'uppercase' }}>
                                  {d.type.replace('_', ' ')}
                                </strong>
                                <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>{d.executionNote}</div>
                              </div>
                              <span
                                className={`badge ${
                                  d.executionStatus === 'executed'
                                    ? 'badge-running'
                                    : d.executionStatus === 'queued_approval'
                                      ? 'badge-handoff'
                                      : 'badge-danger'
                                }`}
                              >
                                {d.executionStatus}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {msg.senderType !== 'system' && (
                        <div className="message-actions-row">
                          <button
                            type="button"
                            className="thread-link-btn"
                            onClick={() => {
                              setActiveThreadRoot(msg);
                              setRightTab('thread');
                              void loadThreadReplies(activeChannel.id, msg.id);
                            }}
                          >
                            {(msg.replyCount ?? 0) > 0 ? `${msg.replyCount} thread repl${msg.replyCount === 1 ? 'y' : 'ies'} →` : 'Reply in thread'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
              <div ref={messageEndRef} />
            </div>

            <div className="composer-wrap">
              {mentionSuggestions.length > 0 && (
                <div className="mention-popover">
                  {mentionSuggestions.map((a) => (
                    <button key={a.id} type="button" className="mention-option" onClick={() => insertMention(a.name)}>
                      <span>
                        <strong>@{a.name}</strong>{' '}
                        <span style={{ color: 'var(--text-tertiary)', fontSize: 11.5 }}>{a.title}</span>
                      </span>
                      <span className={`badge badge-${a.provider}`}>{a.provider}</span>
                    </button>
                  ))}
                </div>
              )}

              <form onSubmit={handleSendMessage} className="composer-box">
                <textarea
                  className="composer-textarea"
                  placeholder={`Message #${activeChannel.name}… Type @ to mention Claude or Gemini agents`}
                  value={composerText}
                  onChange={(e) => setComposerText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSendMessage();
                    }
                  }}
                />
                <div className="composer-footer">
                  <div className="composer-snippets">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        setComposerText((p) => `${p}${p ? ' ' : ''}[DELEGATE to="Vega" title="Task title" effort="high"]Details...[/DELEGATE]`)
                      }
                    >
                      + Delegate
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        setComposerText((p) => `${p}${p ? ' ' : ''}[RECORD_DECISION title="ADR-00X: ..."]Rationale...[/RECORD_DECISION]`)
                      }
                    >
                      + ADR
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setComposerText((p) => `${p}${p ? ' ' : ''}@Atlas `)}
                    >
                      @Atlas (Claude)
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setComposerText((p) => `${p}${p ? ' ' : ''}@Vega `)}
                    >
                      @Vega (Gemini)
                    </button>
                  </div>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={sending || !composerText.trim()}>
                    <SendIcon size={12} /> {sending ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </form>
            </div>
          </>
        )}

        {mode === 'github' && (
          <GitHubProjectsView
            repos={githubRepos}
            tasks={tasks}
            agents={org.agents}
            onRefresh={onRefreshAll}
            onNotify={onNotify}
            onOpenChannel={(chId) => {
              setActiveChannelId(chId);
              setMode('chat');
            }}
          />
        )}

        {mode === 'tasks' && (
          <TasksView
            tasks={tasks}
            agents={org.agents}
            departments={org.departments}
            githubRepos={githubRepos}
            onRefresh={onRefreshAll}
            onNotify={onNotify}
            onOpenChannel={(chId) => {
              setActiveChannelId(chId);
              setMode('chat');
            }}
          />
        )}

        {mode === 'files' && (
          <FilesLeasesView
            files={files}
            leases={leases}
            agents={org.agents}
            onRefresh={onRefreshAll}
            onNotify={onNotify}
            onRequestHandoffMessage={handleRequestFileHandoff}
          />
        )}

        {mode === 'knowledge' && (
          <KnowledgeView entries={knowledge} departments={org.departments} onRefresh={onRefreshAll} onNotify={onNotify} />
        )}

        {mode === 'governance' && (
          <ApprovalsAuditView approvals={approvals} onRefresh={onRefreshAll} onNotify={onNotify} />
        )}
      </main>

      {/* RIGHT RAIL: Handoff Queue, Live Roster, and Active Thread */}
      <aside className="collab-right-rail" aria-label="Agent handoff queue, roster, and threads">
        <div className="right-rail-tabs">
          <button
            type="button"
            className={`inspector-tab ${rightTab === 'handoff' ? 'active' : ''}`}
            onClick={() => setRightTab('handoff')}
          >
            Handoff Queue {pendingHandoffs > 0 && <span className="tab-count" style={{ marginLeft: 4 }}>{pendingHandoffs}</span>}
          </button>
          <button
            type="button"
            className={`inspector-tab ${rightTab === 'roster' ? 'active' : ''}`}
            onClick={() => setRightTab('roster')}
          >
            Roster ({activeAgents.length})
          </button>
          {activeThreadRoot && (
            <button
              type="button"
              className={`inspector-tab ${rightTab === 'thread' ? 'active' : ''}`}
              onClick={() => setRightTab('thread')}
            >
              Thread
            </button>
          )}
        </div>

        <div className="right-rail-body">
          {rightTab === 'handoff' && (
            <HandoffQueuePanel
              dispatches={dispatches}
              adapters={adapters}
              onRefresh={async () => {
                onRefreshAll();
                if (activeChannel) await loadChannelMessages(activeChannel.id);
              }}
              onNotify={onNotify}
            />
          )}

          {rightTab === 'roster' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {activeAgents.map((a) => (
                <div key={a.id} className="roster-item">
                  <div className="roster-item-left">
                    <span className={`status-dot ${a.runtimeStatus === 'awaiting_handoff' ? 'awaiting_handoff' : a.lifecycleState === 'running' ? 'running' : 'planned'}`} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 12.5 }}>{a.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                        {a.provider}/{a.effort} · {a.activeWorkload ?? 0}/{a.maxConcurrentWorkload} load
                        {a.maxSubagents > 0 ? ` · ${a.activeSubagentCount ?? 0}/${a.maxSubagents} sub` : ''}
                      </div>
                    </div>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleOpenDmWithAgent(a)}>
                    DM
                  </button>
                </div>
              ))}
            </div>
          )}

          {rightTab === 'thread' && activeThreadRoot && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <strong style={{ fontSize: 12.5 }}>Thread</strong>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon"
                  onClick={() => {
                    setActiveThreadRoot(null);
                    setRightTab('handoff');
                  }}
                >
                  <CloseIcon size={14} />
                </button>
              </div>

              <div className="doc-card" style={{ padding: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{activeThreadRoot.senderName}</div>
                <div style={{ fontSize: 12.5, whiteSpace: 'pre-wrap' }}>{activeThreadRoot.content}</div>
              </div>

              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
                {threadReplies.map((r) => (
                  <div key={r.id} className="handoff-card" style={{ padding: 9 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}>
                      <strong>{r.senderName}</strong>
                      <span style={{ color: 'var(--text-tertiary)' }}>{new Date(r.createdAt).toLocaleTimeString()}</span>
                    </div>
                    <div style={{ fontSize: 12.5, whiteSpace: 'pre-wrap' }}>{renderFormattedContent(r.content)}</div>
                  </div>
                ))}
              </div>

              <form onSubmit={handleSendThreadReply} style={{ display: 'flex', gap: 6 }}>
                <input
                  className="input"
                  placeholder="Reply in thread (@mention supported)..."
                  value={threadComposer}
                  onChange={(e) => setThreadComposer(e.target.value)}
                />
                <button type="submit" className="btn btn-primary btn-sm">
                  Send
                </button>
              </form>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};
