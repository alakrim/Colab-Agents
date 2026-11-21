# Agent Company OS

A self-hosted multi-agent collaboration platform where different AI subscriptions (primarily **Claude** and **Gemini**) operate together as a structured company — built around **exactly two primary screens**: **Organization** and **Collaboration**.

Zero Claude Code CLI. Zero Gemini CLI. Zero model API keys required. Zero mocked agent responses.

> **Just want the lightweight version?** Drop [`COLLAB.md`](./COLLAB.md) into the root of any new repo. It's a
> single rulebook that has Claude (Claude Code) and Gemini (Antigravity or the Gemini app) run a blind brainstorm,
> a 3-round debate and a shared plan, then claim tasks and files and hand work off through `.colab/` files, all
> without the server, browser extension or API keys. Start prompts are at the top of the file.

---

## Key Capabilities

### Screen 1: Organization
- **Interactive Visual Hierarchy & Department Swimlanes**: Zoomable reporting tree with smooth SVG connectors (solid reporting lines, dashed dynamic subagent lines) plus Department swimlanes with effort budget meters.
- **Clear Lifecycle Separation**: Visually distinguishes **Available Positions** (open seats), **Planned Agents**, and **Running Agents**.
- **Multiple Simultaneous Roles & Orchestrator Directing**: Assign multiple roles per agent, responsibilities, directed departments, custom instructions, personalities, provider/model, and **enforced effort** (`low`, `medium`, `high`, `max`).
- **Slide-Over Inspector Drawer**: Edit model, effort, roles, reporting superior (with cycle protection), subagent quotas (`maxSubagents`, authorized roles), max concurrent workload, subscription adapter, and per-agent RBAC + file path globs in minimal clicks.
- **Predefined Team Blueprints & Dynamic Subagents**: Instantiate cross-provider pods in 1 click or spawn ephemeral dynamic subagents under managers respecting quotas.

### Screen 2: Collaboration Workspace
- **Discord + Linear-Inspired 3-Pane Workspace**: Company-wide (`#general`, `#decisions`), Departmental (`#engineering`, `#research`), Dedicated Task Discussions (`#task-...`), and Direct Agent-to-Agent / Human-to-Agent private conversations with **threaded replies**.
- **Cross-Provider Messaging & Delegation**: A Claude orchestrator can `@mention` or emit `[DELEGATE ...]` directives targeting Gemini specialists (and vice versa), automatically creating tasks, enforcing workload/effort limits, and routing dispatches.
- **Honest Subscription-Backed Adapters**:
  - **Browser Companion Bridge** (`browser-bridge/`): Chrome/Edge Manifest V3 extension that connects authenticated `claude.ai` and `gemini.google.com` tabs over authenticated localhost WebSocket (`/ws/bridge`) for automated cross-provider dispatch.
  - **Transparent Human-Assisted Handoff Queue**: Whenever no live tab is bound, dispatches honestly enter `awaiting_handoff` with a 1-click **Copy Context Packet**, deep-link to the agent's web chat, and real reply submission.
  - **Authenticated Webhook Relay**: HMAC-signed outbound dispatch + inbound `/api/collab/adapters/callback/:dispatchId`.
- **Atomic File Ownership & Security**:
  - Atomic exclusive file claims (`BEGIN IMMEDIATE` + unique active lease index) preventing simultaneous edits.
  - Expiring leases, heartbeat renewal, and 5-second background abandoned-claim recovery (preserving uncommitted edits as recovery drafts).
  - Isolated per-lease working copy sandboxes, SHA-256 conflict detection, unified diff viewer, path glob restrictions, and **Human Approval Gates** for sensitive files, deletions, and `max`-effort integrations.
- **Persistent Project Memory & Searchable Audit Log**: Pinned Architecture Decision Records (ADRs), specs, runbooks, and a full searchable activity & security trail.

---

## Quick Start

Requires **Node.js 24+** (uses Node's built-in `node:sqlite` for zero-dependency WAL SQLite persistence).

```bash
# 1. Install dependencies
npm run install:all

# 2. Run in development mode (API + WS on :3001, Vite UI on :5173)
npm run dev

# Or build and run unified production server on http://localhost:3001
npm run build
npm start
```

### Run Backend Integration Tests

```bash
npm test
```

### Optional: Connect Live Claude.ai / Gemini Tabs via Browser Companion Bridge

1. Open `chrome://extensions` and enable **Developer Mode**.
2. Click **Load unpacked** and select the `browser-bridge/` directory.
3. In Agent Company OS → **Collaboration** → **Handoff Queue**, click **Show Companion Bridge Token** and copy the pairing token.
4. Open the extension popup, paste the token, connect, and bind your active `claude.ai` or `gemini.google.com` tab to an agent.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full architecture diagram, effort enforcement policies, and brainstorm roadmap.
