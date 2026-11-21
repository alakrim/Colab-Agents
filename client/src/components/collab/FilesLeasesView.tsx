import React, { useEffect, useState } from 'react';
import type { AgentNode, DiffResult, FileLease, ProjectFileInfo } from '../../types';
import { api } from '../../api/client';
import { FileIcon, LockIcon, PlusIcon, ShieldIcon } from '../Icons';

interface FilesLeasesViewProps {
  files: ProjectFileInfo[];
  leases: FileLease[];
  agents: AgentNode[];
  onRefresh: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
  onRequestHandoffMessage: (ownerAgent: AgentNode, filePath: string) => void;
}

export const FilesLeasesView: React.FC<FilesLeasesViewProps> = ({
  files,
  leases,
  agents,
  onRefresh,
  onNotify,
  onRequestHandoffMessage,
}) => {
  const activeAgents = agents.filter((a) => a.lifecycleState !== 'position_open');
  const [selectedPath, setSelectedPath] = useState<string>(files[0]?.path ?? '');
  const [actingAgentId, setActingAgentId] = useState<string>(activeAgents[0]?.id ?? '');
  const [canonicalContent, setCanonicalContent] = useState<string>('');
  const [sandboxContent, setSandboxContent] = useState<string>('');
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [showNewFile, setShowNewFile] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [newContent, setNewContent] = useState('');
  const [tick, setTick] = useState(0);

  // Ticking countdown for active lease expiry display
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const selectedFile = files.find((f) => f.path === selectedPath) ?? files[0] ?? null;
  const activeLease = selectedFile?.activeLease ?? null;

  useEffect(() => {
    if (!selectedFile) return;
    if (selectedFile.path !== selectedPath) setSelectedPath(selectedFile.path);

    let cancelled = false;
    (async () => {
      try {
        const res = await api.readFile(selectedFile.path);
        if (!cancelled) setCanonicalContent(res.content);

        if (selectedFile.activeLease) {
          const sb = await api.readSandbox(selectedFile.activeLease.id);
          if (!cancelled) {
            setSandboxContent(sb.content);
            setDiff(sb.diff);
          }
        } else if (!cancelled) {
          setSandboxContent('');
          setDiff(null);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedFile?.path, selectedFile?.activeLease?.id, selectedFile?.sha256]);

  const handleClaim = async () => {
    if (!selectedFile || !actingAgentId) return;
    try {
      await api.claimFile({ filePath: selectedFile.path, agentId: actingAgentId });
      onNotify(`Acquired atomic lease & isolated sandbox on "${selectedFile.path}".`);
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Claim failed', true);
    }
  };

  const handleSaveSandbox = async () => {
    if (!activeLease) return;
    try {
      const res = await api.writeSandbox(activeLease.id, sandboxContent);
      setDiff(res.diff);
      onNotify(`Saved isolated sandbox copy & renewed lease heartbeat.`);
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save sandbox', true);
    }
  };

  const handleIntegrate = async () => {
    if (!activeLease) return;
    try {
      const res = await api.integrateLease(activeLease.id);
      if (res.status === 'pending_approval') {
        onNotify(`Controlled Integration gated: Human Approval Request created (${res.approval?.id}).`);
      } else if (res.status === 'integrated') {
        onNotify(`Integrated changes cleanly into "${activeLease.filePath}".`);
      } else {
        onNotify('No changes detected — lease released.');
      }
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Integration failed', true);
    }
  };

  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await api.createFile(newPath.trim(), newContent);
      setNewPath('');
      setNewContent('');
      setShowNewFile(false);
      setSelectedPath(created.path);
      onNotify(`Created file "${created.path}".`);
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Create failed', true);
    }
  };

  const remainingSec = activeLease
    ? Math.max(0, Math.round((new Date(activeLease.expiresAt).getTime() - Date.now()) / 1000))
    : 0;
  void tick;

  const abandonedLeases = leases.filter((l) => l.status === 'abandoned').slice(0, 4);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="stage-header">
        <div className="stage-header-title">
          <h1>Shared Files & Ownership Leases</h1>
          <span className="stage-header-desc">Atomic exclusive claims, isolated sandboxes, SHA-256 conflict detection & approval gates</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            aria-label="Acting agent for file operations"
            className="select"
            style={{ width: 175, height: 29, padding: '0 8px', fontSize: 12 }}
            value={actingAgentId}
            onChange={(e) => setActingAgentId(e.target.value)}
          >
            {activeAgents.map((a) => (
              <option key={a.id} value={a.id}>
                Act as: {a.name} ({a.provider})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-sm"
            onClick={async () => {
              const r = await api.sweepLeases();
              onNotify(`Swept expired leases: ${r.recovered.length} recovered.`);
              onRefresh();
            }}
          >
            Sweep Expired
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowNewFile((s) => !s)}>
            <PlusIcon size={13} /> New File
          </button>
        </div>
      </div>

      <div className="files-grid">
        <div className="files-list-pane">
          {showNewFile && (
            <form onSubmit={handleCreateFile} className="doc-card" style={{ padding: 10, marginBottom: 8 }}>
              <input
                className="input mono"
                required
                placeholder="src/module.ts"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
              />
              <textarea
                className="textarea mono"
                style={{ minHeight: 60, fontSize: 11.5 }}
                placeholder="Initial file content..."
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                <button type="button" className="btn btn-sm" onClick={() => setShowNewFile(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm">
                  Create
                </button>
              </div>
            </form>
          )}

          {files.map((f) => (
            <button
              key={f.path}
              type="button"
              className={`file-row-btn ${selectedFile?.path === f.path ? 'active' : ''}`}
              onClick={() => setSelectedPath(f.path)}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <span className="mono" style={{ fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <FileIcon size={13} />
                  {f.path}
                </span>
                {f.isSensitive && (
                  <span title="Protected path — requires human approval" style={{ color: 'var(--status-danger)' }}>
                    <ShieldIcon size={13} />
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-tertiary)' }}>
                <span>{f.sizeBytes} B</span>
                {f.activeLease ? (
                  <span className="badge badge-handoff" style={{ height: 18, fontSize: 10.5 }}>
                    <LockIcon size={10} /> {f.activeLease.agentName}
                  </span>
                ) : (
                  <span>Available</span>
                )}
              </div>
            </button>
          ))}

          {abandonedLeases.length > 0 && (
            <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}>
              <div className="channel-section-header" style={{ paddingLeft: 2 }}>
                Recovered Abandoned Leases
              </div>
              {abandonedLeases.map((l) => (
                <div key={l.id} style={{ fontSize: 11, color: 'var(--text-tertiary)', padding: '4px 2px' }}>
                  <div className="mono" style={{ color: 'var(--text-secondary)' }}>{l.filePath}</div>
                  <div>
                    Reclaimed from {l.agentName}
                    {l.recoveryDraftPath ? ' · draft saved' : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="file-editor-pane">
          {selectedFile ? (
            <>
              <div className="lease-banner">
                <div>
                  <div className="mono" style={{ fontWeight: 600, fontSize: 13.5 }}>
                    {selectedFile.path}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                    Canonical SHA-256: <code className="mono">{selectedFile.sha256.slice(0, 12)}</code>
                    {selectedFile.isSensitive ? ' · Protected path (Human Approval required)' : ''}
                  </div>
                </div>

                {activeLease ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span className="badge badge-handoff">
                      <LockIcon size={11} /> Leased by {activeLease.agentName} · {remainingSec}s left
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={async () => {
                        await api.renewLease(activeLease.id);
                        onNotify('Renewed lease heartbeat.');
                        onRefresh();
                      }}
                    >
                      Heartbeat
                    </button>
                    {activeLease.agentId !== actingAgentId && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          const owner = agents.find((a) => a.id === activeLease.agentId);
                          if (owner) onRequestHandoffMessage(owner, selectedFile.path);
                        }}
                      >
                        Request Handoff
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={async () => {
                        await api.releaseLease(activeLease.id);
                        onNotify(`Released lease on "${selectedFile.path}".`);
                        onRefresh();
                      }}
                    >
                      Release
                    </button>
                  </div>
                ) : (
                  <button type="button" className="btn btn-primary btn-sm" onClick={handleClaim}>
                    <LockIcon size={12} /> Claim Exclusive Lease
                  </button>
                )}
              </div>

              {activeLease ? (
                <>
                  <div className="field-group">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <label className="field-label">
                        Isolated Sandbox Working Copy ({activeLease.agentName}) — canonical file remains untouched until integrated
                      </label>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" className="btn btn-sm" onClick={handleSaveSandbox}>
                          Save Sandbox
                        </button>
                        <button type="button" className="btn btn-primary btn-sm" onClick={handleIntegrate}>
                          Integrate Changes
                        </button>
                      </div>
                    </div>
                    <textarea
                      className="code-editor"
                      value={sandboxContent}
                      onChange={(e) => setSandboxContent(e.target.value)}
                    />
                  </div>

                  {diff && (
                    <div className="field-group">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <label className="field-label">Unified Diff & Conflict Detection</label>
                        {diff.hasConflict ? (
                          <span className="badge badge-danger">Merge Conflict Detected</span>
                        ) : diff.hasChanges ? (
                          <span className="badge badge-running">Clean Diff — Ready to Integrate</span>
                        ) : (
                          <span className="badge">No Changes Yet</span>
                        )}
                      </div>
                      {diff.unifiedDiff && (
                        <div className="diff-viewer">
                          {diff.unifiedDiff.split('\n').map((line, i) => (
                            <div
                              key={i}
                              className={`diff-line ${
                                line.startsWith('+') && !line.startsWith('+++')
                                  ? 'add'
                                  : line.startsWith('-') && !line.startsWith('---')
                                    ? 'del'
                                    : line.startsWith('@@')
                                      ? 'hunk'
                                      : ''
                              }`}
                            >
                              {line}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="field-group">
                  <label className="field-label">Canonical File (Read-Only until an agent acquires an exclusive lease)</label>
                  <pre className="code-editor" style={{ margin: 0, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                    {canonicalContent}
                  </pre>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <h3>Select a project file</h3>
              <p>Claim an atomic lease to edit safely inside an isolated working copy.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
