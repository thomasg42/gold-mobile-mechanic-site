/* Gold Mobile Mechanic — diagnose.html behaviour.
   Deliberately small: this page has no booking form and no 3D hero, so it
   reuses only the pieces of the main site.js it actually needs (phone
   handling, sticky nav, voice widget) rather than importing that whole file. */

export const CONFIG = {
  // ElevenLabs Conversational AI agent — Ken in DIAGNOSIS MODE. This is a
  // separate agent id from the booking-line Ken on the main page; see
  // DIAGNOSIS_AGENT.md for why they're kept apart and how to set this one up.
  // Blank on purpose until that agent exists — the page degrades to the
  // symptom/tool reference plus a "voice line not connected yet" message,
  // exactly like the booking page does with a blank agent id.
  elevenLabsAgentId: '',

  // Same phone gate as the main site: blank means every call-to-call is
  // removed rather than publishing a stale number.
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
  renderToolIcons();
  wireVoice();
});

/* ── phone ────────────────────────────────────────────────────────────── */
function applyPhone() {
  const on = hasPhone();
  $$('[data-call]').forEach((el) => {
    if (!on) { el.remove(); return; }
    el.setAttribute('href', 'tel:' + CONFIG.phone);
    if (!el.textContent.trim()) el.textContent = CONFIG.phoneDisplay;
  });
  if (!on) $$('[data-call-line]').forEach((el) => el.remove());
}

/* ── nav ──────────────────────────────────────────────────────────────── */
function stickyNav() {
  const nav = $('#nav');
  if (!nav) return;
  const onScroll = () => nav.classList.toggle('is-stuck', window.scrollY > 40);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

function fillYear() {
  const el = $('#year');
  if (el) el.textContent = String(new Date().getFullYear());
}

/* ── tool icons ───────────────────────────────────────────────────────── */
// One simple line-art SVG per tool, injected by data-tool so the markup only
// has to name the tool once and every instance stays visually identical.
// Original line-art, not photography — sidesteps licensing entirely and
// keeps the file weight near zero.
const TOOL_ICONS = {
  flashlight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h5l1.5 2H7.5L9 3Z"/><path d="M7.5 5h7v3l-2 2v9a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-9l-2-2V5Z"/><path d="M17 9h3M17 12h3.5M17 15h3"/></svg>',
  gauge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="6.5"/><path d="M9 8.2V12l3 2"/><path d="M15.5 9 20 6.3M15.5 12H20M15.5 15l4.5 2.7"/></svg>',
  tread: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.6"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M6 6l2.1 2.1M18 6l-2.1 2.1M6 18l2.1-2.1M18 18l-2.1-2.1"/></svg>',
  dipstick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13"/><ellipse cx="12" cy="19" rx="3.4" ry="2"/><path d="M9.6 15.5h4.8"/></svg>',
  jumper: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6v6a3 3 0 0 0 3 3h1"/><path d="M20 6v6a3 3 0 0 1-3 3h-1"/><path d="M4 4v4M6.5 4v4M20 4v4M17.5 4v4"/><path d="M8 15v4M16 15v4"/></svg>',
  rag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h11l5 5v9H4V5Z"/><path d="M15 5v5h5"/><path d="M8 13h6M8 16.5h4"/></svg>',
};

function renderToolIcons() {
  $$('[data-tool]').forEach((el) => {
    const svg = TOOL_ICONS[el.dataset.tool];
    if (svg) el.innerHTML = svg;
  });
}

/* ── voice agent ──────────────────────────────────────────────────────── */
function wireVoice() {
  const agentId = String(CONFIG.elevenLabsAgentId || '').trim();
  const shell = $('#voice');

  if (agentId) {
    mountElevenLabs(agentId);
    if (shell) shell.remove();
    $$('[data-open-voice]').forEach((btn) => btn.addEventListener('click', () => pulseWidget()));
    return;
  }

  // No agent configured yet — branded button still works, routed to the
  // symptom reference and the booking form instead of a live conversation.
  if (!shell) return;
  const fab = $('#voiceFab');
  const panel = $('#voicePanel');
  const close = $('#voiceClose');
  const fallback = $('#voiceFallback');
  if (fallback) fallback.hidden = false;

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
  el.setAttribute('action-text', 'Talk to Ken');
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
