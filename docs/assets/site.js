/* Gold Mobile Mechanic — site behaviour.
   Everything configurable lives in CONFIG so the site can be re-pointed
   without reading the rest of this file. */

import { initHero3D } from './hero3d.js';

export const CONFIG = {
  // n8n webhook that receives a booking request. See wiki build page for the
  // workflow. Leave as-is unless the workflow is moved.
  bookingEndpoint: 'https://tggai.app.n8n.cloud/webhook/gmm-booking',

  // Read-only companion to the booking webhook: returns the days still open,
  // with anything already claimed on the calendar removed. Same workflow.
  availabilityEndpoint: 'https://tggai.app.n8n.cloud/webhook/gmm-availability',
  availabilityTimeoutMs: 7000,

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

// Google Calendar is the single source of truth, but polling it on a timer
// burns n8n executions for no reason — nobody is looking at stale chips while
// a tab sits in the background. Refresh only when a person is actually there:
// on load (see DOMContentLoaded), and again when they land back on the tab.
// A saved manual/voice event still disappears without a manual reload, just
// not on a fixed clock. The booking POST still re-checks the day server-side
// as the final word before any hold is created.
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

// Days the calendar says are still free. Null on any failure — never a partial
// or invented list, because a wrong "open" here books two cars on one day.
async function fetchOpenDays() {
  const endpoint = String(CONFIG.availabilityEndpoint || '').trim();
  if (!endpoint || typeof fetch !== 'function') return null;

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), CONFIG.availabilityTimeoutMs)
    : null;

  try {
    const options = { method: 'GET', cache: 'no-store' };
    if (controller) options.signal = controller.signal;
    const response = await fetch(endpoint, options);
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

  // Fail closed. If the calendar cannot be checked, do not invent dates that
  // may already belong to somebody else.
  if (!Array.isArray(isoDays)) {
    wrap.innerHTML = '<div class="days-note">I cannot verify the calendar right now, so no days are being shown. ' +
      '<button type="button" class="days-retry" data-retry-days>Check again</button></div>';
    setDayPickerReady(false);
    return;
  }

  if (!isoDays.length) {
    wrap.innerHTML = '<div class="days-note">Every day on the board is claimed right now. ' +
      '<button type="button" class="days-retry" data-retry-days>Check again</button></div>';
    setDayPickerReady(false);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const iso of isoDays) {
    // Noon, so a timezone offset can never roll the label onto the wrong date.
    const date = new Date(iso + 'T12:00:00');
    const label = document.createElement('label');
    label.className = 'day';
    label.innerHTML =
      '<input type="radio" name="day" value="' + iso + '"' + (iso === selectedDay ? ' checked' : '') + '>' +
      '<span><span class="d-dow">' + dows[date.getDay()] + '</span>' +
      '<span class="d-date">' + (date.getMonth() + 1) + '/' + date.getDate() + '</span></span>';
    frag.appendChild(label);
  }
  wrap.appendChild(frag);
  setDayPickerReady(true);
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
      if (result && result.ok === false) throw new Error('rejected');
      // The request landed, but the calendar may not have taken the hold. Say so
      // rather than promising a day that was never actually held.
      const held = !result || result.calendarHeld !== false;
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

// A 2xx with an empty or non-JSON body is a success, not a failure — only an
// explicit {ok:false} counts as a rejection. Written defensively so a body that
// cannot be parsed never turns a real booking into an error message.
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

function showSent(form, payload, calendarHeld) {
  const day = new Date(payload.requestedDay + 'T12:00:00');
  const pretty = day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const body = calendarHeld
    ? '<h3>Day requested</h3>' +
      '<p>' + escapeHtml(pretty) + ' for the ' + escapeHtml(payload.vehicle) + '.</p>' +
      '<p class="hint">That day is now off the board &mdash; nobody else can claim it. I text back to confirm the time and the price range.</p>'
    // Calendar refused the hold. Do not imply the day is spoken for.
    : '<h3>Got your details</h3>' +
      '<p>' + escapeHtml(payload.vehicle) + ', for ' + escapeHtml(pretty) + '.</p>' +
      '<p class="hint">My calendar did not take the hold, so I am scheduling this one by hand. I will reach out personally to lock the day in. Nothing is lost &mdash; I have everything you sent.</p>';

  form.innerHTML =
    '<div class="sent">' +
    '<div class="sent-mark" aria-hidden="true">' + (calendarHeld ? '✓' : '!') + '</div>' +
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
  const canvas = $('#heroCanvas');
  const section = $('.hero-scroll');
  const layer = $('#heroHotspots');
  const fill = $('#stateFill');
  const before = $('#stateBefore');
  const after = $('#stateAfter');

  if (!canvas || !section || !supportsWebGL()) {
    document.body.classList.add('no-webgl');
    return;
  }

  const scene = initHero3D({
    canvas,
    section,
    layer,
    onProgress: (p) => {
      if (fill) fill.style.width = (p * 100).toFixed(1) + '%';
      if (before) before.style.opacity = String(1 - p * 0.78);
      if (after) after.style.opacity = String(0.28 + p * 0.72);
    },
  });

  if (!scene) document.body.classList.add('no-webgl');
}

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl2') || canvas.getContext('webgl'))
    );
  } catch (err) {
    return false;
  }
}
