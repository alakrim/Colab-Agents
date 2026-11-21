import React, { useCallback, useEffect, useState } from 'react';
import type {
  AdapterHealth,
  AgentNode,
  ApprovalRequest,
  Channel,
  DebateSession,
  Dispatch,
  FileLease,
  GitHubRepo,
  KnowledgeEntry,
  OrgPayload,
  ProjectFileInfo,
  SystemTelemetry,
  Task,
  WorkflowPlan,
  WorkflowTemplate,
} from './types';
import { api } from './api/client';
import { connectRealtime } from './api/ws';
import { TopNav, type PrimaryScreen } from './components/TopNav';
import { ConnectWizardModal } from './components/ConnectWizardModal';
import { OrganizationScreen } from './components/org/OrganizationScreen';
import { WorkflowScreen } from './components/workflow/WorkflowScreen';
import { CollaborationScreen } from './components/collab/CollaborationScreen';

interface Toast {
  id: number;
  message: string;
  isError?: boolean;
}

export const App: React.FC = () => {
  const [activeScreen, setActiveScreen] = useState<PrimaryScreen>('organization');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = window.localStorage.getItem('acos-theme');
    return saved === 'light' ? 'light' : 'dark';
  });
  const [wsConnected, setWsConnected] = useState(false);
  const [showConnectWizard, setShowConnectWizard] = useState(false);

  const [org, setOrg] = useState<OrgPayload | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [adapters, setAdapters] = useState<AdapterHealth[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [files, setFiles] = useState<ProjectFileInfo[]>([]);
  const [leases, setLeases] = useState<FileLease[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [workflowPlans, setWorkflowPlans] = useState<WorkflowPlan[]>([]);
  const [workflowTemplates, setWorkflowTemplates] = useState<WorkflowTemplate[]>([]);
  const [debates, setDebates] = useState<DebateSession[]>([]);
  const [telemetry, setTelemetry] = useState<SystemTelemetry | null>(null);
  const [jumpChannelId, setJumpChannelId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback((message: string, isError = false) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-3), { id, message, isError }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem('acos-theme', theme);
  }, [theme]);

  const refreshAll = useCallback(async () => {
    try {
      const [orgRes, chRes, dispRes, adaptRes, taskRes, fileRes, knowRes, apprRes, ghRes, wfRes] = await Promise.all([
        api.getOrg(),
        api.getChannels(),
        api.getDispatches(),
        api.getAdapterHealth(),
        api.getTasks(),
        api.getFilesAndLeases(),
        api.getKnowledge(),
        api.getApprovals(),
        api.getGitHubRepos(),
        api.getWorkflowState(),
      ]);
      setOrg(orgRes);
      setChannels(chRes.channels);
      setDispatches(dispRes.dispatches);
      setAdapters(adaptRes.adapters);
      setTasks(taskRes.tasks);
      setFiles(fileRes.files);
      setLeases(fileRes.leases);
      setKnowledge(knowRes.entries);
      setApprovals(apprRes.approvals);
      setGithubRepos(ghRes.repos);
      setWorkflowPlans(wfRes.plans);
      setWorkflowTemplates(wfRes.templates);
      setDebates(wfRes.debates);
      setTelemetry(wfRes.telemetry);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to reach Agent Company OS server', true);
    }
  }, [notify]);

  useEffect(() => {
    void refreshAll();
    const disconnect = connectRealtime(
      () => {
        void refreshAll();
      },
      (connected) => setWsConnected(connected),
    );
    return disconnect;
  }, [refreshAll]);

  const handleMessageAgentFromOrg = async (agent: AgentNode) => {
    try {
      const ch = await api.openDmChannel(['human-exec', agent.id], `Supervisor ↔ ${agent.name}`);
      await refreshAll();
      setJumpChannelId(ch.id);
      setActiveScreen('collaboration');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not open conversation', true);
    }
  };

  const handleTogglePause = async () => {
    const next = !telemetry?.companyPaused;
    try {
      const updated = await api.setCompanyPaused(next);
      setTelemetry(updated);
      notify(next ? 'Company Paused — autonomous dispatches halted.' : 'Company Resumed — dispatches active.');
      void refreshAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to toggle pause', true);
    }
  };

  const pendingHandoffs = dispatches.filter(
    (d) => d.status === 'awaiting_handoff' || d.status === 'dispatched',
  ).length;
  const pendingApprovals = approvals.filter((a) => a.status === 'pending').length;

  return (
    <div className="app-shell">
      <TopNav
        activeScreen={activeScreen}
        onSelectScreen={setActiveScreen}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        wsConnected={wsConnected}
        pendingHandoffs={pendingHandoffs}
        pendingApprovals={pendingApprovals}
        telemetry={telemetry}
        onTogglePause={handleTogglePause}
        onOpenConnectWizard={() => setShowConnectWizard(true)}
      />

      <div className="screen-body">
        {!org ? (
          <div className="empty-state" style={{ flex: 1 }}>
            <h3>Connecting to Agent Company OS…</h3>
            <p>Loading persistent organization graph, workflow plans, channels, and active file leases.</p>
          </div>
        ) : activeScreen === 'organization' ? (
          <OrganizationScreen
            org={org}
            onRefresh={() => void refreshAll()}
            onNotify={notify}
            onMessageAgent={handleMessageAgentFromOrg}
          />
        ) : activeScreen === 'workflow' ? (
          <WorkflowScreen
            plans={workflowPlans}
            templates={workflowTemplates}
            debates={debates}
            agents={org.agents}
            githubRepos={githubRepos}
            onRefresh={() => void refreshAll()}
            onNotify={notify}
            onOpenManagementChat={() => {
              setJumpChannelId('ch-management');
              setActiveScreen('collaboration');
            }}
          />
        ) : (
          <CollaborationScreen
            org={org}
            channels={channels}
            dispatches={dispatches}
            adapters={adapters}
            tasks={tasks}
            files={files}
            leases={leases}
            knowledge={knowledge}
            approvals={approvals}
            githubRepos={githubRepos}
            initialChannelId={jumpChannelId}
            onRefreshAll={() => void refreshAll()}
            onNotify={notify}
          />
        )}
      </div>

      {showConnectWizard && (
        <ConnectWizardModal
          adapters={adapters}
          githubRepos={githubRepos}
          onClose={() => setShowConnectWizard(false)}
          onRefresh={() => void refreshAll()}
          onNotify={notify}
        />
      )}

      <div className="toast-container" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.isError ? 'error' : ''}`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
};
