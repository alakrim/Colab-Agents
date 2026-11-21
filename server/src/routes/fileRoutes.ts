import { Router } from 'express';
import type { FileLeaseService } from '../services/fileLeaseService.js';

export function createFileRouter(files: FileLeaseService): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ files: files.listFiles(), leases: files.listLeases() });
  });

  router.get('/content', (req, res) => {
    try {
      const filePath = String(req.query.path || '');
      res.json(files.readCanonicalFile(filePath));
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'File not found' });
    }
  });

  router.post('/create', (req, res) => {
    try {
      const file = files.createCanonicalFile(req.body.path, req.body.content ?? '', req.body.actorName);
      res.status(201).json(file);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create file' });
    }
  });

  router.post('/delete', (req, res) => {
    try {
      const result = files.requestDeleteFile(req.body.path, req.body.agentId ?? null);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to delete file' });
    }
  });

  router.post('/leases/claim', (req, res) => {
    try {
      const lease = files.claimFile(req.body);
      res.status(201).json(lease);
    } catch (err) {
      const e = err as Error & { statusCode?: number; conflictLease?: unknown };
      res.status(e.statusCode ?? 400).json({ error: e.message, conflictLease: e.conflictLease });
    }
  });

  router.post('/leases/:id/heartbeat', (req, res) => {
    try {
      const lease = files.renewHeartbeat(req.params.id, req.body?.extendSeconds);
      res.json(lease);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to renew heartbeat' });
    }
  });

  router.get('/leases/:id/sandbox', (req, res) => {
    try {
      res.json(files.readSandbox(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to read sandbox' });
    }
  });

  router.put('/leases/:id/sandbox', (req, res) => {
    try {
      res.json(files.writeSandbox(req.params.id, String(req.body.content ?? '')));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to write sandbox' });
    }
  });

  router.post('/leases/:id/integrate', (req, res) => {
    try {
      const result = files.integrateLease(req.params.id, {
        forceResolveConflict: Boolean(req.body?.forceResolveConflict),
        bypassApprovalForHuman: Boolean(req.body?.bypassApprovalForHuman),
      });
      res.json(result);
    } catch (err) {
      const e = err as Error & { statusCode?: number; diff?: unknown };
      res.status(e.statusCode ?? 400).json({ error: e.message, diff: e.diff });
    }
  });

  router.post('/leases/:id/release', (req, res) => {
    try {
      res.json(files.releaseLease(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to release lease' });
    }
  });

  router.post('/leases/sweep', (_req, res) => {
    res.json({ recovered: files.sweepExpiredLeases() });
  });

  return router;
}
