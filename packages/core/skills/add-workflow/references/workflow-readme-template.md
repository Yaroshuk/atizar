# Workflow README template

Co-located at `workflows/<id>/README.md`. Fill in each section; strip the guidance comments before
committing. All five sections are required — this file is the single source of truth for "what is
this workflow and how do I run it."

---

# <Label> workflow

<!-- One sentence: what this workflow automates and what it decides or produces. -->
<!-- Example: "Reads the unread inbox, sorts each email, and drafts replies for human approval." -->

**What it does:** <one line>

---

## Agents & roles

| Agent | Role | Description |
|---|---|---|
| `<agent-id>` | Input (startable) | <What it does: reads source, qualifies, dispatches> |
| `<agent-id>` | Worker | <What it does: handles one item dispatched by the input> |

<!-- Mark exactly one agent as "Input (startable)" — it is the agent the human STARTs. -->
<!-- All others are workers spawned by dispatch. -->

---

## How to run

1. Start `yarn dev` (or `npm run dev`) from the project root.
2. Open `http://localhost:5173`.
3. Find the **<Label>** workflow in the left column.
4. Click **Start** on the **<Input agent name>** agent.
5. The agent runs; dispatched workers appear in the pipeline column as they are spawned.
6. Open a worker to see its card and the approval gate.

<!-- Describe any trigger condition, e.g. "Gmail must have unread mail in the last 24 hours." -->

---

## Credentials / integrations

| Service | Env var | Where to get it |
|---|---|---|
| <Service name> | `ATIZAR_<SERVICE>_TOKEN` | <Link or instructions> |

<!-- List every ATIZAR_* env var the workflow reads. Copy the var names from server.ts effects. -->
<!-- Seed your .env.example with these vars and a comment. -->

---

## Gates (human approval points)

| Gate | What the human approves | Effect when approved |
|---|---|---|
| `<tool-name>` | <What the human sees and confirms> | <What the server executes: API call, write, etc.> |

<!-- List every approval tool (from defineAgent.approvals). -->
<!-- "Effect when approved" is what ServerBinding.effects[toolName] does. -->
<!-- If there is no gate (no approval tool), remove this section. -->
