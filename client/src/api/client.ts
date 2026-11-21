import type {
  AdapterHealth,
  AgentNode,
  ApprovalRequest,
  AuditLogEntry,
  Channel,
  DebateSession,
  Department,
  DiffResult,
  Dispatch,
  FileLease,
  GitHubIssueSummary,
  GitHubPrSummary,
  GitHubRepo,
  KnowledgeEntry,
  Message,
  OrgPayload,
  ProjectFileInfo,
  SystemTelemetry,
  Task,
  Team,
  WorkflowPlan,
  WorkflowStep,
  WorkflowTemplate,
} from '../types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  // Organization
  getOrg: () => request<OrgPayload>('/api/org'),
  createDepartment: (body: Record<string, unknown>) =>
    request<Department>('/api/org/departments', { method: 'POST', body: JSON.stringify(body) }),
  updateDepartment: (id: string, body: Record<string, unknown>) =>
    request<Department>(`/api/org/departments/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteDepartment: (id: string) => request<{ deleted: boolean }>(`/api/org/departments/${id}`, { method: 'DELETE' }),
  createTeam: (body: Record<string, unknown>) =>
    request<Team>('/api/org/teams', { method: 'POST', body: JSON.stringify(body) }),
  instantiateBlueprint: (id: string, body: { departmentId: string; reportsToId: string | null }) =>
    request<{ team: Team; agents: AgentNode[] }>(`/api/org/blueprints/${id}/instantiate`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  createAgent: (body: Record<string, unknown>) =>
    request<AgentNode>('/api/org/agents', { method: 'POST', body: JSON.stringify(body) }),
  updateAgent: (id: string, body: Record<string, unknown>) =>
    request<AgentNode>(`/api/org/agents/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  promoteAgent: (id: string, body?: Record<string, unknown>) =>
    request<AgentNode>(`/api/org/agents/${id}/promote`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  spawnSubagent: (managerId: string, body: Record<string, unknown>) =>
    request<AgentNode>(`/api/org/agents/${managerId}/spawn-subagent`, { method: 'POST', body: JSON.stringify(body) }),
  deleteAgent: (id: string) => request<{ deleted: boolean }>(`/api/org/agents/${id}`, { method: 'DELETE' }),

  // Collaboration & Messaging
  getChannels: () => request<{ channels: Channel[] }>('/api/collab/channels'),
  createChannel: (body: Record<string, unknown>) =>
    request<Channel>('/api/collab/channels', { method: 'POST', body: JSON.stringify(body) }),
  openDmChannel: (participantIds: string[], name?: string) =>
    request<Channel>('/api/collab/channels/dm', {
      method: 'POST',
      body: JSON.stringify({ participantIds, name }),
    }),
  getMessages: (channelId: string, parentMessageId?: string | null) =>
    request<{ messages: Message[] }>(
      `/api/collab/channels/${channelId}/messages${parentMessageId ? `?parentMessageId=${encodeURIComponent(parentMessageId)}` : ''}`,
    ),
  postMessage: (channelId: string, body: Record<string, unknown>) =>
    request<{ message: Message; createdDispatches: Dispatch[] }>(`/api/collab/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getDispatches: (status?: string) =>
    request<{ dispatches: Dispatch[] }>(`/api/collab/dispatches${status ? `?status=${status}` : ''}`),
  createDispatch: (body: Record<string, unknown>) =>
    request<Dispatch>('/api/collab/dispatches', { method: 'POST', body: JSON.stringify(body) }),
  respondDispatch: (dispatchId: string, responseText: string) =>
    request<{ dispatch: Dispatch; message: Message; downstreamDispatches: Dispatch[] }>(
      `/api/collab/dispatches/${dispatchId}/respond`,
      { method: 'POST', body: JSON.stringify({ responseText, source: 'human_handoff' }) },
    ),
  cancelDispatch: (dispatchId: string) =>
    request<Dispatch>(`/api/collab/dispatches/${dispatchId}/cancel`, { method: 'POST' }),
  getAdapterHealth: () => request<{ adapters: AdapterHealth[] }>('/api/collab/adapters/health'),

  // Tasks
  getTasks: () => request<{ tasks: Task[] }>('/api/tasks'),
  createTask: (body: Record<string, unknown>) =>
    request<{ task: Task; dispatch: Dispatch | null }>('/api/tasks', { method: 'POST', body: JSON.stringify(body) }),
  updateTask: (id: string, body: Record<string, unknown>) =>
    request<Task>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  claimTask: (id: string, agentId: string) =>
    request<Task>(`/api/tasks/${id}/claim`, { method: 'POST', body: JSON.stringify({ agentId }) }),
  addDeliverable: (id: string, body: Record<string, unknown>) =>
    request<Task>(`/api/tasks/${id}/deliverables`, { method: 'POST', body: JSON.stringify(body) }),

  // Files & Leases
  getFilesAndLeases: () => request<{ files: ProjectFileInfo[]; leases: FileLease[] }>('/api/files'),
  readFile: (path: string) =>
    request<{ path: string; content: string; sha256: string; isSensitive: boolean }>(
      `/api/files/content?path=${encodeURIComponent(path)}`,
    ),
  createFile: (path: string, content: string) =>
    request<ProjectFileInfo>('/api/files/create', { method: 'POST', body: JSON.stringify({ path, content }) }),
  deleteFile: (path: string, agentId?: string | null) =>
    request<{ deleted: boolean; approval?: ApprovalRequest }>('/api/files/delete', {
      method: 'POST',
      body: JSON.stringify({ path, agentId: agentId ?? null }),
    }),
  claimFile: (body: { filePath: string; agentId: string; taskId?: string | null; ttlSeconds?: number }) =>
    request<FileLease>('/api/files/leases/claim', { method: 'POST', body: JSON.stringify(body) }),
  renewLease: (leaseId: string) =>
    request<FileLease>(`/api/files/leases/${leaseId}/heartbeat`, { method: 'POST', body: JSON.stringify({}) }),
  readSandbox: (leaseId: string) =>
    request<{ lease: FileLease; content: string; diff: DiffResult }>(`/api/files/leases/${leaseId}/sandbox`),
  writeSandbox: (leaseId: string, content: string) =>
    request<{ lease: FileLease; diff: DiffResult }>(`/api/files/leases/${leaseId}/sandbox`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),
  integrateLease: (leaseId: string, opts?: { forceResolveConflict?: boolean }) =>
    request<{ status: string; lease: FileLease; diff: DiffResult; approval?: ApprovalRequest }>(
      `/api/files/leases/${leaseId}/integrate`,
      { method: 'POST', body: JSON.stringify(opts ?? {}) },
    ),
  releaseLease: (leaseId: string) =>
    request<FileLease>(`/api/files/leases/${leaseId}/release`, { method: 'POST' }),
  sweepLeases: () => request<{ recovered: FileLease[] }>('/api/files/leases/sweep', { method: 'POST' }),

  // Governance (Knowledge, Approvals, Audit)
  getKnowledge: (params?: { kind?: string; q?: string }) => {
    const sp = new URLSearchParams();
    if (params?.kind && params.kind !== 'all') sp.set('kind', params.kind);
    if (params?.q) sp.set('q', params.q);
    return request<{ entries: KnowledgeEntry[] }>(`/api/governance/knowledge?${sp.toString()}`);
  },
  createKnowledge: (body: Record<string, unknown>) =>
    request<KnowledgeEntry>('/api/governance/knowledge', { method: 'POST', body: JSON.stringify(body) }),
  updateKnowledge: (id: string, body: Record<string, unknown>) =>
    request<KnowledgeEntry>(`/api/governance/knowledge/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteKnowledge: (id: string) =>
    request<{ deleted: boolean }>(`/api/governance/knowledge/${id}`, { method: 'DELETE' }),
  getApprovals: () => request<{ approvals: ApprovalRequest[] }>('/api/governance/approvals'),
  decideApproval: (id: string, decision: 'approved' | 'rejected', note?: string) =>
    request<{ approval: ApprovalRequest }>(`/api/governance/approvals/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ decision, note }),
    }),
  getAuditLogs: (params?: { q?: string; category?: string; severity?: string }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set('q', params.q);
    if (params?.category && params.category !== 'all') sp.set('category', params.category);
    if (params?.severity && params.severity !== 'all') sp.set('severity', params.severity);
    return request<{ logs: AuditLogEntry[] }>(`/api/governance/audit?${sp.toString()}`);
  },

  // GitHub Projects
  getGitHubRepos: () => request<{ repos: GitHubRepo[] }>('/api/github/repos'),
  connectGitHubRepo: (body: Record<string, unknown>) =>
    request<GitHubRepo>('/api/github/repos', { method: 'POST', body: JSON.stringify(body) }),
  updateGitHubRepo: (id: string, body: Record<string, unknown>) =>
    request<GitHubRepo>(`/api/github/repos/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeGitHubRepo: (id: string) => request<{ deleted: boolean }>(`/api/github/repos/${id}`, { method: 'DELETE' }),
  syncGitHubRepo: (id: string) =>
    request<{
      repo: GitHubRepo;
      ghAvailable: boolean;
      error?: string;
      issues: GitHubIssueSummary[];
      pullRequests: GitHubPrSummary[];
    }>(`/api/github/repos/${id}/live`),
  importGitHubIssue: (repoId: string, body: Record<string, unknown>) =>
    request<{ task: Task; dispatch: Dispatch | null }>(`/api/github/repos/${repoId}/import-issue`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Workflow, Management Debate & Telemetry
  getWorkflowState: () =>
    request<{
      plans: WorkflowPlan[];
      templates: WorkflowTemplate[];
      debates: DebateSession[];
      telemetry: SystemTelemetry;
    }>('/api/workflow/plans'),
  createWorkflowPlan: (body: Record<string, unknown>) =>
    request<WorkflowPlan>('/api/workflow/plans', { method: 'POST', body: JSON.stringify(body) }),
  addWorkflowStep: (planId: string, body: Record<string, unknown>) =>
    request<WorkflowPlan>(`/api/workflow/plans/${planId}/steps`, { method: 'POST', body: JSON.stringify(body) }),
  updateWorkflowStep: (stepId: string, body: Record<string, unknown>) =>
    request<WorkflowStep>(`/api/workflow/steps/${stepId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  launchWorkflowPlan: (planId: string) =>
    request<WorkflowPlan>(`/api/workflow/plans/${planId}/launch`, { method: 'POST' }),
  startDebate: (body: Record<string, unknown>) =>
    request<{ debate: DebateSession; dispatches: Dispatch[] }>('/api/workflow/debates', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  advanceDebate: (debateId: string, synthesisText?: string) =>
    request<{ debate: DebateSession; plan?: WorkflowPlan; dispatches?: Dispatch[] }>(
      `/api/workflow/debates/${debateId}/advance`,
      { method: 'POST', body: JSON.stringify({ synthesisText }) },
    ),
  setCompanyPaused: (paused: boolean) =>
    request<SystemTelemetry>('/api/workflow/pause', { method: 'POST', body: JSON.stringify({ paused }) }),
};
