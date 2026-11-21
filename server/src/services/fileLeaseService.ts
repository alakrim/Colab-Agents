import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AppDatabase } from '../db/database.js';
import type { ApprovalRequest, FileLease } from '../domain/types.js';
import { getEffortPolicy } from '../domain/effort.js';
import { canAccessFilePath, hasPermission, isSensitivePath } from '../domain/permissions.js';
import type { AuditService } from './auditService.js';
import type { OrgService } from './orgService.js';
import type { RealtimeHub } from './realtime.js';

export interface ProjectFileInfo {
  path: string;
  sizeBytes: number;
  sha256: string;
  updatedAt: string;
  isSensitive: boolean;
  activeLease: FileLease | null;
}

export interface DiffResult {
  hasChanges: boolean;
  hasConflict: boolean;
  baseSha256: string;
  currentCanonicalSha256: string;
  sandboxSha256: string;
  unifiedDiff: string;
}

function sha256Of(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function sanitizeRelPath(relPath: string): string {
  const normalized = path.posix.normalize(relPath.replace(/\\/g, '/').replace(/^\/+/, ''));
  if (!normalized || normalized === '.' || normalized.startsWith('..') || normalized.includes('/../')) {
    throw new Error(`Invalid file path "${relPath}". Path traversal is forbidden.`);
  }
  return normalized;
}

/**
 * Simple, deterministic line-by-line unified diff generator (no external binaries required).
 */
export function generateUnifiedDiff(filePath: string, oldText: string, newText: string): string {
  if (oldText === newText) return '';
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // Longest Common Subsequence DP for accurate minimal line diffs
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`, `@@ -1,${m} +1,${n} @@`];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      out.push(` ${oldLines[i]}`);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push(`-${oldLines[i]}`);
      i++;
    } else {
      out.push(`+${newLines[j]}`);
      j++;
    }
  }
  while (i < m) out.push(`-${oldLines[i++]}`);
  while (j < n) out.push(`+${newLines[j++]}`);
  return out.join('\n');
}

export class FileLeaseService {
  private onApprovalNeeded?: (req: {
    kind: ApprovalRequest['kind'];
    requestedByAgentId: string | null;
    requestedByName: string;
    title: string;
    summary: string;
    payload: Record<string, unknown>;
  }) => ApprovalRequest;

  constructor(
    private readonly appDb: AppDatabase,
    private readonly org: OrgService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeHub,
  ) {}

  public setApprovalCreator(fn: NonNullable<FileLeaseService['onApprovalNeeded']>): void {
    this.onApprovalNeeded = fn;
  }

  private mapLease(r: Record<string, unknown>): FileLease {
    const agent = this.org.getAgentById(String(r.agent_id));
    const expiresAt = String(r.expires_at);
    const remainingMs = Math.max(0, new Date(expiresAt).getTime() - Date.now());
    return {
      id: String(r.id),
      filePath: String(r.file_path),
      agentId: String(r.agent_id),
      taskId: r.task_id ? String(r.task_id) : null,
      baseSha256: String(r.base_sha256),
      sandboxPath: String(r.sandbox_path),
      status: r.status as FileLease['status'],
      acquiredAt: String(r.acquired_at),
      lastHeartbeatAt: String(r.last_heartbeat_at),
      expiresAt,
      releasedAt: r.released_at ? String(r.released_at) : null,
      recoveryDraftPath: r.recovery_draft_path ? String(r.recovery_draft_path) : null,
      agentName: agent?.name ?? String(r.agent_id),
      agentProvider: agent?.provider,
      remainingMs: r.status === 'active' ? remainingMs : 0,
    };
  }

  private walkCanonicalFiles(dir: string, base: string, acc: string[]): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.posix.join(base, entry.name);
      if (entry.isDirectory()) {
        this.walkCanonicalFiles(full, rel, acc);
      } else if (entry.isFile()) {
        acc.push(rel);
      }
    }
  }

  public listFiles(): ProjectFileInfo[] {
    // Reap expired leases before listing so UI always sees accurate locks
    this.sweepExpiredLeases();

    const relPaths: string[] = [];
    this.walkCanonicalFiles(this.appDb.paths.canonicalProjectDir, '', relPaths);
    relPaths.sort();

    const activeLeases = this.listLeases({ status: 'active' });
    const leaseByPath = new Map(activeLeases.map((l) => [l.filePath, l]));

    return relPaths.map((rel) => {
      const abs = path.join(this.appDb.paths.canonicalProjectDir, rel);
      const stat = fs.statSync(abs);
      const content = fs.readFileSync(abs, 'utf8');
      return {
        path: rel,
        sizeBytes: stat.size,
        sha256: sha256Of(content),
        updatedAt: stat.mtime.toISOString(),
        isSensitive: isSensitivePath(rel),
        activeLease: leaseByPath.get(rel) ?? null,
      };
    });
  }

  public readCanonicalFile(relPath: string): { path: string; content: string; sha256: string; isSensitive: boolean } {
    const clean = sanitizeRelPath(relPath);
    const abs = path.join(this.appDb.paths.canonicalProjectDir, clean);
    if (!fs.existsSync(abs)) {
      throw new Error(`File "${clean}" does not exist in canonical project workspace.`);
    }
    const content = fs.readFileSync(abs, 'utf8');
    return { path: clean, content, sha256: sha256Of(content), isSensitive: isSensitivePath(clean) };
  }

  public createCanonicalFile(relPath: string, content: string, actorName = 'Executive Supervisor'): ProjectFileInfo {
    const clean = sanitizeRelPath(relPath);
    const abs = path.join(this.appDb.paths.canonicalProjectDir, clean);
    if (fs.existsSync(abs)) {
      throw new Error(`File "${clean}" already exists.`);
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    this.audit.record({
      actorType: 'human',
      actorId: 'human-exec',
      actorName,
      category: 'file',
      action: 'file.created',
      targetType: 'file',
      targetId: clean,
      summary: `Created project file "${clean}".`,
    });
    this.realtime.broadcast('files:updated', { path: clean });
    return this.listFiles().find((f) => f.path === clean)!;
  }

  public requestDeleteFile(relPath: string, requestedByAgentId: string | null): { deleted: boolean; approval?: ApprovalRequest } {
    const clean = sanitizeRelPath(relPath);
    const abs = path.join(this.appDb.paths.canonicalProjectDir, clean);
    if (!fs.existsSync(abs)) throw new Error(`File "${clean}" not found.`);

    const activeLease = this.getActiveLeaseForPath(clean);
    if (activeLease) {
      throw new Error(`Cannot delete "${clean}" while leased by ${activeLease.agentName}.`);
    }

    if (requestedByAgentId) {
      const agent = this.org.getAgentById(requestedByAgentId);
      if (!agent) throw new Error(`Agent ${requestedByAgentId} not found.`);
      // Deleting files by an agent ALWAYS requires human approval
      if (!this.onApprovalNeeded) throw new Error('Approval service unavailable');
      const approval = this.onApprovalNeeded({
        kind: 'file_delete',
        requestedByAgentId: agent.id,
        requestedByName: agent.name,
        title: `Delete file ${clean}`,
        summary: `${agent.name} requested deletion of "${clean}". Human approval is mandatory for file deletions.`,
        payload: { filePath: clean },
      });
      return { deleted: false, approval };
    }

    fs.unlinkSync(abs);
    this.audit.record({
      actorType: 'human',
      actorId: 'human-exec',
      actorName: 'Executive Supervisor',
      category: 'file',
      action: 'file.deleted',
      severity: 'warning',
      targetType: 'file',
      targetId: clean,
      summary: `Deleted canonical file "${clean}".`,
    });
    this.realtime.broadcast('files:updated', { path: clean, deleted: true });
    return { deleted: true };
  }

  public executeApprovedDelete(filePath: string): void {
    const clean = sanitizeRelPath(filePath);
    const abs = path.join(this.appDb.paths.canonicalProjectDir, clean);
    if (fs.existsSync(abs)) {
      fs.unlinkSync(abs);
    }
    this.realtime.broadcast('files:updated', { path: clean, deleted: true });
  }

  public listLeases(filter?: { status?: string; agentId?: string }): FileLease[] {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (filter?.status && filter.status !== 'all') {
      clauses.push('status = ?');
      values.push(filter.status);
    }
    if (filter?.agentId) {
      clauses.push('agent_id = ?');
      values.push(filter.agentId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.appDb.db
      .prepare(`SELECT * FROM file_leases ${where} ORDER BY acquired_at DESC LIMIT 100`)
      .all(...values);
    return rows.map((r) => this.mapLease(r));
  }

  public getLeaseById(id: string): FileLease | null {
    const row = this.appDb.db.prepare('SELECT * FROM file_leases WHERE id = ?').get(id);
    return row ? this.mapLease(row) : null;
  }

  public getActiveLeaseForPath(relPath: string): FileLease | null {
    const clean = sanitizeRelPath(relPath);
    const row = this.appDb.db
      .prepare(`SELECT * FROM file_leases WHERE file_path = ? AND status = 'active'`)
      .get(clean);
    return row ? this.mapLease(row) : null;
  }

  /**
   * ATOMIC FILE CLAIM & ISOLATED SANDBOX CREATION
   * Uses BEGIN IMMEDIATE + SQLite UNIQUE partial index on active leases
   * so simultaneous edits to the same file are impossible.
   */
  public claimFile(input: {
    filePath: string;
    agentId: string;
    taskId?: string | null;
    ttlSeconds?: number;
  }): FileLease {
    this.sweepExpiredLeases();

    const clean = sanitizeRelPath(input.filePath);
    const agent = this.org.getAgentById(input.agentId);
    if (!agent) throw new Error(`Agent ${input.agentId} not found.`);

    if (!hasPermission(agent, 'files:claim_edit')) {
      this.audit.record({
        actorType: 'agent',
        actorId: agent.id,
        actorName: agent.name,
        category: 'security',
        action: 'file.claim_denied',
        severity: 'security',
        targetType: 'file',
        targetId: clean,
        summary: `Denied file claim on "${clean}": ${agent.name} lacks "files:claim_edit" permission.`,
      });
      const err = new Error(`Permission denied: ${agent.name} does not have "files:claim_edit".`) as Error & {
        statusCode?: number;
      };
      err.statusCode = 403;
      throw err;
    }

    const pathCheck = canAccessFilePath(agent, clean);
    if (!pathCheck.allowed) {
      this.audit.record({
        actorType: 'agent',
        actorId: agent.id,
        actorName: agent.name,
        category: 'security',
        action: 'file.path_restricted',
        severity: 'security',
        targetType: 'file',
        targetId: clean,
        summary: pathCheck.reason || `Restricted path access attempt by ${agent.name}`,
      });
      const err = new Error(pathCheck.reason) as Error & { statusCode?: number };
      err.statusCode = 403;
      throw err;
    }

    const canonicalAbs = path.join(this.appDb.paths.canonicalProjectDir, clean);
    const canonicalExists = fs.existsSync(canonicalAbs);
    const canonicalContent = canonicalExists ? fs.readFileSync(canonicalAbs, 'utf8') : '';
    const baseSha = sha256Of(canonicalContent);

    const leaseId = `lease-${crypto.randomUUID().slice(0, 10)}`;
    const sandboxAbs = path.join(this.appDb.paths.sandboxesDir, agent.id, leaseId, clean);
    const effortPolicy = getEffortPolicy(agent.effort);
    const ttl = Math.max(15, Math.min(3600, Number(input.ttlSeconds ?? effortPolicy.defaultLeaseSeconds)));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();

    const lease = this.appDb.transaction(() => {
      const existing = this.appDb.db
        .prepare(`SELECT * FROM file_leases WHERE file_path = ? AND status = 'active'`)
        .get(clean);

      if (existing) {
        const owner = this.org.getAgentById(String(existing.agent_id));
        const err = new Error(
          `File "${clean}" is already leased by ${owner?.name ?? existing.agent_id} until ${existing.expires_at}. Request a handoff or wait for lease release.`,
        ) as Error & { statusCode?: number; conflictLease?: FileLease };
        err.statusCode = 409;
        err.conflictLease = this.mapLease(existing);
        throw err;
      }

      // Create isolated working copy on disk
      fs.mkdirSync(path.dirname(sandboxAbs), { recursive: true });
      fs.writeFileSync(sandboxAbs, canonicalContent, 'utf8');

      this.appDb.db
        .prepare(
          `INSERT INTO file_leases (
            id, file_path, agent_id, task_id, base_sha256, sandbox_path,
            status, acquired_at, last_heartbeat_at, expires_at, released_at, recovery_draft_path
          ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL, NULL)`,
        )
        .run(
          leaseId,
          clean,
          agent.id,
          input.taskId ?? null,
          baseSha,
          sandboxAbs,
          now.toISOString(),
          now.toISOString(),
          expiresAt,
        );

      return this.getLeaseById(leaseId)!;
    });

    this.audit.record({
      actorType: 'agent',
      actorId: agent.id,
      actorName: agent.name,
      category: 'file',
      action: 'file.lease_acquired',
      targetType: 'file',
      targetId: clean,
      summary: `${agent.name} acquired exclusive lease on "${clean}" (TTL ${ttl}s, isolated sandbox created).`,
      details: { leaseId: lease.id, baseSha256: baseSha, expiresAt },
    });
    this.realtime.broadcast('files:lease_changed', lease);
    return lease;
  }

  public renewHeartbeat(leaseId: string, extendSeconds?: number): FileLease {
    const lease = this.getLeaseById(leaseId);
    if (!lease) throw new Error(`Lease ${leaseId} not found.`);
    if (lease.status !== 'active') {
      throw new Error(`Lease ${leaseId} is no longer active (status: ${lease.status}).`);
    }
    const agent = this.org.getAgentById(lease.agentId);
    const ttl = Math.max(
      15,
      Math.min(3600, Number(extendSeconds ?? getEffortPolicy(agent?.effort ?? 'medium').defaultLeaseSeconds)),
    );
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();

    this.appDb.db
      .prepare(`UPDATE file_leases SET last_heartbeat_at = ?, expires_at = ? WHERE id = ? AND status = 'active'`)
      .run(now.toISOString(), expiresAt, leaseId);

    const updated = this.getLeaseById(leaseId)!;
    this.realtime.broadcast('files:lease_heartbeat', updated);
    return updated;
  }

  /**
   * Automatic heartbeat renewal for agents that currently have active/dispatched work
   * (e.g., connected browser bridge tabs or active handoffs), plus abandoned-claim recovery.
   */
  public sweepExpiredLeases(): FileLease[] {
    const nowIso = new Date().toISOString();
    const expiredRows = this.appDb.db
      .prepare(`SELECT * FROM file_leases WHERE status = 'active' AND expires_at <= ?`)
      .all(nowIso);

    const recovered: FileLease[] = [];
    for (const row of expiredRows) {
      const lease = this.mapLease(row);
      let recoveryPath: string | null = null;

      // Preserve isolated sandbox work as a recoverable draft snapshot before releasing lock!
      if (fs.existsSync(lease.sandboxPath)) {
        const sandboxContent = fs.readFileSync(lease.sandboxPath, 'utf8');
        if (sha256Of(sandboxContent) !== lease.baseSha256) {
          recoveryPath = path.join(
            this.appDb.paths.recoveryDir,
            `${lease.id}-${path.basename(lease.filePath)}.draft`,
          );
          fs.mkdirSync(path.dirname(recoveryPath), { recursive: true });
          fs.writeFileSync(recoveryPath, sandboxContent, 'utf8');
        }
      }

      this.appDb.db
        .prepare(
          `UPDATE file_leases SET status = 'abandoned', released_at = ?, recovery_draft_path = ? WHERE id = ? AND status = 'active'`,
        )
        .run(nowIso, recoveryPath, lease.id);

      const updated = this.getLeaseById(lease.id)!;
      recovered.push(updated);

      this.audit.record({
        actorType: 'system',
        actorId: 'lease-sweeper',
        actorName: 'Lease Recovery Monitor',
        category: 'file',
        action: 'file.lease_abandoned_recovered',
        severity: 'warning',
        targetType: 'file',
        targetId: lease.filePath,
        summary: `Recovered abandoned lease on "${lease.filePath}" from ${lease.agentName}.${
          recoveryPath ? ' Uncommitted edits preserved as recovery draft.' : ''
        }`,
        details: { leaseId: lease.id, recoveryDraftPath: recoveryPath },
      });
      this.realtime.broadcast('files:lease_changed', updated);
    }

    return recovered;
  }

  public readSandbox(leaseId: string): { lease: FileLease; content: string; diff: DiffResult } {
    const lease = this.getLeaseById(leaseId);
    if (!lease) throw new Error(`Lease ${leaseId} not found.`);
    if (!fs.existsSync(lease.sandboxPath)) {
      throw new Error(`Sandbox working copy missing for lease ${leaseId}.`);
    }
    const content = fs.readFileSync(lease.sandboxPath, 'utf8');
    const diff = this.computeDiff(leaseId);
    return { lease, content, diff };
  }

  public writeSandbox(leaseId: string, newContent: string): { lease: FileLease; diff: DiffResult } {
    const lease = this.getLeaseById(leaseId);
    if (!lease) throw new Error(`Lease ${leaseId} not found.`);
    if (lease.status !== 'active') {
      throw new Error(`Cannot write to sandbox: lease ${leaseId} is "${lease.status}".`);
    }
    if (new Date(lease.expiresAt).getTime() <= Date.now()) {
      this.sweepExpiredLeases();
      throw new Error(`Lease ${leaseId} has expired and was reclaimed.`);
    }

    fs.mkdirSync(path.dirname(lease.sandboxPath), { recursive: true });
    fs.writeFileSync(lease.sandboxPath, newContent, 'utf8');
    // Renew heartbeat automatically on active sandbox write
    const renewed = this.renewHeartbeat(leaseId);
    const diff = this.computeDiff(leaseId);
    this.realtime.broadcast('files:sandbox_updated', { leaseId, filePath: lease.filePath, diff });
    return { lease: renewed, diff };
  }

  public computeDiff(leaseId: string): DiffResult {
    const lease = this.getLeaseById(leaseId);
    if (!lease) throw new Error(`Lease ${leaseId} not found.`);

    const canonicalAbs = path.join(this.appDb.paths.canonicalProjectDir, lease.filePath);
    const canonicalText = fs.existsSync(canonicalAbs) ? fs.readFileSync(canonicalAbs, 'utf8') : '';
    const sandboxText = fs.existsSync(lease.sandboxPath) ? fs.readFileSync(lease.sandboxPath, 'utf8') : '';

    const currentCanonicalSha = sha256Of(canonicalText);
    const sandboxSha = sha256Of(sandboxText);
    const hasConflict = currentCanonicalSha !== lease.baseSha256;
    const hasChanges = sandboxSha !== currentCanonicalSha;
    const unifiedDiff = generateUnifiedDiff(lease.filePath, canonicalText, sandboxText);

    return {
      hasChanges,
      hasConflict,
      baseSha256: lease.baseSha256,
      currentCanonicalSha256: currentCanonicalSha,
      sandboxSha256: sandboxSha,
      unifiedDiff,
    };
  }

  /**
   * Controlled integration of isolated working copy into canonical workspace.
   * Enforces: active lease + conflict detection + permissions + sensitive-path/max-effort human approval gate.
   */
  public integrateLease(
    leaseId: string,
    opts?: { forceResolveConflict?: boolean; bypassApprovalForHuman?: boolean },
  ): {
    status: 'integrated' | 'pending_approval' | 'no_changes';
    lease: FileLease;
    diff: DiffResult;
    approval?: ApprovalRequest;
  } {
    const lease = this.getLeaseById(leaseId);
    if (!lease) throw new Error(`Lease ${leaseId} not found.`);
    if (lease.status !== 'active') {
      throw new Error(`Cannot integrate lease ${leaseId}: status is "${lease.status}".`);
    }

    const diff = this.computeDiff(leaseId);
    if (!diff.hasChanges) {
      this.releaseLease(leaseId);
      return { status: 'no_changes', lease: this.getLeaseById(leaseId)!, diff };
    }

    if (diff.hasConflict && !opts?.forceResolveConflict) {
      const err = new Error(
        `Merge conflict detected on "${lease.filePath}": canonical file changed since lease acquisition (base ${lease.baseSha256.slice(0, 8)} vs current ${diff.currentCanonicalSha256.slice(0, 8)}).`,
      ) as Error & { statusCode?: number; diff?: DiffResult };
      err.statusCode = 409;
      err.diff = diff;
      throw err;
    }

    const agent = this.org.getAgentById(lease.agentId);
    const effortPolicy = getEffortPolicy(agent?.effort ?? 'medium');
    const needsApproval =
      !opts?.bypassApprovalForHuman &&
      (isSensitivePath(lease.filePath) ||
        effortPolicy.requireApprovalForIntegration ||
        !agent ||
        !hasPermission(agent, 'files:integrate_direct'));

    if (needsApproval) {
      if (!this.onApprovalNeeded) throw new Error('Approval service unavailable');
      const reason = isSensitivePath(lease.filePath)
        ? 'Sensitive file path'
        : effortPolicy.requireApprovalForIntegration
          ? 'MAX effort integration policy'
          : `${agent?.name ?? lease.agentId} requires supervisor approval (no direct integration permission)`;

      const approval = this.onApprovalNeeded({
        kind: 'file_integrate',
        requestedByAgentId: lease.agentId,
        requestedByName: lease.agentName ?? lease.agentId,
        title: `Integrate changes to ${lease.filePath}`,
        summary: `${lease.agentName} proposed changes to "${lease.filePath}". Gate reason: ${reason}.`,
        payload: {
          leaseId: lease.id,
          filePath: lease.filePath,
          unifiedDiff: diff.unifiedDiff,
          baseSha256: diff.baseSha256,
          sandboxSha256: diff.sandboxSha256,
          reason,
        },
      });
      return { status: 'pending_approval', lease, diff, approval };
    }

    return this.commitIntegrationAtomically(lease, diff, 'Direct agent integration');
  }

  public commitIntegrationAtomically(
    lease: FileLease,
    diff: DiffResult,
    note: string,
  ): { status: 'integrated'; lease: FileLease; diff: DiffResult } {
    const canonicalAbs = path.join(this.appDb.paths.canonicalProjectDir, lease.filePath);
    const sandboxContent = fs.readFileSync(lease.sandboxPath, 'utf8');
    const now = new Date().toISOString();

    this.appDb.transaction(() => {
      fs.mkdirSync(path.dirname(canonicalAbs), { recursive: true });
      // Write atomically via temp file + rename
      const tmpAbs = `${canonicalAbs}.tmp-${crypto.randomUUID().slice(0, 6)}`;
      fs.writeFileSync(tmpAbs, sandboxContent, 'utf8');
      fs.renameSync(tmpAbs, canonicalAbs);

      this.appDb.db
        .prepare(`UPDATE file_leases SET status = 'integrated', released_at = ? WHERE id = ?`)
        .run(now, lease.id);
    });

    const updated = this.getLeaseById(lease.id)!;
    this.audit.record({
      actorType: 'agent',
      actorId: lease.agentId,
      actorName: lease.agentName ?? lease.agentId,
      category: 'file',
      action: 'file.integrated',
      severity: 'decision',
      targetType: 'file',
      targetId: lease.filePath,
      summary: `Integrated sandbox changes to "${lease.filePath}" (${note}).`,
      details: { leaseId: lease.id, newSha256: diff.sandboxSha256 },
    });
    this.realtime.broadcast('files:updated', { path: lease.filePath, integrated: true, leaseId: lease.id });
    this.realtime.broadcast('files:lease_changed', updated);
    return { status: 'integrated', lease: updated, diff };
  }

  public releaseLease(leaseId: string): FileLease {
    const lease = this.getLeaseById(leaseId);
    if (!lease) throw new Error(`Lease ${leaseId} not found.`);
    const now = new Date().toISOString();
    this.appDb.db
      .prepare(`UPDATE file_leases SET status = 'released', released_at = ? WHERE id = ? AND status = 'active'`)
      .run(now, leaseId);
    const updated = this.getLeaseById(leaseId)!;
    this.audit.record({
      actorType: 'agent',
      actorId: lease.agentId,
      actorName: lease.agentName ?? lease.agentId,
      category: 'file',
      action: 'file.lease_released',
      targetType: 'file',
      targetId: lease.filePath,
      summary: `Released file lease on "${lease.filePath}".`,
    });
    this.realtime.broadcast('files:lease_changed', updated);
    return updated;
  }
}
