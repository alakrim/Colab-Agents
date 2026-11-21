# Agent Company OS — Non-Technical PM User Manual

Welcome to **Agent Company OS**! This lightweight, self-hosted platform lets you run a company of autonomous AI agents (powered by Claude and Gemini) working directly on your local codebase and GitHub repositories.

---

## 1. 1-Minute Quick Start

### Prerequisites
- **Node.js 24+** (download from [nodejs.org](https://nodejs.org))
- Git & a GitHub repository

### Launching the App
1. **Mac / Linux**: Open your terminal in the project folder and run:
   ```bash
   ./start.sh
   ```
2. **Windows**: Double-click `start.bat`.
3. Open your browser and go to: **`http://localhost:3001`**

The launcher automatically installs dependencies on first run, builds the server and client, and starts the dashboard.

---

## 2. Connecting Claude, Gemini & GitHub

Click **`Connect AI`** in the top navigation bar to open the connection wizard. You have two options for linking your AI subscriptions:

- **Zero-Setup Handoff Queue (Recommended & Easiest)**: No API keys needed! The app generates compact JSON prompt packets for you to paste into your authenticated browser tabs (`claude.ai` and `gemini.google.com`), pasting responses right back into the queue.
- **Automated Chrome Companion Bridge**: Install the extension in `browser-bridge/` to connect your authenticated browser tabs directly to the OS for seamless automated dispatches.

> 💡 **Pro Tip**: Link your GitHub repository inside Claude Projects or Gemini custom instructions. This allows the models to reference your codebase directly without re-uploading files, saving massive amounts of context tokens!

---

## 3. Using the 3 Screens as a Non-Technical PM

The top navigation bar features three core workspaces designed for product managers:

### Screen 1: Organization (`Organization`)
- **Shape your team**: Visualize your autonomous agency as an interactive org chart.
- **Effort & Roles**: Inspect agents, assign roles (e.g., Tech Lead, QA, Frontend Architect), and tune effort levels and model providers.

### Screen 2: Workflow (`Workflow`)
- **3-Round Claude ↔ Gemini AAA Debate**: Click to start a structured debate where Claude and Gemini critique each other's blind plans in `#management` before writing code.
- **Plain-English Goals**: Edit plain-English goals, user impact, and PM notes for any workflow step without touching code.
- **Core vs. AAA Polish**: Toggle scope tiers (`core` vs `polish`) and autonomy modes (`autonomous` vs `supervised`).
- **Approve & Launch**: Review the generated multi-step plan, then click **`Approve & Launch`** to spin up tasks and isolated GitHub branches.

### Screen 3: Collaboration (`Collaboration`)
- **`#management` Debate Room**: Watch live cross-model debates and agent arguments.
- **GitHub Repos & Branches**: Track isolated `agent/*` feature branches and pull requests.
- **Files & Leases**: Prevent agents from overwriting each other's work with visual file locking.
- **Approvals & Log**: Review agent PRs and checkpoints before merging.
- **Handoff Queue**: Manage manual prompt handoffs if using browser-bridge fallback.

---

## 4. Staying Safe & Saving Tokens

- **Bootstrap + Delta Packets**: Agents only receive compressed incremental updates ("Deltas") rather than reloading full history, keeping token usage ultra-low.
- **Fuel Gauge (`C:% / G:%`)**: Monitor Claude (`C`) and Gemini (`G`) token consumption and rate-limit windows in real time right from the top bar.
- **Pause All Kill Switch**: Click the **`Pause All`** button in the top right at any time to instantly freeze all autonomous agent dispatches across the entire company.
