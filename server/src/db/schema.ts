export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#3b82f6',
  effort_budget INTEGER NOT NULL DEFAULT 12,
  director_agent_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  lead_agent_id TEXT,
  is_predefined INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  avatar_color TEXT NOT NULL DEFAULT '#3b82f6',
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('position_open', 'planned', 'running')),
  runtime_status TEXT NOT NULL DEFAULT 'offline',
  provider TEXT NOT NULL DEFAULT 'claude',
  model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  adapter_kind TEXT NOT NULL DEFAULT 'human_handoff',
  adapter_config_json TEXT NOT NULL DEFAULT '{}',
  effort TEXT NOT NULL DEFAULT 'medium' CHECK (effort IN ('low', 'medium', 'high', 'max')),
  roles_json TEXT NOT NULL DEFAULT '[]',
  responsibilities_json TEXT NOT NULL DEFAULT '[]',
  directed_departments_json TEXT NOT NULL DEFAULT '[]',
  custom_instructions TEXT NOT NULL DEFAULT '',
  personality TEXT NOT NULL DEFAULT '',
  department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
  team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
  reports_to_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  is_dynamic_subagent INTEGER NOT NULL DEFAULT 0,
  spawned_by_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  max_subagents INTEGER NOT NULL DEFAULT 0,
  subagent_roles_json TEXT NOT NULL DEFAULT '[]',
  max_concurrent_workload INTEGER NOT NULL DEFAULT 3,
  permissions_json TEXT NOT NULL DEFAULT '[]',
  allowed_path_globs_json TEXT NOT NULL DEFAULT '["**"]',
  restricted_path_globs_json TEXT NOT NULL DEFAULT '["config/security/**",".env*"]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('company', 'department', 'task', 'dm')),
  department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
  task_id TEXT,
  participant_ids_json TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS github_repos (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL UNIQUE,
  default_branch TEXT NOT NULL DEFAULT 'main',
  local_path TEXT,
  protected_branches_json TEXT NOT NULL DEFAULT '["main","master"]',
  review_policy TEXT NOT NULL DEFAULT 'cross_provider_required' CHECK (review_policy IN ('standard', 'cross_provider_required')),
  connected_at TEXT NOT NULL,
  last_synced_at TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','claimed','in_progress','blocked','in_review','completed','cancelled')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  effort TEXT NOT NULL DEFAULT 'medium' CHECK (effort IN ('low','medium','high','max')),
  department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
  channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
  created_by_type TEXT NOT NULL DEFAULT 'human',
  created_by_id TEXT NOT NULL DEFAULT 'human-exec',
  assigned_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  claimed_by_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  dependency_ids_json TEXT NOT NULL DEFAULT '[]',
  deliverables_json TEXT NOT NULL DEFAULT '[]',
  github_repo_id TEXT REFERENCES github_repos(id) ON DELETE SET NULL,
  github_issue_number INTEGER,
  github_branch TEXT,
  github_pr_number INTEGER,
  github_pr_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  parent_message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('human','agent','system')),
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  sender_provider TEXT,
  sender_model TEXT,
  sender_effort TEXT,
  content TEXT NOT NULL,
  mentions_json TEXT NOT NULL DEFAULT '[]',
  directives_json TEXT NOT NULL DEFAULT '[]',
  dispatch_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_channel_created ON messages(channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_message_id);

CREATE TABLE IF NOT EXISTS dispatches (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  parent_message_id TEXT,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  trigger_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  adapter_kind TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  enforced_effort TEXT NOT NULL,
  packet_mode TEXT NOT NULL DEFAULT 'bootstrap' CHECK (packet_mode IN ('bootstrap','delta')),
  estimated_tokens INTEGER NOT NULL DEFAULT 0,
  saved_tokens_estimate INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('queued','paused','awaiting_handoff','dispatched','responded','failed','cancelled','timed_out')),
  context_packet TEXT NOT NULL,
  response_text TEXT,
  error_message TEXT,
  hop_depth INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  dispatched_at TEXT,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_dispatches_agent_status ON dispatches(agent_id, status);

CREATE TABLE IF NOT EXISTS agent_sessions (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  bootstrapped_at TEXT NOT NULL,
  last_message_id TEXT,
  last_message_created_at TEXT,
  turn_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (agent_id, channel_id)
);

CREATE TABLE IF NOT EXISTS system_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_plans (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  original_prompt TEXT NOT NULL DEFAULT '',
  template_id TEXT NOT NULL DEFAULT 'feature',
  github_repo_id TEXT REFERENCES github_repos(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('debating','draft','approved','active','paused','completed')),
  debate_session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_steps (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES workflow_plans(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('discovery','blueprint','build','review','ship')),
  order_index INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  plain_goal TEXT NOT NULL DEFAULT '',
  user_impact TEXT NOT NULL DEFAULT '',
  pm_notes TEXT NOT NULL DEFAULT '',
  next_steps TEXT NOT NULL DEFAULT '',
  todos_json TEXT NOT NULL DEFAULT '[]',
  scope_tier TEXT NOT NULL DEFAULT 'core' CHECK (scope_tier IN ('core','aaa_polish')),
  enabled INTEGER NOT NULL DEFAULT 1,
  autonomy_mode TEXT NOT NULL DEFAULT 'autonomous' CHECK (autonomy_mode IN ('autonomous','checkpoint','manual_handoff')),
  assigned_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  effort TEXT NOT NULL DEFAULT 'medium' CHECK (effort IN ('low','medium','high','max')),
  progress INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','waiting_pm','review','done','paused')),
  linked_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  github_branch TEXT,
  latest_summary TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS debates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  original_prompt TEXT NOT NULL,
  template_id TEXT NOT NULL DEFAULT 'feature',
  github_repo_id TEXT REFERENCES github_repos(id) ON DELETE SET NULL,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  claude_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  gemini_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  current_round INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'round_1' CHECK (status IN ('round_1','round_2','round_3','converged','cancelled')),
  workflow_plan_id TEXT REFERENCES workflow_plans(id) ON DELETE SET NULL,
  round1_claude TEXT,
  round1_gemini TEXT,
  round2_claude TEXT,
  round2_gemini TEXT,
  final_synthesis TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS file_leases (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  base_sha256 TEXT NOT NULL,
  sandbox_path TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','released','expired','abandoned','integrated')),
  acquired_at TEXT NOT NULL,
  last_heartbeat_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  released_at TEXT,
  recovery_draft_path TEXT
);

-- Atomic exclusivity: at most ONE active lease per file_path at any instant
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_file_lease
  ON file_leases(file_path)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('file_integrate','file_delete','spawn_subagent','org_change','agent_request')),
  requested_by_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  requested_by_name TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by TEXT,
  decision_note TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS knowledge_entries (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('decision','spec','runbook','note')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('proposed','accepted','superseded')),
  department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
  author_type TEXT NOT NULL DEFAULT 'human',
  author_id TEXT NOT NULL DEFAULT 'human-exec',
  author_name TEXT NOT NULL DEFAULT 'Executive Supervisor',
  tags_json TEXT NOT NULL DEFAULT '[]',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('human','agent','system')),
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  category TEXT NOT NULL,
  action TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','security','decision')),
  target_type TEXT,
  target_id TEXT,
  summary TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_category ON audit_logs(category);
`;
