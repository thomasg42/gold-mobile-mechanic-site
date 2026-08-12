# Gold Mobile Mechanic — website

Lead-gen site for Thomas's own mobile mechanic business in Bozeman. Separate
from `client-sites/gold-mobile-mechanic/`, which is the operator app (job clock,
receipts, invoices) — this is the customer-facing site that feeds it.

Built on `wiki/builds/local-business-website-seo-blueprint.md`.

- Live: https://thomasg42.github.io/gold-mobile-mechanic-site/
- Source of truth for the page: `docs/` (multi-page static site, no build step)
- Booking backend: n8n workflow `Gold Mobile Mechanic — Website Booking Request`
  (`iZQeMd1Hiq3mV4Qf`) on `tggai.app.n8n.cloud`
- Voice agent (booking): see `ELEVENLABS_AGENT.md`
- Voice agent (free diagnosis): see `DIAGNOSIS_AGENT.md`

## What is in here

```
docs/
  index.html            the main page
  diagnose.html         free consumer diagnosis assistant page ("ask Ken")
  assets/styles.css     one stylesheet, one layout for phone and desktop, both pages
  assets/site.js        CONFIG, booking form, day picker, voice widget wiring (index.html)
  assets/diagnose.js    CONFIG, tool icons, voice widget wiring (diagnose.html)
  assets/hero3d.js      retained source for the superseded WebGL hero
  assets/hero/          the current scroll-scrub MP4
  assets/favicon.svg
  vendor/three/         three.js r185, vendored so the hero has no CDN dependency
  robots.txt sitemap.xml .nojekyll
```

## The free diagnosis page (`diagnose.html`)

A separate, deliberately simpler page: "talk to Ken and find out what's
probably wrong, with hardly any special tools." It is NOT the technician
manual repackaged — the content (`wiki/builds/gmm-consumer-diagnosis-content.md`
in FGA-Brain) is a from-scratch, safety-bounded rewrite covering only what a
layperson can check by look, sound, or a handful of $5-$20 tools (flashlight,
tire pressure gauge, tread depth gauge or a penny, jumper cables, a rag +
white cardboard, and the car's own dipstick). Anything beyond that — brake
hydraulics, transmission, hybrid/EV high-voltage, exhaust restriction, HVAC,
electrical faults beyond battery terminals — always routes to "book the
diagnostic," never a guessed answer.

Voice is Ken again (same character, same voice, for brand consistency) but a
**separate ElevenLabs agent** from the booking-line Ken, so nothing about this
page can destabilize the already-live, already-tuned booking agent. See
`DIAGNOSIS_AGENT.md` for the full system prompt, safety rules, and the
ready-to-paste Claude Co-Work prompt to actually create that agent — it isn't
configured yet, so the page currently shows the visual symptom/tool reference
plus a graceful "voice line not connected yet" fallback, same pattern as the
booking page before its agent existed.

## The hero

The hero uses `docs/assets/hero/gmm-hero-orbit.mp4`, a five-second portrait
before/after vehicle orbit. The mobile-safe H.264 Level 4.1 video is encoded
with a keyframe every six frames for responsive trackpad seeking, pinned full-screen, and scrubbed by
progress through the tall hero section. The scrubber queues only one media seek
at a time and keeps the video muted and paused between updates. Thirteen common
problems and repairs cycle below the before/after meter with enough scroll
distance to read each one. The headline, supporting copy, CTAs, and diagnostic
note stay layered above a lighter lower vignette on desktop and phone. If the
MP4 cannot load, the branded dark background remains visible and the hero
collapses to a normal non-scrubbing block.

## Business rules encoded in the page

- Booking days: Sunday, Monday, Tuesday, Wednesday only. One vehicle per day.
- One-day jobs, done at the customer's location: brakes, oil, suspension,
  tune-ups (plugs and coils), transmission fluid, oil pan and transmission pan.
- Two- to three-day jobs, dropped off: timing chains, head gaskets, anything internal to
  the engine. The drop-off address is never published — it goes out in the
  confirmation text.
- The form asks only for location preference: mobile service at the customer's
  place (higher cost), drop-off (lower cost), or not sure yet. The diagnostic,
  not the customer, determines whether the repair is a one-day or 2–3-day job.
- $50 diagnostic, free of charge if the job is out of Thomas's realm.
- Not offered: transmission rebuilds, body work, alignments, tire mounting.

The day picker asks the calendar-backed availability webhook for the next open
Sun/Mon/Tue/Wed dates. Held dates are not rendered. If availability cannot be
verified, the picker fails closed and shows no dates instead of guessing. The
booking webhook checks the calendar again immediately before creating the hold,
so a stale browser receives `409 day_taken` and redraws the remaining dates
without losing anything the customer typed. An already-open page also refreshes
when the tab regains focus (no background timer — polling on a fixed interval
wastes n8n executions while nobody's looking). If an active Google Calendar
event title contains `Gold Mobile Mechanic` (for example `Gold Mobile Mechanic
Work` or `Gold Mobile Mechanic Diagnosis`), every covered date is treated as a
whole-day block even when the event itself is only one hour long. Existing `GMM
HOLD` and `GMM BLOCK` titles remain supported.

## Configuration

Everything re-pointable is at the top of `docs/assets/site.js`:

```js
bookingEndpoint     n8n webhook that receives the booking request
availabilityEndpoint read-only webhook returning calendar-verified open days
elevenLabsAgentId   public Ken Melvoice widget id
phone / phoneDisplay
```

## Local run

```
cd docs && python3 -m http.server 8791
```

Must be served over HTTP, not opened as a `file://` path — the hero is an ES
module and imports three.js.

For safe booking QA without touching Google Calendar:

```bash
node tests/booking-availability-server.mjs
```

Open `http://127.0.0.1:4174/`. Add `?scenario=fail` to prove the calendar-failure
state or `?scenario=none` to prove the fully-booked state.

## Deploy

GitHub Pages from `main:/docs` on its own public repo. See `DEPLOY.md`.
