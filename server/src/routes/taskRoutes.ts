import { Router } from 'express';
import type { TaskService } from '../services/taskService.js';
import type { CollabService } from '../services/collabService.js';

export function createTaskRouter(tasks: TaskService, collab: CollabService): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const status = req.query.status ? String(req.query.status) : undefined;
    const agentId = req.query.agentId ? String(req.query.agentId) : undefined;
    const departmentId = req.query.departmentId ? String(req.query.departmentId) : undefined;
    res.json({ tasks: tasks.list({ status, agentId, departmentId }) });
  });

  router.post('/', async (req, res) => {
    try {
      const task = tasks.create(req.body);
      let dispatch = null;
      if (req.body.dispatchImmediately && task.assignedAgentId && task.channelId) {
        dispatch = await collab.dispatchAgent({
          agentId: task.assignedAgentId,
          channelId: task.channelId,
          taskId: task.id,
        });
      }
      res.status(201).json({ task, dispatch });
    } catch (err) {
      const status = (err as Error & { statusCode?: number }).statusCode ?? 400;
      res.status(status).json({ error: err instanceof Error ? err.message : 'Failed to create task' });
    }
  });

  router.patch('/:id', (req, res) => {
    try {
      res.json(tasks.update(req.params.id, req.body));
    } catch (err) {
      const status = (err as Error & { statusCode?: number }).statusCode ?? 400;
      res.status(status).json({ error: err instanceof Error ? err.message : 'Failed to update task' });
    }
  });

  router.post('/:id/claim', (req, res) => {
    try {
      res.json(tasks.claimTask(req.params.id, req.body.agentId));
    } catch (err) {
      const status = (err as Error & { statusCode?: number }).statusCode ?? 400;
      res.status(status).json({ error: err instanceof Error ? err.message : 'Failed to claim task' });
    }
  });

  router.post('/:id/deliverables', (req, res) => {
    try {
      res.json(tasks.addDeliverable(req.params.id, req.body));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to add deliverable' });
    }
  });

  return router;
}
