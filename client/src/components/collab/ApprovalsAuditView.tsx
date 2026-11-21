import React, { useEffect, useState } from 'react';
import type { ApprovalRequest, AuditLogEntry } from '../../types';
import { api } from '../../api/client';

interface ApprovalsAuditViewProps {
  approvals: ApprovalRequest[];
  onRefresh: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

export const ApprovalsAuditView: React.FC<ApprovalsAuditViewProps> = ({ approvals, onRefresh, onNotify }) => {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [severity, setSeverity] = useState('all');

  const loadLogs = async () => {
    try {
      const res = await api.getAuditLogs({ q: search, category, severity });
      setLogs(res.logs);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void loadLogs();
  }, [search, category, severity, approvals.length]);

  const pendingApprovals = approvals.filter((a) => a.status === 'pending');

  const handleDecision = async (id: string, decision: 'approved' | 'rejected') => {
    try {
      await api.decideApproval(id, decision, notes[id] || '');
      onNotify(`Approval ${decision}.`);
      onRefresh();
      void loadLogs();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Decision failed', true);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="stage-header">
        <div className="stage-header-title">
          <h1>Approvals & Activity Log</h1>
          <span className="stage-header-desc">Human executive sign-off gates and complete searchable decision/security trail</span>
        </div>
      </div>

      <div className="subview-scroll">
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>
              Pending Human Approvals ({pendingApprovals.length})
            </h2>
          </div>

          {pendingApprovals.length === 0 ? (
            <div className="doc-card" style={{ color: 'var(--text-tertiary)', fontSize: 12.5 }}>
              No sensitive operations awaiting sign-off. File integrations on protected paths, MAX-effort edits, file deletions, and agent approval requests appear here.
            </div>
          ) : (
            pendingApprovals.map((req) => {
              const unifiedDiff = typeof req.payload.unifiedDiff === 'string' ? req.payload.unifiedDiff : null;
              return (
                <div key={req.id} className="approval-card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="badge badge-handoff">{req.kind}</span>
                      <strong>{req.title}</strong>
                    </div>
                    <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                      Requested by {req.requestedByName} · {new Date(req.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{req.summary}</div>

                  {unifiedDiff && (
                    <div className="diff-viewer">
                      {unifiedDiff.split('\n').map((line, i) => (
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

                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      className="input"
                      placeholder="Optional supervisor note..."
                      value={notes[req.id] || ''}
                      onChange={(e) => setNotes((p) => ({ ...p, [req.id]: e.target.value }))}
                    />
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => handleDecision(req.id, 'rejected')}>
                      Reject
                    </button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => handleDecision(req.id, 'approved')}>
                      Approve & Execute
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>Searchable Activity & Decision Log</h2>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              <input
                className="input"
                style={{ width: 210, height: 29, padding: '0 9px', fontSize: 12 }}
                placeholder="Search actions, actors, files..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                className="select"
                style={{ width: 'auto', height: 29, padding: '0 8px', fontSize: 12 }}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="all">All Categories</option>
                <option value="org">Organization</option>
                <option value="comms">Comms & Delegation</option>
                <option value="task">Tasks</option>
                <option value="file">File Leases</option>
                <option value="security">Security</option>
                <option value="approval">Approvals</option>
                <option value="adapter">Adapters</option>
                <option value="knowledge">Knowledge</option>
              </select>
              <select
                className="select"
                style={{ width: 'auto', height: 29, padding: '0 8px', fontSize: 12 }}
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
              >
                <option value="all">All Severities</option>
                <option value="info">Info</option>
                <option value="decision">Decision</option>
                <option value="warning">Warning</option>
                <option value="security">Security</option>
              </select>
            </div>
          </div>

          <div className="doc-card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="audit-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Actor</th>
                  <th>Category</th>
                  <th>Action</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="mono" style={{ whiteSpace: 'nowrap', color: 'var(--text-tertiary)', fontSize: 11 }}>
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>{log.actorName}</td>
                    <td>
                      <span
                        className={`badge ${
                          log.severity === 'security'
                            ? 'badge-danger'
                            : log.severity === 'decision'
                              ? 'badge-claude'
                              : log.severity === 'warning'
                                ? 'badge-handoff'
                                : ''
                        }`}
                      >
                        {log.category}
                      </span>
                    </td>
                    <td className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      {log.action}
                    </td>
                    <td style={{ color: 'var(--text-primary)' }}>{log.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};
