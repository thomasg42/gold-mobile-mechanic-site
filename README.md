# Gold Mobile Mechanic — website

Lead-gen site for Thomas's own mobile mechanic business in Bozeman. Separate
from `client-sites/gold-mobile-mechanic/`, which is the operator app (job clock,
receipts, invoices) — this is the customer-facing site that feeds it.

Built on `wiki/builds/local-business-website-seo-blueprint.md`.

- Live: https://thomasg42.github.io/gold-mobile-mechanic-site/
- Source of truth for the page: `docs/` (single page, no build step)
- Booking backend: n8n workflow `Gold Mobile Mechanic — Website Booking Request`
  (`iZQeMd1Hiq3mV4Qf`) on `tggai.app.n8n.cloud`
- Voice agent: see `ELEVENLABS_AGENT.md`

## What is in here

```
docs/
  index.html            the whole page
  assets/styles.css     one stylesheet, one layout for phone and desktop
  assets/site.js        CONFIG, booking form, day picker, voice widget wiring
  assets/hero3d.js      the scroll-driven 3D before/after hero
  assets/favicon.svg
  vendor/three/         three.js r185, vendored so the hero has no CDN dependency
  robots.txt sitemap.xml .nojekyll
```

## The hero

The "3D" in the Premium 3D Website tier is normally the scroll-driven hero video
pattern (`wiki/builds/scroll-driven-hero-video.md`). There is no hero footage for
this business and no photos of Thomas's work in the repo, so the same scroll
mechanic drives a live WebGL scene instead of a video file.

Scroll progress sweeps a diagnostic scan plane from the nose of a vehicle to the
tail. Two copies of the car are rendered — a grey, faulted BEFORE and a gold,
repaired AFTER — split by real clipping planes at the scan position, so it is one
continuous 3D wipe rather than a crossfade. One callout at a time follows the
scan: Misfire → Plugs + coils, Grinding → Brakes, Leaking → Oil + fluids,
Clunking → Suspension.

Same scene on desktop and phone. The camera distance is solved from the viewport
aspect each resize, so a tall phone pulls back and frames the car instead of
slicing the bumpers off. If WebGL is unavailable the page adds `body.no-webgl`,
the tall scroll container collapses, and the hero becomes a normal static block —
nothing breaks.

## Business rules encoded in the page

- Booking days: Sunday, Monday, Tuesday, Wednesday only. One vehicle per day.
- One-day jobs, done at the customer's location: brakes, oil, suspension,
  tune-ups (plugs and coils), transmission fluid, oil pan and transmission pan.
- Two-day jobs, dropped off: timing chains, head gaskets, anything internal to
  the engine. The drop-off address is never published — it goes out in the
  confirmation text.
- $50 diagnostic, free of charge if the job is out of Thomas's realm.
- Not offered: transmission rebuilds, body work, alignments, tire mounting.

The day picker asks the calendar-backed availability webhook for the next open
Sun/Mon/Tue/Wed dates. Held dates are not rendered. If availability cannot be
verified, the picker fails closed and shows no dates instead of guessing. The
booking webhook checks the calendar again immediately before creating the hold,
so a stale browser receives `409 day_taken` and redraws the remaining dates
without losing anything the customer typed.

## Configuration

Everything re-pointable is at the top of `docs/assets/site.js`:

```js
bookingEndpoint     n8n webhook that receives the booking request
availabilityEndpoint read-only webhook returning calendar-verified open days
elevenLabsAgentId   paste the agent id to switch on the real voice widget
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
