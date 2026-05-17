# Next Card

Next Card turns a one-sentence goal, written plan, attachment, notification, or
image timetable into an AI-planned task card deck. The user picks one of three
execution plans, then completes decomposed action cards through a swipe-driven
deck. Completion, freeze, burn, reschedule, and reward events get written into
a proof log so the work becomes visible evidence.

It runs as a Next.js (App Router) web app, sized like a single mobile WebView
so it can later be wrapped into an Android APK without re-doing layout.

## Run

```bash
pnpm install
pnpm dev          # http://127.0.0.1:3000
pnpm lint
pnpm build        # full Next.js build (server routes included, see below)
```

> Note: `pnpm build` produces a normal Next.js production build with API
> routes. There is no `output: "export"` and no `out/` directory. If you need
> a static bundle for an Android APK that only loads HTML/JS, you must add
> `output: "export"` to `next.config.mjs` and remove the API routes (or stub
> them out). The current build assumes a Node.js host.

### Optional environment variables

The app degrades gracefully when these are missing — chat falls back to a
local mock planner, push falls back to no-op, calendar writes to a temp dir.

```text
# Chat / planning
DEEPSEEK_API_KEY            # if set, /api/chat tries DeepSeek first
DEEPSEEK_BASE_URL           # defaults to https://api.deepseek.com
DEEPSEEK_MODEL              # defaults to deepseek-chat
NEXT_CARD_CHAT_PROVIDER     # "deepseek" | "mimo" (default mimo)

MIMO_API_KEY / MIMO_BASE_URL / MIMO_MODEL  # optional Mimo backend
                            # When unset, the local plan-mode service is used.

# Web Push (Agent 2 reminders)
NEXT_CARD_PUSH_VAPID_SUBJECT       # mailto: or https:// URL
NEXT_CARD_PUSH_VAPID_PUBLIC_KEY
NEXT_CARD_PUSH_VAPID_PRIVATE_KEY
NEXT_CARD_PUSH_TTL_SECONDS         # default 3600
NEXT_CARD_PUSH_SUBSCRIPTIONS_FILE  # JSON file path; default tmpdir

# Queue snapshot persistence
NEXT_CARD_QUEUE_REPOSITORY  # "memory" or default JSON file
NEXT_CARD_QUEUE_FILE        # JSON file path; default tmpdir

# ICS calendar export
NEXT_CARD_CALENDAR_DIR
NEXT_CARD_CALENDAR_NAME
NEXT_CARD_CALENDAR_PRODUCT_ID
NEXT_CARD_CALENDAR_DEFAULT_DURATION_MINUTES   # default 25

NEXT_PUBLIC_APP_URL                # used in push payload `url`
```

If you run with none of these set, the app still works end to end against the
local mock planner and skips push/calendar dispatch.

## Stack

- Next.js 15 App Router (Node runtime for API routes)
- TypeScript
- Tailwind CSS
- Zustand + `localStorage` persist (schema v4)
- Framer Motion + lucide-react
- `web-push` (VAPID) and `ics` (calendar export)

## Mobile WebView Target

The UI is sized for a single mobile WebView frame. Desktop browsers see a
centered ~430px preview. There are no desktop two-column layouts and no
desktop-only breakpoints.

```text
lib/webview-contract.ts    # WebView shape contract
```

Android wrapper requirements when packaging:

```kotlin
webView.settings.javaScriptEnabled = true
webView.settings.domStorageEnabled = true   // Zustand persist needs this
webView.settings.loadWithOverviewMode = true
webView.settings.useWideViewPort = true
```

The current Next.js build is **not** a static export. To ship the WebView as
local APK assets you have two options:

1. Point the WebView at a hosted Next.js deployment (HTTPS).
2. Add `output: "export"` and stub `app/api/**` routes — chat/import/push are
   server-only by design.

## Modes

The app exposes three primary modes — `input / deck / proof` — and nothing
else. Mode switching is in `app/page.tsx` and `components/TopModeTabs.tsx`.
Don't add a fourth mode without revisiting the product contract in
`AGENTS.md`.

### input

ChatGPT-style composer that accepts text, document attachments, and image
timetables. The flow is **understand → ask → plan**, in that order:

- AI replies in `thinking` (gathering) → `asking` (one-question clarify with
  three options + "按默认理解直接生成方案") → `generating` → `ready` (three
  execution plans + 否，重新生成).
- Plans are not emitted while the AI is still in `asking`. Users see the
  question first, not the plans.
- The clarification turn budget is a single source of truth in
  `lib/ai-prompts.ts` (`CLARIFICATION_TURN_BUDGET = 5`); both the `/api/chat`
  / `/api/ai/clarify` server entries and the frontend store enforce the same
  cap.
- "否，重新生成" actually rerolls plan content via `mockRegeneratePlanOptions`
  on the server (`regenerate: true` is forwarded into `/api/chat`), instead
  of returning identical labels.

### deck

Reigns-style single-card execution surface.

- Generated decks appear as covers; opening one reveals one card at a time.
- Cards display title, action, estimated minutes, deadline / suggested-start
  window, urgency stage, and a time rail on the card itself.
- Interactions: double-click → start timing (with sparks + WebAudio fallback);
  triple-click → quick burning mode; left/right swipe or button → complete;
  down swipe → status bar; deeper down swipe → freeze prompt.
- Freezing a card writes a `FrozenTaskEntry` (Agent 2 picks it up — see
  below).

### proof

Visible evidence dashboard.

- Stat cards, colored action table, completion ring, charts.
- Blog-style flow journal with chronological entries.
- AI-generated summary document.
- Records come from plan selection, timing, completion, freezing, burning,
  reward generation, and freeze-return reminders.

## Two AI Agents

The system has two agents with clear boundaries.

### Agent 1 — Clarification / requirement capture

Takes raw user input and turns it into a structured target the planner can
build cards from. Lives in:

```text
app/api/chat/route.ts
app/api/ai/clarify/route.ts
lib/server/plan-mode-service.ts
lib/server/compat-ai-service.ts
components/input/InputComposer.tsx (ChatPanel / ClarifyingPanel / GeneratingPanel / PlanChoicePanel)
store/useNextCardStore.ts (requestAiTurn, clarifyingQuestion, plans)
```

Responsibilities:

- Detect missing information (`missingInformation`) before building.
- Drive the four-phase loop above.
- Honor the 5-round budget; force `ready` once it's exhausted.
- Provider order: `NEXT_CARD_CHAT_PROVIDER` → DeepSeek (if `DEEPSEEK_API_KEY`
  is set) → Mimo (if configured) → local fallback.

### Agent 2 — Time scheduling and push

Owns the entire "what should fire when, and how do we tell the user" surface.
Sub-modules:

- **Freeze-return reminders** — when a user freezes a card, compute
  `returnAfter` (deadline-30min → suggestedStart → now+90min) and remind them
  to come back. `components/FreezeReturnScheduler.tsx` is the client-side
  driver: it (re-)registers a `setTimeout` per pending entry on every store
  change, calls `triggerFreezeReturn` at the deadline, and POSTs a
  `dispatch: true` worker tick so Web Push fires too.
- **Priority sorting** — `lib/server/priority-engine.ts` +
  `lib/server/schedule-planner.ts`. Reads behavior vector / deadline / time
  locks / freeze age and produces `QueueAction[]`.
- **Reminder & calendar sync** — when the user opts in (`reminderSync` /
  `calendarSync` set to `wanted` or `synced`), the planner produces
  `create-reminder` / `create-calendar-event` actions. Pure urgency-driven
  reminders without an opt-in are flagged `requiresUserReview: true` so
  `lib/server/provider-dispatch.ts` skips them instead of silently pushing.
- **Hidden goal reveal** — hidden future tasks only surface as
  `reveal-hidden-goal` actions when their priority crosses a threshold, and
  always with `requiresUserReview: true`.
- **ICS export** — `lib/server/providers/ics-calendar-provider.ts`.

Files:

```text
lib/server/agent-runtime.ts            # skill registry + runtime guard
lib/server/backend-worker.ts           # worker tick orchestration
lib/server/schedule-planner.ts
lib/server/priority-engine.ts
lib/server/freeze-return-agent.ts
lib/server/freeze-sweep.ts
lib/server/schedule-agent.ts           # AgentScheduleAction compat surface
lib/server/provider-dispatch.ts
lib/server/providers/web-push-notification-provider.ts
lib/server/providers/ics-calendar-provider.ts
components/FreezeReturnScheduler.tsx   # client-side timer driver
```

Safety properties enforced:

- `worker tick` route accepts client snapshots in **preview mode** by default
  (`persist: false`, `dispatch: false`). It will not overwrite the server
  queue snapshot or push to subscribers unless the caller explicitly opts in.
- `provider-dispatch` skips any action with `requiresUserReview: true`.
- `applyAgentRuntimeGuard` (in `agent-runtime.ts`) filters QueueAction kinds
  against the trigger's allowlist — e.g. a `worker-tick` cannot mint a
  `reveal-hidden-goal` that bypasses review.
- Hard time locks (`canAgentMove: false`) only generate suggestions, never
  silent moves.

## API Routes

```text
POST /api/chat                       # streamed-style structured chat (DeepSeek/Mimo/local)
POST /api/ai/clarify                 # one-shot clarification turn
POST /api/ai/parse                   # multimodal import parser
POST /api/ai/plan                    # compat planning bundle (analysis + 3 plans + deck + flow)
POST /api/agent/schedule             # validate AgentScheduleAction, return QueueAction
POST /api/backend/worker/tick        # run priority engine + freeze sweep (preview by default)
POST /api/backend/freeze/return      # analyzeFrozenTaskReturn for one entry
POST /api/backend/schedule/plan      # standalone schedule plan
GET  /api/backend/push/public-key    # VAPID public key (or `configured: false`)
POST /api/backend/push/subscriptions # register a Web Push subscription
POST /api/backend/push/send          # dispatch a single QueueAction
POST /api/backend/import/review      # large-import review gate
POST /api/backend/calendar/events    # ICS calendar event create/update
GET  /api/backend/health             # health probe
POST /api/backend/proof/export       # proof export
POST /api/proof/export               # proof export (legacy alias)
POST /api/backend/plan-mode          # plan-mode pass-through
```

## State and Types

Shared types: `lib/types.ts`. Zustand store: `store/useNextCardStore.ts`.

The store owns: `mode`, `inputs`, `analysis`, `plans`, `taskFlow`, `deck`
(including the `frozenTasks` ledger), `proofs`, plus the chat/clarify state
machine.

Persistence schema is at version 4. v3 → v4 migration backfills
`deck.frozenTasks: []` so old localStorage state still loads.

When adding a feature, prefer adding a named store action over mutating
nested state inside a UI component.

## Mock AI

Local fallbacks live in `lib/mock-ai.ts`:

```text
mockAnalyzeInput
mockGeneratePlanOptions
mockRegeneratePlanOptions
mockGenerateClarifyingQuestion
mockGenerateThinkingSteps
mockGenerateTaskFlow
mockGenerateDeckFromPlan
mockGenerateTimePlanForCard
mockUpdateCardUrgency
mockRescheduleFrozenCard
mockGenerateProofSummary
```

These remain deterministic and feed both the offline path and the always-three
plan slots in the API responses, so the UI never sees fewer than three plans.

## Suggested Next PRs

1. Wire a real Service Worker registration so Web Push actually delivers in
   the browser (the server side is wired; the client subscribe step is not).
2. Add a periodic server-side worker tick (Vercel cron or a small Node
   scheduler) so freeze returns and urgency thresholds fire even when the
   tab is closed.
3. Persist `agentDecision`/`requiresUserReview` actions to a real review
   queue surface in `proof` so users can approve queued reminders.
4. On-device WebView tuning: drag thresholds, double/triple-click, WebAudio,
   safe-area, native back button.

## Known Worktree Notes

- `proof-03.html` is a static design reference, not part of the build.
- The repository previously contained an `archive/` folder from prototype
  cleanup; ignore unless the owner asks.

## License

MIT
