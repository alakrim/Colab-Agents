import { Router } from 'express';
import type { CollabService } from '../services/collabService.js';
import type { AdapterRegistry } from '../adapters/registry.js';

export function createCollabRouter(collab: CollabService, adapters: AdapterRegistry): Router {
  const router = Router();

  router.get('/channels', (_req, res) => {
    res.json({ channels: collab.listChannels() });
  });

  router.post('/channels', (req, res) => {
    try {
      const channel = collab.createChannel(req.body);
      res.status(201).json(channel);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create channel' });
    }
  });

  router.post('/channels/dm', (req, res) => {
    try {
      const { participantIds, name } = req.body;
      const channel = collab.getOrCreateDirectChannel(participantIds || [], name);
      res.status(201).json(channel);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create DM channel' });
    }
  });

  router.get('/channels/:id/messages', (req, res) => {
    const parentMessageId = req.query.parentMessageId ? String(req.query.parentMessageId) : null;
    res.json({ messages: collab.listMessages(req.params.id, parentMessageId) });
  });

  router.post('/channels/:id/messages', async (req, res) => {
    try {
      const result = await collab.postMessage({
        channelId: req.params.id,
        parentMessageId: req.body.parentMessageId ?? null,
        senderType: req.body.senderType ?? 'human',
        senderId: req.body.senderId ?? 'human-exec',
        senderName: req.body.senderName,
        content: req.body.content,
        targetAgentId: req.body.targetAgentId ?? null,
      });
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to post message' });
    }
  });

  router.get('/dispatches', (req, res) => {
    const status = req.query.status ? String(req.query.status) : undefined;
    const agentId = req.query.agentId ? String(req.query.agentId) : undefined;
    res.json({ dispatches: collab.listDispatches({ status, agentId }) });
  });

  router.post('/dispatches', async (req, res) => {
    try {
      const dispatch = await collab.dispatchAgent(req.body);
      res.status(201).json(dispatch);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to dispatch agent' });
    }
  });

  router.post('/dispatches/:id/respond', async (req, res) => {
    try {
      const { responseText, source } = req.body;
      if (!responseText || !String(responseText).trim()) {
        res.status(400).json({ error: 'responseText is required.' });
        return;
      }
      const result = await collab.completeDispatch(
        req.params.id,
        String(responseText),
        source === 'webhook_relay' ? 'webhook_relay' : source === 'browser_bridge' ? 'browser_bridge' : 'human_handoff',
      );
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to complete dispatch' });
    }
  });

  router.post('/dispatches/:id/cancel', (req, res) => {
    try {
      res.json(collab.cancelDispatch(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to cancel dispatch' });
    }
  });

  router.get('/adapters/health', (_req, res) => {
    res.json({ adapters: adapters.listHealth() });
  });

  router.post('/adapters/callback/:dispatchId', async (req, res) => {
    try {
      const { responseText } = req.body;
      if (!responseText) {
        res.status(400).json({ error: 'responseText is required.' });
        return;
      }
      const result = await collab.completeDispatch(req.params.dispatchId, String(responseText), 'webhook_relay');
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Callback failed' });
    }
  });

  return router;
}
