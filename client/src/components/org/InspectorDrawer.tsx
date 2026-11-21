import React, { useEffect, useState } from 'react';
import type {
  AdapterKind,
  AgentNode,
  Department,
  EffortLevel,
  EffortPolicy,
  LifecycleState,
  PermissionKey,
  ProviderKind,
  Team,
} from '../../types';
import { api } from '../../api/client';
import { CloseIcon, CollabIcon } from '../Icons';

const MODEL_PRESETS: Record<ProviderKind, string[]> = {
  claude: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash-thinking'],
  openai: ['gpt-5', 'o3', 'gpt-4.1'],
  custom: ['custom-subscription-model'],
};

const PERMISSION_LABELS: Record<PermissionKey, { label: string; desc: string }> = {
  'org:spawn_subagents': { label: 'Spawn Subagents', desc: 'Launch dynamic subagents up to quota' },
  'org:manage_hierarchy': { label: 'Manage Hierarchy', desc: 'Reassign or coordinate team structure' },
  'tasks:delegate': { label: 'Delegate Tasks', desc: 'Assign work to teammates & subagents' },
  'tasks:approve': { label: 'Approve Tasks', desc: 'Sign off on completed peer deliverables' },
  'files:read': { label: 'Read Project Files', desc: 'Inspect canonical workspace files' },
  'files:claim_edit': { label: 'Claim & Edit Files', desc: 'Acquire atomic file leases and edit sandboxes' },
  'files:integrate_direct': { label: 'Direct Integration', desc: 'Commit non-sensitive diffs without approval' },
  'files:delete': { label: 'Request File Deletion', desc: 'Propose deletions (always gated by human approval)' },
  'decisions:publish': { label: 'Publish Decisions', desc: 'Record ADRs and specs into Project Memory' },
  'cross_provider:communicate': { label: 'Cross-Provider Comms', desc: 'Message & delegate across Claude / Gemini' },
};

interface InspectorDrawerProps {
  agent: AgentNode;
  allAgents: AgentNode[];
  departments: Department[];
  teams: Team[];
  effortPolicies: Record<EffortLevel, EffortPolicy>;
  allPermissions: PermissionKey[];
  onClose: () => void;
  onRefresh: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
  onMessageAgent: (agent: AgentNode) => void;
}

type InspectorTab = 'identity' | 'hierarchy' | 'subagents' | 'adapter' | 'security';

export const InspectorDrawer: React.FC<InspectorDrawerProps> = ({
  agent,
  allAgents,
  departments,
  teams,
  effortPolicies,
  allPermissions,
  onClose,
  onRefresh,
  onNotify,
  onMessageAgent,
}) => {
  const [tab, setTab] = useState<InspectorTab>('identity');
  const [saving, setSaving] = useState(false);

  // Local editable form state synced when `agent` changes
  const [name, setName] = useState(agent.name);
  const [title, setTitle] = useState(agent.title);
  const [lifecycleState, setLifecycleState] = useState<LifecycleState>(agent.lifecycleState);
  const [provider, setProvider] = useState<ProviderKind>(agent.provider);
  const [model, setModel] = useState(agent.model);
  const [effort, setEffort] = useState<EffortLevel>(agent.effort);
  const [roles, setRoles] = useState<string[]>(agent.roles);
  const [newRole, setNewRole] = useState('');
  const [responsibilities, setResponsibilities] = useState<string[]>(agent.responsibilities);
  const [newResp, setNewResp] = useState('');
  const [directedDepartmentIds, setDirectedDepartmentIds] = useState<string[]>(agent.directedDepartmentIds);
  const [departmentId, setDepartmentId] = useState<string>(agent.departmentId ?? '');
  const [teamId, setTeamId] = useState<string>(agent.teamId ?? '');
  const [reportsToId, setReportsToId] = useState<string>(agent.reportsToId ?? '');
  const [maxSubagents, setMaxSubagents] = useState<number>(agent.maxSubagents);
  const [subagentRoles, setSubagentRoles] = useState<string[]>(agent.subagentRoles);
  const [newSubRole, setNewSubRole] = useState('');
  const [maxConcurrentWorkload, setMaxConcurrentWorkload] = useState<number>(agent.maxConcurrentWorkload);
  const [personality, setPersonality] = useState(agent.personality);
  const [customInstructions, setCustomInstructions] = useState(agent.customInstructions);
  const [adapterKind, setAdapterKind] = useState<AdapterKind>(agent.adapterKind);
  const [conversationUrl, setConversationUrl] = useState(agent.adapterConfig.conversationUrl ?? '');
  const [webhookUrl, setWebhookUrl] = useState(agent.adapterConfig.webhookUrl ?? '');
  const [permissions, setPermissions] = useState<PermissionKey[]>(agent.permissions);
  const [allowedGlobs, setAllowedGlobs] = useState(agent.allowedPathGlobs.join(', '));
  const [restrictedGlobs, setRestrictedGlobs] = useState(agent.restrictedPathGlobs.join(', '));

  // Inline subagent spawner state
  const [spawnName, setSpawnName] = useState('');
  const [spawnRole, setSpawnRole] = useState(agent.subagentRoles[0] ?? '');
  const [spawnProvider, setSpawnProvider] = useState<ProviderKind>(agent.provider);

  useEffect(() => {
    setName(agent.name);
    setTitle(agent.title);
    setLifecycleState(agent.lifecycleState);
    setProvider(agent.provider);
    setModel(agent.model);
    setEffort(agent.effort);
    setRoles(agent.roles);
    setResponsibilities(agent.responsibilities);
    setDirectedDepartmentIds(agent.directedDepartmentIds);
    setDepartmentId(agent.departmentId ?? '');
    setTeamId(agent.teamId ?? '');
    setReportsToId(agent.reportsToId ?? '');
    setMaxSubagents(agent.maxSubagents);
    setSubagentRoles(agent.subagentRoles);
    setMaxConcurrentWorkload(agent.maxConcurrentWorkload);
    setPersonality(agent.personality);
    setCustomInstructions(agent.customInstructions);
    setAdapterKind(agent.adapterKind);
    setConversationUrl(agent.adapterConfig.conversationUrl ?? '');
    setWebhookUrl(agent.adapterConfig.webhookUrl ?? '');
    setPermissions(agent.permissions);
    setAllowedGlobs(agent.allowedPathGlobs.join(', '));
    setRestrictedGlobs(agent.restrictedPathGlobs.join(', '));
    setSpawnRole(agent.subagentRoles[0] ?? '');
    setSpawnProvider(agent.provider);
  }, [agent]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateAgent(agent.id, {
        name,
        title,
        lifecycleState,
        provider,
        model,
        effort,
        roles,
        responsibilities,
        directedDepartmentIds,
        departmentId: departmentId || null,
        teamId: teamId || null,
        reportsToId: reportsToId || null,
        maxSubagents,
        subagentRoles,
        maxConcurrentWorkload,
        personality,
        customInstructions,
        adapterKind,
        adapterConfig: {
          ...agent.adapterConfig,
          conversationUrl: conversationUrl.trim() || undefined,
          webhookUrl: webhookUrl.trim() || undefined,
        },
        permissions,
        allowedPathGlobs: allowedGlobs
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        restrictedPathGlobs: restrictedGlobs
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      onNotify(`Saved changes to ${name}`);
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save', true);
    } finally {
      setSaving(false);
    }
  };

  const handlePromote = async () => {
    try {
      await api.promoteAgent(agent.id, {
        directDepartmentId: departmentId || null,
        extraSubagents: 2,
      });
      onNotify(`Promoted ${agent.name} with expanded leadership authority.`);
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to promote', true);
    }
  };

  const handleSpawnSubagent = async () => {
    if (!spawnName.trim() || !spawnRole.trim()) {
      onNotify('Provide a subagent name and select an authorized role.', true);
      return;
    }
    try {
      await api.spawnSubagent(agent.id, {
        name: spawnName.trim(),
        role: spawnRole.trim(),
        provider: spawnProvider,
        model: MODEL_PRESETS[spawnProvider][0],
      });
      setSpawnName('');
      onNotify(`Spawned dynamic subagent "${spawnName.trim()}" under ${agent.name}.`);
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to spawn subagent', true);
    }
  };

  const handleDelete = async () => {
    try {
      await api.deleteAgent(agent.id);
      onNotify(`Removed ${agent.name} (direct reports reassigned safely).`);
      onClose();
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Delete failed', true);
    }
  };

  const deptTeams = teams.filter((t) => !departmentId || t.departmentId === departmentId);
  const potentialManagers = allAgents.filter((a) => a.id !== agent.id);
  const currentEffortPolicy = effortPolicies[effort];

  return (
    <aside className="inspector-drawer" aria-label="Agent and position editor">
      <div className="inspector-header">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {agent.name}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
            {agent.lifecycleState === 'position_open' ? 'Available Position' : `${agent.provider.toUpperCase()} · ${agent.model}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {agent.lifecycleState !== 'position_open' && (
            <button type="button" className="btn btn-sm" onClick={() => onMessageAgent(agent)}>
              <CollabIcon size={12} /> Message
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close inspector">
            <CloseIcon size={15} />
          </button>
        </div>
      </div>

      <div className="inspector-tabs">
        {(['identity', 'hierarchy', 'subagents', 'adapter', 'security'] as InspectorTab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`inspector-tab ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'identity'
              ? 'Identity & Effort'
              : t === 'hierarchy'
                ? 'Roles & Org'
                : t === 'subagents'
                  ? 'Subagents'
                  : t === 'adapter'
                    ? 'Adapter & Prompt'
                    : 'Permissions'}
          </button>
        ))}
      </div>

      <div className="inspector-body">
        {tab === 'identity' && (
          <>
            {lifecycleState === 'position_open' && (
              <div className="effort-policy-callout" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span>This seat is currently open. Convert it to a configured agent in one click.</span>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setLifecycleState('planned');
                    if (name.startsWith('Open Seat:')) setName(name.replace('Open Seat:', '').trim());
                  }}
                >
                  Fill Seat
                </button>
              </div>
            )}

            <div className="grid-2">
              <div className="field-group">
                <label className="field-label">Name</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field-group">
                <label className="field-label">Lifecycle State</label>
                <select className="select" value={lifecycleState} onChange={(e) => setLifecycleState(e.target.value as LifecycleState)}>
                  <option value="position_open">Available Position (Vacant)</option>
                  <option value="planned">Planned Agent</option>
                  <option value="running">Running Agent</option>
                </select>
              </div>
            </div>

            <div className="field-group">
              <label className="field-label">Title</label>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>

            <div className="grid-2">
              <div className="field-group">
                <label className="field-label">Subscription Provider</label>
                <select
                  className="select"
                  value={provider}
                  onChange={(e) => {
                    const p = e.target.value as ProviderKind;
                    setProvider(p);
                    setModel(MODEL_PRESETS[p][0]);
                  }}
                >
                  <option value="claude">Claude Subscription</option>
                  <option value="gemini">Gemini Subscription</option>
                  <option value="openai">OpenAI Subscription</option>
                  <option value="custom">Custom Provider</option>
                </select>
              </div>
              <div className="field-group">
                <label className="field-label">Model</label>
                <input
                  className="input mono"
                  list="model-presets-list"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
                <datalist id="model-presets-list">
                  {MODEL_PRESETS[provider].map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="field-group">
              <label className="field-label">Enforced Effort Level</label>
              <div className="effort-selector">
                {(['low', 'medium', 'high', 'max'] as EffortLevel[]).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    className={`effort-option ${effort === lvl ? 'active' : ''}`}
                    onClick={() => setEffort(lvl)}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
              {currentEffortPolicy && (
                <div className="effort-policy-callout">
                  <strong>Enforced at runtime:</strong> {currentEffortPolicy.contextMessageLimit} messages context ·{' '}
                  {currentEffortPolicy.knowledgeRecordLimit} memory docs · max {currentEffortPolicy.maxDelegationHops}{' '}
                  delegation hops · {currentEffortPolicy.defaultLeaseSeconds}s file lease
                  {currentEffortPolicy.requireApprovalForIntegration ? ' · Mandatory Human Approval for edits' : ''}.
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'hierarchy' && (
          <>
            <div className="field-group">
              <label className="field-label">Multiple Simultaneous Roles</label>
              <div className="chip-editor">
                {roles.map((r) => (
                  <span key={r} className="editable-chip">
                    {r}
                    <button type="button" onClick={() => setRoles(roles.filter((x) => x !== r))}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="inline-add-row">
                <input
                  className="input"
                  placeholder="Add role (e.g., Security Reviewer)..."
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newRole.trim()) {
                      e.preventDefault();
                      if (!roles.includes(newRole.trim())) setRoles([...roles, newRole.trim()]);
                      setNewRole('');
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    if (newRole.trim() && !roles.includes(newRole.trim())) {
                      setRoles([...roles, newRole.trim()]);
                      setNewRole('');
                    }
                  }}
                >
                  Add
                </button>
              </div>
            </div>

            <div className="grid-2">
              <div className="field-group">
                <label className="field-label">Department</label>
                <select className="select" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                  <option value="">Company-wide / Unassigned</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label className="field-label">Team</label>
                <select className="select" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                  <option value="">No specific team</option>
                  {deptTeams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field-group">
              <label className="field-label">Reports To (Superior)</label>
              <select className="select" value={reportsToId} onChange={(e) => setReportsToId(e.target.value)}>
                <option value="">Top-level (Reports directly to Human Executive)</option>
                {potentialManagers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} — {m.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="field-group">
              <label className="field-label">Directed Departments (Orchestrator Responsibilities)</label>
              <div className="permission-list">
                {departments.map((d) => {
                  const checked = directedDepartmentIds.includes(d.id);
                  return (
                    <label key={d.id} className="permission-row" style={{ cursor: 'pointer' }}>
                      <span>
                        <span
                          className="dept-swatch"
                          style={{ background: d.color, display: 'inline-block', marginRight: 8 }}
                        />
                        {d.name}
                      </span>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setDirectedDepartmentIds(
                            checked ? directedDepartmentIds.filter((x) => x !== d.id) : [...directedDepartmentIds, d.id],
                          )
                        }
                      />
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="field-group">
              <label className="field-label">Responsibilities</label>
              <div className="chip-editor">
                {responsibilities.map((r) => (
                  <span key={r} className="editable-chip">
                    {r}
                    <button type="button" onClick={() => setResponsibilities(responsibilities.filter((x) => x !== r))}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="inline-add-row">
                <input
                  className="input"
                  placeholder="Add responsibility..."
                  value={newResp}
                  onChange={(e) => setNewResp(e.target.value)}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    if (newResp.trim()) {
                      setResponsibilities([...responsibilities, newResp.trim()]);
                      setNewResp('');
                    }
                  }}
                >
                  Add
                </button>
              </div>
            </div>

            <div>
              <button type="button" className="btn" onClick={handlePromote}>
                Promote to Department Director (+2 subagent quota)
              </button>
            </div>
          </>
        )}

        {tab === 'subagents' && (
          <>
            <div className="grid-2">
              <div className="field-group">
                <label className="field-label">Max Concurrent Workload (tasks)</label>
                <input
                  type="number"
                  min={1}
                  max={25}
                  className="input"
                  value={maxConcurrentWorkload}
                  onChange={(e) => setMaxConcurrentWorkload(Number(e.target.value))}
                />
              </div>
              <div className="field-group">
                <label className="field-label">Max Dynamic Subagents</label>
                <input
                  type="number"
                  min={0}
                  max={20}
                  className="input"
                  value={maxSubagents}
                  onChange={(e) => setMaxSubagents(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="field-group">
              <label className="field-label">Authorized Subagent Roles</label>
              <div className="chip-editor">
                {subagentRoles.map((r) => (
                  <span key={r} className="editable-chip">
                    {r}
                    <button type="button" onClick={() => setSubagentRoles(subagentRoles.filter((x) => x !== r))}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="inline-add-row">
                <input
                  className="input"
                  placeholder="e.g., Unit Test Engineer"
                  value={newSubRole}
                  onChange={(e) => setNewSubRole(e.target.value)}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    if (newSubRole.trim() && !subagentRoles.includes(newSubRole.trim())) {
                      setSubagentRoles([...subagentRoles, newSubRole.trim()]);
                      setNewSubRole('');
                    }
                  }}
                >
                  Add
                </button>
              </div>
            </div>

            {agent.maxSubagents > 0 && agent.lifecycleState !== 'position_open' && (
              <div className="effort-policy-callout" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  Spawn Dynamic Subagent ({agent.activeSubagentCount ?? 0}/{agent.maxSubagents} used)
                </div>
                <div className="grid-2">
                  <input
                    className="input"
                    placeholder="Subagent name"
                    value={spawnName}
                    onChange={(e) => setSpawnName(e.target.value)}
                  />
                  <select className="select" value={spawnProvider} onChange={(e) => setSpawnProvider(e.target.value as ProviderKind)}>
                    <option value="claude">Claude</option>
                    <option value="gemini">Gemini</option>
                    <option value="openai">OpenAI</option>
                  </select>
                </div>
                {agent.subagentRoles.length > 0 ? (
                  <select className="select" value={spawnRole} onChange={(e) => setSpawnRole(e.target.value)}>
                    {agent.subagentRoles.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="input"
                    placeholder="Role"
                    value={spawnRole}
                    onChange={(e) => setSpawnRole(e.target.value)}
                  />
                )}
                <button type="button" className="btn btn-primary btn-sm" onClick={handleSpawnSubagent}>
                  Spawn Under {agent.name}
                </button>
              </div>
            )}
          </>
        )}

        {tab === 'adapter' && (
          <>
            <div className="field-group">
              <label className="field-label">Subscription Messaging Adapter</label>
              <select className="select" value={adapterKind} onChange={(e) => setAdapterKind(e.target.value as AdapterKind)}>
                <option value="human_handoff">Transparent Human-Assisted Handoff (Zero API keys)</option>
                <option value="browser_bridge">Browser Companion Bridge (Live Claude.ai / Gemini tab)</option>
                <option value="webhook_relay">Authenticated Webhook Relay</option>
              </select>
            </div>

            <div className="field-group">
              <label className="field-label">Subscription Conversation Deep-Link URL</label>
              <input
                className="input mono"
                placeholder="https://claude.ai/chat/... or https://gemini.google.com/app/..."
                value={conversationUrl}
                onChange={(e) => setConversationUrl(e.target.value)}
              />
            </div>

            {adapterKind === 'webhook_relay' && (
              <div className="field-group">
                <label className="field-label">Webhook Relay URL</label>
                <input
                  className="input mono"
                  placeholder="https://relay.internal/agent-dispatch"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                />
              </div>
            )}

            <div className="field-group">
              <label className="field-label">Personality</label>
              <input
                className="input"
                placeholder="e.g., Calm, analytical, concise"
                value={personality}
                onChange={(e) => setPersonality(e.target.value)}
              />
            </div>

            <div className="field-group">
              <label className="field-label">Custom Instructions</label>
              <textarea
                className="textarea"
                rows={6}
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
              />
            </div>
          </>
        )}

        {tab === 'security' && (
          <>
            <div className="field-group">
              <label className="field-label">Per-Agent Permissions</label>
              <div className="permission-list">
                {allPermissions.map((perm) => {
                  const meta = PERMISSION_LABELS[perm];
                  const enabled = permissions.includes(perm);
                  return (
                    <label key={perm} className="permission-row" style={{ cursor: 'pointer' }}>
                      <div>
                        <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{meta.label}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{meta.desc}</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={() =>
                          setPermissions(enabled ? permissions.filter((p) => p !== perm) : [...permissions, perm])
                        }
                      />
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="field-group">
              <label className="field-label">Allowed File Path Globs (comma-separated)</label>
              <input className="input mono" value={allowedGlobs} onChange={(e) => setAllowedGlobs(e.target.value)} />
            </div>

            <div className="field-group">
              <label className="field-label">Restricted File Path Globs (always blocked)</label>
              <input className="input mono" value={restrictedGlobs} onChange={(e) => setRestrictedGlobs(e.target.value)} />
            </div>
          </>
        )}
      </div>

      <div className="inspector-footer">
        <button type="button" className="btn btn-danger btn-sm" onClick={handleDelete}>
          Remove
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </aside>
  );
};
