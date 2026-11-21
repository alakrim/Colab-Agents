export type EffortLevel = 'low' | 'medium' | 'high' | 'max';
export type ProviderKind = 'claude' | 'gemini' | 'openai' | 'custom';
export type AdapterKind = 'human_handoff' | 'browser_bridge' | 'webhook_relay';
export type LifecycleState = 'position_open' | 'planned' | 'running';
export type RuntimeStatus =
  | 'vacant'
  | 'offline'
  | 'idle'
  | 'awaiting_handoff'
  | 'dispatched'
  | 'working'
  | 'paused'
  | 'error';

export type PermissionKey =
  | 'org:spawn_subagents'
  | 'org:manage_hierarchy'
  | 'tasks:delegate'
  | 'tasks:approve'
  | 'files:read'
  | 'files:claim_edit'
  | 'files:integrate_direct'
  | 'files:delete'
  | 'decisions:publish'
  | 'cross_provider:communicate';

export interface AdapterConfig {
  conversationUrl?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  bridgeTabLabel?: string;
  notes?: string;
}

export interface EffortPolicy {
  level: EffortLevel;
  label: string;
  budgetWeight: number;
  contextMessageLimit: number;
  knowledgeRecordLimit: number;
  maxDelegationHops: number;
  requireApprovalForIntegration: boolean;
  defaultLeaseSeconds: number;
  directiveInstruction: string;
}

export interface Department {
  id: string;
  name: string;
  slug: string;
  description: string;
  color: string;
  effortBudget: number;
  directorAgentId: string | null;
  createdAt: string;
}

export interface Team {
  id: string;
  departmentId: string;
  name: string;
  purpose: string;
  leadAgentId: string | null;
  isPredefined: boolean;
  createdAt: string;
}

export interface TeamBlueprint {
  id: string;
  name: string;
  description: string;
  departmentName: string;
  members: Array<{
    name: string;
    title: string;
    provider: ProviderKind;
    model: string;
    effort: EffortLevel;
    roles: string[];
    lifecycleState: LifecycleState;
  }>;
}

export interface AgentNode {
  id: string;
  name: string;
  title: string;
  avatarColor: string;
  lifecycleState: LifecycleState;
  runtimeStatus: RuntimeStatus;
  provider: ProviderKind;
  model: string;
  adapterKind: AdapterKind;
  adapterConfig: AdapterConfig;
  effort: EffortLevel;
  roles: string[];
  responsibilities: string[];
  directedDepartmentIds: string[];
  customInstructions: string;
  personality: string;
  departmentId: string | null;
  teamId: string | null;
  reportsToId: string | null;
  isDynamicSubagent: boolean;
  spawnedByAgentId: string | null;
  maxSubagents: number;
  subagentRoles: string[];
  maxConcurrentWorkload: number;
  permissions: PermissionKey[];
  allowedPathGlobs: string[];
  restrictedPathGlobs: string[];
  createdAt: string;
  updatedAt: string;
  activeWorkload?: number;
  activeEffortLoad?: number;
  activeSubagentCount?: number;
  directReportCount?: number;
  pendingDispatchCount?: number;
  bridgeConnected?: boolean;
}

export interface OrgPayload {
  departments: Department[];
  teams: Team[];
  agents: AgentNode[];
  blueprints: TeamBlueprint[];
  effortPolicies: Record<EffortLevel, EffortPolicy>;
  allPermissions: PermissionKey[];
}

export type ChannelKind = 'company' | 'department' | 'task' | 'dm';

export interface Channel {
  id: string;
  name: string;
  slug: string;
  kind: ChannelKind;
  departmentId: string | null;
  taskId: string | null;
  participantIds: string[];
  description: string;
  createdAt: string;
  messageCount?: number;
}

export interface ParsedDirective {
  type: 'delegate' | 'claim_file' | 'propose_edit' | 'request_approval' | 'record_decision' | 'spawn_subagent';
  raw: string;
  params: Record<string, string>;
  body?: string;
  executionStatus?: 'executed' | 'queued_approval' | 'blocked' | 'failed';
  executionNote?: string;
}

export interface Message {
  id: string;
  channelId: string;
  parentMessageId: string | null;
  senderType: 'human' | 'agent' | 'system';
  senderId: string;
  senderName: string;
  senderProvider: ProviderKind | null;
  senderModel: string | null;
  senderEffort: EffortLevel | null;
  content: string;
  mentions: string[];
  directives: ParsedDirective[];
  dispatchId: string | null;
  createdAt: string;
  replyCount?: number;
}

export interface Dispatch {
  id: string;
  agentId: string;
  channelId: string;
  parentMessageId: string | null;
  taskId: string | null;
  triggerMessageId: string | null;
  adapterKind: AdapterKind;
  provider: ProviderKind;
  model: string;
  enforcedEffort: EffortLevel;
  packetMode: 'bootstrap' | 'delta';
  estimatedTokens: number;
  savedTokensEstimate: number;
  status: 'queued' | 'paused' | 'awaiting_handoff' | 'dispatched' | 'responded' | 'failed' | 'cancelled' | 'timed_out';
  contextPacket: string;
  responseText: string | null;
  errorMessage: string | null;
  hopDepth: number;
  createdAt: string;
  dispatchedAt: string | null;
  completedAt: string | null;
  agentName?: string;
  channelName?: string;
  conversationUrl?: string;
}

export type WorkflowStage = 'discovery' | 'blueprint' | 'build' | 'review' | 'ship';
export type StepScopeTier = 'core' | 'aaa_polish';
export type StepAutonomyMode = 'autonomous' | 'checkpoint' | 'manual_handoff';
export type WorkflowStepStatus = 'pending' | 'active' | 'waiting_pm' | 'review' | 'done' | 'paused';

export interface WorkflowTodo {
  text: string;
  done: boolean;
}

export interface WorkflowStep {
  id: string;
  planId: string;
  stage: WorkflowStage;
  orderIndex: number;
  title: string;
  plainGoal: string;
  userImpact: string;
  pmNotes: string;
  nextSteps: string;
  todos: WorkflowTodo[];
  scopeTier: StepScopeTier;
  enabled: boolean;
  autonomyMode: StepAutonomyMode;
  assignedAgentId: string | null;
  effort: EffortLevel;
  progress: number;
  status: WorkflowStepStatus;
  linkedTaskId: string | null;
  githubBranch: string | null;
  latestSummary: string;
  updatedAt: string;
  assignedAgentName?: string | null;
  assignedAgentProvider?: ProviderKind | null;
}

export interface WorkflowPlan {
  id: string;
  title: string;
  originalPrompt: string;
  templateId: string;
  githubRepoId: string | null;
  status: 'debating' | 'draft' | 'approved' | 'active' | 'paused' | 'completed';
  debateSessionId: string | null;
  createdAt: string;
  updatedAt: string;
  steps: WorkflowStep[];
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
}

export interface DebateSession {
  id: string;
  title: string;
  originalPrompt: string;
  templateId: string;
  githubRepoId: string | null;
  channelId: string;
  claudeAgentId: string;
  geminiAgentId: string;
  currentRound: 1 | 2 | 3;
  status: 'round_1' | 'round_2' | 'round_3' | 'converged' | 'cancelled';
  workflowPlanId: string | null;
  round1Claude: string | null;
  round1Gemini: string | null;
  round2Claude: string | null;
  round2Gemini: string | null;
  finalSynthesis: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderFuelStatus {
  provider: ProviderKind;
  windowHours: number;
  dispatchesInWindow: number;
  softMessageCap: number;
  tokensInWindow: number;
  softTokenCap: number;
  savedTokensTotal: number;
  fuelUsedPercent: number;
  warning: boolean;
}

export interface SystemTelemetry {
  companyPaused: boolean;
  fuel: ProviderFuelStatus[];
  totalDeltaDispatches: number;
  totalBootstrapDispatches: number;
  totalEstimatedTokensSaved: number;
}

export interface AdapterHealth {
  kind: AdapterKind;
  name: string;
  description: string;
  automated: boolean;
  connectedTargets: number;
  details: Record<string, unknown>;
}

export interface TaskDeliverable {
  id: string;
  title: string;
  kind: 'file' | 'decision' | 'message' | 'artifact';
  ref: string;
  submittedBy: string;
  submittedAt: string;
}

export interface GitHubRepo {
  id: string;
  fullName: string;
  defaultBranch: string;
  localPath: string | null;
  protectedBranches: string[];
  reviewPolicy: 'standard' | 'cross_provider_required';
  connectedAt: string;
  lastSyncedAt: string | null;
}

export interface GitHubIssueSummary {
  number: number;
  title: string;
  state: string;
  url: string;
  labels: string[];
  author: string;
  updatedAt: string;
}

export interface GitHubPrSummary {
  number: number;
  title: string;
  state: string;
  url: string;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  reviewDecision: string;
  author: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'open' | 'claimed' | 'in_progress' | 'blocked' | 'in_review' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  effort: EffortLevel;
  departmentId: string | null;
  channelId: string | null;
  createdByType: 'human' | 'agent';
  createdById: string;
  assignedAgentId: string | null;
  claimedByAgentId: string | null;
  parentTaskId: string | null;
  dependencyIds: string[];
  deliverables: TaskDeliverable[];
  githubRepoId: string | null;
  githubRepoName?: string | null;
  githubIssueNumber: number | null;
  githubBranch: string | null;
  githubPrNumber: number | null;
  githubPrUrl: string | null;
  createdAt: string;
  updatedAt: string;
  blockedByOpenDeps?: boolean;
}

export interface FileLease {
  id: string;
  filePath: string;
  agentId: string;
  taskId: string | null;
  baseSha256: string;
  sandboxPath: string;
  status: 'active' | 'released' | 'expired' | 'abandoned' | 'integrated';
  acquiredAt: string;
  lastHeartbeatAt: string;
  expiresAt: string;
  releasedAt: string | null;
  recoveryDraftPath: string | null;
  agentName?: string;
  agentProvider?: ProviderKind;
  remainingMs?: number;
}

export interface ProjectFileInfo {
  path: string;
  sizeBytes: number;
  sha256: string;
  updatedAt: string;
  isSensitive: boolean;
  activeLease: FileLease | null;
}

export interface DiffResult {
  hasChanges: boolean;
  hasConflict: boolean;
  baseSha256: string;
  currentCanonicalSha256: string;
  sandboxSha256: string;
  unifiedDiff: string;
}

export interface ApprovalRequest {
  id: string;
  kind: 'file_integrate' | 'file_delete' | 'spawn_subagent' | 'org_change' | 'agent_request';
  requestedByAgentId: string | null;
  requestedByName: string;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy: string | null;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface KnowledgeEntry {
  id: string;
  kind: 'decision' | 'spec' | 'runbook' | 'note';
  title: string;
  content: string;
  status: 'proposed' | 'accepted' | 'superseded';
  departmentId: string | null;
  authorType: 'human' | 'agent';
  authorId: string;
  authorName: string;
  tags: string[];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorType: 'human' | 'agent' | 'system';
  actorId: string;
  actorName: string;
  category: string;
  action: string;
  severity: 'info' | 'warning' | 'security' | 'decision';
  targetType: string | null;
  targetId: string | null;
  summary: string;
  details: Record<string, unknown>;
}
