import React, { useState } from 'react';
import type { AgentNode, Department, EffortLevel, LifecycleState, ProviderKind, TeamBlueprint } from '../../types';
import { api } from '../../api/client';
import { CloseIcon } from '../Icons';

export type CreateMode = 'agent' | 'position' | 'department' | 'team' | 'blueprint';

interface CreateEntityModalProps {
  mode: CreateMode;
  departments: Department[];
  agents: AgentNode[];
  blueprints: TeamBlueprint[];
  onClose: () => void;
  onCreated: (message: string) => void;
  onError: (msg: string) => void;
}

export const CreateEntityModal: React.FC<CreateEntityModalProps> = ({
  mode,
  departments,
  agents,
  blueprints,
  onClose,
  onCreated,
  onError,
}) => {
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [provider, setProvider] = useState<ProviderKind>('claude');
  const [model, setModel] = useState('claude-sonnet-4-6');
  const [effort, setEffort] = useState<EffortLevel>('medium');
  const [rolesText, setRolesText] = useState('');
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? '');
  const [reportsToId, setReportsToId] = useState(agents[0]?.id ?? '');
  const [maxSubagents, setMaxSubagents] = useState(2);
  const [maxWorkload, setMaxWorkload] = useState(3);
  const [effortBudget, setEffortBudget] = useState(14);
  const [color, setColor] = useState('#2563eb');
  const [selectedBlueprintId, setSelectedBlueprintId] = useState(blueprints[0]?.id ?? '');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === 'department') {
        await api.createDepartment({
          name,
          description,
          color,
          effortBudget,
          directorAgentId: reportsToId || null,
        });
        onCreated(`Created department "${name}" and its collaboration channel.`);
      } else if (mode === 'team') {
        await api.createTeam({
          departmentId,
          name,
          purpose: description,
        });
        onCreated(`Created team "${name}".`);
      } else if (mode === 'blueprint') {
        await api.instantiateBlueprint(selectedBlueprintId, {
          departmentId,
          reportsToId: reportsToId || null,
        });
        const bp = blueprints.find((b) => b.id === selectedBlueprintId);
        onCreated(`Instantiated predefined pod "${bp?.name}".`);
      } else {
        const lifecycleState: LifecycleState = mode === 'position' ? 'position_open' : 'planned';
        const roles = rolesText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        await api.createAgent({
          name: mode === 'position' && !name.toLowerCase().includes('open') ? `Open Seat: ${name}` : name,
          title: title || name,
          lifecycleState,
          provider,
          model,
          effort,
          roles: roles.length > 0 ? roles : [title || name],
          departmentId: departmentId || null,
          reportsToId: reportsToId || null,
          maxSubagents,
          maxConcurrentWorkload: maxWorkload,
          customInstructions: description,
        });
        onCreated(`Created ${mode === 'position' ? 'available position' : 'planned agent'} "${name}".`);
      }
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Creation failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            {mode === 'agent'
              ? 'New Agent'
              : mode === 'position'
                ? 'Open New Position'
                : mode === 'department'
                  ? 'New Department'
                  : mode === 'team'
                    ? 'New Team'
                    : 'Instantiate Predefined Team Blueprint'}
          </h2>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose}>
            <CloseIcon size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {mode === 'blueprint' ? (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {blueprints.map((bp) => (
                    <label
                      key={bp.id}
                      className="doc-card"
                      style={{
                        cursor: 'pointer',
                        borderColor: selectedBlueprintId === bp.id ? 'var(--accent-primary)' : undefined,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <strong>{bp.name}</strong>
                        <input
                          type="radio"
                          checked={selectedBlueprintId === bp.id}
                          onChange={() => setSelectedBlueprintId(bp.id)}
                        />
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{bp.description}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {bp.members.map((m) => (
                          <span key={m.name} className={`badge badge-${m.provider}`}>
                            {m.name} ({m.provider}/{m.effort})
                          </span>
                        ))}
                      </div>
                    </label>
                  ))}
                </div>
                <div className="grid-2">
                  <div className="field-group">
                    <label className="field-label">Target Department</label>
                    <select className="select" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-group">
                    <label className="field-label">Pod Reports To</label>
                    <select className="select" value={reportsToId} onChange={(e) => setReportsToId(e.target.value)}>
                      <option value="">Top-level</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({a.title})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            ) : mode === 'department' ? (
              <>
                <div className="grid-2">
                  <div className="field-group">
                    <label className="field-label">Department Name</label>
                    <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Design & Brand" />
                  </div>
                  <div className="field-group">
                    <label className="field-label">Effort Budget (units)</label>
                    <input type="number" min={4} max={100} className="input" value={effortBudget} onChange={(e) => setEffortBudget(Number(e.target.value))} />
                  </div>
                </div>
                <div className="grid-2">
                  <div className="field-group">
                    <label className="field-label">Accent Color</label>
                    <input type="color" className="input" style={{ height: 34, padding: 3 }} value={color} onChange={(e) => setColor(e.target.value)} />
                  </div>
                  <div className="field-group">
                    <label className="field-label">Department Director</label>
                    <select className="select" value={reportsToId} onChange={(e) => setReportsToId(e.target.value)}>
                      <option value="">Unassigned</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="field-group">
                  <label className="field-label">Mandate / Description</label>
                  <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this department owns..." />
                </div>
              </>
            ) : mode === 'team' ? (
              <>
                <div className="field-group">
                  <label className="field-label">Team Name</label>
                  <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Data Infrastructure" />
                </div>
                <div className="field-group">
                  <label className="field-label">Department</label>
                  <select className="select" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-group">
                  <label className="field-label">Purpose</label>
                  <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
                </div>
              </>
            ) : (
              <>
                <div className="grid-2">
                  <div className="field-group">
                    <label className="field-label">{mode === 'position' ? 'Seat Name' : 'Agent Name'}</label>
                    <input
                      className="input"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={mode === 'position' ? 'e.g., Data Engineer' : 'e.g., Echo'}
                    />
                  </div>
                  <div className="field-group">
                    <label className="field-label">Title</label>
                    <input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Staff Systems Engineer" />
                  </div>
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
                        setModel(p === 'gemini' ? 'gemini-2.5-pro' : p === 'claude' ? 'claude-sonnet-4-6' : 'gpt-5');
                      }}
                    >
                      <option value="claude">Claude</option>
                      <option value="gemini">Gemini</option>
                      <option value="openai">OpenAI</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                  <div className="field-group">
                    <label className="field-label">Model</label>
                    <input className="input mono" value={model} onChange={(e) => setModel(e.target.value)} />
                  </div>
                </div>

                <div className="grid-2">
                  <div className="field-group">
                    <label className="field-label">Enforced Effort</label>
                    <select className="select" value={effort} onChange={(e) => setEffort(e.target.value as EffortLevel)}>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="max">Max (Approval gated)</option>
                    </select>
                  </div>
                  <div className="field-group">
                    <label className="field-label">Simultaneous Roles (comma-separated)</label>
                    <input className="input" value={rolesText} onChange={(e) => setRolesText(e.target.value)} placeholder="Backend Lead, Reviewer" />
                  </div>
                </div>

                <div className="grid-2">
                  <div className="field-group">
                    <label className="field-label">Department</label>
                    <select className="select" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                      <option value="">Company-wide</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-group">
                    <label className="field-label">Reports To</label>
                    <select className="select" value={reportsToId} onChange={(e) => setReportsToId(e.target.value)}>
                      <option value="">Top-level Executive</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({a.title})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid-2">
                  <div className="field-group">
                    <label className="field-label">Max Subagents</label>
                    <input type="number" min={0} max={20} className="input" value={maxSubagents} onChange={(e) => setMaxSubagents(Number(e.target.value))} />
                  </div>
                  <div className="field-group">
                    <label className="field-label">Max Concurrent Workload</label>
                    <input type="number" min={1} max={20} className="input" value={maxWorkload} onChange={(e) => setMaxWorkload(Number(e.target.value))} />
                  </div>
                </div>

                <div className="field-group">
                  <label className="field-label">Custom Instructions</label>
                  <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Behavioral directives and domain focus..." />
                </div>
              </>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Creating…' : mode === 'blueprint' ? 'Instantiate Pod' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
