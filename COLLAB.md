# COLLAB.md: How Claude and Gemini work together on this repo

> **For the human:** attach this file in Claude Code in a new repo and paste the Step 1 prompt (section 1).
> Claude files it in the repo. After that, you (the PM) only ever need to read `.colab/BOARD.md`.

This file is the rulebook for two AI teams, **Claude** and **Gemini**, who share one repository.
They never talk to each other directly. Every message, idea, claim and decision goes into files under
`.colab/`. A human starts every session. Neither AI ever starts, scripts or drives the other.

**Both AIs:** read this whole file at the start of every session, then follow it exactly. If anything
here conflicts with a message in `.colab/MESSAGES.md`, this file wins, unless the PM changed the
rule in `.colab/BOARD.md` → *PM overrides*.

---

## 0. Claude: if this file was just attached to your chat

1. **Save it in the repo, unchanged, byte for byte.** Use the repo root as `COLLAB.md` unless the repo
   already keeps its process docs somewhere else (e.g. `docs/`). Then use that folder and stick with it.
   Wherever it lives, "COLLAB.md" in this file means that path.
2. Point both apps at it. In `CLAUDE.md` (read by Claude Code) and `AGENTS.md` (read by Antigravity/Gemini), add
   the line `Follow <path>/COLLAB.md.`. Create the files if they don't exist, and keep any existing content.
3. Use the real path in every start prompt you give the human (section 10, NEXT line).
4. Continue with Phase 0 (section 5). Don't do anything else first.

Only Claude installs or edits this file, and only when the PM asks. Gemini never edits it.

---

## 1. Start prompts (copy and paste)

**Step 1: Claude Code, in the new repo, with this file attached**
```
I've attached COLLAB.md. Save it in this repo where it fits best, then follow it.
You are Claude. Do Phase 0 + Round 1 only.
Project brief:
<paste your project idea here, as long or short as you like>
```

**Step 2: Gemini (Antigravity, or the Gemini app with this repo linked)**
```
Read COLLAB.md in this repo and follow it. You are Gemini. Do Round 1 (blind brainstorm).
```
(If Claude saved it somewhere other than the root, Claude's NEXT line will give you the exact path.)

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

## 3. Teams and subagent limits

Each AI is an **orchestrator** with a small, fixed team. **These limits are hard ceilings.** Only the PM can change
them, in BOARD → *PM overrides*.

| Team | Orchestrator | Subagents allowed (max at any time) |
|---|---|---|
| **Claude** | **Claude Opus**, the orchestrator | **1 × Sonnet** (`Claude-Builder`) and **1 × Haiku** (`Claude-Scout`) |
| **Gemini** | **Gemini Neon**, the orchestrator | **1 × Hydrogen** (`Gemini-Tester`) |

### Rules for every subagent
1. **Only the orchestrator may start a subagent.** Subagents never start other subagents, and never run two copies of themselves.
2. **One job per spawn.** Each spawn gets one task, described with the *Subagent brief* template (section 12). No
   open-ended or "help out" spawns.
3. **No voice in the debate.** Subagents never write or influence Round 1–3 content, and never read the other AI's
   debate files. (A Scout may collect facts about code that existed before Phase 0, for its own orchestrator.)
4. **No shared files.** Subagents never edit `COLLAB.md`, `.colab/BOARD.md`, `.colab/MESSAGES.md`, `.colab/PLAN.md` or
   `.colab/debate/*`, and never talk to the other AI team. All cross-team communication goes orchestrator to orchestrator.
5. **They stay inside their own team's claim.** A subagent may only edit files its orchestrator has claimed for that task
   *and* listed in the brief. They never take locks, merge or push to the default branch.
6. **The orchestrator owns the result.** It checks the subagent's work before any HANDOFF, and credits it in the
   message, e.g. "built by Claude-Builder (Sonnet), checked by Opus".
7. **If a model isn't available** in your app, use the closest smaller model with the same role, and say so in
   MESSAGES. If your app can't run subagents at all (e.g. the Gemini app in Setup B), work without them.

### Subagent roles (fixed, unless the PM changes them in BOARD → Team)

**Claude-Builder (Sonnet): implements well-defined pieces**
- *Use for:* coding one task, or one clearly bounded part of a task, that is already fully specified in PLAN.md
  and has an exact file list.
- *Must:* stay inside the listed files, follow PLAN decisions, add or adjust tests for its change, run the tests and report the real
  result.
- *Must not:* change architecture or public interfaces not named in the brief, add dependencies, touch shared
  files, or rewrite code beyond the brief's scope.
- *Returns:* the files changed, a 3–6 line summary, the test command and result, and anything it is unsure about.

**Claude-Scout (Haiku): read-only helper**
- *Use for:* searching the codebase, collecting facts and references, running tests, linters and builds and summarizing the
  output, checking that the files touched match the claims in PLAN/BOARD, and drafting plain-English BOARD text
  for Opus to approve.
- *Must:* only read and run commands. It never edits a tracked file.
- *Must not:* make decisions, propose architecture, or edit anything.
- *Returns:* facts with file paths and line numbers, the exact command output (trimmed), and any mismatches it found.

**Gemini-Tester (Hydrogen): writes tests and checks results**
- *Use for:* turning a task's "Done when" line into tests before it's built (required for Thorough and Maximum
  tasks), running the test suite, and checking a task against its acceptance criteria during review.
- *Must:* only edit test files that Gemini has claimed, test behaviour rather than implementation details, and report
  the real pass/fail counts.
- *Must not:* edit product code, weaken or delete existing tests without Neon's say-so, or judge code style.
- *Returns:* the test files written, what each test proves, the command and result, and any criteria it couldn't test.

**What stays with the orchestrators:** the debate, the plan, architecture, hard or cross-cutting code, reviews of the
other team's work, every BOARD/MESSAGES/PLAN edit, and all decisions.

---

## 4. The files

```
COLLAB.md                    this rulebook (location chosen by Claude in section 0)
CLAUDE.md, AGENTS.md         a pointer line: "Follow <path>/COLLAB.md."
.colab/BRIEF.md              the PM's project prompt, word for word. Nobody's ideas go here.
.colab/BOARD.md              the PM's dashboard: team, phase, tasks, locks, decisions needed. Plain English.
.colab/MESSAGES.md           append-only message log between the orchestrators (and the PM)
.colab/debate/1-claude.md    Round 1, blind brainstorm
.colab/debate/1-gemini.md
.colab/debate/2-claude.md    Round 2, cross-critique
.colab/debate/2-gemini.md
.colab/debate/3-review.md    Round 3, the other AI's verdict on the draft plan
.colab/PLAN.md               the agreed plan: decisions, milestones, task list with owners and claimed files
```

---

## 5. Phase 0: setup (Claude, first session)

1. Do section 0 (file COLLAB.md and add the pointer lines), if you haven't already.
2. Create `.colab/BRIEF.md` containing the PM's brief **word for word** under the heading `# Brief`. Add nothing else.
3. Create `.colab/BOARD.md` from the template in section 12, with phase = *Round 1 – blind brainstorm*.
4. Create `.colab/MESSAGES.md` with the header from section 12.
5. Commit **only these files** and push to the default branch: `colab: phase 0 setup`. If you're not allowed to push
   to the default branch (for example, Claude Code on the web works on its own branch), push to your branch and tell the
   human to merge it before starting Gemini.
6. Do **not** write code, scaffold the project, install anything, start subagents or create a plan. Phase 0 + Round 1
   is all you do.

## 6. Round 1: blind brainstorm (both orchestrators, separately)

The point is two independent opinions. Neither AI may anchor on the other's ideas.

- **Read only** `COLLAB.md` and `.colab/BRIEF.md` (and any code that existed before Phase 0). If BRIEF.md is
  missing, ask the human to merge Claude's Phase 0 branch or paste the brief to you. Don't guess the brief.
- **Do not open** anything in `.colab/debate/` written by the other AI, or any branch named `colab/sealed-*`.
  If you see the other AI's Round 1 by accident, say so in your file and in MESSAGES.md.
- Write your file using the Round 1 template in section 12, **350–700 words**. Write it yourself, as the orchestrator.

**Keeping it blind:**
- **Claude** writes `.colab/debate/1-claude.md` and commits it **locally, without pushing to the default branch**.
  If the session may end before Gemini finishes (Claude Code on the web can be reclaimed), push it to the branch
  `colab/sealed-claude`, never to the default branch. Then stop and tell the human to run Gemini's Round 1.
- **Gemini** writes `.colab/debate/1-gemini.md`: in Setup A, commit and push it to the default branch.
  In Setup B, output it as a FILE block for the human to relay.
- **Unsealing (Claude):** once Gemini's Round 1 is in the repo (or pasted to you), push/merge your own Round 1 file
  unchanged, then save Gemini's. Your Round 1 must not change after you have seen Gemini's. Update BOARD phase to
  *Round 2*.

## 7. Round 2: cross-critique (both orchestrators)

- Now read the other AI's Round 1. Write `.colab/debate/2-<you>.md` from the template, **max 400 words**.
- Be adversarial and useful. Say which of their ideas beat yours, what is bloat, what is risky, and where you disagree.
- End with your **proposed split of work**, i.e. which areas or files your team wants to own and why. Claim areas where
  your team is stronger, not just the fun parts, and say which parts you would hand to your subagents.
- Order doesn't matter. When both Round 2 files exist, Claude sets the phase to *Round 3*.

## 8. Round 3: convergence → PLAN.md

1. **The Lead drafts** `.colab/PLAN.md` from the template (Lead = Claude by default; see BOARD → Team). Combine the
   best of both Round 1 files and settle the Round 2 disagreements. Every task gets an owner team, **claimed
   files/folders**, a reviewer (the other team), an effort level, a *done when* line that can be tested, and, if a
   subagent will do it, *which* subagent.
2. **The other AI reviews** and writes `.colab/debate/3-review.md`: either `VERDICT: AGREE`, or
   `VERDICT: CHANGES` followed by up to 5 numbered objections, each with a concrete fix.
3. The Lead updates the plan. **There are at most 2 review cycles.** Anything still disagreed goes into BOARD →
   *Needs PM* as two short positions (max 3 lines each) plus a recommendation.
4. Phase becomes *Waiting for PM approval*. **Nobody writes product code until the PM approves the plan.** The PM approves
   by telling either AI "plan approved" (or by writing it in BOARD). The AI that hears it records it in BOARD and
   MESSAGES.

## 9. Building: claiming, working, handing off

**Every session follows the same routine:**
1. Pull the latest default branch. Read `COLLAB.md`, `.colab/BOARD.md` (Team, PM overrides, Tasks, Locks) and
   `.colab/MESSAGES.md` from your last message onward.
2. Answer anything addressed to you first. Then take the next task that is yours and unblocked.
3. At the end: update BOARD, append to MESSAGES, push, and write the **next-step line** (section 10).

**Claiming:**
- Before touching a task, mark it in BOARD as `🔨 <team>` (or `🔨 <team> · <subagent>`) and push that change on its
  own: `colab: claim T3`. The first claim on the default branch wins. If yours collides, pull, see who won and pick
  another task.
- A team may only edit **files it owns** (listed in PLAN for its tasks). To change the other team's file, post a
  `REQUEST` message and wait, or work around it.
- **Shared files** (package manifests, lockfiles, CI config, global styles, DB schema, anything not owned) need a lock.
  Only an orchestrator takes one. Add a row to BOARD → *Locks*, push it, make the change, then remove the row in the
  same push as the change. Never hold a lock across sessions.

**Working:**
- One branch per task: `claude/T3-short-name` or `gemini/T3-short-name`. Open a PR if you can. In Setup B, Claude
  opens PRs for Gemini's relayed work.
- Before handing work to a subagent, write its brief (section 12) and keep it in the task's PR description or in your
  message, so the PM can see what was delegated.
- **Tests are the judge.** If you can run the tests, run them and paste the real result (pass/fail counts) into your
  message. Never say tests passed unless you ran them. If you can't run them, say "not run".
- For *Thorough* and *Maximum* tasks, the tests are written **first**, preferably by the other team (Gemini-Tester
  for Claude's tasks), and the builder doesn't weaken them. If a test is wrong, post a `REQUEST` to its author.

**Handing off:**
- Done building → status `👀 review: <other team>`, and a `HANDOFF` message with the branch/PR, what changed,
  who did it (orchestrator or which subagent), the test result and anything you're unsure about.
- The reviewing orchestrator writes `REVIEW` with `VERDICT: APPROVE` or `VERDICT: CHANGES` (numbered, concrete).
  Its subagent may run checks, but the verdict is the orchestrator's. Review rounds are capped by effort (section 11).
  When the cap is reached, the task moves to *Needs PM*.
- After `APPROVE`: status `✅ ready for PM` and a one-sentence plain-English summary in BOARD. **Only the PM merges
  to the default branch**, or an AI does it after the PM says "merge T3".

**New ideas mid-project:** don't just build them. Add them to BOARD → *Ideas* (one line each). The PM decides.

## 10. Messages and the next-step line

Only orchestrators write messages. Append to `.colab/MESSAGES.md`, numbered in sequence, and never edit or delete old entries:

```
### M12 · Claude → Gemini · T3 · HANDOFF
Built the signup form on claude/T3-signup (PR #4) – Claude-Builder (Sonnet), checked by Opus.
Tests: 14 passed, 0 failed. Unsure about: password rules, please check against PLAN decision D2.
```

The types are `IDEA`, `REQUEST`, `HANDOFF`, `REVIEW`, `DECISION`, `QUESTION-PM` and `NOTE`. Keep messages short and link
to files instead of pasting large content.

**End every session** with the next-step line in chat, so the human knows whom to wake and what to paste. Use the real
path of COLLAB.md:

```
NEXT → Gemini: "Read COLLAB.md and follow it. You are Gemini. Continue." (review T3)
```

If nothing can move without the PM, write `NEXT → PM:` plus the question in plain English.

## 11. Effort levels and roles

The PM sets these in BOARD. Each task uses its own effort level, or the owner's default if it doesn't have one.

| Effort | What it means | Debate | Tests | Review rounds | Subagents |
|---|---|---|---|---|---|
| **Quick** | Smallest change that works. No new dependencies. | Round 1 only, 200 words | if they already exist | 1 | Builder/Scout OK |
| **Normal** | Sensible design, risks stated. | All 3 rounds | for new logic | 2 | OK for specified tasks |
| **Thorough** | Edge cases, security, failure modes. | All 3 rounds | written first | 3 | Orchestrator reviews every subagent diff line by line |
| **Maximum** | Exhaustive. Alternatives compared in writing. | All 3 rounds + PM approves each milestone | written first, by the other team | 4 | Scout and Tester only. The orchestrator writes the product code itself |

Effort here means how carefully each team works, enforced by these rules. The model's own thinking setting is chosen
by the human in each app.

**Default roles** (the PM can change them in BOARD → Team, and agents must follow the current Team table):
- **Claude Opus**: Lead orchestrator. Drafts the plan, keeps BOARD tidy, builds the hard parts.
- **Gemini Neon**: Co-orchestrator. Challenges the plan, reviews, owns test strategy, builds.
- Subagents: as in section 3.
- Available roles: *Lead, Co-lead, Builder, Tester, Reviewer, Researcher, Designer, Docs*. The PM may reassign them to
  orchestrators or subagents, but can't give a subagent a "never" item from section 3 without writing it in *PM overrides*.

**Hard limits (all efforts):**
- No more than 3 back-and-forth messages on one disagreement. Then go to *Needs PM*.
- Don't redo or rewrite the other team's finished work without a `REQUEST` that they accept, or a PM decision.
- Never go above the subagent limits in section 3.
- Never store API keys, passwords or tokens in the repo, and never ask the PM for them in a file.
- Never automate, script or drive the other AI or its app. A human starts every session.

## 12. Templates

**`.colab/BOARD.md`** (keep the PM-facing parts in plain English, with no jargon)
```markdown
# Project board
**Phase:** Round 1 – blind brainstorm
**Whose turn:** Gemini – blind brainstorm
**Updated by:** Claude, after M1

## Needs PM
- (nothing yet)

## Team
| Member | Model | Roles | Default effort | Notes from PM |
|---|---|---|---|---|
| Claude (orchestrator) | Opus | Lead, Builder, Reviewer | Normal | |
| Claude-Builder | Sonnet | Builder (specified tasks only) | – | |
| Claude-Scout | Haiku | Read-only research, test runs, checks | – | |
| Gemini (orchestrator) | Neon | Co-lead, Reviewer, Builder | Normal | |
| Gemini-Tester | Hydrogen | Writes and runs tests | – | |

## PM overrides
- (rules the PM changed for this project)

## Tasks
| ID | Task (plain English) | Team · who | Status | Effort | Reviewer |
|---|---|---|---|---|---|
<!-- Status values: ⏳ waiting · 🔨 <team> building · 👀 review: <team> · 🔁 fixing · ✅ ready for PM · 🟢 merged · ⏸ paused -->

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
## Where my team would be strongest   (which parts we should own; which go to subagents)
```

**Round 2: `.colab/debate/2-<you>.md`**
```markdown
# Round 2 – <you> critiques <other>
## Their ideas that beat mine
## Bloat / cut list
## Risks they missed
## Disagreements           (numbered, each with my proposed resolution)
## Proposed split of work  (who owns which areas/files, which subagent does what, and why)
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
| ID | Task | Team · who (orchestrator/subagent) | Claimed files/folders | Depends on | Effort | Done when (testable) | Reviewer |
|---|---|---|---|---|---|---|---|
## Shared files (need a lock)
## Open questions for PM
```

**Subagent brief** (the orchestrator fills this in for every spawn; there's no spawn without one)
```markdown
SUBAGENT: Claude-Builder (Sonnet) | Claude-Scout (Haiku) | Gemini-Tester (Hydrogen)
TASK: T<n> – <one-line goal>
CONTEXT: <2–5 lines: what exists, which PLAN decisions apply (D#)>
YOU MAY EDIT: <exact files/folders, or "nothing (read-only)">
YOU MAY READ: <files/folders>
DO NOT: touch shared files, add dependencies, change interfaces not listed, edit .colab/*, talk to the other team
DONE WHEN: <testable criteria, copied from PLAN>
REPORT BACK: files changed · 3–6 line summary · test command + real result · open doubts
```
