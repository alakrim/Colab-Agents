import crypto from 'node:crypto';
import type { AppDatabase } from '../db/database.js';
import type { ApprovalKind, ApprovalRequest } from '../domain/types.js';
import type { AuditService } from './auditService.js';
import type { FileLeaseService } from './fileLeaseService.js';
import type { OrgService } from './orgService.js';
import type { RealtimeHub } from './realtime.js';

export class ApprovalService {
  constructor(
    private readonly appDb: AppDatabase,
    private readonly org: OrgService,
    private readonly files: FileLeaseService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeHub,
  ) {}

  private mapRow(r: Record<string, unknown>): ApprovalRequest {
    return {
      id: String(r.id),
      kind: r.kind as ApprovalKind,
      requestedByAgentId: r.requested_by_agent_id ? String(r.requested_by_agent_id) : null,
      requestedByName: String(r.requested_by_name),
      title: String(r.title),
      summary: String(r.summary),
      payload: JSON.parse(String(r.payload_json || '{}')),
      status: r.status as ApprovalRequest['status'],
      decidedBy: r.decided_by ? String(r.decided_by) : null,
      decisionNote: r.decision_note ? String(r.decision_note) : null,
      createdAt: String(r.created_at),
      decidedAt: r.decided_at ? String(r.decided_at) : null,
    };
  }

  public list(status?: string): ApprovalRequest[] {
    const where = status && status !== 'all' ? 'WHERE status = ?' : '';
    const rows =
      status && status !== 'all'
        ? this.appDb.db.prepare(`SELECT * FROM approvals ${where} ORDER BY created_at DESC`).all(status)
        : this.appDb.db.prepare('SELECT * FROM approvals ORDER BY created_at DESC').all();
    return rows.map((r) => this.mapRow(r));
  }

  public create(input: {
    kind: ApprovalKind;
    requestedByAgentId: string | null;
    requestedByName: string;
    title: string;
    summary: string;
    payload?: Record<string, unknown>;
  }): ApprovalRequest {
    const now = new Date().toISOString();
    const id = `appr-${crypto.randomUUID().slice(0, 10)}`;
    this.appDb.db
      .prepare(
        `INSERT INTO approvals (
          id, kind, requested_by_agent_id, requested_by_name, title, summary,
          payload_json, status, decided_by, decision_note, created_at, decided_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, NULL)`,
      )
      .run(
        id,
        input.kind,
        input.requestedByAgentId,
        input.requestedByName,
        input.title.trim(),
        input.summary.trim(),
        JSON.stringify(input.payload ?? {}),
        now,
      );

    const created = this.mapRow(this.appDb.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id)!);
    this.audit.record({
      actorType: input.requestedByAgentId ? 'agent' : 'system',
      actorId: input.requestedByAgentId ?? 'system',
      actorName: input.requestedByName,
      category: 'approval',
      action: 'approval.requested',
      severity: 'security',
      targetType: 'approval',
      targetId: created.id,
      summary: `Human approval requested: "${created.title}" (${created.kind}).`,
      details: { kind: created.kind },
    });
    this.realtime.broadcast('approvals:updated', created);
    return created;
  }

  public decide(
    id: string,
    decision: 'approved' | 'rejected',
    note?: string,
    decidedBy = 'Executive Supervisor',
  ): { approval: ApprovalRequest; executionResult?: unknown } {
    const row = this.appDb.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id);
    if (!row) throw new Error(`Approval request ${id} not found.`);
    const req = this.mapRow(row);
    if (req.status !== 'pending') {
      throw new Error(`Approval ${id} was already decided (${req.status}).`);
    }

    let executionResult: unknown = undefined;

    if (decision === 'approved') {
      if (req.kind === 'file_integrate') {
        const leaseId = String(req.payload.leaseId || '');
        const lease = this.files.getLeaseById(leaseId);
        if (!lease || lease.status !== 'active') {
          throw new Error(`Cannot complete approved integration: lease ${leaseId} is no longer active.`);
        }
        const diff = this.files.computeDiff(leaseId);
        executionResult = this.files.commitIntegrationAtomically(
          lease,
          diff,
          `Approved by ${decidedBy}${note ? `: ${note}` : ''}`,
        );
      } else if (req.kind === 'file_delete') {
        const filePath = String(req.payload.filePath || '');
        this.files.executeApprovedDelete(filePath);
        executionResult = { deleted: filePath };
      } else if (req.kind === 'spawn_subagent') {
        const managerId = String(req.payload.managerId || req.requestedByAgentId || '');
        executionResult = this.org.spawnSubagent(managerId, {
          name: String(req.payload.name || 'Subagent'),
          role: String(req.payload.role || 'Specialist'),
          provider: req.payload.provider as 'claude' | 'gemini' | undefined,
          model: req.payload.model ? String(req.payload.model) : undefined,
        });
      }
    }

    const now = new Date().toISOString();
    this.appDb.db
      .prepare('UPDATE approvals SET status = ?, decided_by = ?, decision_note = ?, decided_at = ? WHERE id = ?')
      .run(decision, decidedBy, note?.trim() || null, now, id);

    const updated = this.mapRow(this.appDb.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id)!);
    this.audit.record({
      actorType: 'human',
      actorId: 'human-exec',
      actorName: decidedBy,
      category: 'approval',
      action: `approval.${decision}`,
      severity: 'decision',
      targetType: 'approval',
      targetId: id,
      summary: `${decision === 'approved' ? 'Approved' : 'Rejected'} "${updated.title}"${note ? ` — ${note}` : ''}.`,
      details: { kind: updated.kind, executionResult: Boolean(executionResult) },
    });
    this.realtime.broadcast('approvals:updated', updated);
    return { approval: updated, executionResult };
  }
}
