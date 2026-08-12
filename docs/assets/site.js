/* Gold Mobile Mechanic — site behaviour.
   Everything configurable lives in CONFIG so the site can be re-pointed
   without reading the rest of this file. */

export const CONFIG = {
  // Public booking routes on the existing Gold Mobile Mechanic cloud ledger.
  // The same ledger feeds the owner phone app, so a website request appears as
  // a draft job there without depending on n8n execution quota.
  bookingEndpoint: 'https://gold-mobile-mechanic-sync.forevergoldai.workers.dev/api/public/bookings',

  // Read-only companion route: only unclaimed booking days are returned.
  availabilityEndpoint: 'https://gold-mobile-mechanic-sync.forevergoldai.workers.dev/api/public/availability',
  availabilityTimeoutMs: 7000,
  availabilityWeeks: 3,

  // ElevenLabs Conversational AI agent — "Ken Melvoice", the same agent that
  // answers the phone, so the site and the phone line give one answer. Public
  // by design: the widget is client-side and the id is visible in the page.
  // Clear it to fall the branded button back to phone + form.
  elevenLabsAgentId: 'agent_0801kzj8sxw4fdt8y3te99av2d36',

  // Leave both blank until the live number is confirmed. Blank removes every
  // call-to-call on the page rather than publishing a stale number, and routes
  // everyone to the booking form instead. Fill both in to switch calling back
  // on everywhere at once — nothing else needs editing.
  phone: '',
  phoneDisplay: '',

};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const hasPhone = () => Boolean(String(CONFIG.phone || '').trim());

document.addEventListener('DOMContentLoaded', () => {
  applyPhone();
  stickyNav();
  mobileNav();
  fillYear();
  buildYearOptions();
  buildDayOptions();
  startAvailabilityRefresh();
  jobTypeHints();
  wireForm();
  wireVoice();
  bootHero();
});

/* ── phone ────────────────────────────────────────────────────────────── */
// A wrong phone number sends real leads to a stranger, so the page ships with
// none. Every call-to-action is marked `data-call`; with no number configured
// they are removed and the whole page funnels into the booking form.
function applyPhone() {
  const on = hasPhone();

  $$('[data-call]').forEach((el) => {
    if (!on) { el.remove(); return; }
    el.setAttribute('href', 'tel:' + CONFIG.phone);
    if (!el.textContent.trim()) el.textContent = CONFIG.phoneDisplay;
  });

  if (!on) $$('[data-call-line]').forEach((el) => el.remove());

  if (on) {
    const schema = document.getElementById('businessSchema');
    if (schema) {
      try {
        const data = JSON.parse(schema.textContent);
        data.telephone = CONFIG.phone;
        schema.textContent = JSON.stringify(data, null, 2);
      } catch (err) { /* schema stays as-is rather than breaking the page */ }
    }
  }
}

/* ── nav ──────────────────────────────────────────────────────────────── */
function stickyNav() {
  const nav = $('#nav');
  const sticky = $('.hero-sticky');
  const onScroll = () => {
    const past = window.scrollY > 40;
    nav.classList.toggle('is-stuck', past);
    if (sticky) sticky.classList.toggle('is-scrolled', window.scrollY > 120);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// Hamburger dropdown for the primary nav on mobile widths (≤1020px, where
// .nav-links no longer fits inline). Reuses the existing #navLinks markup as
// the panel rather than duplicating it, toggled by an .is-open class on #nav.
function mobileNav() {
  const nav = $('#nav');
  const toggle = $('#navToggle');
  const links = $('#navLinks');
  if (!nav || !toggle || !links) return;

  const close = () => {
    nav.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open menu');
  };
  const open = () => {
    nav.classList.add('is-open');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Close menu');
  };

  toggle.addEventListener('click', () => {
    nav.classList.contains('is-open') ? close() : open();
  });
  links.addEventListener('click', (e) => {
    if (e.target.closest('a')) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  document.addEventListener('click', (e) => {
    if (nav.classList.contains('is-open') && !nav.contains(e.target)) close();
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 1020) close();
  });
}

function fillYear() {
  const el = $('#year');
  if (el) el.textContent = String(new Date().getFullYear());
}

/* ── form options ─────────────────────────────────────────────────────── */
function buildYearOptions() {
  const select = $('#f-year');
  if (!select) return;
  const newest = new Date().getFullYear() + 1;
  const frag = document.createDocumentFragment();
  for (let y = newest; y >= 1985; y -= 1) {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = String(y);
    frag.appendChild(opt);
  }
  select.appendChild(frag);
}

// One car a day, so a day that has already been claimed must never be offered
// to the next person. The calendar is the authority: the server returns the
// days still open and those are the only chips drawn.
let dayRefreshPromise = null;
let bookingSubmitPending = false;

async function buildDayOptions(options = {}) {
  if (dayRefreshPromise) return dayRefreshPromise;
  dayRefreshPromise = refreshDayOptions(options);
  try {
    return await dayRefreshPromise;
  } finally {
    dayRefreshPromise = null;
  }
}

async function refreshDayOptions({ quiet = false } = {}) {
  const wrap = $('#days');
  if (!wrap) return;

  // Bound once, here — the chips get redrawn when a day is taken mid-session,
  // and re-binding on every render would fire this handler N times per click.
  if (!wrap.dataset.bound) {
    wrap.dataset.bound = 'true';
    wrap.addEventListener('change', () => wrap.classList.remove('is-invalid'));
    wrap.addEventListener('click', (event) => {
      if (event.target.closest('[data-retry-days]')) buildDayOptions();
    });
  }

  const selected = $('input[name="day"]:checked', wrap)?.value || '';
  if (!quiet) {
    setDayPickerReady(false);
    wrap.classList.add('is-loading');
    wrap.innerHTML = '<p class="days-note">Checking which days are still open…</p>';
  }

  const open = await fetchOpenDays();
  wrap.classList.remove('is-loading');
  const selectedStillOpen = Boolean(selected && Array.isArray(open) && open.includes(selected));
  renderDays(open, selectedStillOpen ? selected : '');

  if (quiet && selected && !selectedStillOpen) {
    const msg = $('#formMsg');
    if (msg) {
      msg.className = 'form-msg is-err';
      msg.textContent = Array.isArray(open)
        ? 'That day was just claimed and is now off the board. Pick another open day.'
        : 'I cannot re-check that day right now, so it has been cleared until the calendar is available.';
    }
  }
}

// The cloud booking board is the source of truth. Refresh only when a person
// is actually there: on load (see DOMContentLoaded), and again when they land
// back on the tab. The booking POST still re-checks the day server-side as the
// final word before any hold is created.
function startAvailabilityRefresh() {
  const refresh = () => {
    if (document.hidden || bookingSubmitPending || !$('#bookForm') || !$('#days')) return;
    buildDayOptions({ quiet: true });
  };

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
  window.addEventListener('focus', refresh);
}

// Days the booking board says are still free. Null on any failure — never a partial
// or invented list, because a wrong "open" here books two cars on one day.
async function fetchOpenDays() {
  const endpoint = String(CONFIG.availabilityEndpoint || '').trim();
  if (!endpoint || typeof fetch !== 'function') return null;

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), CONFIG.availabilityTimeoutMs)
    : null;

  try {
    const url = new URL(endpoint, window.location.href);
    url.searchParams.set('weeks', String(CONFIG.availabilityWeeks));
    const options = { method: 'GET', cache: 'no-store' };
    if (controller) options.signal = controller.signal;
    const response = await fetch(url.toString(), options);
    if (!response.ok) return null;
    const data = await readJson(response);
    if (!data || !Array.isArray(data.open)) return null;
    return data.open.filter((iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso));
  } catch (err) {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function renderDays(isoDays, selectedDay = '') {
  const wrap = $('#days');
  if (!wrap) return;

  const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  wrap.innerHTML = '';

  // Fail closed. If the booking board cannot be checked, do not invent dates that
  // may already belong to somebody else.
  if (!Array.isArray(isoDays)) {
    wrap.innerHTML = '<div class="days-note">I cannot verify the schedule right now, so no days are being shown. ' +
      '<button type="button" class="days-retry" data-retry-days>Check again</button></div>';
    setDayPickerReady(false);
    return;
  }

  if (!isoDays.length) {
    wrap.innerHTML = '<div class="days-note">Every appointment day on the board is claimed right now. ' +
      '<button type="button" class="days-retry" data-retry-days>Check again</button></div>';
    setDayPickerReady(false);
    return;
  }

  const groups = groupDaysByWeek(isoDays);
  const frag = document.createDocumentFragment();
  groups.forEach((group, groupIndex) => {
    const section = document.createElement('section');
    section.className = 'day-week';
    const headingId = 'booking-week-' + groupIndex;
    section.setAttribute('aria-labelledby', headingId);

    const heading = document.createElement('h3');
    heading.className = 'day-week-heading';
    heading.id = headingId;
    heading.textContent = weekLabel(group.start);
    section.appendChild(heading);

    const dayGrid = document.createElement('div');
    dayGrid.className = 'day-week-grid';
    for (const iso of group.days) {
      // Noon, so a timezone offset can never roll the label onto the wrong date.
      const date = new Date(iso + 'T12:00:00');
      const label = document.createElement('label');
      label.className = 'day';
      label.innerHTML =
        '<input type="radio" name="day" value="' + iso + '"' + (iso === selectedDay ? ' checked' : '') + '>' +
        '<span><span class="d-dow">' + dows[date.getDay()] + '</span>' +
        '<span class="d-date">' + (date.getMonth() + 1) + '/' + date.getDate() + '</span></span>';
      dayGrid.appendChild(label);
    }
    section.appendChild(dayGrid);
    frag.appendChild(section);
  });

  if (!groups.length) {
    wrap.innerHTML = '<div class="days-note">No Sunday-through-Wednesday dates are open in the upcoming schedule. ' +
      '<button type="button" class="days-retry" data-retry-days>Check again</button></div>';
    setDayPickerReady(false);
    return;
  }
  wrap.appendChild(frag);
  setDayPickerReady(true);
}

// Keep the appointment board easy to scan on a phone: dates from the live
// booking board stay grouped into Sunday-start weeks, so if this week is gone the
// next available week becomes the first thing the customer sees.
function groupDaysByWeek(isoDays) {
  const groups = [];
  const byStart = new Map();
  const unique = Array.from(new Set(isoDays)).sort();

  for (const iso of unique) {
    const date = new Date(iso + 'T12:00:00');
    if (Number.isNaN(date.getTime()) || ![0, 1, 2, 3].includes(date.getDay())) continue;
    const start = startOfWeek(date);
    const key = localIso(start);
    if (!byStart.has(key)) {
      const group = { start, days: [] };
      byStart.set(key, group);
      groups.push(group);
    }
    byStart.get(key).days.push(iso);
  }
  return groups;
}

function startOfWeek(value) {
  const date = new Date(value);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

function localIso(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function weekLabel(start) {
  const thisWeek = startOfWeek(new Date());
  const nextWeek = new Date(thisWeek);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const key = localIso(start);
  if (key === localIso(thisWeek)) return 'This week';
  if (key === localIso(nextWeek)) return 'Next week';
  return 'Week of ' + start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function setDayPickerReady(ready) {
  const submit = $('#bookSubmit');
  if (submit) submit.disabled = !ready;
}

function jobTypeHints() {
  const hint = $('#jobTypeHint');
  const group = $('#jobType');
  if (!hint || !group) return;
  const text = {
    'At my place': 'Mobile service at your location costs more because I bring the work to you.',
    'Drop it off': 'Drop-off service costs less when the repair can be done at my place.',
    'Not sure yet': 'Not sure is fine. The diagnostic decides the best place and how long the repair needs.',
  };
  group.addEventListener('change', (event) => {
    const value = event.target.value;
    if (text[value]) hint.textContent = text[value];
  });
}

/* ── booking form ─────────────────────────────────────────────────────── */
function wireForm() {
  const form = $('#bookForm');
  if (!form) return;
  const msg = $('#formMsg');
  const submit = $('#bookSubmit');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    // Honeypot: a bot fills every field it finds.
    if (form.elements.company && form.elements.company.value) return;

    const problems = validate(form);
    if (problems.length) {
      msg.className = 'form-msg is-err';
      msg.textContent = problems[0];
      const first = $('.is-invalid', form);
      if (first && first.focus) first.focus();
      return;
    }

    const payload = collect(form);
    bookingSubmitPending = true;
    submit.disabled = true;
    msg.className = 'form-msg';
    msg.textContent = 'Sending…';

    try {
      const response = await fetch(CONFIG.bookingEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      // Trust the body, not just the status. A rejection that still returns 200
      // would otherwise render the confirmation panel for a booking that was
      // never taken — and a 409 is a real answer, not a failure.
      const result = await readJson(response);

      // Someone claimed that day between page load and submit. Nothing the
      // customer did wrong, and nothing they typed should be lost.
      if (result && result.reason === 'day_taken') {
        bookingSubmitPending = false;
        await showDayTaken(form, payload, result.open);
        return;
      }

      if (!response.ok) throw new Error('HTTP ' + response.status);
      if (!result || result.ok !== true) throw new Error('rejected');
      const held = result.dayHeld === true || result.calendarHeld === true;
      if (!held) throw new Error('day_not_held');
      bookingSubmitPending = false;
      showSent(form, payload, held);
    } catch (err) {
      bookingSubmitPending = false;
      submit.disabled = false;
      msg.className = 'form-msg is-err';
      // Never swallow a lead. With a number configured, hand them a pre-filled
      // text; without one, tell them to try again rather than pretend it sent.
      msg.innerHTML = hasPhone()
        ? "That didn't go through. Text it to me instead: " +
          '<a href="' + smsLink(payload) + '">' + CONFIG.phoneDisplay + '</a>'
        : "That didn't go through — my end, not yours. Give it another try in a moment.";
    }
  });

  form.addEventListener('input', (event) => {
    if (event.target.classList) event.target.classList.remove('is-invalid');
  });
}

// A booking is successful only when the backend returns explicit JSON proof.
async function readJson(response) {
  try {
    if (typeof response.json !== 'function') return null;
    return await response.json();
  } catch (err) {
    return null;
  }
}

function validate(form) {
  const problems = [];
  const need = [
    ['issue', 'Tell me what the car is doing.'],
    ['year', 'Pick the year.'],
    ['make', 'What make is it?'],
    ['model', 'What model is it?'],
    ['name', 'I need a name.'],
    ['phone', 'I need a cell to text you back.'],
  ];

  for (const [field, message] of need) {
    const el = form.elements[field];
    if (!el || !String(el.value).trim()) {
      if (el) el.classList.add('is-invalid');
      problems.push(message);
    }
  }

  const phone = form.elements.phone;
  if (phone && phone.value.replace(/\D/g, '').length < 10 && !problems.includes('I need a cell to text you back.')) {
    phone.classList.add('is-invalid');
    problems.push('That phone number is short a few digits.');
  }

  const email = form.elements.email;
  if (email && email.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
    email.classList.add('is-invalid');
    problems.push('That email looks off.');
  }

  if (!form.querySelector('input[name="day"]:checked')) {
    $('#days').classList.add('is-invalid');
    problems.push('Pick a day.');
  }

  return problems;
}

function collect(form) {
  const data = new FormData(form);
  const get = (key) => String(data.get(key) || '').trim();
  return {
    source: 'gold-mobile-mechanic-site',
    submittedAt: new Date().toISOString(),
    name: get('name'),
    phone: get('phone'),
    email: get('email'),
    location: get('location'),
    issue: get('issue'),
    year: get('year'),
    make: get('make'),
    model: get('model'),
    vehicle: [get('year'), get('make'), get('model')].filter(Boolean).join(' '),
    jobType: get('jobType'),
    requestedDay: get('day'),
    pageUrl: window.location.href,
  };
}

function smsLink(payload) {
  const body = [
    'Booking request — ' + payload.name,
    payload.vehicle,
    payload.issue,
    'Day: ' + payload.requestedDay,
  ].join(' | ');
  return 'sms:' + CONFIG.phone + '?&body=' + encodeURIComponent(body);
}

// The requested day went to someone else. Redraw the picker from the days the
// server says are still open and leave every other field exactly as typed.
async function showDayTaken(form, payload, open) {
  const msg = $('#formMsg');
  const submit = $('#bookSubmit');
  const supplied = Array.isArray(open)
    ? open.filter((iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso))
    : null;
  const days = supplied === null ? await fetchOpenDays() : supplied;

  renderDays(days);

  const day = new Date(payload.requestedDay + 'T12:00:00');
  const pretty = day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  if (submit) submit.disabled = !Array.isArray(days) || days.length === 0;
  if (msg) {
    msg.className = 'form-msg is-err';
    msg.textContent = pretty + ' just got claimed — one car a day, so it is off the board. ' +
      'Everything you typed is still here: pick another day below and send it.';
  }
  const wrap = $('#days');
  if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showSent(form, payload, dayHeld) {
  const day = new Date(payload.requestedDay + 'T12:00:00');
  const pretty = day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const body = dayHeld
    ? '<h3>Day requested</h3>' +
      '<p>' + escapeHtml(pretty) + ' for the ' + escapeHtml(payload.vehicle) + '.</p>' +
      '<p class="hint">That day is now off the board &mdash; nobody else can claim it. I text back to confirm the time and the price range.</p>'
    // Defensive fallback. The submit path currently refuses to call this unless
    // the booking board proves the day is held.
    : '<h3>Got your details</h3>' +
      '<p>' + escapeHtml(payload.vehicle) + ', for ' + escapeHtml(pretty) + '.</p>' +
      '<p class="hint">The schedule did not take the hold, so I am scheduling this one by hand. I will reach out personally to lock the day in. Nothing is lost &mdash; I have everything you sent.</p>';

  form.innerHTML =
    '<div class="sent">' +
    '<div class="sent-mark" aria-hidden="true">' + (dayHeld ? '✓' : '!') + '</div>' +
    body +
    (hasPhone()
      ? '<p class="hint">Need it sooner? Call <a href="tel:' + CONFIG.phone + '">' + CONFIG.phoneDisplay + '</a>.</p>'
      : '') +
    '</div>';
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* ── voice agent ──────────────────────────────────────────────────────── */
function wireVoice() {
  const agentId = String(CONFIG.elevenLabsAgentId || '').trim();
  const shell = $('#voice');

  if (agentId) {
    mountElevenLabs(agentId);
    if (shell) shell.remove();
    $$('[data-open-voice]').forEach((btn) => {
      btn.addEventListener('click', () => pulseWidget());
    });
    return;
  }

  // No agent configured yet — branded button still works, routed to phone/form.
  if (!shell) return;
  const fab = $('#voiceFab');
  const panel = $('#voicePanel');
  const close = $('#voiceClose');
  $('#voiceFallback').hidden = false;

  const open = () => {
    shell.dataset.state = 'open';
    panel.hidden = false;
    fab.setAttribute('aria-expanded', 'true');
    close.focus();
  };
  const shut = () => {
    shell.dataset.state = 'idle';
    panel.hidden = true;
    fab.setAttribute('aria-expanded', 'false');
  };

  fab.addEventListener('click', open);
  close.addEventListener('click', shut);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') shut(); });
  $$('[data-open-voice]').forEach((btn) => btn.addEventListener('click', open));
}

function mountElevenLabs(agentId) {
  const el = document.createElement('elevenlabs-convai');
  el.setAttribute('agent-id', agentId);
  el.setAttribute('avatar-orb-color-1', '#f4dfa6');
  el.setAttribute('avatar-orb-color-2', '#a8842f');
  el.setAttribute('action-text', 'Talk to the shop');
  el.setAttribute('start-call-text', 'Start talking');
  el.setAttribute('end-call-text', 'Hang up');
  el.setAttribute('listening-text', 'Listening');
  el.setAttribute('speaking-text', 'Talking');
  el.id = 'convaiWidget';
  document.body.appendChild(el);

  const script = document.createElement('script');
  script.src = 'https://unpkg.com/@elevenlabs/convai-widget-embed';
  script.async = true;
  document.body.appendChild(script);
}

// The widget owns its own shadow DOM. Try to press its button; if the internals
// have changed, draw the eye to it instead of failing silently.
function pulseWidget() {
  const widget = document.getElementById('convaiWidget');
  if (!widget) return;
  const button = widget.shadowRoot && widget.shadowRoot.querySelector('button');
  if (button) { button.click(); return; }
  widget.animate(
    [{ filter: 'brightness(1)' }, { filter: 'brightness(1.9)' }, { filter: 'brightness(1)' }],
    { duration: 520, iterations: 3 }
  );
}

/* ── hero ─────────────────────────────────────────────────────────────── */
function bootHero() {
  const video = $('#heroVideo');
  const canvas = $('#heroCanvas');
  const context = canvas && canvas.getContext('2d', { alpha: false });
  const section = $('.hero-scroll');
  const fill = $('#stateFill');
  const before = $('#stateBefore');
  const after = $('#stateAfter');
  const repairs = $$('#repairCycle li');

  if (!video || !canvas || !context || !section) {
    document.body.classList.add('hero-video-failed');
    return;
  }

  let targetProgress = 0;
  let displayedProgress = 0;
  let frame = 0;
  let ready = false;
  let initialized = false;
  let activeRepair = -1;

  const resizeCanvas = () => {
    const density = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(window.innerWidth * density));
    const height = Math.max(1, Math.round(window.innerHeight * density));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  };

  const drawVideoFrame = () => {
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    resizeCanvas();
    const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
    const width = video.videoWidth * scale;
    const height = video.videoHeight * scale;
    const x = (canvas.width - width) / 2;
    const y = (canvas.height - height) / 2;
    context.fillStyle = '#0b0c0d';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(video, x, y, width, height);
  };

  const paintProgress = (progress) => {
    if (fill) fill.style.width = (progress * 100).toFixed(1) + '%';
    if (before) before.style.opacity = String(1 - progress * 0.78);
    if (after) after.style.opacity = String(0.28 + progress * 0.72);
    if (repairs.length) {
      const nextRepair = Math.min(repairs.length - 1, Math.floor(progress * repairs.length));
      if (nextRepair !== activeRepair) {
        repairs.forEach((repair, index) => repair.classList.toggle('is-active', index === nextRepair));
        activeRepair = nextRepair;
      }
    }
  };

  const seek = () => {
    if (!ready || !Number.isFinite(video.duration) || video.duration <= 0) {
      frame = 0;
      return;
    }

    displayedProgress += (targetProgress - displayedProgress) * 0.22;
    if (Math.abs(targetProgress - displayedProgress) < 0.0005) displayedProgress = targetProgress;

    const safeEnd = Math.max(0, video.duration - 0.04);
    const wantedTime = Math.min(safeEnd, displayedProgress * safeEnd);
    if (!video.seeking && Math.abs(video.currentTime - wantedTime) > 0.018) video.currentTime = wantedTime;
    paintProgress(displayedProgress);

    const targetTime = Math.min(safeEnd, targetProgress * safeEnd);
    const caughtUp = displayedProgress === targetProgress &&
      !video.seeking && Math.abs(video.currentTime - targetTime) <= 0.024;
    if (caughtUp) frame = 0;
    else frame = requestAnimationFrame(seek);
  };

  const readScroll = () => {
    const rect = section.getBoundingClientRect();
    const scrollable = section.offsetHeight - window.innerHeight;
    targetProgress = scrollable > 0
      ? Math.min(1, Math.max(0, -rect.top / scrollable))
      : 0;
    if (!frame) frame = requestAnimationFrame(seek);
  };

  const markReady = () => {
    if (initialized) return;
    initialized = true;

    const finish = () => {
      drawVideoFrame();
      video.pause();
      ready = true;
      readScroll();
    };
    const finishAfterFirstFrame = () => {
      if (typeof video.requestVideoFrameCallback === 'function') {
        video.requestVideoFrameCallback(finish);
      } else {
        requestAnimationFrame(() => requestAnimationFrame(finish));
      }
    };
    const playback = video.play();
    if (playback && typeof playback.then === 'function') playback.then(finishAfterFirstFrame).catch(finish);
    else finishAfterFirstFrame();
  };

  video.addEventListener('loadeddata', markReady, { once: true });
  video.addEventListener('seeked', drawVideoFrame);
  video.addEventListener('error', () => document.body.classList.add('hero-video-failed'), { once: true });
  window.addEventListener('scroll', readScroll, { passive: true });
  window.addEventListener('resize', () => {
    drawVideoFrame();
    readScroll();
  }, { passive: true });
  resizeCanvas();
  paintProgress(0);
  readScroll();

  if (video.readyState >= 2) markReady();
}
