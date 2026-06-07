# Consumer Desktop re-skin — Smedja design system

_Spec · 2026-06-07 · branch `feat/consumer-desktop-reskin`_

## Goal

Apply the **Smedja design system** (exported from Claude Design as a handoff bundle)
to the existing consumer desktop in `apps/inbox/client`, and restructure the desktop
into the **two-panel layout** the user confirmed against a reference screenshot.

This is a **re-skin + layout** change. All CopilotKit / AG-UI functional machinery
(runs, handoff, human-in-the-loop, status derivation) stays exactly as-is.

## In scope

1. **Design tokens → `styles.css`.** Port the design's `:root` token set (background
   `#f5f5f7`, surface `#fff`, text `#111`, muted `#888`, teal `#00aa77`/`#0a7`, amber
   `#fffbe6`/`#f0c000`, radii 8/12/16/22, soft card/pop/modal shadows, system-ui font)
   plus the component classes used below. The current ad-hoc inline styles are replaced
   by these classes.

2. **Re-skin the 5 existing components** (markup + classes only — no logic change):
   - `AgentCard` → `.agent-card`: icon tile, name (uppercase, tracked), status pill with
     colored dot (pulsing ring while `running`/`awaiting_approval`), subtitle, dark
     `START` button. While `running`, the button is replaced by a `✦ Running… tap to
     view` footer (per the reference screenshot).
   - `AgentModal` → `.backdrop`/`.modal`/`.modal-head` (icon glyph + title + live status)
     + `.thread`; assistant text renders as a `.bubble` next to an `.agent-glyph`.
   - `LeadCard` → `.lead-card` (envelope tile, from, bold subject, teal `.pill`).
   - `VerdictCard` → `.lead-card` + category/priority `.pill`s + a teal-on-dark
     `Draft reply` button.
   - `ApprovalDialog` → `.approval` (amber card: badge, kicker, question, preview box,
     teal `Save draft`).

3. **Two-panel layout** in `InboxView.tsx` (replaces the current flat flex of two cards):
   - `.workspace-body` = a left **Pipeline** panel + a right **Your agents** panel.
   - Both panels share the **same thin `.comp-head`** (icon + uppercase title) — the
     "same style, each with a thin header" requirement.
   - The right header carries the status **legend** (Idle / Running·done / Awaiting
     approval).
   - **`PipelineColumn`** (new component): mini agent cards **tinted by live status**
     (`.mini.run` green, `.mini.await` amber, `.mini.err` red), connected top-to-bottom
     by a handoff arrow (`def.handoffs`: qualifier → reply). A **tint legend** pins to
     the panel foot. **Only agents that are actually launched (status ≠ `idle`) appear**;
     when none are active, a placeholder line shows instead.

4. **Icons.** One `Icon` component (own file) + an internal `Record<IconName, ReactNode>`
   of thin line SVGs — honors the strict one-component-per-file rule (no icon-component
   sprawl).

## Out of scope (explicitly dropped by the user)

Left icon rail / sidebar, global top bar, Manager/Admin toggle, account menu,
notifications dropdown, admin agent-settings modal, Leads table screen, run history.
These exist in the design bundle but are not wanted now.

## Logic worth a test

Most of this is cosmetic. The one piece with real behavior is the Pipeline filter +
order, extracted as a pure helper (`client/src/pipeline.ts`):

- `activePipeline(nodes)` — drop `idle` nodes, then order so a handoff **source precedes
  its target** (qualifier before reply). Tested: idle excluded; source-before-target
  ordering; single active node; empty when none active.

## Data flow

`InboxView` already holds both agents + their derived `Status` (`useAgentStatus`). It
passes each agent's `{ id, name, subtitle, iconName, status, handoffsTo }` to
`PipelineColumn` (which calls `activePipeline`) and the per-agent `subtitle`/`iconName`
to `AgentCard`. Subtitle + icon are supplied client-side per agent (core's `defineAgent`
passport is left untouched — adding a `subtitle`/`icon` field is deferred to the
framework phase).

## Verification

`yarn test` (incl. the new `pipeline` tests + existing render tests) + `yarn typecheck`
+ `yarn lint` + `yarn format:check`, then **browser E2E** at `:5173`: launch the
qualifier on a real Gmail lead, watch the pipeline mini-card light up green, hand off to
reply, see it tint amber + the modal thread (lead/verdict card + amber approval), approve.
