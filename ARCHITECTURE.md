# Agent Company OS — Architecture & Practical Brainstorm

## 1. System Architecture

Agent Company OS is a modular, self-hosted multi-agent collaboration platform built strictly around **two primary screens** (**Organization** and **Collaboration**), persistent SQLite storage (`node:sqlite` WAL mode), real-time WebSocket synchronization, provider-independent subscription messaging adapters, and atomic filesystem lease isolation.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    FRONTEND (React + TypeScript + Vanilla CSS)          │
│   ┌───────────────────────────────┐  ┌───────────────────────────────┐  │
│   │   SCREEN 1: ORGANIZATION      │  │   SCREEN 2: COLLABORATION     │  │
│   │ • Interactive Visual Org Tree │  │ • Discord/Slack Channel Rail  │  │
│   │ • Department Swimlanes        │  │ • Threads, DMs, @mentions     │  │
│   │ • Running / Planned / Vacant  │  │ • Subscription Handoff Queue  │  │
│   │ • Slide-Over Inspector Drawer │  │ • Tasks & Dependency Locks    │  │
│   │ • Predefined Team Blueprints  │  │ • Shared Files & Atomic Leases│  │
│   └───────────────────────────────┘  │ • Persistent Memory & ADRs    │  │
│                                      │ • Approvals & Audit Log       │  │
│                                      └───────────────────────────────┘  │
└──────────────────────────┬───────────────────────────┬──────────────────┘
                           │ REST (/api/*)             │ WS (/ws/events)
┌──────────────────────────▼───────────────────────────▼──────────────────┐
│                 BACKEND RUNTIME (Node 24 + Express 5 + ws)              │
│                                                                         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────────┐  │
│  │ OrgService   │ │CollabService │ │ TaskService  │ │FileLeaseService│  │
│  │ • Depts/Teams│ │• Channels/DMs│ │• Deps/Locks  │ │• Atomic Leases │  │
│  │ • Multi-Role │ │• Protocol    │ │• Workload Cap│ │• Sandboxes     │  │
│  │ • Subagents  │ │  Parser      │ │• Deliverables│ │• SHA-256 Diff  │  │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └───────┬────────┘  │
│         └────────────────┴────────────────┴─────────────────┘           │
│                          │                                              │
│  ┌───────────────────────▼───────────────────────────────────────────┐  │
│  │  GOVERNANCE & ENFORCEMENT KERNEL                                  │  │
│  │  • Effort Policy Engine (low / medium / high / max)               │  │
│  │  • Per-Agent RBAC & File Path Glob Guard                          │  │
│  │  • ApprovalService (Human Sign-off Gate)                          │  │
│  │  • MemoryService (Persistent ADRs/Specs) + AuditService (Logs)    │  │
│  └───────────────────────┬───────────────────────────────────────────┘  │
│                          │                                              │
│  ┌───────────────────────▼───────────────────────────────────────────┐  │
│  │  PROVIDER-INDEPENDENT MESSAGING ADAPTERS (Zero CLI / Zero API Key)│  │
│  │  1. BrowserBridgeAdapter  → Chrome Extension (claude.ai / gemini) │  │
│  │  2. WebhookRelayAdapter   → Signed HTTP Relay + Callback          │  │
│  │  3. HumanHandoffAdapter   → Honest 1-Click Context Packet Relay   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  PERSISTENCE (SQLite WAL + Canonical Workspace + Isolated Sandbox)│  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Core Architectural Guarantees

1. **Honest Subscription-Backed Execution (No CLI, No API Keys, No Mocks)**:
   - Agents never simulate or hallucinate completion statuses.
   - `BrowserBridgeAdapter` connects over authenticated localhost WebSocket (`/ws/bridge`) to the included Chrome Manifest V3 Companion Extension (`browser-bridge/`), allowing open authenticated `claude.ai` and `gemini.google.com` tabs to bind to agents and exchange real messages automatically.
   - When no browser tab is bound or a relay is unreachable, dispatches transparently transition to `awaiting_handoff` inside the **Subscription Handoff Queue** with a 1-click **Copy Context Packet**, deep-link to the agent's conversation URL, and real response ingestion.
2. **Enforced Effort Governance**:
   - Every agent and task specifies an effort level (`low`, `medium`, `high`, `max`).
   - Effort is actively enforced in `server/src/domain/effort.ts`:
     - **Low**: 6 messages context, 2 memory docs, max 1 delegation hop, 180s lease TTL, 1 budget unit.
     - **Medium**: 15 messages context, 5 memory docs, max 3 delegation hops, 300s lease TTL, 2 budget units.
     - **High**: 30 messages context, 10 memory docs, max 5 delegation hops, 600s lease TTL, 3 budget units.
     - **Max**: 60 messages context, 20 memory docs, max 6 delegation hops, 900s lease TTL, 4 budget units, **mandatory Human Executive Approval for all file integrations**.
3. **Plain-Text Cross-Provider Inter-Agent Protocol**:
   - Because Claude and Gemini web subscriptions communicate through natural chat messages, agents use lightweight, human-readable directives parsed deterministically by `server/src/adapters/protocolParser.ts`:
     - `@AgentName` — Cross-provider mention routing (Claude → Gemini and Gemini → Claude)
     - `[DELEGATE to="Vega" title="..." effort="high"]...[/DELEGATE]`
     - `[CLAIM_FILE path="docs/architecture.md"]`
     - `[PROPOSE_EDIT path="docs/architecture.md"]...[/PROPOSE_EDIT]`
     - `[RECORD_DECISION title="ADR-00X: ..."]...[/RECORD_DECISION]`
     - `[REQUEST_APPROVAL title="..." reason="..."]`
     - `[SPAWN_SUBAGENT name="..." role="..."]`
4. **Atomic File Ownership & Recovery**:
   - Enforced via SQLite `BEGIN IMMEDIATE` transaction + partial `UNIQUE` index (`WHERE status = 'active'`) on `file_leases(file_path)`.
   - Every claim snapshots the canonical file's SHA-256 hash and copies it into `workspace-data/sandboxes/<agentId>/<leaseId>/`.
   - Active browser bridge heartbeats and sandbox writes renew leases automatically; a 5-second background sweeper recovers expired leases as `abandoned` and preserves uncommitted edits into `workspace-data/recovery-drafts/` before unlocking the file.
   - Controlled integration verifies SHA-256 conflict freedom, produces a unified diff, checks per-agent RBAC (`files:integrate_direct`) + path globs + sensitive path patterns + `max` effort policy, and either atomically renames the file into canonical storage or queues a **Human Approval Request** with the full diff.

---

## 2. Brainstorm Session: Practical Ideas to Make Agent Company OS Extraordinary

### Implemented Directly in This MVP
1. **Effort-as-Governance (Not Just a Label)**: Enforcing context depth, max cross-agent delegation hops (preventing infinite Claude ↔ Gemini ping-pong loops), lease TTL, and approval gates directly from the `effort` setting makes effort tangible and operationally meaningful.
2. **Three-Tier Honest Transport**: Combining a live Chrome Companion Bridge (`browser-bridge/`), Authenticated Webhook Relay, and Transparent Human-Assisted Handoff Queue gives real cross-provider collaboration immediately on day 1 without violating subscription auth or requiring API keys.
3. **"Knock-to-Handoff" for File Conflicts**: When a file is locked by another agent, instead of a dead-end error, the UI surfaces who owns the lease, its live expiry countdown, and a 1-click **Request Handoff** button that messages the owner in `#general`.
4. **Vacant Seats vs. Planned vs. Running Lifecycle**: Designing the org chart with open dashed-border positions lets founders design the company they *want* to staff, then convert vacant seats into configured agents with one click while keeping reporting lines intact.
5. **Predefined Cross-Provider Team Blueprints**: One-click pods (*Claude + Gemini Delivery Pod*, *Adversarial Dual-Model Review Pod*) accelerate spinning up specialized cross-provider teams with sensible defaults and permissions.
6. **Dual-Hatting & Department Directing**: Supporting multiple simultaneous roles + `directedDepartmentIds` mirrors real startups where an orchestrator leads two departments while also acting as Release Gatekeeper.

### High-Leverage Phase 2 Ideas (Next Milestones)
1. **Cross-Provider "Two-Model Rule" Policy**: Add a department toggle requiring any `high` or `max` effort file diff authored by a Claude agent to receive an explicit review message from a Gemini agent (or vice versa) before the Human Approve button unlocks.
2. **Subscription Cooldown & Rate-Limit Tracker**: Track rolling message counts per Claude / Gemini subscription account (e.g., 5-hour Claude message window), surface subtle capacity bars on agent cards, and offer 1-click fallback to an alternate model/provider when a subscription hits cooldown.
3. **Context Budget Estimator on Handoff Cards**: Show live estimated token weight (`~3.4k tokens`) on every Context Packet before copy/dispatch, with toggles to trim older messages or exclude specific memory docs.
4. **Org Chart Live Activity Pulses & Replay Mode**: Animate subtle directional particles along org tree connectors whenever a real cross-provider delegation flows from Manager → Specialist, plus a timeline scrubber replaying how a project's decisions and file leases unfolded.
5. **Git Worktree / Branch Export Mode**: Allow exporting the canonical `workspace-data/project-files/` directory into a real Git branch with co-authored commit trailers attributing each participating Claude/Gemini agent and the approving Human Supervisor.
6. **Scheduled Standups & Stale-Task Watchdog**: Optional human-triggered "Daily Standup" dispatch that asks each Department Director to summarize blockers, workload bottlenecks, and open approvals in `#general`.
