import crypto from 'node:crypto';
import type { AppDatabase } from '../db/database.js';
import type { KnowledgeEntry } from '../domain/types.js';
import type { AuditService } from './auditService.js';
import type { RealtimeHub } from './realtime.js';

export class MemoryService {
  constructor(
    private readonly appDb: AppDatabase,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeHub,
  ) {}

  private mapRow(r: Record<string, unknown>): KnowledgeEntry {
    return {
      id: String(r.id),
      kind: r.kind as KnowledgeEntry['kind'],
      title: String(r.title),
      content: String(r.content),
      status: r.status as KnowledgeEntry['status'],
      departmentId: r.department_id ? String(r.department_id) : null,
      authorType: r.author_type as KnowledgeEntry['authorType'],
      authorId: String(r.author_id),
      authorName: String(r.author_name),
      tags: JSON.parse(String(r.tags_json || '[]')),
      pinned: Boolean(r.pinned),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  public list(params?: { kind?: string; query?: string; departmentId?: string }): KnowledgeEntry[] {
    const clauses: string[] = [];
    const values: unknown[] = [];

    if (params?.kind && params.kind !== 'all') {
      clauses.push('kind = ?');
      values.push(params.kind);
    }
    if (params?.departmentId) {
      clauses.push('department_id = ?');
      values.push(params.departmentId);
    }
    if (params?.query && params.query.trim()) {
      const q = `%${params.query.trim().toLowerCase()}%`;
      clauses.push('(LOWER(title) LIKE ? OR LOWER(content) LIKE ? OR LOWER(tags_json) LIKE ?)');
      values.push(q, q, q);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.appDb.db
      .prepare(`SELECT * FROM knowledge_entries ${where} ORDER BY pinned DESC, updated_at DESC`)
      .all(...values);
    return rows.map((r) => this.mapRow(r));
  }

  public getRelevantForContext(departmentId: string | null, limit: number): KnowledgeEntry[] {
    const rows = this.appDb.db
      .prepare(
        `SELECT * FROM knowledge_entries
         WHERE status != 'superseded'
         ORDER BY
           pinned DESC,
           CASE WHEN department_id = ? THEN 1 ELSE 0 END DESC,
           updated_at DESC
         LIMIT ?`,
      )
      .all(departmentId ?? '', limit);
    return rows.map((r) => this.mapRow(r));
  }

  public create(input: {
    kind: KnowledgeEntry['kind'];
    title: string;
    content: string;
    status?: KnowledgeEntry['status'];
    departmentId?: string | null;
    authorType?: 'human' | 'agent';
    authorId?: string;
    authorName?: string;
    tags?: string[];
    pinned?: boolean;
  }): KnowledgeEntry {
    const now = new Date().toISOString();
    const entry: KnowledgeEntry = {
      id: `know-${crypto.randomUUID().slice(0, 10)}`,
      kind: input.kind,
      title: input.title.trim(),
      content: input.content.trim(),
      status: input.status ?? 'accepted',
      departmentId: input.departmentId ?? null,
      authorType: input.authorType ?? 'human',
      authorId: input.authorId ?? 'human-exec',
      authorName: input.authorName ?? 'Executive Supervisor',
      tags: input.tags ?? [],
      pinned: Boolean(input.pinned),
      createdAt: now,
      updatedAt: now,
    };

    this.appDb.db
      .prepare(
        `INSERT INTO knowledge_entries (
          id, kind, title, content, status, department_id,
          author_type, author_id, author_name, tags_json, pinned, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.kind,
        entry.title,
        entry.content,
        entry.status,
        entry.departmentId,
        entry.authorType,
        entry.authorId,
        entry.authorName,
        JSON.stringify(entry.tags),
        entry.pinned ? 1 : 0,
        entry.createdAt,
        entry.updatedAt,
      );

    this.audit.record({
      actorType: entry.authorType,
      actorId: entry.authorId,
      actorName: entry.authorName,
      category: 'knowledge',
      action: `knowledge.${entry.kind}.created`,
      severity: entry.kind === 'decision' ? 'decision' : 'info',
      targetType: 'knowledge',
      targetId: entry.id,
      summary: `Published ${entry.kind}: "${entry.title}"`,
      details: { status: entry.status, tags: entry.tags, pinned: entry.pinned },
    });

    this.realtime.broadcast('knowledge:updated', entry);
    return entry;
  }

  public update(
    id: string,
    patch: Partial<Pick<KnowledgeEntry, 'title' | 'content' | 'status' | 'pinned' | 'tags' | 'departmentId'>>,
  ): KnowledgeEntry {
    const existingRow = this.appDb.db.prepare('SELECT * FROM knowledge_entries WHERE id = ?').get(id);
    if (!existingRow) {
      throw new Error(`Knowledge entry ${id} not found`);
    }
    const cur = this.mapRow(existingRow);
    const updated: KnowledgeEntry = {
      ...cur,
      title: patch.title !== undefined ? patch.title.trim() : cur.title,
      content: patch.content !== undefined ? patch.content.trim() : cur.content,
      status: patch.status ?? cur.status,
      pinned: patch.pinned !== undefined ? patch.pinned : cur.pinned,
      tags: patch.tags ?? cur.tags,
      departmentId: patch.departmentId !== undefined ? patch.departmentId : cur.departmentId,
      updatedAt: new Date().toISOString(),
    };

    this.appDb.db
      .prepare(
        `UPDATE knowledge_entries
         SET title = ?, content = ?, status = ?, pinned = ?, tags_json = ?, department_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        updated.title,
        updated.content,
        updated.status,
        updated.pinned ? 1 : 0,
        JSON.stringify(updated.tags),
        updated.departmentId,
        updated.updatedAt,
        id,
      );

    this.realtime.broadcast('knowledge:updated', updated);
    return updated;
  }

  public delete(id: string): void {
    this.appDb.db.prepare('DELETE FROM knowledge_entries WHERE id = ?').run(id);
    this.realtime.broadcast('knowledge:deleted', { id });
  }
}
