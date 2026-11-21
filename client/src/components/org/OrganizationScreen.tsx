import React, { useMemo, useState } from 'react';
import type { AgentNode, LifecycleState, OrgPayload } from '../../types';
import { OrgTreeCanvas } from './OrgTreeCanvas';
import { AgentCard } from './AgentCard';
import { InspectorDrawer } from './InspectorDrawer';
import { CreateEntityModal, type CreateMode } from './CreateEntityModal';
import { PlusIcon, SparkIcon } from '../Icons';

interface OrganizationScreenProps {
  org: OrgPayload;
  onRefresh: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
  onMessageAgent: (agent: AgentNode) => void;
}

export const OrganizationScreen: React.FC<OrganizationScreenProps> = ({
  org,
  onRefresh,
  onNotify,
  onMessageAgent,
}) => {
  const [viewMode, setViewMode] = useState<'hierarchy' | 'departments'>('hierarchy');
  const [lifecycleFilter, setLifecycleFilter] = useState<'all' | LifecycleState>('all');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState<CreateMode | null>(null);

  const selectedAgent = useMemo(
    () => org.agents.find((a) => a.id === selectedAgentId) ?? null,
    [org.agents, selectedAgentId],
  );

  const filteredAgents = useMemo(() => {
    return org.agents.filter((a) => {
      if (lifecycleFilter !== 'all' && a.lifecycleState !== lifecycleFilter) return false;
      if (departmentFilter !== 'all' && a.departmentId !== departmentFilter) return false;
      return true;
    });
  }, [org.agents, lifecycleFilter, departmentFilter]);

  const counts = useMemo(() => {
    const running = org.agents.filter((a) => a.lifecycleState === 'running').length;
    const planned = org.agents.filter((a) => a.lifecycleState === 'planned').length;
    const open = org.agents.filter((a) => a.lifecycleState === 'position_open').length;
    const claude = org.agents.filter((a) => a.provider === 'claude' && a.lifecycleState !== 'position_open').length;
    const gemini = org.agents.filter((a) => a.provider === 'gemini' && a.lifecycleState !== 'position_open').length;
    return { running, planned, open, claude, gemini };
  }, [org.agents]);

  const allById = useMemo(() => new Map(org.agents.map((a) => [a.id, a])), [org.agents]);

  return (
    <div style={{ display: 'flex', flex: 1, minWidth: 0, height: '100%' }}>
      <main className="org-screen">
        <div className="org-toolbar">
          <div className="org-toolbar-left">
            <h1 className="org-heading">Company Organization</h1>

            <div className="filter-group" role="tablist" aria-label="Organization view mode">
              <button
                type="button"
                className={`filter-pill ${viewMode === 'hierarchy' ? 'active' : ''}`}
                onClick={() => setViewMode('hierarchy')}
              >
                Visual Hierarchy
              </button>
              <button
                type="button"
                className={`filter-pill ${viewMode === 'departments' ? 'active' : ''}`}
                onClick={() => setViewMode('departments')}
              >
                Departments
              </button>
            </div>

            <div className="filter-group" aria-label="Filter by lifecycle">
              {(
                [
                  ['all', `All (${org.agents.length})`],
                  ['running', `Running (${counts.running})`],
                  ['planned', `Planned (${counts.planned})`],
                  ['position_open', `Open Seats (${counts.open})`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`filter-pill ${lifecycleFilter === key ? 'active' : ''}`}
                  onClick={() => setLifecycleFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            <select
              aria-label="Filter by department"
              className="select"
              style={{ width: 'auto', height: 29, padding: '0 8px', fontSize: 12 }}
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
            >
              <option value="all">All Departments</option>
              {org.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="org-toolbar-right">
            <button type="button" className="btn btn-sm" onClick={() => setCreateMode('blueprint')}>
              <SparkIcon size={13} /> Team Blueprints
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setCreateMode('department')}>
              <PlusIcon size={13} /> Department
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setCreateMode('team')}>
              <PlusIcon size={13} /> Team
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setCreateMode('position')}>
              <PlusIcon size={13} /> Open Seat
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreateMode('agent')}>
              <PlusIcon size={13} /> New Agent
            </button>
          </div>
        </div>

        <div className="org-stats-strip">
          <span className="org-stat">
            <strong>{org.departments.length}</strong> departments
          </span>
          <span className="org-stat">
            <strong>{org.teams.length}</strong> teams
          </span>
          <span className="org-stat">
            <span className="status-dot running" />
            <strong>{counts.running}</strong> running
          </span>
          <span className="org-stat">
            <span className="status-dot planned" />
            <strong>{counts.planned}</strong> planned
          </span>
          <span className="org-stat">
            <span className="status-dot vacant" />
            <strong>{counts.open}</strong> open seats
          </span>
          <span className="org-stat">
            <span className="badge badge-claude">Claude ×{counts.claude}</span>
            <span className="badge badge-gemini">Gemini ×{counts.gemini}</span>
          </span>
          <span className="org-stat" style={{ marginLeft: 'auto', color: 'var(--text-tertiary)' }}>
            Click any card to configure model, enforced effort, roles, reporting line & permissions
          </span>
        </div>

        {viewMode === 'hierarchy' ? (
          <OrgTreeCanvas
            agents={filteredAgents}
            allAgents={org.agents}
            departments={org.departments}
            selectedAgentId={selectedAgentId}
            onSelectAgent={(a) => setSelectedAgentId(a.id)}
            onMessageAgent={onMessageAgent}
          />
        ) : (
          <div className="org-canvas-wrap">
            <div className="dept-lanes-grid">
              {org.departments.map((dept) => {
                const members = filteredAgents.filter((a) => a.departmentId === dept.id);
                const director = dept.directorAgentId ? allById.get(dept.directorAgentId) : null;
                const effortUsed = members.reduce((sum, m) => sum + (m.activeEffortLoad ?? 0), 0);
                return (
                  <section key={dept.id} className="dept-lane">
                    <div className="dept-lane-header">
                      <div>
                        <div className="dept-lane-title">
                          <span className="dept-swatch" style={{ background: dept.color }} />
                          <span>{dept.name}</span>
                        </div>
                        {dept.description && <p className="dept-lane-desc">{dept.description}</p>}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                        <span className="badge mono" title="Active effort load vs department effort budget">
                          {effortUsed}/{dept.effortBudget} effort
                        </span>
                        {director && (
                          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Dir: {director.name}</span>
                        )}
                      </div>
                    </div>

                    <div className="dept-lane-cards">
                      {members.length === 0 ? (
                        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '12px 4px' }}>
                          No agents assigned in this department.
                        </div>
                      ) : (
                        members.map((m) => (
                          <AgentCard
                            key={m.id}
                            agent={m}
                            selected={selectedAgentId === m.id}
                            departments={org.departments}
                            managerName={m.reportsToId ? allById.get(m.reportsToId)?.name ?? null : null}
                            onSelect={(a) => setSelectedAgentId(a.id)}
                            onMessageAgent={onMessageAgent}
                          />
                        ))
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {selectedAgent && (
        <InspectorDrawer
          agent={selectedAgent}
          allAgents={org.agents}
          departments={org.departments}
          teams={org.teams}
          effortPolicies={org.effortPolicies}
          allPermissions={org.allPermissions}
          onClose={() => setSelectedAgentId(null)}
          onRefresh={onRefresh}
          onNotify={onNotify}
          onMessageAgent={onMessageAgent}
        />
      )}

      {createMode && (
        <CreateEntityModal
          mode={createMode}
          departments={org.departments}
          agents={org.agents}
          blueprints={org.blueprints}
          onClose={() => setCreateMode(null)}
          onCreated={(msg) => {
            onNotify(msg);
            onRefresh();
          }}
          onError={(err) => onNotify(err, true)}
        />
      )}
    </div>
  );
};
