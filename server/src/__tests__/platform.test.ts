import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAgentCompanyApp } from '../app.js';

function createTempRuntime() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acos-test-'));
  const runtime = createAgentCompanyApp({ dataDir: dir, startSweeper: false });
  return {
    runtime,
    cleanup: () => {
      runtime.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('Organization hierarchy, multi-role agents, effort policies, cycle guard, and subagent quota enforcement', () => {
  const { runtime, cleanup } = createTempRuntime();
  try {
    const initial = runtime.org.getFullOrg();
    assert.ok(initial.departments.length >= 3);
    assert.ok(initial.agents.some((a) => a.lifecycleState === 'position_open'));
    assert.ok(initial.agents.some((a) => a.lifecycleState === 'planned'));
    // Zero faked running statuses on fresh boot
    assert.equal(initial.agents.filter((a) => a.lifecycleState === 'running').length, 0);

    // Multi-role + directed departments
    const atlas = runtime.org.getAgentById('agent-atlas')!;
    assert.ok(atlas.roles.length >= 2);
    assert.ok(atlas.directedDepartmentIds.includes('dept-eng'));

    // Cycle detection: Atlas cannot report to Vega (who reports to Atlas)
    assert.throws(() => {
      runtime.org.updateAgent('agent-atlas', { reportsToId: 'agent-vega' });
    }, /cycle detected/i);

    // Dynamic subagent spawning respecting allowed roles and maxSubagents quota
    const cipher = runtime.org.getAgentById('agent-cipher')!; // maxSubagents = 1, role = 'Fuzzing Subagent'
    runtime.org.updateAgent(cipher.id, { permissions: [...cipher.permissions, 'org:spawn_subagents'] });
    const sub1 = runtime.org.spawnSubagent(cipher.id, {
      name: 'Cipher-Fuzz-1',
      role: 'Fuzzing Subagent',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
    });
    assert.equal(sub1.isDynamicSubagent, true);
    assert.equal(sub1.spawnedByAgentId, cipher.id);

    // Second spawn must fail due to maxSubagents=1 quota
    assert.throws(() => {
      runtime.org.spawnSubagent(cipher.id, { name: 'Cipher-Fuzz-2', role: 'Fuzzing Subagent' });
    }, /quota exceeded/i);
  } finally {
    cleanup();
  }
});

test('Cross-provider Claude <-> Gemini messaging, directive delegation, and honest handoff queue', async () => {
  const { runtime, cleanup } = createTempRuntime();
  try {
    // Supervisor messages @Atlas (Claude) in #general
    const { message, createdDispatches } = await runtime.collab.postMessage({
      channelId: 'ch-general',
      senderType: 'human',
      senderId: 'human-exec',
      content: '@Atlas Please plan the Q1 architecture update and delegate backend work to Vega.',
    });

    assert.equal(message.mentions.includes('Atlas'), true);
    assert.equal(createdDispatches.length, 1);
    const atlasDispatch = createdDispatches[0];
    assert.equal(atlasDispatch.provider, 'claude');
    assert.equal(atlasDispatch.status, 'awaiting_handoff'); // Honest status — never fake completed!
    assert.match(atlasDispatch.contextPacket, /Enforced Effort: HIGH/);

    // Real response arrives from Atlas (Claude) delegating a task to Vega (Gemini)
    const completion = await runtime.collab.completeDispatch(
      atlasDispatch.id,
      `I have scoped the update. [DELEGATE to="Vega" title="Update architecture doc" effort="high"]Revise docs/architecture.md with the new lease recovery flow.[/DELEGATE] [RECORD_DECISION title="ADR-002: Lease TTL 300s"]Set default medium-effort lease TTL to 300 seconds.[/RECORD_DECISION]`,
      'human_handoff',
    );

    assert.equal(completion.dispatch.status, 'responded');
    // Cross-provider delegation automatically created a real dispatch for Vega (Gemini)!
    assert.equal(completion.downstreamDispatches.length, 1);
    const vegaDispatch = completion.downstreamDispatches[0];
    assert.equal(vegaDispatch.provider, 'gemini');
    assert.equal(vegaDispatch.agentId, 'agent-vega');
    assert.equal(vegaDispatch.status, 'awaiting_handoff');
    assert.equal(vegaDispatch.hopDepth, 1);

    // Decision was saved to persistent project memory
    const decisions = runtime.memory.list({ kind: 'decision' });
    assert.ok(decisions.some((d) => d.title.includes('ADR-002')));
  } finally {
    cleanup();
  }
});

test('Atomic file leases, simultaneous edit prevention, sandbox isolation, conflict detection, approval gate, and abandoned-claim recovery', () => {
  const { runtime, cleanup } = createTempRuntime();
  try {
    // 1. Restricted path guard: Vega is blocked from config/security/**
    assert.throws(() => {
      runtime.files.claimFile({ filePath: 'config/security/policy.json', agentId: 'agent-vega' });
    }, /restricted from accessing/i);

    // 2. Vega atomically claims docs/architecture.md
    const lease = runtime.files.claimFile({
      filePath: 'docs/architecture.md',
      agentId: 'agent-vega',
      ttlSeconds: 120,
    });
    assert.equal(lease.status, 'active');

    // 3. Atlas cannot simultaneously claim the same file (409 Conflict)
    assert.throws(() => {
      runtime.files.claimFile({ filePath: 'docs/architecture.md', agentId: 'agent-atlas' });
    }, /already leased by Vega/i);

    // 4. Vega edits ONLY its isolated sandbox copy — canonical file remains untouched
    const canonicalBefore = runtime.files.readCanonicalFile('docs/architecture.md').content;
    const updatedText = canonicalBefore + '\n## Lease Recovery\nVerified by Vega.\n';
    const { diff } = runtime.files.writeSandbox(lease.id, updatedText);
    assert.equal(diff.hasChanges, true);
    assert.equal(diff.hasConflict, false);
    assert.match(diff.unifiedDiff, /\+Verified by Vega\./);
    assert.equal(runtime.files.readCanonicalFile('docs/architecture.md').content, canonicalBefore);

    // 5. MAX effort policy enforces Human Approval before integration
    runtime.org.updateAgent('agent-vega', { effort: 'max' });
    const integrationAttempt = runtime.files.integrateLease(lease.id);
    assert.equal(integrationAttempt.status, 'pending_approval');
    assert.ok(integrationAttempt.approval);

    // 6. Human approves -> atomic commit into canonical workspace!
    const decided = runtime.approvals.decide(integrationAttempt.approval!.id, 'approved', 'Looks clean');
    assert.equal(decided.approval.status, 'approved');
    assert.equal(runtime.files.readCanonicalFile('docs/architecture.md').content, updatedText);

    // 7. Abandoned lease recovery preserves uncommitted edits as a draft snapshot
    const lease2 = runtime.files.claimFile({ filePath: 'README.md', agentId: 'agent-vega', ttlSeconds: 30 });
    runtime.files.writeSandbox(lease2.id, '# Unsaved work before disconnect\n');
    // Simulate lease expiry in DB
    runtime.appDb.db
      .prepare(`UPDATE file_leases SET expires_at = ? WHERE id = ?`)
      .run(new Date(Date.now() - 5000).toISOString(), lease2.id);

    const recovered = runtime.files.sweepExpiredLeases();
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].status, 'abandoned');
    assert.ok(recovered[0].recoveryDraftPath && fs.existsSync(recovered[0].recoveryDraftPath));
    // File is now unlocked for another agent!
    const lease3 = runtime.files.claimFile({ filePath: 'README.md', agentId: 'agent-atlas' });
    assert.equal(lease3.status, 'active');

    // 8. Complete searchable audit log recorded all security & decision events
    const securityLogs = runtime.audit.search({ category: 'security' });
    assert.ok(securityLogs.length >= 1);
  } finally {
    cleanup();
  }
});

test('GitHub project linking, isolated agent branch creation, and GitHub context injection in dispatches', async () => {
  const { runtime, cleanup } = createTempRuntime();
  try {
    const repos = runtime.github.listRepos();
    assert.ok(repos.some((r) => r.fullName === 'alakrim/Colab-Agents'));

    const repo = runtime.github.connectRepo({
      fullName: 'acme/multi-agent-app',
      defaultBranch: 'main',
      reviewPolicy: 'cross_provider_required',
    });
    assert.equal(repo.reviewPolicy, 'cross_provider_required');

    const branch = runtime.github.suggestAgentBranch('Vega', 'Add OAuth callback handler', 42);
    assert.equal(branch, 'agent/vega/issue-42-add-oauth-callback-handler');

    const task = runtime.tasks.create({
      title: '#42 Add OAuth callback handler',
      description: 'Implement callback route and unit tests',
      effort: 'high',
      assignedAgentId: 'agent-vega',
      githubRepoId: repo.id,
      githubIssueNumber: 42,
      githubBranch: branch,
    });
    assert.equal(task.githubRepoName, 'acme/multi-agent-app');
    assert.equal(task.githubBranch, branch);

    const dispatch = await runtime.collab.dispatchAgent({
      agentId: 'agent-vega',
      channelId: task.channelId!,
      taskId: task.id,
    });
    assert.ok(dispatch);
    assert.match(dispatch!.contextPacket, /GitHub Project: acme\/multi-agent-app \(Issue #42\)/);
    assert.match(dispatch!.contextPacket, /Isolated Agent Branch: agent\/vega\/issue-42-add-oauth-callback-handler/);
  } finally {
    cleanup();
  }
});

test('Token-efficient Bootstrap vs Delta packets, Global Pause switch, 3-round #management AAA Debate, and Workflow launch', async () => {
  const { runtime, cleanup } = createTempRuntime();
  try {
    // 1. First turn uses bootstrap; second turn in same channel switches to delta and saves tokens!
    const d1 = await runtime.collab.dispatchAgent({ agentId: 'agent-atlas', channelId: 'ch-general' });
    assert.equal(d1!.packetMode, 'bootstrap');
    const d2 = await runtime.collab.dispatchAgent({ agentId: 'agent-atlas', channelId: 'ch-general' });
    assert.equal(d2!.packetMode, 'delta');
    assert.ok(d2!.estimatedTokens < d1!.estimatedTokens);
    assert.ok(d2!.savedTokensEstimate > 0);

    // 2. Global Pause All halts autonomous dispatches cleanly
    runtime.collab.setCompanyPaused(true);
    const dPaused = await runtime.collab.dispatchAgent({ agentId: 'agent-vega', channelId: 'ch-general' });
    assert.equal(dPaused!.status, 'paused');
    runtime.collab.setCompanyPaused(false);

    // 3. 3-Round #management AAA Debate (Claude vs Gemini) auto-populates Workflow boxes!
    const { debate, dispatches } = await runtime.debate.startDebate({
      title: 'OAuth Login Polish',
      originalPrompt: 'Build simple GitHub login with awesome UX.',
      githubRepoId: 'gh-colab-agents',
    });
    assert.equal(debate.status, 'round_1');
    assert.equal(dispatches.length, 2);

    // Both Round 1 replies arrive -> automatically advances to Round 2
    await runtime.collab.completeDispatch(dispatches[0].id, 'Claude R1: Need PKCE + clear session error UI.', 'human_handoff');
    await runtime.collab.completeDispatch(dispatches[1].id, 'Gemini R1: Agree on PKCE + add one-click reconnect.', 'human_handoff');
    assert.equal(runtime.debate.get(debate.id)!.status, 'round_2');

    // Advance directly to Round 3 and converge with compact [WORKFLOW_PLAN] boxes
    const { dispatches: r3 } = await runtime.debate.advanceToRound3(debate.id);
    assert.equal(r3.length, 1);
    await runtime.collab.completeDispatch(
      r3[0].id,
      `[WORKFLOW_PLAN title="OAuth Login Polish"]
[BOX stage="build" tier="core" owner="Vega" effort="high" title="Implement GitHub PKCE OAuth"]Wire secure login route and callback handler | Users sign in reliably in 1 click[/BOX]
[BOX stage="build" tier="aaa_polish" owner="Vega" effort="medium" title="One-Click Reconnect Toast"]Show friendly reconnect banner on expired token | Zero dead-end error screens[/BOX]
[/WORKFLOW_PLAN]`,
      'human_handoff',
    );

    const converged = runtime.debate.get(debate.id)!;
    assert.equal(converged.status, 'converged');
    assert.ok(converged.workflowPlanId);

    const plan = runtime.workflow.getPlan(converged.workflowPlanId!)!;
    assert.equal(plan.status, 'draft');
    assert.equal(plan.steps.length, 2);

    // PM edits plain-English goal & launches workflow -> creates tasks + isolated agent branches
    const launched = await runtime.workflow.approveAndLaunchPlan(plan.id);
    assert.equal(launched.status, 'active');
    assert.ok(launched.steps[0].githubBranch?.startsWith('agent/vega/'));
    assert.ok(launched.steps[0].linkedTaskId);

    // Fuel gauge telemetry tracks saved tokens
    const telemetry = runtime.collab.getTelemetry();
    assert.ok(telemetry.totalDeltaDispatches >= 1);
    assert.ok(telemetry.totalEstimatedTokensSaved > 0);
  } finally {
    cleanup();
  }
});
