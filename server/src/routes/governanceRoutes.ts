import { Router } from 'express';
import type { ApprovalService } from '../services/approvalService.js';
import type { AuditService } from '../services/auditService.js';
import type { MemoryService } from '../services/memoryService.js';

export function createGovernanceRouter(
  memory: MemoryService,
  approvals: ApprovalService,
  audit: AuditService,
): Router {
  const router = Router();

  router.get('/knowledge', (req, res) => {
    const kind = req.query.kind ? String(req.query.kind) : undefined;
    const query = req.query.q ? String(req.query.q) : undefined;
    const departmentId = req.query.departmentId ? String(req.query.departmentId) : undefined;
    res.json({ entries: memory.list({ kind, query, departmentId }) });
  });

  router.post('/knowledge', (req, res) => {
    try {
      res.status(201).json(memory.create(req.body));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create knowledge entry' });
    }
  });

  router.patch('/knowledge/:id', (req, res) => {
    try {
      res.json(memory.update(req.params.id, req.body));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update knowledge entry' });
    }
  });

  router.delete('/knowledge/:id', (req, res) => {
    memory.delete(req.params.id);
    res.json({ deleted: true });
  });

  router.get('/approvals', (req, res) => {
    const status = req.query.status ? String(req.query.status) : undefined;
    res.json({ approvals: approvals.list(status) });
  });

  router.post('/approvals', (req, res) => {
    try {
      res.status(201).json(approvals.create(req.body));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create approval' });
    }
  });

  router.post('/approvals/:id/decide', (req, res) => {
    try {
      const { decision, note, decidedBy } = req.body;
      if (decision !== 'approved' && decision !== 'rejected') {
        res.status(400).json({ error: 'decision must be "approved" or "rejected".' });
        return;
      }
      res.json(approvals.decide(req.params.id, decision, note, decidedBy));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to decide approval' });
    }
  });

  router.get('/audit', (req, res) => {
    res.json({
      logs: audit.search({
        query: req.query.q ? String(req.query.q) : undefined,
        category: req.query.category ? String(req.query.category) : undefined,
        severity: req.query.severity ? String(req.query.severity) : undefined,
        actorId: req.query.actorId ? String(req.query.actorId) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : 150,
      }),
    });
  });

  return router;
}
