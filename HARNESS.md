# The Coding Harness

This repo has a five-layer local quality harness. Each layer catches a **different
class of mistake**, and they are ordered from cheapest/fastest feedback to most
expensive. The point isn't exhaustive coverage — it's that every change passes
through a short, understood gauntlet before it's trusted, and that when something
breaks you know which layer should have caught it.

Run the whole thing locally, in order, before trusting a change:

```bash
npm run format:check   # is it formatted?
npm run lint           # is it free of lint errors? (warnings are errors here)
npm run typecheck      # does it type-check under strict settings?
npm test               # do the tests pass?
```

`npm run format` fixes formatting; `npm run lint:fix` auto-fixes what ESLint can.

---

## Why these five layers, in this order

Each layer only has to catch what the layers below it can't. Formatting can't
know about types; types can't know about runtime behaviour; tests are where
behaviour is finally pinned. Ordering them cheapest-first means the fast checks
reject the obvious problems before you spend time on the slow ones.

### Layer 1 — Formatting (Prettier) + Linting (ESLint)

**What it catches:** style drift and a class of real bugs (unsafe effects,
missing hook deps, accessibility slips) that aren't type errors.

- **Prettier** owns formatting entirely. Config lives in `prettier.config.mjs`
  and is deliberately set to **match the code already in the repo** (single
  quotes, no semicolons, ~100 columns) so adopting it was a near-no-op diff, not
  a repo-wide rewrite. Formatting is not a matter of opinion once a formatter is
  in place — it's automated, so it stops being a thing anyone argues about or
  wastes review time on.
- **ESLint** uses the Next.js flat-config presets (`core-web-vitals` +
  `typescript`) as the base — the rules the framework authors consider correct
  for a Next app — plus `eslint-config-prettier` appended **last** to switch off
  any stylistic rules so ESLint and Prettier never fight over the same line.
- **Warnings are errors.** The `lint` script runs with `--max-warnings 0`. A
  warning that's allowed to linger is a warning everyone learns to scroll past;
  making the build fail on it forces a decision — fix it or consciously disable
  the rule with a reason. Nothing rots quietly in the yellow.

### Layer 2 — Strict TypeScript

**What it catches:** whole categories of runtime bug at compile time —
null/undefined access, implicit `any`, dead bindings after a refactor, and
functions that forget to return on one branch.

`tsconfig.json` already had `strict: true` (which bundles `noImplicitAny`,
`strictNullChecks`, and the rest of the type-soundness flags). The harness adds
three flags that `strict` deliberately leaves out because they're hygiene rather
than soundness — each is commented in `tsconfig.json` with the bug it catches:

- `noUnusedLocals` / `noUnusedParameters` — dead code and leftover bindings after
  a refactor (the classic "renamed the thing I use, the old one is now unused").
  Prefix an intentionally-unused parameter with `_` to opt out case-by-case.
- `noImplicitReturns` — a branch that forgets to return, so the caller silently
  gets `undefined`. A genuine runtime bug the other flags miss.

`npm run typecheck` runs `tsc --noEmit`. It's separate from `next build` on
purpose: you get the type verdict in a second or two without building the app.

### Layer 3 — Focused unit tests

**What it catches:** logic regressions in small, high-consequence functions —
the ones where a wrong answer is silent and the type checker is blind because the
input is untrusted (`unknown` off the wire) or the function is pure string-mangling.

This layer is deliberately **not** blanket coverage. Most of the extraction
pipeline was already well tested (see `__tests__/lib/extract-events.test.ts`).
The harness added tests only where a real gap existed:

- `__tests__/lib/confidence.test.ts` — `sanitizeLevel`, the seam where an
  untrusted model value becomes a confidence signal the UI presents as trust.
  The property that matters: invalid input defaults to `medium`, **never** the
  falsely reassuring `high`. One line, easy to break, invisible to the compiler.
- `__tests__/components/ScreenRouter.parseFrame.test.ts` — the client-side SSE
  frame parser. It was only covered indirectly by a slow, DOM-heavy full-flow
  test; pulling it out into direct unit tests means a parsing regression fails
  fast and points at the exact layer.

Both required exporting a previously-private function (`sanitizeLevel`,
`parseFrame`) — an export-only change, no logic touched. The principle: if a
piece of critical logic isn't reachable for a direct test, make it reachable
rather than testing around it through a heavier surface.

### Layer 4 — Integration tests over realistic inputs

**What it catches:** the pieces failing to **compose**, even when each unit
passes — the splitter and parser disagreeing, the mapper dropping the confidence
object, a formatting change breaking the cal-string.

`__tests__/integration/extraction-pipeline.test.ts` runs the whole pipeline —
delimiter split, JSON parse, mapping, confidence sanitisation — for real, mocking
only the Anthropic SDK **at its boundary** (the one seam where our code hands off
to someone else's). Given a realistic school message, it asserts the pipeline
returns well-shaped events with a valid confidence value on **every** item.

The inputs live in `__tests__/fixtures/school-messages.ts`, each pairing three
things: the **source letter** (the human-readable original), the **model
response** (what Claude would return, fed to the mock), and the **expected**
output (ground truth). This split is intentional groundwork for a follow-up **AI
eval harness**: swap the mock for a real API call, keep the same fixtures and
`expected`, and an integration test becomes an eval that scores live-model drift.
Clean fixtures and a clean pipeline entry point matter more here than test
cleverness — they're the reusable part.

### Layer 5 — The review discipline (this document)

**What it catches:** the harness itself rotting, or a change slipping past because
"it's just a small one." The other four layers are only as good as the habit of
running them.

The discipline:

1. Before trusting any change, run all four commands above, in order.
2. Warnings-as-errors and strict types mean the tools surface issues **up front**.
   When they do, the response is a deliberate decision — fix it, or disable the
   rule with a written reason — never a silent scroll-past.
3. New logic that a regression would break silently gets a focused test at the
   smallest unit that pins the contract. Untestable-in-place logic gets made
   testable (a minimal export), not tested around.
4. Fixtures are shared ground truth. Extend `__tests__/fixtures/` rather than
   inlining one-off sample data in a test.

---

## A note on CI (read this, it's the honest part)

The original intent was **no CI yet** — run the checks manually first, feel the
discipline, then automate. It turned out CI already existed
(`.github/workflows/test.yml` on push/PR, and `deploy.yml` gating the Vercel
deploy), so the harness's checks (`format:check`, `lint`, `typecheck`) were wired
into `test.yml` alongside the existing `npm test`, cheapest-first. CI now enforces
the same gauntlet you run locally.

**What warnings-as-errors caught, and how it was handled.** Turning on
`--max-warnings 0` immediately surfaced two pre-existing
`react-hooks/set-state-in-effect` errors the baseline had been ignoring — a good
illustration of Layer 1 earning its keep. The two were **not** the same kind of
problem, so they got two different responses (this is the discipline in action —
each error is a decision, not a reflex):

- `UploadZone.tsx` read a browser capability (`matchMedia`) with a
  `useEffect` + `setState`. That genuinely wanted React's
  `useSyncExternalStore` instead, which removes the pattern entirely, keeps the
  SSR value via a server snapshot, and stays live if the input mode changes. A
  **real fix**.
- `ScreenRouter.tsx` uses an effect to read the URL once after mount for a
  dev-only preview. That is the legitimate "synchronise with an external system"
  use of an effect — moving it into initial state is precisely what would cause a
  hydration mismatch. Here the rule over-fires, so it's a **scoped
  `eslint-disable` with a written reason**, not a contorted rewrite.

Deliberately **not** done, and why:

- **No pre-commit hooks yet.** Same reasoning as the original CI stance: running
  the checks by hand first builds the habit and the understanding. Hooks (e.g.
  husky + lint-staged) are the natural next step once the discipline is muscle
  memory or a second contributor joins.
- **Strict-type cleanup was not needed** — the three added flags surfaced zero
  errors, so nothing was deferred there.

## Next steps (recommended, not done)

- Add pre-commit hooks once the manual habit is established.
- Add the same `format:check` / `lint` / `typecheck` steps to `deploy.yml`.
- Build the AI eval harness on top of `__tests__/fixtures/` (see Layer 4). ← **done in phase two, below.**

---

# Phase two: AI evaluation harness

The coding harness above catches bugs in **our code**. It can't catch the model
getting worse. When you tweak the extraction prompt, or Anthropic ships a new
model, the code still type-checks and the mocked integration test still passes —
because the mock returns a canned answer. The thing that actually changed, the
live model's output, is exactly the thing the mock hides.

The eval closes that gap. It's the same idea as Layer 4 — same fixtures, same
`expected` ground truth — but it swaps the mocked SDK for the **real** API and
scores how far the live output drifts from ground truth.

```bash
npm run eval
```

## What it does

For each fixture in `__tests__/fixtures/school-messages.ts` it:

1. Sends the fixture's **`sourceLetter`** (the human-readable original) to the
   live Claude API via `extractEventsFromText` — a string-in entry point added
   for exactly this purpose (`lib/extract-events.ts`).
2. Structurally compares the result against the fixture's **`expected`** events
   with `compareExtraction` (`lib/eval/compare.ts`), producing a per-field diff
   and a 0–100 score.
3. Prints a per-fixture report and a summary to stdout.
4. Writes the raw results to `eval-results/{timestamp}.json`.

The output looks like this (abridged):

```
── multi-event-newsletter ───────────────────────────────
   A monthly newsletter with three events…
   event count: ✓ match
   event 0: ✓ title=exact timed=ok location=both-null | confidence[title=exact datetime=exact location=n/a]
   event 1: · title=exact timed=ok location=exact    | confidence[title=exact datetime=off-by-one location=exact]
   event 2: ✓ title=close timed=ok location=exact    | confidence[title=exact datetime=exact location=exact]
   score: 92/100
════════════════════════════════════════════════════════════════
SUMMARY   average score: 95/100   (3 scored, 0 errored)
  clean (100):  single-clear-event
  drifted:      multi-event-newsletter (92), ambiguous-low-confidence (94)
════════════════════════════════════════════════════════════════

Raw results written to …/eval-results/2026-07-16T12-00-00.000Z.json
```

## The design decisions, and why

- **Regression-focused, not baseline-focused.** The score is not the point — the
  _change_ in the score is. A single run tells you roughly how the current
  model+prompt does; two runs across a prompt edit or model bump tell you whether
  you made it better or worse. That's why every run is persisted to
  `eval-results/` as JSON: so runs can be diffed over time. Baseline scoring is a
  by-product of building a regression detector, not the goal.

- **Structural comparison, not model-graded.** We compare fields with a pure
  function (title exact/close/miss, timed-ness, location, per-field confidence)
  rather than asking a second model "how close are these?". A model grader is
  itself non-deterministic and can drift on its own, so a score change would no
  longer isolate _the extraction_ as the cause — the exact thing a regression
  eval must do. The pure function is deterministic, free, fast, and its verdict
  is inspectable line by line. The cost is that it only grades the dimensions we
  encode; that's an accepted, honest limit (see `lib/eval/compare.ts`).

- **Positional event matching, not fuzzy pairing.** Events are compared
  index-to-index. Clever nearest-match pairing would quietly re-align a dropped
  or reordered event and make the diff look healthier than reality. Positional
  keeps failures obvious: a wrong count or wrong order shows up as misses.

- **On-demand, not CI.** `npm run eval` is never wired into `npm test` or any
  workflow. It spends real API credits and is non-deterministic, so it does not
  belong on the fast, free, deterministic path every push runs. You run it
  deliberately, when you've changed the prompt or the model, and read the output.

- **String-in entry point, not file encoding.** The production pipeline is
  file-oriented (base64 + mime). Rather than base64-encode fixture strings into
  fake "files" to reach it — ceremony that obscures what's under test —
  `extractEventsFromText` shares the model call and parsing with
  `extractEventsFromFile` via a common core, so the eval reads as what it is
  without a second copy of the logic to keep in sync.

## What it deliberately doesn't cover yet

These are left undone on purpose — each is a real next step, not an oversight:

- **Multi-run averaging for non-determinism.** The live model can answer slightly
  differently across calls, so a single run's score has noise in it. The honest
  fix is to run each fixture N times and report a mean/spread. Not built yet
  because the fixture set is small and the current goal is to _see_ the shape of
  the output first; averaging is the natural follow-up once a run cadence exists.
- **Prompt versioning.** Right now a run's JSON records the score but not _which
  prompt produced it_. Stamping each run with a prompt hash/version would make
  the over-time diff causal ("score dropped when we changed the confidence
  instructions"), not just correlational.
- **CI integration.** Intentionally excluded (see above). If it's ever automated,
  it belongs on a schedule or a manual trigger with a cost budget — never on the
  per-push path.
- **Richer scoring dimensions.** Description quality, category correctness, and
  date-value exactness aren't graded. They can be added to `compareExtraction`
  as more `expected` fields when they start to matter.

---

# State architecture — the two-panel workspace

The workspace shows two panels at once: a conversational **stream panel** (the
summary typing out live, with a single-line agent status underneath) and a
structured **events panel** (the extracted events with their confidence
indicators). The load-bearing requirement is a rendering one: **the events panel
must not re-render while the summary streams.** A letter's summary arrives as
dozens of tokens; the events don't change across any of them. Every events-panel
render during that stream is wasted work, and on a longer document it's the
difference between a workspace that feels instant and one that stutters.

That requirement — not feature count — is why the state is shaped the way it is.

### Two isolated stores, not one lifted state

The pre-workspace design lifted everything into the orchestrator's `useState` (a
single object holding summary + events). That is the simplest thing that works,
and it's exactly what fails here: calling `setState` to append one summary token
produces a new state object, so **every** consumer of that state re-renders —
the events panel included, on every token.

The fix is two separate Zustand stores — `useLeftPanelStore` (summary, status,
error, and a reserved chat slice) and `useEventsStore` (events, phase, error) —
each consumed by exactly one panel.

- **Why not lifted state:** covered above — a shared object re-renders everything
  that reads any part of it.
- **Why not one store with selectors:** Zustand selectors _can_ deliver the same
  isolation (`useStore(s => s.events)` only re-renders when `events` changes). But
  that isolation is a matter of discipline — one careless `useStore(s => s)` or an
  object-returning selector re-subscribes a panel to the whole store, and nothing
  fails loudly when it happens. With two stores the boundary is **structural**:
  `RightPanel` imports `useEventsStore` and never imports the left store, so there
  is no selector it _could_ write that would re-render it on a summary token. The
  guarantee holds by construction, not by review vigilance.
- **The consumer writes, it doesn't subscribe.** `ScreenRouter` routes stream
  frames into the stores via `useStore.getState().action()` — it never calls the
  hooks, so it holds no summary/events state itself and doesn't re-render as they
  change. Writer and readers are cleanly separated.

The isolation is instrumented, not asserted: `RightPanel` logs a render count in
development. On a typical upload it logs about twice — once on mount (the loading
skeleton), once when events arrive — and never on a summary token. If that number
ever tracks the token count, the architecture has regressed.

### Agent status is an explicit stream chunk, not derived state

The status line ("Reading letter…", "Writing summary…", "Extracting events…") is
driven by a dedicated `status` chunk the pipeline emits at each transition — a
third `StreamChunk` variant alongside summary deltas and the terminal result,
carried to the client as its own SSE event.

The tempting alternative is to _derive_ the stage in the UI from timing: "we've
seen summary deltas but no events yet, so we must be extracting." That couples the
UI to the pipeline's internal ordering — it re-implements, in the consumer,
knowledge the pipeline already has, and it breaks silently the moment that
ordering changes (a new stage, reordered emission, a model that interleaves).
Making status an explicit signal keeps the pipeline the **single source of truth**
for its own progress: it says when it transitions, and the panel is a dumb
renderer of the stage it's told. It also means the status can describe work that
produces no visible tokens at all — the `reading` stage exists before the first
summary token, which no timing heuristic could infer.

### Errors are panel-scoped

Each store carries its own `error`, and each panel renders only its own. An
events-only failure (a malformed terminal frame) sets the events store's error
while the streamed summary stays intact on the left; a whole-stream failure sets
both, as independent writes. Because a panel reads only its own store, one side
failing can never blank the other — the same isolation that serves rendering also
contains failures.

### What it deliberately leaves for later

- **Chat input and transcript.** `useLeftPanelStore` reserves a `chatMessages`
  slice, empty and unused. Chat belongs to the same conversational surface as the
  summary and needs the same isolation from the events panel, so it will live in
  this store; the layout already leaves room under the status line for the input.
  Declaring the shape now means adding chat is additive — new actions on an
  existing store — rather than a restructure of the panel/store boundary.
  ← **done in phase three, below.**
- **A side-by-side layout.** The panels stack in a column (stream on top) because
  the app is mobile-first and narrow. Going horizontal on wide viewports is a
  layout-only change in `WorkspaceShell` — neither panel nor either store knows
  or cares how the two are arranged.

---

# Phase three: session-aware chat

Chat sits under the agent status in the left panel: a parent uploads a letter,
gets the summary and events, then asks follow-up questions ("what time is the bake
sale?", "do I need to sign anything?"). The reply streams in below the previous
turns. It's the same conversational surface as the summary, so it lives in the
same store and inherits the same render isolation from the events panel.

The whole point of this phase is that it's **additive**. It reuses the streaming
pattern (`app/api/chat/route.ts` mirrors `app/api/upload/route.ts` — SSE over a
`ReadableStream`), the SDK seam (`getAnthropicClient` + `MODEL`, exported from
`lib/extract-events` so chat and extraction can't drift onto different models),
the client read loop (`fetch` + `getReader` + `parseFrame`), and the reserved
`chatMessages` slice. No new store, no new model, no new dependency.

## How context is passed

The API is **stateless** — it holds no session. Every request carries everything
it needs and the route rebuilds the prompt from scratch: `{ letter, events,
messages }`, where the client sends the letter summary, the extracted events, and
the **entire** turn history on **every** call.

That context is split two ways for a reason:

- **Letter summary + events → the `system` prompt.** They're stable ground truth
  for the whole conversation. They don't change between turns, and the model should
  treat them as the authoritative source to answer from, not as a user utterance to
  weigh. `system` says exactly that: this is the world, answer within it.
- **The turns → `messages`.** They grow and change every request — they _are_ the
  conversation, the variable part of the call.

The "letter" is really the **summary**, not the full letter text. The letter is
never transcribed to text anywhere — at upload it goes to the model as a PDF/image,
and the only letter-derived text the client holds is the streamed summary. So the
summary is what chat answers from, and the system prompt labels it honestly and
tells the model to admit when an answer isn't in it rather than invent one.

## The design decisions, and why

- **Full context on every call, no truncation.** The stateless API means the whole
  history rides along each time. We deliberately do **not** trim or summarise old
  turns. If a conversation ever grew long enough to strain the context window,
  that's a real design decision worth having out loud — not something to silently
  paper over with a truncation heuristic that quietly drops the turn that mattered.
  For the letter-sized conversations this is built for, full context is correct and
  simplest.

- **Chat state lives in `useLeftPanelStore`, not its own store.** Chat is part of
  the same conversational surface as the summary and needs the same isolation from
  the events panel. A store of its own would just be a second thing `RightPanel`
  must promise never to import; folding it into the left store makes that boundary
  structural, exactly as the summary/events split already is. `ChatPanel` subscribes
  only to the left store; it reads the events it needs to _send_ via
  `useEventsStore.getState()` — a one-shot read at submit, never a subscription — so
  chat activity can't re-render the events panel and vice versa. The `RightPanel`
  commit counter stays flat while chat streams, the same guarantee the summary has.

- **The streamed reply grows one message, not one-per-chunk.** `startAssistantMessage`
  pushes an empty assistant turn and `appendAssistantChunk` grows its `text` in
  place — the same accumulate pattern as `appendSummary`. A message per token would
  render each chunk as its own bubble; instead the reply fills a single bubble as it
  types out.

- **Input disabled while streaming.** The API is stateless and we send the whole
  history each call, so two overlapping requests would race on the transcript. The
  input (and send button) disable for the duration of a reply, so a second question
  can't be fired mid-response.

- **Chat clears on upload, not persists across letters.** A new letter calls the
  left store's `reset()`, which empties `chatMessages` (it's part of `INITIAL`). Chat
  is grounded in one specific letter's summary + events; carrying it to a different
  letter would answer new questions against the wrong context. A dedicated
  `clearChat()` action also exists for callers that want to reset only the chat.

## What it deliberately leaves for later

- **Prompt caching.** The letter summary + events are re-sent in the `system` prompt
  on every turn and are identical across a conversation — a textbook case for
  Anthropic prompt caching (mark the stable prefix as cacheable, pay for it once).
  Left unbuilt on purpose so the base streaming pattern stays the focus; it's the
  obvious first optimisation.
- **Full letter text as context.** Chat answers from the summary, which is lossy. A
  faithful version would have the extraction pipeline also emit a verbatim
  transcription, stored client-side and sent as the real `letter`. That touches the
  phase-two extraction prompt and stream contract and costs more tokens per
  extraction, so it's a deliberate scope call, not an oversight.
- **Session persistence.** Chat evaporates on refresh by design — no storage, no
  history across visits.
