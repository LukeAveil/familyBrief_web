# Confidence Indicators — design notes & learnings

Personal reference for the "confidence indicators" feature on the `add-confidence`
branch. Written to explain the _why_ behind each decision — the kind of thing an
interviewer probes after you say "I show honest uncertainty in the UI."

The design pattern this demonstrates: **an AI interface that surfaces its own
uncertainty instead of presenting every output with the same confident polish.**

---

## 1. The problem it solves

FamilyBrief turns a photo/PDF of a school letter into calendar events via Claude,
then lets a parent add them to Google Calendar. Those events are _actionable_ — a
parent relies on them for a real deadline — so a wrong-but-confident date is worse
than an obviously-uncertain one.

The app already _had_ a `confidence` field, but it was **fake**:

```ts
// the OLD code (removed)
const confidence = !event.time && !event.description && !event.location ? 'medium' : 'high'
```

That measures **data completeness**, not **certainty**. An event can have a time,
a location, and a description and still be a total guess ("the last Wednesday").
The heuristic would stamp it `high`. That's the opposite of honest.

**The change:** move confidence from a code heuristic to a _model judgment_, make
it three levels, and assess it _per field_.

---

## 2. The decision trail (each of these is an interview talking point)

### 2a. Model-assessed, not code-computed

A heuristic in code can only look at _shape_ (is this field present?). Only the
model has seen the source text, so only the model can judge whether "next Friday"
is a solid date or a guess. So the **prompt** now asks Claude to assess and return
confidence, and the code's only job is to _sanitise_ what comes back.

> Lives in: `lib/extract-events.ts` → `buildPrompt()`

### 2b. Per _field_, not per event, not per response

First instinct was "per item." But in this app the extracted unit _is_ an event,
so "per item" collapses to "per event." The sharper question is: **what does a
parent actually rely on?** Three things, independently:

- **the event title** — is this really "the school play"?
- **the date/time** — the thing they'll set a reminder for
- **the location** — where they'll drive to

Each is judged **independently**, because they fail independently: a letter can
state a crystal-clear date for an event whose _name_ is ambiguous. One blanket
score would hide that.

> The prompt tells the model to assess each field on its own. `location` is
> **omitted** when the event has no location — you can't be uncertain about a
> thing that isn't there.

### 2c. Three words, not a 0–100 number

This is the subtle one and the best interview point. A score like `73%` _looks_
precise — it implies the model measured something to two significant figures. It
didn't. A coarse `high / medium / low` is **honest about its own granularity**:
it signals "this is a rough judgment," which is exactly what it is. Showing false
precision is itself a form of dishonest UI.

### 2d. The confidence _rule_ given to the model

The prompt defines the levels concretely so the judgment is repeatable, not vibes:

- **high** — explicitly, unambiguously stated (full date + year, clear time,
  named venue, event named in plain words)
- **medium** — present but _inferred_: a date with no year, "next Friday"
  resolved from context, an abbreviated/ambiguous title, a vague "the hall"
- **low** — genuinely unclear, guessed, or pieced together from weak cues

> Learning: giving the model a **rubric** (with examples of each level) makes
> structured judgments far more consistent than asking it to "rate your
> confidence." Vague criteria → noisy output.

### 2e. Honest _fallback_ when the model omits/garbles a field

If the model returns nothing usable for a field, the code defaults it to
**`medium`**, not `high`:

```ts
function sanitizeLevel(value: unknown): ConfidenceLevel {
  return value === 'high' || value === 'low' ? value : 'medium'
}
```

Rationale: the safe failure mode is to **flag for a second look**, never to
falsely reassure. Defaulting an unknown to `high` would be the one dangerous bug
in the whole feature.

> Learning: model output is _untrusted input_. Type it loosely (`confidence?:
{ title?: string; ... }`), then sanitise at the boundary — same discipline as
> validating an API response.

### 2f. Accessibility — never colour alone

Medium is amber, low is red. But colour-blind users (and anyone glancing quickly)
can't rely on hue. So **every** flag carries three signals:

1. an **icon** (info circle for medium, warning triangle for low)
2. a **visible text label** ("Double-check" / "Low confidence — verify")
3. an **`aria-label`** naming the field ("Low confidence in the date and time")

Colour is the _fourth_, redundant signal — never the only one. This is the WCAG
"don't use colour as the only visual means of conveying information" guideline in
practice.

### 2g. Glanceable at the list level, not just per-field

A parent scanning a list of 6 events shouldn't have to read every pill. So the
**card itself** escalates:

- any non-high field → dashed border (`.uncertain`)
- any _low_ field → dashed **red-tinted** border (`.uncertain-low`)

Computed by taking the **worst** confidence across the present fields. Result:
the eye lands on the shakiest cards first.

### 2h. Consistency with the existing design language

No new visual vocabulary was invented. The amber pill _already existed_ for the
old "Please verify the date" badge; low confidence reuses the app's existing
`--color-error*` tokens. New styling is one CSS rule (`.uncertain-low`).

> Learning: the constraint "stay consistent with the current design language" is
> a feature, not a limitation — reusing tokens keeps the change small and the
> product coherent.

### 2i. Why NOT switch to the structured-outputs API

Claude has an `output_config.format` mode that forces a JSON schema. Tempting for
"structured output." **We deliberately didn't use it here**, because the app's
streaming design depends on the model writing a human summary _first_, then a
delimiter, then the JSON:

```
<friendly summary that streams to the screen live>
<<<EVENTS_JSON>>>
[ ...the actual events... ]
```

The summary is _safe to show as it types out_; the events are _actionable_ and
must never be shown half-formed. Forcing a single JSON blob would kill the live
summary. So confidence rides _inside_ the existing per-event JSON objects — the
streaming architecture is untouched.

> Learning: "use the more structured API" isn't automatically right. The existing
> split (stream the safe half, buffer the actionable half) is a better fit than a
> schema-constrained single response.

---

## 3. Where everything lives (data flow)

```
school letter (image/PDF)
      │
      ▼
lib/extract-events.ts
  buildPrompt()            ← asks the model for per-field confidence + the rule
  streamEventsFromFile()   ← streams summary live, buffers + parses the JSON
  toCalendarEvent()        ← sanitises model confidence → EventConfidence
      │  (Server-Sent Events)
      ▼
app/api/upload/route.ts    ← relays SSE: `delta` (summary) then `done` (events)
      │
      ▼
components/ScreenRouter.tsx ← reads the stream, flips to the results screen
      │
      ▼
components/results/ResultsScreen.tsx → EventCard.tsx
  ConfidenceFlag           ← per-field pill (icon + label + aria-label)
  worst-level card class   ← .uncertain / .uncertain-low
      │
      ▼
app/globals.css            ← .uncertain (dashed) / .uncertain-low (red tint)
```

**The data shape** (`types/index.ts`):

```ts
export type ConfidenceLevel = 'high' | 'medium' | 'low'

export interface EventConfidence {
  title: ConfidenceLevel
  datetime: ConfidenceLevel
  location?: ConfidenceLevel // only when the event has a location
}
```

---

## 4. Proof it actually works (real Claude output)

Fed a test letter with deliberately mixed clarity through the live endpoint. The
model returned genuine per-field variation — not everything defaulting to one
level:

| Event                   | Confidence returned                            | Why                                                      |
| ----------------------- | ---------------------------------------------- | -------------------------------------------------------- |
| Sports Day              | `datetime: medium`                             | date stated without a year context                       |
| End of Year Performance | `datetime: low`                                | time given only as "next Tuesday"                        |
| Last Day of Term        | `datetime: medium`, _no location key_          | no venue in the letter                                   |
| Parents' Evening        | `title: medium, datetime: low, location: high` | "the last Wednesday" + a guessed name, but a clear venue |

This is the whole thesis in one table: **the uncertainty is real and it varies by
field.** The `location` key correctly disappears when there's no location.

---

## 5. Testing approach (what's worth copying)

- **Unit tests** (`__tests__/lib/extract-events.test.ts`) mock the Anthropic SDK
  and assert the mapping: model confidence passes through, invalid/missing →
  `medium`, `location` omitted when absent.
- **Component tests** (`__tests__/components/results/EventCard.test.tsx`) render
  the real DOM and assert the flags appear with the right labels + `aria-label`,
  and that the card gets `uncertain` / `uncertain-low`. This is what lets me claim
  the frontend works without opening a browser.
- **End-to-end** was a real upload through `/api/upload` with a live Claude call
  (the table in §4) — the only way to prove the _prompt_ actually elicits the
  behaviour, since the unit tests mock the model.

> Learning: mock the model to test _your_ code (mapping, rendering); use one real
> call to test the _prompt_. Different layers, different tools.

---

## 6. How to demo it

```bash
npm run dev
# then open:
http://localhost:3000/?preview=results
```

Dev-only query param (compiled out in production) that jumps straight to the
results screen with `MOCK_MULTIPLE`, which spans every level. Edit the
`confidence` objects in `lib/mock-data.ts` to see other combinations. `?preview=empty`
shows the no-events state.

---

## 7. One-line summary for the interview

> "The model rates its own confidence per field on a coarse high/medium/low scale —
> coarse on purpose, because a percentage would fake a precision the model doesn't
> have — and the UI flags the shaky items with an icon, a label, and colour (never
> colour alone) so a parent sees at a glance which dates to double-check before
> trusting them."
