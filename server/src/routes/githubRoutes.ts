import { Router } from 'express';
import type { GitHubService } from '../services/githubService.js';
import type { TaskService } from '../services/taskService.js';
import type { CollabService } from '../services/collabService.js';
import type { OrgService } from '../services/orgService.js';

export function createGitHubRouter(
  github: GitHubService,
  tasks: TaskService,
  collab: CollabService,
  org: OrgService,
): Router {
  const router = Router();

  router.get('/repos', (_req, res) => {
    res.json({ repos: github.listRepos() });
  });

  router.post('/repos', (req, res) => {
    try {
      res.status(201).json(github.connectRepo(req.body));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to connect repo' });
    }
  });

  router.patch('/repos/:id', (req, res) => {
    try {
      res.json(github.updateRepo(req.params.id, req.body));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update repo' });
    }
  });

  router.delete('/repos/:id', (req, res) => {
    github.removeRepo(req.params.id);
    res.json({ deleted: true });
  });

  router.get('/repos/:id/live', async (req, res) => {
    try {
      res.json(await github.fetchLiveRepoState(req.params.id));
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Repo not found' });
    }
  });

  router.post('/repos/:id/import-issue', async (req, res) => {
    try {
      const repo = github.getRepo(req.params.id);
      if (!repo) {
        res.status(404).json({ error: 'GitHub repo not found' });
        return;
      }
      const { issueNumber, title, description, assignedAgentId, effort, dispatchImmediately } = req.body;
      const assignee = assignedAgentId ? org.getAgentById(String(assignedAgentId)) : null;
      const branch = github.suggestAgentBranch(assignee?.name || 'team', String(title || 'issue'), issueNumber);

      const task = tasks.create({
        title: `#${issueNumber} ${title}`,
        description:
          description ||
          `Linked GitHub Issue #${issueNumber} on ${repo.fullName}. Work on isolated branch \`${branch}\` (base: \`${repo.defaultBranch}\`). Review policy: ${repo.reviewPolicy}.`,
        effort: effort || assignee?.effort || 'high',
        assignedAgentId: assignedAgentId || null,
        githubRepoId: repo.id,
        githubIssueNumber: Number(issueNumber),
        githubBranch: branch,
        createDedicatedChannel: true,
      });

      let dispatch = null;
      if (dispatchImmediately && task.assignedAgentId && task.channelId) {
        dispatch = await collab.dispatchAgent({
          agentId: task.assignedAgentId,
          channelId: task.channelId,
          taskId: task.id,
        });
      }

      res.status(201).json({ task, dispatch });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to import GitHub issue' });
    }
  });

  return router;
}
