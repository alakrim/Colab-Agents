import { Router } from 'express';
import type { OrgService } from '../services/orgService.js';
import { EFFORT_POLICIES } from '../domain/effort.js';
import { ALL_PERMISSIONS } from '../domain/types.js';

export function createOrgRouter(org: OrgService): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({
      ...org.getFullOrg(),
      effortPolicies: EFFORT_POLICIES,
      allPermissions: ALL_PERMISSIONS,
    });
  });

  router.post('/departments', (req, res) => {
    try {
      const dept = org.createDepartment(req.body);
      res.status(201).json(dept);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create department' });
    }
  });

  router.patch('/departments/:id', (req, res) => {
    try {
      const dept = org.updateDepartment(req.params.id, req.body);
      res.json(dept);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update department' });
    }
  });

  router.delete('/departments/:id', (req, res) => {
    try {
      org.deleteDepartment(req.params.id);
      res.json({ deleted: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to delete department' });
    }
  });

  router.post('/teams', (req, res) => {
    try {
      const team = org.createTeam(req.body);
      res.status(201).json(team);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create team' });
    }
  });

  router.post('/blueprints/:id/instantiate', (req, res) => {
    try {
      const { departmentId, reportsToId } = req.body;
      const result = org.instantiateBlueprint(req.params.id, departmentId, reportsToId ?? null);
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to instantiate blueprint' });
    }
  });

  router.post('/agents', (req, res) => {
    try {
      const agent = org.createAgentOrPosition(req.body);
      res.status(201).json(agent);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create agent/position' });
    }
  });

  router.patch('/agents/:id', (req, res) => {
    try {
      const agent = org.updateAgent(req.params.id, req.body);
      res.json(agent);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update agent' });
    }
  });

  router.post('/agents/:id/promote', (req, res) => {
    try {
      const agent = org.promoteAgent(req.params.id, req.body || {});
      res.json(agent);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to promote agent' });
    }
  });

  router.post('/agents/:id/spawn-subagent', (req, res) => {
    try {
      const subagent = org.spawnSubagent(req.params.id, req.body);
      res.status(201).json(subagent);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to spawn subagent' });
    }
  });

  router.delete('/agents/:id', (req, res) => {
    try {
      org.deleteAgent(req.params.id);
      res.json({ deleted: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to delete agent' });
    }
  });

  return router;
}
