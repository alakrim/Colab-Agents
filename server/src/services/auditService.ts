import crypto from 'node:crypto';
import type { AppDatabase } from '../db/database.js';
import type { AuditLogEntry } from '../domain/types.js';
import type { RealtimeHub } from './realtime.js';

export interface LogAuditInput {
  actorType: 'human' | 'agent' | 'system';
  actorId: string;
  actorName: string;
  category: AuditLogEntry['category'];
  action: string;
  severity?: AuditLogEntry['severity'];
  targetType?: string | null;
  targetId?: string | null;
  summary: string;
  details?: Record<string, unknown>;
}

export class AuditService {
  constructor(
    private readonly appDb: AppDatabase,
    private readonly realtime: RealtimeHub,
  ) {}

  public record(input: LogAuditInput): AuditLogEntry {
    const entry: AuditLogEntry = {
      id: `audit-${crypto.randomUUID().slice(0, 12)}`,
      timestamp: new Date().toISOString(),
      actorType: input.actorType,
      actorId: input.actorId,
      actorName: input.actorName,
      category: input.category,
      action: input.action,
      severity: input.severity ?? 'info',
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      summary: input.summary,
      details: input.details ?? {},
    };

    this.appDb.db
      .prepare(
        `INSERT INTO audit_logs (
          id, timestamp, actor_type, actor_id, actor_name, category, action, severity,
          target_type, target_id, summary, details_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.timestamp,
        entry.actorType,
        entry.actorId,
        entry.actorName,
        entry.category,
        entry.action,
        entry.severity,
        entry.targetType,
        entry.targetId,
        entry.summary,
        JSON.stringify(entry.details),
      );

    this.realtime.broadcast('audit:created', entry);
    return entry;
  }

  public search(params?: {
    query?: string;
    category?: string;
    severity?: string;
    actorId?: string;
    limit?: number;
  }): AuditLogEntry[] {
    const clauses: string[] = [];
    const values: unknown[] = [];

    if (params?.category && params.category !== 'all') {
      clauses.push('category = ?');
      values.push(params.category);
    }
    if (params?.severity && params.severity !== 'all') {
      clauses.push('severity = ?');
      values.push(params.severity);
    }
    if (params?.actorId) {
      clauses.push('actor_id = ?');
      values.push(params.actorId);
    }
    if (params?.query && params.query.trim().length > 0) {
      const q = `%${params.query.trim().toLowerCase()}%`;
      clauses.push(
        '(LOWER(summary) LIKE ? OR LOWER(action) LIKE ? OR LOWER(actor_name) LIKE ? OR LOWER(details_json) LIKE ?)',
      );
      values.push(q, q, q, q);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.min(Math.max(Number(params?.limit ?? 120), 1), 500);

    const rows = this.appDb.db
      .prepare(`SELECT * FROM audit_logs ${where} ORDER BY timestamp DESC LIMIT ?`)
      .all(...values, limit);

    return rows.map((r) => ({
      id: String(r.id),
      timestamp: String(r.timestamp),
      actorType: r.actor_type as AuditLogEntry['actorType'],
      actorId: String(r.actor_id),
      actorName: String(r.actor_name),
      category: r.category as AuditLogEntry['category'],
      action: String(r.action),
      severity: r.severity as AuditLogEntry['severity'],
      targetType: r.target_type ? String(r.target_type) : null,
      targetId: r.target_id ? String(r.target_id) : null,
      summary: String(r.summary),
      details: JSON.parse(String(r.details_json || '{}')),
    }));
  }
}
