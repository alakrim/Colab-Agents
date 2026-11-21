import { Router } from 'express';
import { WORKFLOW_TEMPLATES, type WorkflowService } from '../services/workflowService.js';
import type { DebateService } from '../services/debateService.js';
import type { CollabService } from '../services/collabService.js';

export function createWorkflowRouter(
  workflow: WorkflowService,
  debate: DebateService,
  collab: CollabService,
): Router {
  const router = Router();

  router.get('/plans', (_req, res) => {
    res.json({
      plans: workflow.listPlans(),
      templates: WORKFLOW_TEMPLATES,
      debates: debate.list(),
      telemetry: collab.getTelemetry(),
    });
  });

  router.post('/plans', (req, res) => {
    try {
      res.status(201).json(workflow.createPlanFromTemplate(req.body));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create workflow plan' });
    }
  });

  router.post('/plans/:id/steps', (req, res) => {
    try {
      res.status(201).json(workflow.addStep(req.params.id, req.body));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to add workflow box' });
    }
  });

  router.patch('/steps/:id', async (req, res) => {
    try {
      const updated = await workflow.updateStep(req.params.id, req.body, 'pm');
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update workflow box' });
    }
  });

  router.post('/plans/:id/launch', async (req, res) => {
    try {
      res.json(await workflow.approveAndLaunchPlan(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to launch workflow' });
    }
  });

  router.post('/plans/:id/status', (req, res) => {
    try {
      res.json(workflow.setPlanStatus(req.params.id, req.body.status));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update status' });
    }
  });

  // Management Debate endpoints (#management)
  router.post('/debates', async (req, res) => {
    try {
      res.status(201).json(await debate.startDebate(req.body));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to start debate' });
    }
  });

  router.post('/debates/:id/advance', async (req, res) => {
    try {
      const cur = debate.get(req.params.id);
      if (!cur) {
        res.status(404).json({ error: 'Debate not found' });
        return;
      }
      if (cur.status === 'round_1') {
        res.json(await debate.advanceToRound2(cur.id));
      } else if (cur.status === 'round_2') {
        res.json(await debate.advanceToRound3(cur.id));
      } else {
        res.json(await debate.convergeDebateToWorkflow(cur.id, req.body?.synthesisText || ''));
      }
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to advance debate' });
    }
  });

  // Global Pause All Kill Switch & Token Telemetry
  router.get('/telemetry', (_req, res) => {
    res.json(collab.getTelemetry());
  });

  router.post('/pause', (req, res) => {
    res.json(collab.setCompanyPaused(Boolean(req.body?.paused)));
  });

  return router;
}
