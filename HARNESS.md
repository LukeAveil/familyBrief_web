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
- Build the AI eval harness on top of `__tests__/fixtures/` (see Layer 4).
