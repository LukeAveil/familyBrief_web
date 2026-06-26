[![Tests](https://github.com/LukeAveil/familyBrief_web/actions/workflows/test.yml/badge.svg)](https://github.com/LukeAveil/familyBrief_web/actions/workflows/test.yml)

# FamilyBrief

**School letters, sorted.**

A mobile-first web app that lets parents upload a school letter (PDF or photo), extracts calendar events using AI, and adds them to Google Calendar in one tap.

## Tech stack

- **Next.js 16** (App Router)
- **Tailwind CSS v4** — design tokens defined in `globals.css` via `@theme`
- **Anthropic SDK** — Claude handles event extraction from PDFs and images
- **TypeScript**
- **Vercel** — deployed at [familybrief-nu.vercel.app](https://familybrief-nu.vercel.app)

## Project structure

```
app/
  api/upload/     — POST route: validates file, calls Claude, returns events
components/
  upload/         — Upload screen and drag-and-drop zone
  processing/     — Scanning animation screen
  results/        — Event cards, multi-select, Google Calendar CTA
  error/          — Error state with retry tips
  icons/          — SVG icon set
lib/
  extract-events  — Claude API call, prompt, and response → CalendarEvent mapping
  file-config     — Accepted MIME types and 20 MB size limit
  mock-data       — PROC_MSGS used by ProcessingScreen; MOCK_* fixtures unused
types/
  index.ts        — Shared TypeScript types
```

## Getting started

```bash
nvm use
npm install
cp .env.local.example .env.local   # add ANTHROPIC_API_KEY
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Status — what's done vs. what's left

### Done

- [x] Full UI — upload, processing, results, and error screens with transitions
- [x] File upload API route — type and size validation (20 MB cap)
- [x] AI extraction — Claude reads PDFs and images, returns structured events
- [x] Google Calendar URL generation — pre-fills title, date/time, location, notes
- [x] Multi-event selection — checkboxes, "Add N events" bulk action
- [x] Error screen — user-facing tips for retrying with a better photo
- [x] Camera capture — "Take photo" button appears on touch devices only; opens rear camera via `capture="environment"`
- [x] Dev screen switcher removed
- [x] Processing screen animates — steps and progress bar advance on timers timed to the typical ~10s API response; cleanup on unmount when the response arrives
- [x] Empty state — zero events now shows a dedicated screen with a friendly message and a "Try a different letter" button
- [x] "Try again" now retries — the last uploaded file is held in a ref and re-submitted to the API when the user taps retry
- [x] Timezone handling — calendar times are now floating (no `Z` suffix) so Google Calendar uses the user's local timezone
- [x] HEIC removed — HEIC is no longer accepted (Anthropic API doesn't support it natively; re-add once server-side conversion via `sharp` is in place)
- [x] Error responses sanitised — raw SDK error messages are no longer forwarded to the client
- [x] Concurrent upload protection — starting a new upload aborts any in-flight request
- [x] Security headers — `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` on all routes; `X-Powered-By` header removed

### Blocking for production test deploy

- [x] **Vercel deploy + `ANTHROPIC_API_KEY` env var** — deployed at [familybrief-nu.vercel.app](https://familybrief-nu.vercel.app)

### Nice-to-have before sharing with real users

- [ ] **Rate limiting** — no guard against bulk API use; add a per-IP limit (e.g. `@upstash/ratelimit`) before publicising the URL.
- [ ] **Request timeout** — `extractEventsFromFile` has no deadline; a slow Anthropic response blocks the API route indefinitely. Wrap in a `Promise.race` with a ~30 s timeout, returning 504 to the client.
- [ ] **File magic-byte validation** — MIME type on upload is client-supplied and can be spoofed. Validate the first few bytes of the `arrayBuffer()` against expected signatures before passing to Claude.
- [ ] **Dead code cleanup** — `LayoutStyle` (`airy`/`structured`) and `ResultsView` (`compact`) types exist but are never used in production paths. `StepsStrip` component is unreachable. `MOCK_SINGLE`/`MOCK_MULTIPLE` in `mock-data.ts` are no longer imported.
- [ ] **`extract-events.ts` responsibilities** — one file handles prompt building, response parsing, date formatting, and calendar serialisation. Splitting into `lib/build-prompt.ts`, `lib/parse-events.ts`, and `lib/calendar-url.ts` would make each part independently testable.
