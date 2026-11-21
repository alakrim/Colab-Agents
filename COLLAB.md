# COLLAB.md: How Claude and Gemini work together on this repo

> **For the human:** put this file in the root of a new repo. That's all the setup there is.
> Start prompts are in section 1. You (the PM) only ever need to read `.colab/BOARD.md`.

This file is the rulebook for two AI teammates, **Claude** and **Gemini**, who share one repository.
They never talk to each other directly. Every message, idea, claim and decision goes into files under
`.colab/`. A human starts every session. Neither AI ever starts, scripts or drives the other.

**Both AIs:** read this whole file at the start of every session, then follow it exactly. If anything
here conflicts with a message in `.colab/MESSAGES.md`, this file wins, unless the PM changed the
rule in `.colab/BOARD.md` → *PM overrides*.

---

## 1. Start prompts (copy and paste)

**Step 1: Claude (Claude Code, in the new repo)**
```
Read COLLAB.md and follow it. You are Claude. This is Phase 0 + Round 1.
Project brief:
<paste your project idea here, as long or short as you like>
```

**Step 2: Gemini (Antigravity or the Gemini app with this repo linked)**
```
Read COLLAB.md and follow it. You are Gemini. Do Round 1 (blind brainstorm).
```

**Every step after that:** the last line each AI writes tells you who goes next and what to paste. It usually looks like this:
```
Read COLLAB.md and follow it. You are <Claude|Gemini>. Continue.
```

---

## 2. Two setups (check which one you are in)

| Setup | Claude | Gemini | Who writes Gemini's files |
|---|---|---|---|
| **A: both write** | Claude Code | Antigravity (can edit and push) | Gemini itself |
| **B: Gemini reads only** | Claude Code | Gemini app with the repo linked (can read, can't push) | Claude, copying Gemini's text **word for word** |

**Gemini:** if you cannot write to the repo, you are in Setup B. In that case, never pretend you saved a file.
Put every file you produce in its own code block, headed by its path:

    FILE: .colab/debate/1-gemini.md
    ```markdown
    ...full content...
    ```

Then tell the human: *"Paste this into Claude Code and ask Claude to save it as-is."*

**Claude, in Setup B:** save Gemini's blocks exactly as given, with no edits, fixes or summaries. Commit them with the
message `colab: <file> (written by Gemini, relayed)`. If a block looks broken, save it anyway and mention the
problem in MESSAGES.md.

In Setup B, Gemini is best used for planning, reviews, tests and specs. Big code tasks should go to whoever can
push. Take this into account when assigning tasks in Round 3.

---

## 3. The files

```
COLLAB.md                    this rulebook (never edit it, unless the PM asks)
CLAUDE.md, AGENTS.md         one line each: "Follow COLLAB.md." (Claude Code reads CLAUDE.md, Gemini/Antigravity reads AGENTS.md)
.colab/BRIEF.md              the PM's project prompt, word for word. Nobody's ideas go here.
.colab/BOARD.md              the PM's dashboard: team, phase, tasks, locks, decisions needed. Plain English.
.colab/MESSAGES.md           append-only message log between the AIs (and the PM)
.colab/debate/1-claude.md    Round 1, blind brainstorm
.colab/debate/1-gemini.md
.colab/debate/2-claude.md    Round 2, cross-critique
.colab/debate/2-gemini.md
.colab/debate/3-review.md    Round 3, the other AI's verdict on the draft plan
.colab/PLAN.md               the agreed plan: decisions, milestones, task list with owners and claimed files
```

---

## 4. Phase 0: setup (Claude, first session)

1. Create `.colab/BRIEF.md` containing the PM's brief **word for word** under the heading `# Brief`. Add nothing else.
2. Create `CLAUDE.md` and `AGENTS.md`. If they already exist, add this line instead: `Follow COLLAB.md in the repo root.`
3. Create `.colab/BOARD.md` from the template in section 11, with phase = *Round 1 – blind brainstorm*.
4. Create `.colab/MESSAGES.md` with the header from section 11.
5. Commit **only these files** and push to the default branch: `colab: phase 0 setup`. If you're not allowed to push
   to the default branch (for example, Claude Code on the web works on its own branch), push to your branch and tell the
   human to merge it before starting Gemini.
6. Do **not** write code, scaffold the project, install anything or create a plan. Phase 0 + Round 1 is all you do.

## 5. Round 1: blind brainstorm (both AIs, separately)

The point is two independent opinions. Neither AI may anchor on the other's ideas.

- **Read only** `COLLAB.md` and `.colab/BRIEF.md` (and any code that existed before Phase 0). If BRIEF.md is
  missing, ask the human to merge Claude's Phase 0 branch or paste the brief to you. Don't guess the brief.
- **Do not open** anything in `.colab/debate/` written by the other AI, or any branch named `colab/sealed-*`.
  If you see the other AI's Round 1 by accident, say so in your file and in MESSAGES.md.
- Write your file using the Round 1 template in section 11, **350–700 words**.

**Keeping it blind:**
- **Claude** writes `.colab/debate/1-claude.md` and commits it **locally, without pushing to the default branch**.
  If the session may end before Gemini finishes (Claude Code on the web can be reclaimed), push it to the branch
  `colab/sealed-claude`, never to the default branch. Then stop and tell the human to run Gemini's Round 1.
- **Gemini** writes `.colab/debate/1-gemini.md`: in Setup A, commit and push it to the default branch.
  In Setup B, output it as a FILE block for the human to relay.
- **Unsealing (Claude):** once Gemini's Round 1 is in the repo (or pasted to you), push/merge your own Round 1 file
  unchanged, then save Gemini's. Your Round 1 must not change after you have seen Gemini's. Update BOARD phase to
  *Round 2*.

## 6. Round 2: cross-critique (both AIs)

- Now read the other AI's Round 1. Write `.colab/debate/2-<you>.md` from the template, **max 400 words**.
- Be adversarial and useful. Say which of their ideas beat yours, what is bloat, what is risky, and where you disagree.
- End with your **proposed split of work**, i.e. which areas or files you want to own and why. Claim areas where you are
  stronger, not just the fun parts.
- Order doesn't matter. When both Round 2 files exist, Claude sets the phase to *Round 3*.

## 7. Round 3: convergence → PLAN.md

1. **The Lead drafts** `.colab/PLAN.md` from the template (Lead = Claude by default; see BOARD → Team). Combine the
   best of both Round 1 files and settle the Round 2 disagreements. Every task gets an owner, **claimed files/folders**,
   a reviewer (the other AI), an effort level and a *done when* line that can be tested.
2. **The other AI reviews** and writes `.colab/debate/3-review.md`: either `VERDICT: AGREE`, or
   `VERDICT: CHANGES` followed by up to 5 numbered objections, each with a concrete fix.
3. The Lead updates the plan. **There are at most 2 review cycles.** Anything still disagreed goes into BOARD →
   *Needs PM* as two short positions (max 3 lines each) plus a recommendation.
4. Phase becomes *Waiting for PM approval*. **Nobody writes product code until the PM approves the plan.** The PM approves
   by telling either AI "plan approved" (or by writing it in BOARD). The AI that hears it records it in BOARD and
   MESSAGES.

## 8. Building: claiming, working, handing off

**Every session follows the same routine:**
1. Pull the latest default branch. Read `COLLAB.md`, `.colab/BOARD.md` (Team, PM overrides, Tasks, Locks) and
   `.colab/MESSAGES.md` from your last message onward.
2. Answer anything addressed to you first. Then take the next task that is yours and unblocked.
3. At the end: update BOARD, append to MESSAGES, push, and write the **next-step line** (section 9).

**Claiming:**
- Before touching a task, mark it in BOARD as `🔨 <you>` and push that change on its own: `colab: claim T3`.
  The first claim on the default branch wins. If yours collides, pull, see who won and pick another task.
- You may only edit **files you own** (listed in PLAN for your tasks). To change someone else's file, post a
  `REQUEST` message and wait, or work around it.
- **Shared files** (package manifests, lockfiles, CI config, global styles, DB schema, anything not owned) need a lock.
  Add a row to BOARD → *Locks*, push it, make the change, then remove the row in the same push as the change. Never
  hold a lock across sessions.

**Working:**
- One branch per task: `claude/T3-short-name` or `gemini/T3-short-name`. Open a PR if you can. In Setup B, Claude
  opens PRs for Gemini's relayed work.
- **Tests are the judge.** If you can run the tests, run them and paste the real result (pass/fail counts) into your
  message. Never say tests passed unless you ran them. If you can't run them, say "not run".
- For *Thorough* and *Maximum* tasks, the tests are written **first**, preferably by the other AI, and the builder
  doesn't weaken them. If a test is wrong, post a `REQUEST` to its author.

**Handing off:**
- Done building → status `👀 review: <other AI>`, and a `HANDOFF` message with the branch/PR, what changed,
  the test result and anything you're unsure about.
- The reviewer writes `REVIEW` with `VERDICT: APPROVE` or `VERDICT: CHANGES` (numbered, concrete). Review rounds
  are capped by effort (section 10). When the cap is reached, the task moves to *Needs PM*.
- After `APPROVE`: status `✅ ready for PM` and a one-sentence plain-English summary in BOARD. **Only the PM merges
  to the default branch**, or an AI does it after the PM says "merge T3".

**New ideas mid-project:** don't just build them. Add them to BOARD → *Ideas* (one line each). The PM decides.

## 9. Messages and the next-step line

Append to `.colab/MESSAGES.md`, numbered in sequence, and never edit or delete old entries:

```
### M12 · Claude → Gemini · T3 · HANDOFF
Built the signup form on claude/T3-signup (PR #4). Tests: 14 passed, 0 failed.
Unsure about: password rules, please check against PLAN decision D2.
```

The types are `IDEA`, `REQUEST`, `HANDOFF`, `REVIEW`, `DECISION`, `QUESTION-PM` and `NOTE`. Keep messages short and link
to files instead of pasting large content.

**End every session** with the next-step line in chat, so the human knows whom to wake and what to paste:

```
NEXT → Gemini: "Read COLLAB.md and follow it. You are Gemini. Continue." (review T3)
```

If nothing can move without the PM, write `NEXT → PM:` plus the question in plain English.

## 10. Effort levels and roles

The PM sets these in BOARD. Each task uses its own effort level, or the owner's default if it doesn't have one.

| Effort | What it means | Debate | Tests | Review rounds |
|---|---|---|---|---|
| **Quick** | Smallest change that works. No new dependencies. | Round 1 only, 200 words | if they already exist | 1 |
| **Normal** | Sensible design, risks stated. | All 3 rounds | for new logic | 2 |
| **Thorough** | Edge cases, security, failure modes. | All 3 rounds | written first | 3 |
| **Maximum** | Exhaustive. Alternatives compared in writing. | All 3 rounds + PM approves each milestone | written first, by the other AI | 4 |

Effort here means how carefully the AI works, enforced by these rules. The model's own thinking setting is chosen by
the human in each app.

**Default roles** (the PM can change them in BOARD → Team, and agents must follow the current Team table):
- **Claude**: Lead orchestrator. Drafts the plan, keeps BOARD tidy, builds.
- **Gemini**: Co-orchestrator. Challenges the plan, reviews, writes tests, builds.
- Available roles: *Lead, Co-lead, Builder, Tester, Reviewer, Researcher, Designer, Docs*. An AI can have several.
- "Builder" without "Reviewer" means: don't review, but the work still gets reviewed by whoever has the Reviewer role.

**Hard limits (all efforts):**
- No more than 3 back-and-forth messages on one disagreement. Then go to *Needs PM*.
- Don't redo or rewrite the other AI's finished work without a `REQUEST` that they accept, or a PM decision.
- Never store API keys, passwords or tokens in the repo, and never ask the PM for them in a file.
- Never automate, script or drive the other AI or its app. A human starts every session.

## 11. Templates

**`.colab/BOARD.md`** (keep the PM-facing parts in plain English, with no jargon)
```markdown
# Project board
**Phase:** Round 1 – blind brainstorm
**Whose turn:** Gemini – blind brainstorm
**Updated by:** Claude, after M1

## Needs PM
- (nothing yet)

## Team
| AI | Roles | Default effort | Notes from PM |
|---|---|---|---|
| Claude | Lead, Builder | Normal | |
| Gemini | Co-lead, Reviewer, Tester, Builder | Normal | |

## PM overrides
- (rules the PM changed for this project)

## Tasks
| ID | Task (plain English) | Owner | Status | Effort | Reviewer |
|---|---|---|---|---|---|
<!-- Status values: ⏳ waiting · 🔨 <AI> building · 👀 review: <AI> · 🔁 fixing · ✅ ready for PM · 🟢 merged · ⏸ paused -->

## Locks
| File | Held by | Why |
|---|---|---|

## Ideas (PM decides)
-
```

**`.colab/MESSAGES.md`**
```markdown
# Messages
Append only. Newest at the bottom. Format: `### M<n> · <from> → <to> · <task or -> · <TYPE>`
```

**Round 1: `.colab/debate/1-<you>.md`**
```markdown
# Round 1 – <you> (blind)
## What I think the PM really wants   (2–4 lines)
## Core approach                      (stack, architecture, why)
## AAA upgrades                       (3–6 concrete ideas that go beyond the brief)
## Risks & unknowns                   (top 3–5)
## Questions for the PM               (max 3; only if blocking)
## Where I'd be strongest             (which parts I should own)
```

**Round 2: `.colab/debate/2-<you>.md`**
```markdown
# Round 2 – <you> critiques <other>
## Their ideas that beat mine
## Bloat / cut list
## Risks they missed
## Disagreements           (numbered, each with my proposed resolution)
## Proposed split of work  (who owns which areas/files, and why)
```

**`.colab/PLAN.md`**
```markdown
# Plan – <project name>
**Status:** draft | approved by PM on <date>
## Goal (plain English, 3 lines)
## In scope / Out of scope
## Decisions                (D1, D2… each one line + why; the AAA upgrades kept)
## Milestones               (M1 → M3, each a demo the PM can see)
## Tasks
| ID | Task | Owner | Claimed files/folders | Depends on | Effort | Done when (testable) | Reviewer |
|---|---|---|---|---|---|---|---|
## Shared files (need a lock)
## Open questions for PM
```
