import React, { useState } from 'react';
import type { Department, KnowledgeEntry } from '../../types';
import { api } from '../../api/client';
import { PlusIcon } from '../Icons';

interface KnowledgeViewProps {
  entries: KnowledgeEntry[];
  departments: Department[];
  onRefresh: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

export const KnowledgeView: React.FC<KnowledgeViewProps> = ({ entries, departments, onRefresh, onNotify }) => {
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<KnowledgeEntry['kind']>('decision');
  const [departmentId, setDepartmentId] = useState('');
  const [content, setContent] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [pinned, setPinned] = useState(true);

  const filtered = entries.filter((e) => {
    if (kindFilter !== 'all' && e.kind !== kindFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        e.title.toLowerCase().includes(q) ||
        e.content.toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createKnowledge({
        kind,
        title,
        content,
        departmentId: departmentId || null,
        tags: tagsText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        pinned,
      });
      setTitle('');
      setContent('');
      setTagsText('');
      setShowCreate(false);
      onNotify(`Saved "${title}" to Persistent Project Memory.`);
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save entry', true);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="stage-header">
        <div className="stage-header-title">
          <h1>Decisions & Persistent Knowledge</h1>
          <span className="stage-header-desc">Automatically injected into agent Context Packets based on enforced effort</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input"
            style={{ width: 200, height: 29, padding: '0 9px', fontSize: 12 }}
            placeholder="Search ADRs, specs, notes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="select"
            style={{ width: 'auto', height: 29, padding: '0 8px', fontSize: 12 }}
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
          >
            <option value="all">All Types</option>
            <option value="decision">Decisions (ADRs)</option>
            <option value="spec">Specs</option>
            <option value="runbook">Runbooks</option>
            <option value="note">Notes</option>
          </select>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowCreate((s) => !s)}>
            <PlusIcon size={13} /> Record Decision
          </button>
        </div>
      </div>

      <div className="subview-scroll">
        {showCreate && (
          <form onSubmit={handleCreate} className="doc-card">
            <div style={{ fontWeight: 600 }}>New Persistent Memory Record</div>
            <div className="grid-2">
              <div className="field-group">
                <label className="field-label">Title</label>
                <input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ADR-002: Cross-provider review SLA" />
              </div>
              <div className="field-group">
                <label className="field-label">Type</label>
                <select className="select" value={kind} onChange={(e) => setKind(e.target.value as KnowledgeEntry['kind'])}>
                  <option value="decision">Architecture Decision (ADR)</option>
                  <option value="spec">Technical Spec</option>
                  <option value="runbook">Runbook</option>
                  <option value="note">Shared Note</option>
                </select>
              </div>
            </div>
            <div className="grid-2">
              <div className="field-group">
                <label className="field-label">Department Scope</label>
                <select className="select" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                  <option value="">Company-wide</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label className="field-label">Tags (comma-separated)</label>
                <input className="input" value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="architecture, security" />
              </div>
            </div>
            <div className="field-group">
              <label className="field-label">Content</label>
              <textarea className="textarea" required rows={5} value={content} onChange={(e) => setContent(e.target.value)} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
              <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
              Pin to top of agent context packets
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-sm" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-sm">
                Publish
              </button>
            </div>
          </form>
        )}

        {filtered.map((entry) => (
          <article key={entry.id} className="doc-card">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                <span className={`badge ${entry.kind === 'decision' ? 'badge-claude' : 'badge-gemini'}`}>
                  {entry.kind.toUpperCase()}
                </span>
                <strong style={{ fontSize: 14 }}>{entry.title}</strong>
                {entry.pinned && <span className="badge badge-running">Pinned</span>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={async () => {
                    await api.updateKnowledge(entry.id, { pinned: !entry.pinned });
                    onRefresh();
                  }}
                >
                  {entry.pinned ? 'Unpin' : 'Pin'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={async () => {
                    await api.deleteKnowledge(entry.id);
                    onRefresh();
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              {entry.content}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 11.5, color: 'var(--text-tertiary)' }}>
              <span>
                By {entry.authorName} · {new Date(entry.updatedAt).toLocaleString()}
              </span>
              <div style={{ display: 'flex', gap: 5 }}>
                {entry.tags.map((t) => (
                  <span key={t} className="role-chip">
                    #{t}
                  </span>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
};
