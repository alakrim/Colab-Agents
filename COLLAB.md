# COLLAB.md: two AIs, one repo

> **For the human:** attach this file to Claude Code in a new repo, together with your project idea (prompt below).
> Claude files it in the repo and starts.

Claude and Gemini never talk to each other directly. They talk through files in `.colab/`.
A human starts every session. Neither AI starts or drives the other.
**Both AIs: read this file at the start of every session and follow it.**

## 0. Claude: when this file is attached
Save it in the repo unchanged, in the root (or wherever the repo already keeps its docs). Add the line
`Follow COLLAB.md.` to `CLAUDE.md` and `AGENTS.md` (create them if missing, keep existing content).
Use the real path in the prompts you give the human. Then do Round 1 and nothing else.

## 1. Prompts

**Step 1: Claude Code, in the new repo, with this file attached**
```
I've attached COLLAB.md. Save it in this repo, then follow it. You are Claude. Do Round 1 only.
Project idea:
<your idea>
```

**Step 2: Gemini, with the repo linked**
```
Read COLLAB.md in this repo and follow it. You are Gemini. Do Round 1.
```

**After that,** each AI ends its turn with a line telling you who goes next:
```
NEXT → Gemini: "Read COLLAB.md and follow it. You are Gemini. Continue."
```

## 2. Teams (hard caps)

| Team | Orchestrator and director | Subagents (never more than this) |
|---|---|---|
| **Claude** | Opus 5.5 | 1 Sonnet + 1 Haiku |
| **Gemini** | Neon | 1 Hydrogen |

Using fewer is fine. Only the orchestrator starts subagents, each with a specific role and written instructions.
Subagents don't edit `.colab/` files or talk to the other team; the orchestrator checks their work.

## 3. The debate (three rounds, then build)

**Round 1: blind brainstorm.** Read only the project idea. Don't open the other AI's files.
Write `.colab/1-<you>.md` (max 700 words): what the project really needs, technologies, architecture,
AAA polish ideas, risks, and what you'd like to own.
- **Claude** commits its file locally and does **not** push it to the default branch. If the session might end,
  push it to the branch `colab/sealed-claude` instead. Then stop and tell the human to wake Gemini.
- **Gemini** writes its file and pushes it.
- Once Gemini's Round 1 exists, Claude publishes its own, unchanged. Neither Round 1 may change after the other has been seen.

**Round 2: cross-critique and shortcut research.**
- Read the other AI's Round 1. Write `.colab/2-<you>.md` (max 400 words): what beat your ideas, what to cut,
  where you disagree.
- **Gemini starts its Hydrogen subagent** to research shortcuts for the whole project, based on both Round 1 files:
  free or open-source libraries, templates, APIs, datasets, and anything that can be taken from online sources
  instead of built from scratch. For each find: what it is, link, licence, what it saves, and the risk
  (maintenance, size, security). Hydrogen only researches and writes `.colab/2-research.md`; Neon checks it.
  If Hydrogen isn't available, Neon does the research.

**Round 3: conclusion.** Debate the research and settle everything in `.colab/PLAN.md`:
technologies, what to reuse and what to build, the AAA polish ideas kept, and a TODO list. Each TODO has a title,
the files/folders it touches, and a testable "done when".
- Claude drafts the plan from both Round 2 files and the research. Gemini replies in `.colab/3-review.md` with
  `AGREE`, or up to 5 numbered objections with fixes. At most 2 rounds of this.
- Anything still disputed goes to the human, as both positions (3 lines each) plus a recommendation.
- When both agree, building starts. The human can stop or change anything at any time.

## 4. Claiming files (so you never collide)

Claims live in `.colab/CLAIMS.md`:
```
| Task | Files / folders | Who | Status |
|------|-----------------|-----|--------|
```
After the TODO list exists, Claude claims some tasks and Gemini claims others. Before touching anything:
1. Pull the latest default branch and check `CLAIMS.md` for overlap.
2. Add your row (task, files, who, 🔨 working) and **push that change alone, immediately**: `colab: claim T3`.
3. If the push is rejected, someone claimed first. Pull, re-check, and pick something else.
4. Only edit files you claimed. If you need a file someone else holds, add a note under the table and work on
   something else until it's released.
5. Work on your own branch (`claude/<task>` or `gemini/<task>`). When the task is done and tests pass, merge it,
   then clear your row (✅ done, files released) and push **immediately**. Never hold claims across sessions.

Shared files (package manifests, lockfiles, config) are claimed like any other file, briefly.
Tell the human what you did and what's next, and end with the `NEXT →` line.

## 5. If Gemini can't write to the repo

Gemini outputs every file in a code block headed `FILE: <path>` and tells the human to paste it into Claude Code.
Claude saves it exactly as given and commits it with `(written by Gemini, relayed)`. Gemini never claims it saved
something it didn't. Claude makes the claim pushes for Gemini's tasks.

## 6. Hard rules
- Never more subagents than the caps in section 2.
- Never put API keys, passwords or tokens in the repo.
- Never script or drive the other AI or its app.
- Never say tests passed unless you ran them. Quote the real result.
