import fs from 'node:fs';
import path from 'node:path';
import type { AppDatabase } from './database.js';
import { DEFAULT_AGENT_PERMISSIONS, MANAGER_PERMISSIONS } from '../domain/types.js';

/**
 * Seeds a clean starter company blueprint on first boot.
 * STRICT HONESTY RULE:
 * - Zero fabricated agent messages or fake AI execution outputs.
 * - Agents begin in `planned` (configured, awaiting subscription bridge/handoff)
 *   or `position_open` (vacant seats ready to hire/fill), never faking `running`.
 */
export function seedInitialCompany(appDb: AppDatabase): void {
  const existing = appDb.db.prepare('SELECT COUNT(*) as cnt FROM departments').get() as { cnt: number };
  if (existing && Number(existing.cnt) > 0) {
    return;
  }

  const now = new Date().toISOString();

  appDb.transaction(() => {
    // 1. Departments
    const insertDept = appDb.db.prepare(`
      INSERT INTO departments (id, name, slug, description, color, effort_budget, director_agent_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertDept.run(
      'dept-exec',
      'Executive & Strategy',
      'executive',
      'Company-wide orchestration, architectural alignment, cross-provider coordination, and release sign-off.',
      '#d97706',
      16,
      'agent-atlas',
      now,
    );
    insertDept.run(
      'dept-eng',
      'Engineering',
      'engineering',
      'Core systems implementation, frontend/backend architecture, code review, and safe file integration.',
      '#2563eb',
      20,
      'agent-atlas',
      now,
    );
    insertDept.run(
      'dept-research',
      'Research & Product',
      'research',
      'Technical discovery, specification drafting, competitive analysis, and decision documentation.',
      '#0d9488',
      14,
      'agent-nova',
      now,
    );

    // 2. Teams
    const insertTeam = appDb.db.prepare(`
      INSERT INTO teams (id, department_id, name, purpose, lead_agent_id, is_predefined, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    insertTeam.run('team-core-eng', 'dept-eng', 'Core Platform', 'Backend services, contracts, and reliability', 'agent-vega', 1, now);
    insertTeam.run('team-ui-eng', 'dept-eng', 'Interface & UX', 'Design systems and interactive workflows', null, 1, now);
    insertTeam.run('team-discovery', 'dept-research', 'Architecture & Specs', 'RFCs, benchmarks, and decision logs', 'agent-nova', 1, now);

    // 3. Agents & Open Positions (honest states: planned or position_open)
    const insertAgent = appDb.db.prepare(`
      INSERT INTO agents (
        id, name, title, avatar_color, lifecycle_state, runtime_status,
        provider, model, adapter_kind, adapter_config_json, effort,
        roles_json, responsibilities_json, directed_departments_json,
        custom_instructions, personality, department_id, team_id, reports_to_id,
        is_dynamic_subagent, spawned_by_agent_id, max_subagents, subagent_roles_json,
        max_concurrent_workload, permissions_json, allowed_path_globs_json, restricted_path_globs_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Chief Orchestrator (Claude) — directs Executive & Engineering
    insertAgent.run(
      'agent-atlas',
      'Atlas',
      'Chief Orchestrator & Architect',
      '#d97706',
      'planned',
      'offline',
      'claude',
      'claude-opus-4-6',
      'human_handoff',
      JSON.stringify({ conversationUrl: 'https://claude.ai/new', notes: 'Bind to a Claude Opus web session or use Handoff Queue' }),
      'high',
      JSON.stringify(['Chief Orchestrator', 'Systems Architect', 'Release Gatekeeper']),
      JSON.stringify([
        'Decompose strategic goals into cross-provider tasks',
        'Direct Engineering and Executive departments',
        'Coordinate Claude and Gemini specialists cleanly',
      ]),
      JSON.stringify(['dept-exec', 'dept-eng']),
      'You are Atlas, Chief Orchestrator. Break complex initiatives into well-scoped tasks with clear dependencies, delegate to specialist teammates using [DELEGATE ...] directives, and uphold strict engineering quality.',
      'Decisive, structured, pragmatic, calm under ambiguity.',
      'dept-exec',
      null,
      null,
      0,
      null,
      4,
      JSON.stringify(['Architecture Reviewer', 'Release Coordinator', 'Incident Triage']),
      5,
      JSON.stringify(MANAGER_PERMISSIONS),
      JSON.stringify(['**']),
      JSON.stringify(['config/security/**', '.env*']),
      now,
      now,
    );

    // Engineering Lead (Gemini) — reports to Atlas
    insertAgent.run(
      'agent-vega',
      'Vega',
      'Principal Engineer',
      '#2563eb',
      'planned',
      'offline',
      'gemini',
      'gemini-2.5-pro',
      'human_handoff',
      JSON.stringify({ conversationUrl: 'https://gemini.google.com/app', notes: 'Bind to a Gemini 2.5 Pro web session or use Handoff Queue' }),
      'high',
      JSON.stringify(['Principal Engineer', 'Code Reviewer']),
      JSON.stringify([
        'Implement core platform features safely via leased file sandboxes',
        'Review cross-team technical deliverables',
        'Spawn implementation subagents when workload peaks',
      ]),
      JSON.stringify([]),
      'You are Vega, Principal Engineer. Always claim files before proposing edits using [CLAIM_FILE path="..."] and coordinate API contracts with Research & Product.',
      'Analytical, thorough, clean-code focused, collaborative.',
      'dept-eng',
      'team-core-eng',
      'agent-atlas',
      0,
      null,
      3,
      JSON.stringify(['Backend Specialist', 'Test Engineer', 'Refactoring Subagent']),
      4,
      JSON.stringify(MANAGER_PERMISSIONS),
      JSON.stringify(['src/**', 'docs/**', 'README.md']),
      JSON.stringify(['config/security/**', '.env*']),
      now,
      now,
    );

    // Research & Product Director (Gemini) — reports to Atlas, directs Research
    insertAgent.run(
      'agent-nova',
      'Nova',
      'Head of Research & Specs',
      '#0d9488',
      'planned',
      'offline',
      'gemini',
      'gemini-2.5-pro',
      'human_handoff',
      JSON.stringify({ conversationUrl: 'https://gemini.google.com/app', notes: 'Bind to a Gemini web session or use Handoff Queue' }),
      'medium',
      JSON.stringify(['Research Director', 'Product Strategist']),
      JSON.stringify([
        'Author crisp technical specifications and ADRs',
        'Synthesize trade-offs and document company decisions',
        'Direct the Research & Product department',
      ]),
      JSON.stringify(['dept-research']),
      'You are Nova, Head of Research & Specs. Capture architectural decisions using [RECORD_DECISION ...] and clarify requirements before Engineering claims files.',
      'Inquisitive, evidence-driven, concise communicator.',
      'dept-research',
      'team-discovery',
      'agent-atlas',
      0,
      null,
      2,
      JSON.stringify(['Market Analyst', 'Benchmark Researcher']),
      4,
      JSON.stringify(DEFAULT_AGENT_PERMISSIONS.concat(['org:spawn_subagents'])),
      JSON.stringify(['docs/**', 'specs/**', 'README.md']),
      JSON.stringify(['config/security/**', '.env*']),
      now,
      now,
    );

    // Security & Quality Specialist (Claude) — reports to Vega
    insertAgent.run(
      'agent-cipher',
      'Cipher',
      'Security & QA Specialist',
      '#e11d48',
      'planned',
      'offline',
      'claude',
      'claude-sonnet-4-6',
      'human_handoff',
      JSON.stringify({ conversationUrl: 'https://claude.ai/new', notes: 'Bind to a Claude Sonnet web session' }),
      'high',
      JSON.stringify(['Security Auditor', 'QA Lead']),
      JSON.stringify([
        'Audit file diffs, permission scopes, and sensitive changes',
        'Flag race conditions, security regressions, and edge cases',
      ]),
      JSON.stringify([]),
      'You are Cipher, Security & QA Specialist. Inspect changes critically and use [REQUEST_APPROVAL ...] whenever human sign-off is warranted.',
      'Skeptical, detail-obsessed, constructive.',
      'dept-eng',
      'team-core-eng',
      'agent-vega',
      0,
      null,
      1,
      JSON.stringify(['Fuzzing Subagent']),
      3,
      JSON.stringify(DEFAULT_AGENT_PERMISSIONS),
      JSON.stringify(['**']),
      JSON.stringify(['.env*']),
      now,
      now,
    );

    // Vacant Position (Open Seat) — clearly distinguished from Planned/Running agents!
    insertAgent.run(
      'pos-frontend-lead',
      'Open Seat: Frontend Lead',
      'Staff Frontend Engineer',
      '#64748b',
      'position_open',
      'vacant',
      'claude',
      'claude-sonnet-4-6',
      'human_handoff',
      JSON.stringify({}),
      'medium',
      JSON.stringify(['Frontend Engineer', 'Design Systems Owner']),
      JSON.stringify([
        'Own UI component architecture and accessibility',
        'Partner with Research on interactive prototypes',
      ]),
      JSON.stringify([]),
      'Own interface craftsmanship, visual clarity, and responsive layouts.',
      'Design-minded, crisp, user-obsessed.',
      'dept-eng',
      'team-ui-eng',
      'agent-vega',
      0,
      null,
      2,
      JSON.stringify(['CSS Polish Subagent', 'Accessibility Auditor']),
      3,
      JSON.stringify(DEFAULT_AGENT_PERMISSIONS),
      JSON.stringify(['src/ui/**', 'docs/**']),
      JSON.stringify(['config/security/**', '.env*']),
      now,
      now,
    );

    // 4. Channels
    const insertChannel = appDb.db.prepare(`
      INSERT INTO channels (id, name, slug, kind, department_id, task_id, participant_ids_json, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertChannel.run('ch-management', 'management', 'management', 'company', null, null, '[]', 'Dual-Orchestrator AAA Debate Room: strongest Claude + strongest Gemini challenge prompts & design the Workflow.', now);
    insertChannel.run('ch-general', 'general', 'general', 'company', null, null, '[]', 'Company-wide headquarters for cross-provider coordination and executive updates.', now);
    insertChannel.run('ch-decisions', 'decisions', 'decisions', 'company', null, null, '[]', 'Architectural Decision Records (ADRs), approvals, and company-wide alignments.', now);
    insertChannel.run('ch-engineering', 'engineering', 'engineering', 'department', 'dept-eng', null, '[]', 'Engineering discussions, file ownership handoffs, and code reviews.', now);
    insertChannel.run('ch-research', 'research', 'research', 'department', 'dept-research', null, '[]', 'Discovery, specifications, and technical trade-off analysis.', now);
    insertChannel.run('ch-dm-atlas-vega', 'Atlas ↔ Vega', 'dm-atlas-vega', 'dm', null, null, JSON.stringify(['agent-atlas', 'agent-vega']), 'Direct cross-provider channel between Atlas (Claude) and Vega (Gemini).', now);

    // 5. Initial Human-authored Knowledge Record (not fake agent output)
    appDb.db.prepare(`
      INSERT INTO knowledge_entries (id, kind, title, content, status, department_id, author_type, author_id, author_name, tags_json, pinned, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'know-charter',
      'decision',
      'ADR-001: Subscription-First Cross-Provider Collaboration Protocol',
      `## Context
Agent Company OS coordinates Claude and Gemini web subscriptions without requiring API keys or CLI wrappers.

## Operating Rules
1. **Honest Execution**: Agents never simulate replies. Dispatches route via the Browser Companion Bridge, Authenticated Webhook Relay, or Transparent Human-Assisted Handoff Queue.
2. **Enforced Effort**: Every agent and task carries an effort level (\`low\`, \`medium\`, \`high\`, \`max\`) governing context depth, delegation hops, and approval gates.
3. **Atomic File Leases**: Before modifying any shared project file, an agent must acquire an exclusive expiring lease and work inside its isolated sandbox copy.`,
      'accepted',
      'dept-exec',
      'human',
      'human-exec',
      'Founder / Supervisor',
      JSON.stringify(['governance', 'cross-provider', 'security']),
      1,
      now,
      now,
    );

    // 6. Connected GitHub Project (honest read-only metadata, zero fake issues/PRs)
    appDb.db
      .prepare(
        `INSERT OR IGNORE INTO github_repos (id, full_name, default_branch, local_path, protected_branches_json, review_policy, connected_at, last_synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        'gh-colab-agents',
        'alakrim/Colab-Agents',
        'main',
        null,
        JSON.stringify(['main', 'master']),
        'cross_provider_required',
        now,
      );

    // 7. System audit entry
    appDb.db.prepare(`
      INSERT INTO audit_logs (id, timestamp, actor_type, actor_id, actor_name, category, action, severity, target_type, target_id, summary, details_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'audit-init',
      now,
      'system',
      'system',
      'Agent Company OS',
      'org',
      'workspace.initialized',
      'info',
      'workspace',
      'default',
      'Initialized starter company structure (3 departments, 4 planned agents, 1 open position, 1 GitHub project).',
      JSON.stringify({ departments: 3, agents: 4, openPositions: 1, githubRepos: 1 }),
    );
  });

  // 7. Seed real canonical project files on disk for file lease & diff workflows
  const files: Record<string, string> = {
    'README.md': `# Project Workspace\n\nThis directory holds the canonical project files managed under Agent Company OS atomic file leases.\n\n## Workflow\n1. An agent acquires an expiring file lease.\n2. Edits happen inside an isolated sandbox copy.\n3. Integration checks SHA-256 base hash for conflicts, generates a unified diff, and enforces permissions & human approvals.\n`,
    'docs/architecture.md': `# System Architecture\n\n## Services\n- Organization Graph & Effort Engine\n- Cross-Provider Message Router (Claude <-> Gemini)\n- Atomic File Lease & Isolated Sandbox Manager\n\n## Open Questions\n- Define Q1 cross-provider review SLA\n`,
    'src/app-config.json': `{\n  "projectName": "Agent Company Workspace",\n  "crossProviderRouting": true,\n  "defaultLeaseSeconds": 300,\n  "requireApprovalOnMaxEffort": true\n}\n`,
    'config/security/policy.json': `{\n  "protected": true,\n  "requireHumanApproval": true,\n  "notes": "Restricted path — agents without explicit clearance cannot claim or integrate changes here."\n}\n`,
  };

  for (const [relPath, content] of Object.entries(files)) {
    const absPath = path.join(appDb.paths.canonicalProjectDir, relPath);
    if (!fs.existsSync(absPath)) {
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, content, 'utf8');
    }
  }
}
