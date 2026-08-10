# Deploy — Gold Mobile Mechanic website

**Live:** https://thomasg42.github.io/gold-mobile-mechanic-site/
**Repo:** https://github.com/thomasg42/gold-mobile-mechanic-site (public)
**Pages:** `main:/docs`, HTTPS enforced. Deployed 2026-08-09.

GitHub Pages is the only user-facing URL. Never send a Netlify, Vercel,
Cloudflare Pages or preview link as the live site.

## Redeploy

`docs/` in this folder is the source of truth. To ship a change:

```bash
SP=/tmp/gmm-deploy
rm -rf "$SP" && git clone https://github.com/thomasg42/gold-mobile-mechanic-site "$SP"
rm -rf "$SP/docs" && cp -R docs "$SP"/ && cp README.md "$SP"/
cd "$SP" && git add -A && git commit -m "..." && git push
```

Then wait for `gh api repos/thomasg42/gold-mobile-mechanic-site/pages --jq .status`
to read `built` and re-verify (below).

## Still open

1. **The live phone number — highest value.** The page ships with no phone at
   all: `CONFIG.phone` and `CONFIG.phoneDisplay` in `docs/assets/site.js` are
   blank, which strips every call CTA at load and routes everyone to the booking
   form. That is deliberate — publishing a stale number sends real leads to a
   stranger. Fill both in and redeploy to switch calling back on everywhere at
   once. Also add `"telephone"` back into the JSON-LD block in `index.html`
   (the runtime patch in `applyPhone()` is a convenience; crawlers want it in
   the served HTML), and update `ELEVENLABS_AGENT.md`, which currently instructs
   the agent to read out no number.
2. **ElevenLabs calendar tools.** Ken Melvoice is live on the page, but the two
   webhook tools in `ELEVENLABS_AGENT.md` still need to be configured in the
   ElevenLabs dashboard before voice can read and reserve the same open dates.
3. **Custom domain.** `github.io/gold-mobile-mechanic-site` is weak on a truck
   or a business card. A real domain pointed at Pages fixes it — remember to
   update `canonical`, the `og:` URLs, the JSON-LD `@id`/`url`, `sitemap.xml`
   and `robots.txt`.
4. **Booking notifications.** The calendar hold is still the primary owner
   signal. If the calendar write fails, the customer now sees a scheduling-by-hand
   message instead of a false hold confirmation, and the request remains in the
   n8n execution log. Adding an SMS or email node in parallel would make that
   fallback proactive.

## Verify after any deploy

Per the GitHub-Only Publishing rule:

```bash
U=https://thomasg42.github.io/gold-mobile-mechanic-site
for f in "" assets/site.js assets/hero3d.js assets/styles.css assets/og.png \
         vendor/three/three.module.min.js robots.txt sitemap.xml; do
  printf "%-40s %s\n" "/$f" "$(curl -s -o /dev/null -w '%{http_code}' "$U/$f")"
done
for f in index.html assets/site.js assets/hero3d.js assets/styles.css; do
  diff <(curl -s "$U/$f") "docs/$f" >/dev/null && echo "MATCH $f" || echo "MISMATCH $f"
done
```

Then drive the live URL in a real browser: the hero must animate on scroll, a
calendar-held date must not appear in the picker, and the booking form must
return the gold confirmation panel.

## Booking backend

n8n `Gold Mobile Mechanic — Website Booking Request` (`iZQeMd1Hiq3mV4Qf`),
**active**. Verified 2026-08-09:

| Case | Result |
|---|---|
| Availability GET | `200` with calendar-verified `open[]` and `taken[]` dates |
| Manual calendar event titled `Gold Mobile Mechanic ...` | Every covered date moves to `taken[]`, even for a short timed event |
| Valid Sun–Wed request | `200 {"ok":true,"calendarHeld":true}` + 8–5 hold on the calendar |
| Second request for the same day | `409 {"ok":false,"reason":"day_taken"}` + refreshed `open[]` |
| Friday | `400 {"ok":false,"errors":["requestedDay"]}` |
| Missing fields | `400` listing each failing field |
| CORS preflight from github.io | `204`, origin allowed |

The weekday is re-derived server-side, so a hand-crafted POST cannot book a
Friday no matter what the browser sends.
