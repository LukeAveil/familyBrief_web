# FamilyBrief

**School letters, sorted.**

A mobile-first web app that lets parents upload a school letter (PDF or photo), extracts calendar events using AI, and adds them to Google Calendar in one tap.

## Tech stack

- **Next.js 16** (App Router)
- **Tailwind CSS v4** — design tokens defined in `globals.css` via `@theme`
- **TypeScript**
- Deployed to **Vercel** (planned)

## Project structure

```
components/
  upload/         — Upload screen, drag-and-drop zone, steps strip
  processing/     — Scanning animation and progress screen
  results/        — Event cards, multi-select, Google Calendar CTA
  error/          — Error state with tips
  icons/          — SVG icon set
lib/
  mock-data.ts    — Fixture data for development
types/
  index.ts        — Shared TypeScript types
```

## Getting started

```bash
nvm use 20
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Use the dev nav bar at the bottom to switch between screens.

---

## Todo

### Core features
- [ ] File upload API route — accept PDF/image and pass to AI extraction
- [ ] AI event extraction — integrate with Claude API to parse letter content
- [ ] Wire up real screen flow — replace dev nav switcher with actual state machine
- [ ] Google Calendar integration — generate and open pre-filled calendar URLs
- [ ] Processing screen — drive progress bar and step messages from real API response time

### Auth & users
- [ ] Sign in / Sign up — add authentication (Auth.js or Clerk)
- [ ] User sessions — persist uploaded letters and extracted events
- [ ] Usage limits — rate limiting per user for AI extraction calls

### Polish
- [ ] Mobile camera capture — hook up "Take photo" button to device camera
- [ ] Error handling — surface specific errors (file too large, unsupported format, AI failure)
- [ ] Empty states — handle letters with no detectable events
- [ ] Accessibility audit — keyboard nav, screen reader testing

### Infrastructure
- [ ] Deploy to Vercel
- [ ] Set up environment variables — `ANTHROPIC_API_KEY`, etc.
- [ ] Remove dev screen switcher before production launch
