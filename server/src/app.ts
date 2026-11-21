import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { AppDatabase } from './db/database.js';
import { seedInitialCompany } from './db/seed.js';
import { RealtimeHub } from './services/realtime.js';
import { AuditService } from './services/auditService.js';
import { MemoryService } from './services/memoryService.js';
import { OrgService } from './services/orgService.js';
import { FileLeaseService } from './services/fileLeaseService.js';
import { TaskService } from './services/taskService.js';
import { ApprovalService } from './services/approvalService.js';
import { CollabService } from './services/collabService.js';
import { GitHubService } from './services/githubService.js';
import { WorkflowService } from './services/workflowService.js';
import { DebateService } from './services/debateService.js';
import { AdapterRegistry } from './adapters/registry.js';
import { createOrgRouter } from './routes/orgRoutes.js';
import { createCollabRouter } from './routes/collabRoutes.js';
import { createTaskRouter } from './routes/taskRoutes.js';
import { createFileRouter } from './routes/fileRoutes.js';
import { createGovernanceRouter } from './routes/governanceRoutes.js';
import { createGitHubRouter } from './routes/githubRoutes.js';
import { createWorkflowRouter } from './routes/workflowRoutes.js';

export interface AppRuntime {
  app: express.Express;
  server: http.Server;
  appDb: AppDatabase;
  realtime: RealtimeHub;
  audit: AuditService;
  memory: MemoryService;
  org: OrgService;
  files: FileLeaseService;
  tasks: TaskService;
  approvals: ApprovalService;
  github: GitHubService;
  workflow: WorkflowService;
  debate: DebateService;
  adapters: AdapterRegistry;
  collab: CollabService;
  stop: () => void;
}

export function createAgentCompanyApp(opts?: { dataDir?: string; startSweeper?: boolean }): AppRuntime {
  const appDb = new AppDatabase(opts?.dataDir);
  seedInitialCompany(appDb);

  const realtime = new RealtimeHub();
  const audit = new AuditService(appDb, realtime);
  const memory = new MemoryService(appDb, audit, realtime);
  const org = new OrgService(appDb, audit, realtime);
  const files = new FileLeaseService(appDb, org, audit, realtime);
  const tasks = new TaskService(appDb, org, audit, realtime);
  const approvals = new ApprovalService(appDb, org, files, audit, realtime);
  const github = new GitHubService(appDb, audit, realtime);
  const workflow = new WorkflowService(appDb, org, tasks, audit, realtime);
  const debate = new DebateService(appDb, org, workflow, audit, realtime);
  const adapters = new AdapterRegistry();
  const collab = new CollabService(appDb, org, tasks, files, memory, approvals, adapters, audit, realtime);

  // Wire circular hooks cleanly
  org.setBridgeStatusResolver((agentId) => adapters.isAgentConnected(agentId));
  files.setApprovalCreator((req) => approvals.create(req));
  collab.setWorkflowAndDebate(workflow, debate);

  workflow.setHooks({
    onPmStepChanged: async (step, summary) => {
      const task = step.linkedTaskId ? tasks.getById(step.linkedTaskId) : null;
      if (task?.channelId && step.assignedAgentId) {
        collab.postSystemNotice(task.channelId, null, summary);
        await collab.dispatchAgent({
          agentId: step.assignedAgentId,
          channelId: task.channelId,
          taskId: task.id,
        });
      }
    },
    onLaunchDispatch: async (agentId, channelId, taskId) => {
      await collab.dispatchAgent({ agentId, channelId, taskId });
    },
  });

  debate.setHooks({
    dispatchFn: ({ agentId, channelId, customPromptOverride }) =>
      collab.dispatchAgent({ agentId, channelId, customPromptOverride }),
    postNoticeFn: (channelId, content) => {
      collab.postSystemNotice(channelId, null, content);
    },
  });

  adapters.browserBridge.setCallbacks({
    onResponse: (dispatchId, responseText) => {
      void collab.completeDispatch(dispatchId, responseText, 'browser_bridge');
    },
    onError: (dispatchId, errorMessage) => {
      collab.failDispatch(dispatchId, errorMessage);
    },
    onAgentBindingChanged: (agentId, connected, tabUrl) => {
      const agent = org.getAgentById(agentId);
      if (!agent) return;
      if (connected) {
        org.setRuntimeStatus(agentId, 'idle', 'running');
        audit.record({
          actorType: 'system',
          actorId: 'browser-bridge',
          actorName: 'Browser Companion Bridge',
          category: 'adapter',
          action: 'bridge.tab_bound',
          targetType: 'agent',
          targetId: agentId,
          summary: `Bound live browser tab (${tabUrl || agent.provider}) to ${agent.name}. Agent is now Running.`,
        });
      } else {
        org.setRuntimeStatus(agentId, 'offline', 'planned');
        audit.record({
          actorType: 'system',
          actorId: 'browser-bridge',
          actorName: 'Browser Companion Bridge',
          category: 'adapter',
          action: 'bridge.tab_unbound',
          severity: 'warning',
          targetType: 'agent',
          targetId: agentId,
          summary: `Browser tab disconnected from ${agent.name}. Future dispatches will fall back to Human-Assisted Handoff.`,
        });
      }
      realtime.broadcast('adapters:updated', adapters.listHealth());
    },
    onHeartbeat: (agentId) => {
      // Automatically renew active file leases for live bridge-connected agents!
      const leases = files.listLeases({ status: 'active', agentId });
      for (const lease of leases) {
        try {
          files.renewHeartbeat(lease.id);
        } catch {
          // ignore if expired mid-loop
        }
      }
    },
  });

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      name: 'Agent Company OS',
      wsClients: realtime.getClientCount(),
      bridgeConnectedTabs: adapters.browserBridge.getBoundTabs().length,
      dataDir: appDb.paths.dataRoot,
    });
  });

  app.use('/api/org', createOrgRouter(org));
  app.use('/api/collab', createCollabRouter(collab, adapters));
  app.use('/api/tasks', createTaskRouter(tasks, collab));
  app.use('/api/files', createFileRouter(files));
  app.use('/api/governance', createGovernanceRouter(memory, approvals, audit));
  app.use('/api/github', createGitHubRouter(github, tasks, collab, org));
  app.use('/api/workflow', createWorkflowRouter(workflow, debate, collab));

  // Serve built frontend in production mode if client/dist exists
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const clientDist = path.resolve(moduleDir, '..', '..', 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/ws')) {
        next();
        return;
      }
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  const server = http.createServer(app);
  const uiWss = new WebSocketServer({ noServer: true });
  const bridgeWss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname === '/ws/events') {
      uiWss.handleUpgrade(request, socket, head, (ws) => {
        realtime.addUiClient(ws);
        ws.send(JSON.stringify({ type: 'connected', payload: { ok: true }, timestamp: new Date().toISOString() }));
      });
    } else if (url.pathname === '/ws/bridge') {
      const token = url.searchParams.get('token');
      bridgeWss.handleUpgrade(request, socket, head, (ws) => {
        adapters.browserBridge.handleSocketConnection(ws, token);
      });
    } else {
      socket.destroy();
    }
  });

  // Periodic background lease sweeper (abandoned-claim recovery every 5s)
  let sweeperTimer: NodeJS.Timeout | null = null;
  if (opts?.startSweeper !== false) {
    sweeperTimer = setInterval(() => {
      try {
        files.sweepExpiredLeases();
      } catch {
        // never crash sweeper loop
      }
    }, 5000);
    sweeperTimer.unref();
  }

  return {
    app,
    server,
    appDb,
    realtime,
    audit,
    memory,
    org,
    files,
    tasks,
    approvals,
    github,
    workflow,
    debate,
    adapters,
    collab,
    stop: () => {
      if (sweeperTimer) clearInterval(sweeperTimer);
      uiWss.close();
      bridgeWss.close();
      server.close();
      appDb.close();
    },
  };
}
