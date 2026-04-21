import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// ------------------------------------------------------------------
// Boot / env
// ------------------------------------------------------------------
const { SUPABASE_URL, SUPABASE_ANON_KEY } = (window.ENV || {});

const $ = (sel, root = document) => (typeof sel === 'string' && sel.startsWith('#')
  ? root.querySelector(sel)
  : root.querySelector('#' + sel));
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  document.body.innerHTML = '<p style="padding:24px;color:#f87171;">Missing SUPABASE env vars.</p>';
  throw new Error('missing-env');
}

// Implicit flow — magic-link redirects put tokens in the URL hash (no PKCE
// code_verifier needed, which would break across browsers/clients).
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'implicit',
    storageKey: 'pack.auth.v1',
  },
});

function cleanAuthParamsFromUrl() {
  const url = new URL(window.location.href);
  let dirty = false;
  if (url.hash && /access_token|refresh_token|error|type=/.test(url.hash)) {
    url.hash = '';
    dirty = true;
  }
  for (const k of ['code', 'error', 'error_description', 'error_code', 'token_hash', 'type']) {
    if (url.searchParams.has(k)) {
      url.searchParams.delete(k);
      dirty = true;
    }
  }
  if (dirty) history.replaceState({}, '', url.toString());
}

function readHashError() {
  const h = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  const p = new URLSearchParams(h);
  const err = p.get('error') || p.get('error_code');
  if (!err) return null;
  return p.get('error_description') || err;
}

// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------
const LS_UNIT_KEY = 'pack.displayUnit';
const UNIT_CYCLE = ['g', 'kg', 'oz', 'lb'];

const WEATHER_TYPES = [
  { id: 'sunny', label: 'Sunny', emoji: '🌞' },
  { id: 'cold',  label: 'Cold',  emoji: '❄️' },
  { id: 'rain',  label: 'Rain',  emoji: '🌧' },
  { id: 'snow',  label: 'Snow',  emoji: '🌨' },
];

// Known outdoor / climbing / paragliding brand palettes. Keys are lowercase.
// `domain` is fetched via icon.horse to render a tiny logo image.
// abbr/bg/fg are the fallback badge shown when the logo fails to load.
const BRAND_STYLES = {
  'black diamond':      { abbr: 'BD',  bg: '#0a0a0a', fg: '#FFC82E', domain: 'blackdiamondequipment.com' },
  'patagonia':          { abbr: 'P',   bg: '#0B3C5D', fg: '#F4B942', domain: 'patagonia.com' },
  'arc\'teryx':         { abbr: 'Arc', bg: '#1A1A1A', fg: '#EFEFEF', domain: 'arcteryx.com' },
  'arcteryx':           { abbr: 'Arc', bg: '#1A1A1A', fg: '#EFEFEF', domain: 'arcteryx.com' },
  'the north face':     { abbr: 'TNF', bg: '#000000', fg: '#E8492D', domain: 'thenorthface.com' },
  'north face':         { abbr: 'TNF', bg: '#000000', fg: '#E8492D', domain: 'thenorthface.com' },
  'rei':                { abbr: 'REI', bg: '#006241', fg: '#FFFFFF', domain: 'rei.com' },
  'rei co-op':          { abbr: 'REI', bg: '#006241', fg: '#FFFFFF', domain: 'rei.com' },
  'mountain hardwear':  { abbr: 'MH',  bg: '#1B4E8C', fg: '#FFFFFF', domain: 'mountainhardwear.com' },
  'mammut':             { abbr: 'Mm',  bg: '#E4002B', fg: '#FFFFFF', domain: 'mammut.com' },
  'salewa':             { abbr: 'Sa',  bg: '#E30613', fg: '#FFFFFF', domain: 'salewa.com' },
  'petzl':              { abbr: 'Pz',  bg: '#F28C00', fg: '#000000', domain: 'petzl.com' },
  'osprey':             { abbr: 'Os',  bg: '#00857A', fg: '#FFFFFF', domain: 'osprey.com' },
  'gregory':            { abbr: 'Gr',  bg: '#2E4E3F', fg: '#FFFFFF', domain: 'gregorypacks.com' },
  'msr':                { abbr: 'MSR', bg: '#E60023', fg: '#FFFFFF', domain: 'msrgear.com' },
  'smartwool':          { abbr: 'SW',  bg: '#D7282F', fg: '#FFFFFF', domain: 'smartwool.com' },
  'la sportiva':        { abbr: 'LS',  bg: '#FFC200', fg: '#000000', domain: 'lasportiva.com' },
  'scarpa':             { abbr: 'Sc',  bg: '#E4032E', fg: '#FFFFFF', domain: 'scarpa.com' },
  'hyperlite mountain gear': { abbr: 'HMG', bg: '#C8C8C8', fg: '#000000', domain: 'hyperlitemountaingear.com' },
  'hyperlite':          { abbr: 'HMG', bg: '#C8C8C8', fg: '#000000', domain: 'hyperlitemountaingear.com' },
  'zpacks':             { abbr: 'Zp',  bg: '#2E7D32', fg: '#FFFFFF', domain: 'zpacks.com' },
  'ortovox':            { abbr: 'Ov',  bg: '#1F7A33', fg: '#FFFFFF', domain: 'ortovox.com' },
  'mystery ranch':      { abbr: 'MR',  bg: '#2F2F2F', fg: '#F28C00', domain: 'mysteryranch.com' },
  'dmm':                { abbr: 'DMM', bg: '#ED1C24', fg: '#FFFFFF', domain: 'dmmclimbing.com' },
  'edelrid':            { abbr: 'Ed',  bg: '#FFC220', fg: '#000000', domain: 'edelrid.com' },
  'fjallraven':         { abbr: 'Fj',  bg: '#B22222', fg: '#FFFFFF', domain: 'fjallraven.com' },
  'fjällräven':         { abbr: 'Fj',  bg: '#B22222', fg: '#FFFFFF', domain: 'fjallraven.com' },
  'columbia':           { abbr: 'Co',  bg: '#1B365C', fg: '#FFFFFF', domain: 'columbia.com' },
  'marmot':             { abbr: 'Mt',  bg: '#1A1A1A', fg: '#F28C00', domain: 'marmot.com' },
  'outdoor research':   { abbr: 'OR',  bg: '#3A4A5C', fg: '#FFFFFF', domain: 'outdoorresearch.com' },
  'sea to summit':      { abbr: 'S2S', bg: '#00A9CE', fg: '#FFFFFF', domain: 'seatosummit.com' },
  'therm-a-rest':       { abbr: 'TaR', bg: '#F4B942', fg: '#0B3C5D', domain: 'thermarest.com' },
  'thermarest':         { abbr: 'TaR', bg: '#F4B942', fg: '#0B3C5D', domain: 'thermarest.com' },
  'nemo':               { abbr: 'Ne',  bg: '#FF6B00', fg: '#FFFFFF', domain: 'nemoequipment.com' },
  'big agnes':          { abbr: 'BA',  bg: '#006633', fg: '#FFFFFF', domain: 'bigagnes.com' },
  'garmin':             { abbr: 'Ga',  bg: '#000000', fg: '#007CC3', domain: 'garmin.com' },
  'gopro':              { abbr: 'GP',  bg: '#000000', fg: '#FFFFFF', domain: 'gopro.com' },
  'ozone':              { abbr: 'Oz',  bg: '#000000', fg: '#FFCC00', domain: 'flyozone.com' },
  'advance':            { abbr: 'Ad',  bg: '#E4002B', fg: '#FFFFFF', domain: 'advance-thun.ch' },
  'icaro':              { abbr: 'Ic',  bg: '#0055A5', fg: '#FFFFFF', domain: 'icaro-paragliders.com' },
  'skywalk':            { abbr: 'Sk',  bg: '#003DA5', fg: '#FFFFFF', domain: 'skywalk.info' },
  'gin gliders':        { abbr: 'Gin', bg: '#E30613', fg: '#FFFFFF', domain: 'gingliders.com' },
  'niviuk':             { abbr: 'Nv',  bg: '#F28C00', fg: '#000000', domain: 'niviuk.com' },
  'supair':             { abbr: 'Sp',  bg: '#003B5C', fg: '#FFFFFF', domain: 'supair.com' },
  'gibbon':             { abbr: 'Gb',  bg: '#FF6B00', fg: '#FFFFFF', domain: 'gibbon-slacklines.com' },
  'balance community':  { abbr: 'BC',  bg: '#228B22', fg: '#FFFFFF', domain: 'balancecommunity.com' },
  'slackline industries': { abbr: 'SLI', bg: '#FF4500', fg: '#FFFFFF', domain: 'slacklineindustries.com' },
};

// ------------------------------------------------------------------
// State (module-level)
// ------------------------------------------------------------------
let currentUser = null;
let gearList = [];
let activities = [];
let itemsByActivity = {};             // activity_id -> array of activity_items rows
let customFiltersByActivity = {};     // activity_id -> array of custom_filters rows
let activeActivityId = null;
let displayUnit = localStorage.getItem(LS_UNIT_KEY) || 'g';
let gearSearchQuery = '';
let brandFilter = null;               // lowercase brand label, or null
let libraryEditMode = false;
let editingGearId = null;             // null = adding
let editingActivityId = null;         // null = adding
let dragState = null;

// ------------------------------------------------------------------
// DOM helpers
// ------------------------------------------------------------------
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) {
      for (const cc of c) {
        if (cc == null || cc === false) continue;
        el.appendChild(typeof cc === 'string' ? document.createTextNode(cc) : cc);
      }
    } else {
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
  }
  return el;
}

function escapeHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return null; }
}

function gearImageEl(url, { className = '', alt = '' } = {}) {
  if (!url) return h('div', { class: ('placeholder-img ' + className).trim() }, '🎒');
  const img = h('img', { src: url, alt, class: className, referrerpolicy: 'no-referrer' });
  let retriedProxy = false;
  img.addEventListener('error', () => {
    if (!retriedProxy && !url.startsWith('https://images.weserv.nl/')) {
      retriedProxy = true;
      img.src = 'https://images.weserv.nl/?url=' + encodeURIComponent(url.replace(/^https?:\/\//, ''));
      return;
    }
    img.replaceWith(h('div', { class: ('placeholder-img ' + className).trim() }, '🎒'));
  });
  return img;
}

// ------------------------------------------------------------------
// Unit conversion
// ------------------------------------------------------------------
const UNIT_TO_G = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592 };

function gramsToUnit(grams, unit) {
  if (grams == null || isNaN(grams)) return null;
  return grams / UNIT_TO_G[unit];
}
function unitToGrams(value, unit) {
  if (value == null || value === '' || isNaN(value)) return null;
  return Number(value) * UNIT_TO_G[unit];
}
function formatWeight(grams, unit = displayUnit) {
  if (grams == null || isNaN(grams)) return '—';
  const v = gramsToUnit(grams, unit);
  const decimals = (unit === 'g') ? 0 : (unit === 'kg' || unit === 'lb') ? 2 : 1;
  return `${v.toFixed(decimals)} ${unit}`;
}

// ------------------------------------------------------------------
// Brand styling
// ------------------------------------------------------------------
function brandAbbrFallback(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.map((w) => w[0]).join('').slice(0, 3).toUpperCase();
}
function hashHue(str) {
  let x = 0;
  for (let i = 0; i < str.length; i++) x = (x * 31 + str.charCodeAt(i)) >>> 0;
  return x % 360;
}
function brandStyle(brand) {
  if (!brand) return null;
  const key = brand.trim().toLowerCase();
  if (BRAND_STYLES[key]) return BRAND_STYLES[key];
  const hue = hashHue(key);
  return {
    abbr: brandAbbrFallback(brand),
    bg: `hsl(${hue} 55% 32%)`,
    fg: '#ffffff',
  };
}
function brandAbbrBadgeEl(brand, { title } = {}) {
  const s = brandStyle(brand);
  if (!s) return null;
  return h('span', {
    class: 'brand-badge brand-badge-abbr',
    style: `background: ${s.bg}; color: ${s.fg};`,
    title: title || brand,
  }, s.abbr);
}
function brandBadgeEl(brand, { title } = {}) {
  const s = brandStyle(brand);
  if (!s) return null;
  if (!s.domain) return brandAbbrBadgeEl(brand, { title });
  const label = title || brand;
  const img = h('img', {
    class: 'brand-badge brand-badge-logo',
    src: `https://icon.horse/icon/${s.domain}`,
    alt: label,
    title: label,
    loading: 'lazy',
    referrerpolicy: 'no-referrer',
  });
  img.addEventListener('error', () => {
    const fallback = brandAbbrBadgeEl(brand, { title });
    if (fallback) img.replaceWith(fallback);
    else img.remove();
  });
  return img;
}

// ------------------------------------------------------------------
// Toast
// ------------------------------------------------------------------
let toastTimeout = null;
function toast(message, kind = '') {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.className = `toast show ${kind}`.trim();
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    el.className = 'toast hidden';
  }, 3200);
}

// ------------------------------------------------------------------
// Auth view / main view toggling
// ------------------------------------------------------------------
function showAuth() {
  $('#auth-view').hidden = false;
  $('#main-view').hidden = true;
}
function showMain() {
  $('#auth-view').hidden = true;
  $('#main-view').hidden = false;
}

function setAuthStatus(msg, kind) {
  const el = $('#auth-status');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('error', kind === 'error');
  el.classList.toggle('ok', kind === 'ok');
}
function setStatus(msg, kind) {
  const el = $('#status');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('error', kind === 'error');
  el.classList.toggle('ok', kind === 'ok');
}

// ------------------------------------------------------------------
// Supabase data layer
// ------------------------------------------------------------------
async function loadAll() {
  setStatus('Loading…');
  const [gearRes, actRes, itemRes, filterRes] = await Promise.all([
    supabase.from('gear').select('*').order('created_at', { ascending: false }),
    supabase.from('activities').select('*').order('position', { ascending: true }),
    supabase.from('activity_items').select('*').order('position', { ascending: true }),
    supabase.from('custom_filters').select('*').order('position', { ascending: true }),
  ]);
  for (const [name, res] of [['gear', gearRes], ['activities', actRes], ['items', itemRes], ['filters', filterRes]]) {
    if (res.error) { setStatus(`Load ${name}: ${res.error.message}`, 'error'); return; }
  }
  gearList = gearRes.data || [];
  activities = actRes.data || [];
  itemsByActivity = {};
  for (const it of itemRes.data || []) {
    (itemsByActivity[it.activity_id] ||= []).push(it);
  }
  customFiltersByActivity = {};
  for (const f of filterRes.data || []) {
    (customFiltersByActivity[f.activity_id] ||= []).push(f);
  }
  if (!activeActivityId || !activities.some((a) => a.id === activeActivityId)) {
    activeActivityId = activities[0]?.id || null;
  }
  setStatus('');
  render();
}

function activeActivity() {
  return activities.find((a) => a.id === activeActivityId) || null;
}
function itemsFor(activityId) {
  return itemsByActivity[activityId] || [];
}
function customFiltersFor(activityId) {
  return customFiltersByActivity[activityId] || [];
}

// ------------------------------------------------------------------
// Rendering
// ------------------------------------------------------------------
function render() {
  renderLibrary();
  renderTabs();
  renderCustomFilterBar();
  renderWeatherFilter();
  renderActivity();
  renderUnitToggle();
  $('#gear-weight-unit').textContent = displayUnit;
}

function renderUnitToggle() {
  $('#unit-toggle').textContent = displayUnit;
}

function renderLibrary() {
  const list = $('#gear-list');
  const empty = $('#gear-empty');
  const count = $('#gear-count');
  const editToggle = $('#library-edit-toggle');
  list.innerHTML = '';

  renderBrandFilters();

  // If the currently-filtered brand no longer exists, clear it.
  if (brandFilter && !gearList.some((g) => (g.brand || '').trim().toLowerCase() === brandFilter)) {
    brandFilter = null;
  }

  const q = gearSearchQuery.trim().toLowerCase();
  let items = gearList;
  if (q) {
    items = items.filter((g) =>
      (g.name || '').toLowerCase().includes(q) ||
      (g.brand || '').toLowerCase().includes(q) ||
      (g.notes || '').toLowerCase().includes(q));
  }
  if (brandFilter) {
    items = items.filter((g) => (g.brand || '').trim().toLowerCase() === brandFilter);
  }

  count.textContent = gearList.length ? `${gearList.length}` : '';

  if (!gearList.length && libraryEditMode) libraryEditMode = false;
  list.classList.toggle('edit-mode', libraryEditMode);
  editToggle.textContent = libraryEditMode ? 'Done' : 'Edit';
  editToggle.setAttribute('aria-pressed', libraryEditMode ? 'true' : 'false');
  editToggle.disabled = !gearList.length;

  if (!gearList.length) {
    empty.classList.remove('hidden');
    list.classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');
  list.classList.remove('hidden');

  for (const gear of items) {
    list.appendChild(gearCard(gear));
  }
}

function renderBrandFilters() {
  const host = $('#brand-filter-pills');
  host.innerHTML = '';

  const counts = new Map();
  for (const g of gearList) {
    const label = (g.brand || '').trim();
    if (!label) continue;
    const key = label.toLowerCase();
    const entry = counts.get(key) || { label, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }

  if (counts.size < 2) {
    host.classList.add('hidden');
    return;
  }
  host.classList.remove('hidden');

  const entries = Array.from(counts.entries()).sort((a, b) => b[1].count - a[1].count);
  for (const [key, { label, count }] of entries) {
    const active = brandFilter === key;
    const pill = h('button', {
      class: 'brand-pill' + (active ? ' active' : ''),
      type: 'button',
      'aria-pressed': active ? 'true' : 'false',
      title: active ? 'Clear filter' : `Show only ${label}`,
      onclick: () => {
        brandFilter = active ? null : key;
        renderLibrary();
      },
    },
      brandBadgeEl(label),
      h('span', {}, label),
      h('span', { class: 'brand-pill-count' }, String(count)),
    );
    host.appendChild(pill);
  }
}

function gearCard(gear) {
  const img = gearImageEl(gear.image_url);
  const weight = h('div', { class: 'gear-weight' }, formatWeight(gear.weight_grams));
  const badge = brandBadgeEl(gear.brand);
  const ownedQty = Number.isFinite(gear.quantity) && gear.quantity >= 1 ? gear.quantity : 1;
  const qtyBadge = ownedQty > 1
    ? h('div', { class: 'gear-qty-badge', title: `You own ${ownedQty}` }, `×${ownedQty}`)
    : null;
  const right = h('div', { class: 'gear-right' }, badge, qtyBadge, weight);

  const meta = h('div', { class: 'gear-meta' },
    h('div', { class: 'gear-name' }, gear.name || 'Unnamed'),
    h('div', { class: 'gear-sub' },
      gear.brand ? h('span', {}, gear.brand) : null,
      gear.url ? h('a', {
        href: gear.url,
        target: '_blank',
        rel: 'noopener noreferrer',
        class: 'gear-sub-link',
        onclick: (e) => e.stopPropagation(),
        ondragstart: (e) => e.preventDefault(),
      }, escapeHost(gear.url) || 'link') : null,
    ),
  );

  const cardProps = { class: 'gear-card', dataset: { gearId: gear.id } };
  if (!libraryEditMode) {
    cardProps.draggable = 'true';
    cardProps.onclick = () => openEditGear(gear.id);
    cardProps.ondragstart = (e) => handleGearDragStart(e, gear.id);
    cardProps.ondragend = handleDragEnd;
  }

  const children = [img, meta, right];
  if (libraryEditMode) {
    const actions = h('div', { class: 'gear-card-actions' },
      h('button', {
        class: 'btn btn-ghost btn-sm',
        type: 'button',
        onclick: (e) => { e.stopPropagation(); openEditGear(gear.id); },
      }, 'Edit details'),
      h('button', {
        class: 'btn btn-danger btn-sm',
        type: 'button',
        onclick: (e) => { e.stopPropagation(); handleInlineDeleteGear(gear.id); },
      }, 'Delete'),
    );
    children.push(actions);
  }
  return h('div', cardProps, ...children);
}

function renderTabs() {
  const tabs = $('#activity-tabs');
  tabs.innerHTML = '';
  for (const a of activities) {
    const tab = h('button', {
      class: 'activity-tab' + (a.id === activeActivityId ? ' active' : ''),
      dataset: { activityId: a.id },
      role: 'tab',
      onclick: () => { activeActivityId = a.id; render(); },
      ondblclick: () => openEditActivity(a.id),
      ondragover: handleTabDragOver,
      ondragleave: handleTabDragLeave,
      ondrop: (e) => handleTabDrop(e, a.id),
    },
      a.emoji ? h('span', { class: 'activity-tab-emoji' }, a.emoji) : null,
      h('span', {}, a.name),
    );
    tabs.appendChild(tab);
  }
  const addBtn = h('button', {
    class: 'activity-tab activity-tab-add',
    onclick: () => openNewActivity(),
    title: 'Add activity',
  }, '+');
  tabs.appendChild(addBtn);
}

function renderCustomFilterBar() {
  const host = $('#custom-filter-pills');
  const hint = $('#custom-filter-hint');
  const wrap = $('#custom-filter');
  host.innerHTML = '';

  const activity = activeActivity();
  if (!activity) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');

  const filters = customFiltersFor(activity.id);
  const active = new Set(activity.active_custom_filter_ids || []);
  for (const f of filters) {
    const on = active.has(f.id);
    const pill = h('button', {
      class: 'custom-filter-pill' + (on ? ' active' : ''),
      type: 'button',
      title: 'Click to toggle · double-click to rename / delete',
      'aria-pressed': on ? 'true' : 'false',
      onclick: () => toggleActivityCustomFilter(activity.id, f.id),
      ondblclick: (e) => { e.preventDefault(); editCustomFilterPrompt(activity.id, f.id); },
    }, f.label);
    host.appendChild(pill);
  }
  const addBtn = h('button', {
    class: 'custom-filter-pill custom-filter-pill-add',
    type: 'button',
    title: 'Add a sub-filter',
    onclick: () => addCustomFilterPrompt(activity.id),
  }, '+');
  host.appendChild(addBtn);

  if (!filters.length) {
    hint.textContent = 'Click + to add sub-filters (e.g. Trad, Sport, Bouldering)';
  } else if (active.size) {
    hint.textContent = 'Showing equipment + items tagged for selected filters';
  } else {
    hint.textContent = 'All items';
  }
}

function renderWeatherFilter() {
  const host = $('#weather-toggles');
  const hint = $('#weather-filter-hint');
  const wrap = $('#weather-filter');
  host.innerHTML = '';

  const activity = activeActivity();
  if (!activity) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');

  const active = new Set(activity.active_weathers || []);
  for (const w of WEATHER_TYPES) {
    const on = active.has(w.id);
    const btn = h('button', {
      class: 'weather-toggle' + (on ? ' active' : ''),
      type: 'button',
      title: w.label,
      'aria-pressed': on ? 'true' : 'false',
      onclick: () => toggleActivityWeather(activity.id, w.id),
    },
      h('span', { class: 'weather-emoji' }, w.emoji),
      h('span', {}, w.label),
    );
    host.appendChild(btn);
  }
  hint.textContent = active.size ? 'Showing equipment + matching clothing' : 'All items';
}

function renderActivity() {
  const list = $('#activity-list');
  const empty = $('#activity-empty');
  const totalEl = $('#activity-total');
  const packedEl = $('#activity-packed');
  const resetBtn = $('#reset-checklist-btn');
  const editBtn = $('#edit-activity-btn');

  list.innerHTML = '';
  const activity = activeActivity();
  if (!activity) {
    empty.classList.add('hidden');
    totalEl.textContent = 'Total: —';
    packedEl.textContent = '';
    resetBtn.disabled = true;
    editBtn.disabled = true;
    return;
  }
  const items = itemsFor(activity.id);
  resetBtn.disabled = !items.length;
  editBtn.disabled = false;

  const activeWeather = new Set(activity.active_weathers || []);
  const activeCustom = new Set(activity.active_custom_filter_ids || []);
  const passWeather = (item) => {
    if (!activeWeather.size) return true;
    const tags = item.weather_tags || [];
    if (!tags.length) return true;
    return tags.some((t) => activeWeather.has(t));
  };
  const passCustom = (item) => {
    if (!activeCustom.size) return true;
    const tags = item.custom_filter_ids || [];
    if (!tags.length) return true;
    return tags.some((t) => activeCustom.has(t));
  };

  const visibleItems = [];
  for (const item of items) {
    const gear = gearList.find((g) => g.id === item.gear_id);
    if (!gear) continue;
    if (passWeather(item) && passCustom(item)) visibleItems.push({ item, gear });
  }

  if (!items.length || !visibleItems.length) {
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    for (const { item, gear } of visibleItems) {
      list.appendChild(activityItemRow(activity, item, gear));
    }
  }

  let total = 0, packed = 0, packedCount = 0;
  for (const { item, gear } of visibleItems) {
    const qty = Number.isFinite(item.quantity) && item.quantity >= 1 ? item.quantity : 1;
    const w = (gear.weight_grams || 0) * qty;
    total += w;
    if (item.packed) { packed += w; packedCount += 1; }
  }
  totalEl.textContent = `Total: ${formatWeight(total)}`;
  packedEl.textContent = visibleItems.length
    ? `${formatWeight(packed)} packed • ${packedCount}/${visibleItems.length} items`
    : '';
}

function activityItemRow(activity, item, gear) {
  const imgEl = gearImageEl(gear.image_url);

  const weatherSet = new Set(item.weather_tags || []);
  const weatherChips = h('div', {
    class: 'weather-chips',
    title: 'Tag this item by weather (leave blank for equipment)',
    onclick: (e) => e.stopPropagation(),
  },
    ...WEATHER_TYPES.map((w) => h('button', {
      class: 'weather-chip' + (weatherSet.has(w.id) ? ' active' : ''),
      type: 'button',
      title: w.label,
      'aria-pressed': weatherSet.has(w.id) ? 'true' : 'false',
      onclick: (e) => { e.stopPropagation(); toggleItemWeather(item.id, w.id); },
    }, w.emoji)),
  );

  const filters = customFiltersFor(activity.id);
  const customSet = new Set(item.custom_filter_ids || []);
  const customChips = filters.length
    ? h('div', {
        class: 'custom-chips',
        title: 'Tag this item by sub-filter (leave blank for equipment)',
        onclick: (e) => e.stopPropagation(),
      },
        ...filters.map((f) => h('button', {
          class: 'custom-chip' + (customSet.has(f.id) ? ' active' : ''),
          type: 'button',
          title: f.label,
          'aria-pressed': customSet.has(f.id) ? 'true' : 'false',
          onclick: (e) => { e.stopPropagation(); toggleItemCustomFilter(item.id, f.id); },
        }, f.label)),
      )
    : null;

  const ownedQty = Number.isFinite(gear.quantity) && gear.quantity >= 1 ? gear.quantity : 1;
  const itemQty = Number.isFinite(item.quantity) && item.quantity >= 1 ? item.quantity : 1;
  const showStepper = ownedQty > 1;
  const totalWeight = (gear.weight_grams || 0) * itemQty;

  const stepperEl = showStepper
    ? h('div', {
        class: 'item-qty',
        title: `You own ${ownedQty}`,
        onclick: (e) => e.stopPropagation(),
      },
        h('button', {
          class: 'item-qty-btn',
          type: 'button',
          disabled: itemQty <= 1,
          onclick: (e) => { e.stopPropagation(); setItemQuantity(item.id, itemQty - 1); },
        }, '−'),
        h('input', {
          class: 'item-qty-input',
          type: 'number',
          min: 1,
          step: 1,
          value: String(itemQty),
          onclick: (e) => e.stopPropagation(),
          onchange: (e) => setItemQuantity(item.id, parseInt(e.target.value, 10)),
        }),
        h('button', {
          class: 'item-qty-btn',
          type: 'button',
          onclick: (e) => { e.stopPropagation(); setItemQuantity(item.id, itemQty + 1); },
        }, '+'),
        h('span', { class: 'item-qty-owned muted' }, `/ ${ownedQty}`),
      )
    : null;

  const weightLabel = gear.weight_grams == null
    ? '—'
    : (itemQty > 1
        ? `${formatWeight(totalWeight)} (${itemQty}× ${formatWeight(gear.weight_grams)})`
        : formatWeight(gear.weight_grams));

  const row = h('div', {
    class: 'activity-item' + (item.packed ? ' packed' : ''),
    draggable: 'true',
    dataset: { gearId: gear.id, itemId: item.id },
    ondragstart: (e) => handleItemDragStart(e, activity.id, gear.id),
    ondragend: handleDragEnd,
    ondragover: handleItemDragOver,
    ondragleave: handleItemDragLeave,
    ondrop: (e) => handleItemDrop(e, activity.id, gear.id),
  },
    h('input', {
      type: 'checkbox',
      checked: item.packed,
      onchange: () => togglePacked(item.id, !item.packed),
      onclick: (e) => e.stopPropagation(),
    }),
    imgEl,
    h('div', { class: 'activity-item-meta' },
      h('div', { class: 'gear-name-row' }, gear.name || 'Unnamed'),
      h('div', { class: 'gear-sub-row' },
        [gear.brand, escapeHost(gear.url)].filter(Boolean).join(' • ')),
      stepperEl,
      customChips,
      weatherChips,
    ),
    h('div', { class: 'item-weight' }, weightLabel),
    h('button', {
      class: 'item-remove',
      title: 'Remove from this list',
      onclick: (e) => { e.stopPropagation(); removeGearFromActivity(activity.id, gear.id); },
    }, '×'),
  );
  return row;
}

// ------------------------------------------------------------------
// Mutations — gear library
// ------------------------------------------------------------------
function handleInlineDeleteGear(id) {
  const gear = gearList.find((g) => g.id === id);
  if (!gear) return;
  const usedIn = activities.filter((a) => itemsFor(a.id).some((i) => i.gear_id === id));
  const msg = usedIn.length
    ? `Delete "${gear.name}"? It will also be removed from: ${usedIn.map((a) => a.name).join(', ')}.`
    : `Delete "${gear.name}"?`;
  if (!confirm(msg)) return;
  deleteGear(id);
}

async function deleteGear(id) {
  const { error } = await supabase.from('gear').delete().eq('id', id);
  if (error) { toast(error.message, 'error'); return; }
  gearList = gearList.filter((g) => g.id !== id);
  for (const k of Object.keys(itemsByActivity)) {
    itemsByActivity[k] = itemsByActivity[k].filter((i) => i.gear_id !== id);
  }
  render();
}

// ------------------------------------------------------------------
// Mutations — activity items
// ------------------------------------------------------------------
async function togglePacked(itemId, packed) {
  const { error } = await supabase.from('activity_items').update({ packed }).eq('id', itemId);
  if (error) { toast(error.message, 'error'); return; }
  for (const arr of Object.values(itemsByActivity)) {
    const it = arr.find((i) => i.id === itemId);
    if (it) it.packed = packed;
  }
  render();
}

async function setItemQuantity(itemId, quantity) {
  const q = Math.max(1, Math.floor(Number(quantity) || 1));
  const { error } = await supabase.from('activity_items').update({ quantity: q }).eq('id', itemId);
  if (error) { toast(error.message, 'error'); return; }
  for (const arr of Object.values(itemsByActivity)) {
    const it = arr.find((i) => i.id === itemId);
    if (it) it.quantity = q;
  }
  render();
}

async function removeGearFromActivity(activityId, gearId) {
  const items = itemsFor(activityId);
  const item = items.find((i) => i.gear_id === gearId);
  if (!item) return;
  const { error } = await supabase.from('activity_items').delete().eq('id', item.id);
  if (error) { toast(error.message, 'error'); return; }
  itemsByActivity[activityId] = items.filter((i) => i.id !== item.id);
  render();
}

async function addGearToActivity(activityId, gearId) {
  if (!activityId) return;
  const existing = itemsFor(activityId).find((i) => i.gear_id === gearId);
  if (existing) {
    const q = (existing.quantity || 1) + 1;
    const { error } = await supabase.from('activity_items').update({ quantity: q }).eq('id', existing.id);
    if (error) { toast(error.message, 'error'); return; }
    existing.quantity = q;
    render();
    return;
  }
  const position = itemsFor(activityId).length;
  const { data, error } = await supabase
    .from('activity_items')
    .insert({ activity_id: activityId, gear_id: gearId, position, quantity: 1 })
    .select()
    .single();
  if (error) { toast(error.message, 'error'); return; }
  (itemsByActivity[activityId] ||= []).push(data);
  render();
}

async function reorderActivityItems(activityId, fromGearId, toGearId, position) {
  const items = itemsFor(activityId).slice();
  const fromIdx = items.findIndex((i) => i.gear_id === fromGearId);
  const toIdx = items.findIndex((i) => i.gear_id === toGearId);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
  const [moved] = items.splice(fromIdx, 1);
  let insertAt = items.findIndex((i) => i.gear_id === toGearId);
  if (position === 'below') insertAt += 1;
  items.splice(insertAt, 0, moved);
  itemsByActivity[activityId] = items;
  render();
  // Persist new positions.
  const updates = items.map((it, i) =>
    supabase.from('activity_items').update({ position: i }).eq('id', it.id)
  );
  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed) toast(failed.error.message, 'error');
}

function toggleInArray(arr, value) {
  const list = Array.isArray(arr) ? [...arr] : [];
  const idx = list.indexOf(value);
  if (idx === -1) list.push(value); else list.splice(idx, 1);
  return list;
}

async function toggleActivityWeather(activityId, weatherId) {
  const act = activities.find((a) => a.id === activityId);
  if (!act) return;
  const next = toggleInArray(act.active_weathers, weatherId);
  const { error } = await supabase.from('activities').update({ active_weathers: next }).eq('id', activityId);
  if (error) { toast(error.message, 'error'); return; }
  act.active_weathers = next;
  render();
}

async function toggleItemWeather(itemId, weatherId) {
  let item = null;
  for (const arr of Object.values(itemsByActivity)) {
    const it = arr.find((i) => i.id === itemId);
    if (it) { item = it; break; }
  }
  if (!item) return;
  const next = toggleInArray(item.weather_tags, weatherId);
  const { error } = await supabase.from('activity_items').update({ weather_tags: next }).eq('id', itemId);
  if (error) { toast(error.message, 'error'); return; }
  item.weather_tags = next;
  render();
}

async function toggleActivityCustomFilter(activityId, filterId) {
  const act = activities.find((a) => a.id === activityId);
  if (!act) return;
  const next = toggleInArray(act.active_custom_filter_ids, filterId);
  const { error } = await supabase.from('activities').update({ active_custom_filter_ids: next }).eq('id', activityId);
  if (error) { toast(error.message, 'error'); return; }
  act.active_custom_filter_ids = next;
  render();
}

async function toggleItemCustomFilter(itemId, filterId) {
  let item = null;
  for (const arr of Object.values(itemsByActivity)) {
    const it = arr.find((i) => i.id === itemId);
    if (it) { item = it; break; }
  }
  if (!item) return;
  const next = toggleInArray(item.custom_filter_ids, filterId);
  const { error } = await supabase.from('activity_items').update({ custom_filter_ids: next }).eq('id', itemId);
  if (error) { toast(error.message, 'error'); return; }
  item.custom_filter_ids = next;
  render();
}

async function addCustomFilterPrompt(activityId) {
  const label = prompt('Sub-filter label? (e.g. Trad, Sport, Multi-pitch)');
  if (!label || !label.trim()) return;
  const position = customFiltersFor(activityId).length;
  const { data, error } = await supabase
    .from('custom_filters')
    .insert({ activity_id: activityId, label: label.trim(), position })
    .select()
    .single();
  if (error) { toast(error.message, 'error'); return; }
  (customFiltersByActivity[activityId] ||= []).push(data);
  render();
}

async function editCustomFilterPrompt(activityId, filterId) {
  const f = customFiltersFor(activityId).find((x) => x.id === filterId);
  if (!f) return;
  const next = prompt(`Rename sub-filter "${f.label}" (empty to delete):`, f.label);
  if (next === null) return;
  const clean = next.trim();
  if (!clean) {
    if (!confirm(`Delete sub-filter "${f.label}"?`)) return;
    const { error } = await supabase.from('custom_filters').delete().eq('id', filterId);
    if (error) { toast(error.message, 'error'); return; }
    customFiltersByActivity[activityId] = customFiltersFor(activityId).filter((x) => x.id !== filterId);
    // Clean from activity.active_custom_filter_ids + item.custom_filter_ids
    const act = activities.find((a) => a.id === activityId);
    if (act && (act.active_custom_filter_ids || []).includes(filterId)) {
      act.active_custom_filter_ids = act.active_custom_filter_ids.filter((id) => id !== filterId);
    }
    for (const it of itemsFor(activityId)) {
      if ((it.custom_filter_ids || []).includes(filterId)) {
        it.custom_filter_ids = it.custom_filter_ids.filter((id) => id !== filterId);
      }
    }
    render();
    return;
  }
  const { error } = await supabase.from('custom_filters').update({ label: clean }).eq('id', filterId);
  if (error) { toast(error.message, 'error'); return; }
  f.label = clean;
  render();
}

async function resetChecklist(activityId) {
  const { error } = await supabase
    .from('activity_items')
    .update({ packed: false })
    .eq('activity_id', activityId);
  if (error) { toast(error.message, 'error'); return; }
  for (const it of itemsFor(activityId)) it.packed = false;
  render();
  toast('Checklist reset.', 'success');
}

// ------------------------------------------------------------------
// Drag & drop
// ------------------------------------------------------------------
function handleGearDragStart(e, gearId) {
  dragState = { kind: 'gear', gearId };
  e.dataTransfer.effectAllowed = 'copyMove';
  e.dataTransfer.setData('text/plain', 'gear:' + gearId);
  e.currentTarget.classList.add('dragging');
}
function handleItemDragStart(e, activityId, gearId) {
  dragState = { kind: 'item', activityId, gearId };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', 'item:' + activityId + ':' + gearId);
  e.currentTarget.classList.add('dragging');
  $('#remove-dropzone').classList.remove('hidden');
}
function handleDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  dragState = null;
  $('#remove-dropzone').classList.add('hidden');
  $$('.drop-target').forEach((el) => el.classList.remove('drop-target'));
  $$('.drop-above, .drop-below').forEach((el) => el.classList.remove('drop-above', 'drop-below'));
}
function handleTabDragOver(e) {
  if (!dragState || dragState.kind !== 'gear') return;
  e.preventDefault();
  e.currentTarget.classList.add('drop-target');
}
function handleTabDragLeave(e) { e.currentTarget.classList.remove('drop-target'); }
function handleTabDrop(e, activityId) {
  e.preventDefault();
  e.currentTarget.classList.remove('drop-target');
  if (dragState?.kind === 'gear') {
    addGearToActivity(activityId, dragState.gearId);
    activeActivityId = activityId;
    render();
  }
}
function handleBodyDragOver(e) {
  if (!dragState || dragState.kind !== 'gear') return;
  e.preventDefault();
  e.currentTarget.classList.add('drop-target');
}
function handleBodyDragLeave(e) {
  if (e.target === e.currentTarget) e.currentTarget.classList.remove('drop-target');
}
function handleBodyDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drop-target');
  if (dragState?.kind === 'gear' && activeActivityId) {
    addGearToActivity(activeActivityId, dragState.gearId);
  }
}
function handleItemDragOver(e) {
  if (!dragState) return;
  e.preventDefault();
  const row = e.currentTarget;
  if (dragState.kind === 'item' && dragState.gearId === row.dataset.gearId) return;
  const rect = row.getBoundingClientRect();
  const above = (e.clientY - rect.top) < rect.height / 2;
  row.classList.toggle('drop-above', above);
  row.classList.toggle('drop-below', !above);
}
function handleItemDragLeave(e) { e.currentTarget.classList.remove('drop-above', 'drop-below'); }
function handleItemDrop(e, activityId, targetGearId) {
  e.preventDefault();
  const row = e.currentTarget;
  const above = row.classList.contains('drop-above');
  row.classList.remove('drop-above', 'drop-below');
  if (!dragState) return;
  if (dragState.kind === 'item' && dragState.activityId === activityId) {
    reorderActivityItems(activityId, dragState.gearId, targetGearId, above ? 'above' : 'below');
  } else if (dragState.kind === 'gear') {
    addGearToActivity(activityId, dragState.gearId);
  }
  e.stopPropagation();
}
function handleRemoveDropzone() {
  if (dragState?.kind === 'item') {
    removeGearFromActivity(dragState.activityId, dragState.gearId);
  }
}

// ------------------------------------------------------------------
// Modals
// ------------------------------------------------------------------
function showModal(id) { $('#' + id).classList.remove('hidden'); }
function hideModal(id) { $('#' + id).classList.add('hidden'); }

// ------------------------------------------------------------------
// Gear modal (add / edit)
// ------------------------------------------------------------------
function resetGearForm() {
  editingGearId = null;
  $('#gear-modal-title').textContent = 'Add gear';
  $('#gear-name').value = '';
  $('#gear-brand').value = '';
  $('#gear-weight').value = '';
  $('#gear-quantity').value = '1';
  $('#gear-url').value = '';
  $('#gear-image').value = '';
  $('#gear-notes').value = '';
  $('#gear-delete-btn').classList.add('hidden');
  $('#fetch-status').textContent = '';
  resetScreenshotUI();
  resetGearSearchUI();
  updateGearPreview();
}

function setGearForm(gear) {
  $('#gear-name').value = gear.name || '';
  $('#gear-brand').value = gear.brand || '';
  const w = gear.weight_grams == null ? '' : gramsToUnit(gear.weight_grams, displayUnit);
  $('#gear-weight').value = w === '' ? '' : (displayUnit === 'g' ? String(Math.round(w)) : w.toFixed(2));
  $('#gear-quantity').value = String(gear.quantity ?? 1);
  $('#gear-url').value = gear.url || '';
  $('#gear-image').value = gear.image_url || '';
  $('#gear-notes').value = gear.notes || '';
  updateGearPreview();
}

function readGearForm() {
  const name = $('#gear-name').value.trim();
  const brand = $('#gear-brand').value.trim() || null;
  const weightRaw = $('#gear-weight').value;
  const qty = Math.max(1, Math.floor(Number($('#gear-quantity').value) || 1));
  const weight_grams = weightRaw === '' ? null : unitToGrams(weightRaw, displayUnit);
  return {
    name,
    brand,
    weight_grams,
    url: $('#gear-url').value.trim() || null,
    image_url: $('#gear-image').value.trim() || null,
    notes: $('#gear-notes').value.trim() || null,
    quantity: qty,
  };
}

function setPreviewLoading(on) {
  const wrap = document.querySelector('.gear-preview-img-wrap');
  if (!wrap) return;
  wrap.classList.toggle('loading', !!on);
}

function updateGearPreview() {
  const img = $('#gear-preview-img');
  const meta = $('#gear-preview-meta');
  const removeBtn = $('#gear-preview-img-remove');
  const url = $('#gear-image').value.trim();
  if (url) {
    img.referrerPolicy = 'no-referrer';
    img.dataset.retriedProxy = '';
    img.onerror = () => {
      if (!img.dataset.retriedProxy && !img.src.startsWith('https://images.weserv.nl/')) {
        img.dataset.retriedProxy = '1';
        img.src = 'https://images.weserv.nl/?url=' + encodeURIComponent(url.replace(/^https?:\/\//, ''));
      }
    };
    img.src = url;
    img.style.display = '';
    removeBtn.classList.remove('hidden');
  } else {
    img.removeAttribute('src');
    img.style.display = 'none';
    removeBtn.classList.add('hidden');
  }
  const name = $('#gear-name').value.trim();
  const brand = $('#gear-brand').value.trim();
  const weight = $('#gear-weight').value.trim();
  const parts = [name || '(no name)', brand, weight ? `${weight} ${displayUnit}` : null].filter(Boolean);
  meta.textContent = parts.join(' · ');
}

function openAddGear() {
  resetGearForm();
  showModal('gear-modal');
  requestAnimationFrame(() => $('#gear-url').focus());
}

function openEditGear(id) {
  const gear = gearList.find((g) => g.id === id);
  if (!gear) return;
  resetGearForm();
  editingGearId = id;
  $('#gear-modal-title').textContent = 'Edit gear';
  $('#gear-delete-btn').classList.remove('hidden');
  setGearForm(gear);
  showModal('gear-modal');
}

async function handleSaveGear() {
  const payload = readGearForm();
  if (!payload.name) { $('#fetch-status').textContent = 'Name is required.'; return; }
  if (editingGearId) {
    const { data, error } = await supabase.from('gear').update(payload).eq('id', editingGearId).select().single();
    if (error) { toast(error.message, 'error'); return; }
    const idx = gearList.findIndex((g) => g.id === editingGearId);
    if (idx >= 0) gearList[idx] = data;
    hideModal('gear-modal');
    render();
    return;
  }
  const { data, error } = await supabase.from('gear').insert(payload).select().single();
  if (error) { toast(error.message, 'error'); return; }
  gearList.unshift(data);
  hideModal('gear-modal');
  render();
}

async function handleDeleteGear() {
  if (!editingGearId) return;
  const gear = gearList.find((g) => g.id === editingGearId);
  if (!gear) return;
  const usedIn = activities.filter((a) => itemsFor(a.id).some((i) => i.gear_id === editingGearId));
  const msg = usedIn.length
    ? `Delete "${gear.name}"? It will also be removed from: ${usedIn.map((a) => a.name).join(', ')}.`
    : `Delete "${gear.name}"?`;
  if (!confirm(msg)) return;
  await deleteGear(editingGearId);
  hideModal('gear-modal');
}

// ------------------------------------------------------------------
// Gear extraction pipeline (URL + screenshot) — server-side Edge Function
// ------------------------------------------------------------------
function applyExtracted(data) {
  if (!data) return;
  const setIfEmpty = (id, val) => {
    if (val == null || val === '') return;
    const el = $('#' + id);
    if (!el.value) el.value = val;
  };
  setIfEmpty('gear-name', data.name);
  setIfEmpty('gear-brand', data.brand);
  setIfEmpty('gear-url', data.url);
  setIfEmpty('gear-image', data.imageUrl);
  setIfEmpty('gear-notes', data.notes);
  if (data.weightGrams != null && !$('#gear-weight').value) {
    const v = gramsToUnit(data.weightGrams, displayUnit);
    $('#gear-weight').value = displayUnit === 'g' ? String(Math.round(v)) : v.toFixed(2);
  }
  if (data.quantity != null && data.quantity > 1) {
    const qtyEl = $('#gear-quantity');
    if (!qtyEl.value || qtyEl.value === '1') qtyEl.value = String(data.quantity);
  }
  updateGearPreview();
}

async function callExtractGear(payload) {
  const { data, error } = await supabase.functions.invoke('extract-gear', { body: payload });
  if (error) {
    let detail = '';
    let status = '';
    const ctx = error.context;
    if (ctx) {
      if (typeof ctx.status === 'number') status = ` (${ctx.status})`;
      if (typeof ctx.text === 'function') {
        try {
          const text = await ctx.text();
          if (text) {
            try {
              const parsed = JSON.parse(text);
              detail = parsed?.error || text;
            } catch (_) { detail = text; }
          }
        } catch (_) {}
      }
    }
    const base = detail || error.message || 'Extraction failed';
    throw new Error(base.length > 200 ? base.slice(0, 200) + '…' + status : base + status);
  }
  return data || {};
}

// ------------------------------------------------------------------
// Gear search (autocomplete)
// ------------------------------------------------------------------
const SEARCH_DEBOUNCE_MS = 500;
const SEARCH_MIN_CHARS = 3;
const searchCache = new Map();
let searchDebounce = null;
let searchSeq = 0;

function resetGearSearchUI() {
  const input = $('#gear-search-input');
  if (input) input.value = '';
  hideGearSuggestions();
  $('#gear-search-status').textContent = '';
  $('#gear-search-spinner').classList.add('hidden');
  searchSeq++;
}

function hideGearSuggestions() {
  const box = $('#gear-search-suggestions');
  box.innerHTML = '';
  box.classList.add('hidden');
}

function renderGearSuggestions(items) {
  const box = $('#gear-search-suggestions');
  box.innerHTML = '';
  if (!items.length) {
    const empty = h('div', { class: 'gear-search-empty' }, 'No matches — try a more specific query.');
    box.appendChild(empty);
    box.classList.remove('hidden');
    return;
  }
  for (const item of items) {
    const btn = h('button', { type: 'button', class: 'gear-suggestion', role: 'option' });
    const body = h('div', { class: 'gear-suggestion-body' });
    body.appendChild(h('div', { class: 'gear-suggestion-name' }, item.name || '(unnamed)'));
    const metaParts = [];
    if (item.brand) metaParts.push(item.brand);
    if (item.weightGrams != null) {
      const v = gramsToUnit(item.weightGrams, displayUnit);
      metaParts.push(displayUnit === 'g' ? `${Math.round(v)} g` : `${v.toFixed(2)} ${displayUnit}`);
    }
    if (item.quantity && item.quantity > 1) metaParts.push(`${item.quantity}-pack`);
    if (metaParts.length) body.appendChild(h('div', { class: 'gear-suggestion-meta' }, metaParts.join(' · ')));
    btn.appendChild(body);
    btn.addEventListener('click', () => pickGearSuggestion(item));
    box.appendChild(btn);
  }
  box.classList.remove('hidden');
}

async function runGearSearch(query) {
  const mySeq = ++searchSeq;
  const status = $('#gear-search-status');
  const spinner = $('#gear-search-spinner');

  if (searchCache.has(query)) {
    const cached = searchCache.get(query);
    if (mySeq !== searchSeq) return;
    renderGearSuggestions(cached);
    status.textContent = cached.length ? '' : 'No matches.';
    return;
  }

  spinner.classList.remove('hidden');
  status.textContent = 'Searching the web…';
  try {
    const res = await callExtractGear({ query });
    if (mySeq !== searchSeq) return;
    const suggestions = Array.isArray(res.suggestions) ? res.suggestions : [];
    searchCache.set(query, suggestions);
    renderGearSuggestions(suggestions);
    status.textContent = suggestions.length ? '' : 'No matches — try a more specific query.';
  } catch (err) {
    if (mySeq !== searchSeq) return;
    status.textContent = err.message || 'Search failed';
    hideGearSuggestions();
  } finally {
    if (mySeq === searchSeq) spinner.classList.add('hidden');
  }
}

function onGearSearchInput() {
  const query = $('#gear-search-input').value.trim();
  if (searchDebounce) { clearTimeout(searchDebounce); searchDebounce = null; }
  if (query.length < SEARCH_MIN_CHARS) {
    searchSeq++;
    hideGearSuggestions();
    $('#gear-search-status').textContent = '';
    $('#gear-search-spinner').classList.add('hidden');
    return;
  }
  searchDebounce = setTimeout(() => runGearSearch(query), SEARCH_DEBOUNCE_MS);
}

async function pickGearSuggestion(item) {
  applyExtracted(item);
  hideGearSuggestions();
  $('#gear-search-input').value = item.name || '';
  setPreviewLoading(true);
  $('#gear-search-status').textContent = 'Fetching thumbnail…';

  let merged = { ...item };
  try {
    // 1) If the suggestion has a URL, use the URL-based pipeline —
    //    it's the most reliable for og:image + weight.
    if (item.url) {
      try {
        const res = await callExtractGear({ url: item.url });
        if (res.data) {
          merged = { ...merged, ...res.data };
          applyExtracted(merged);
        }
      } catch (_) { /* fall through to identity */ }
    }
    // 2) Always follow up with identity-based enrichment if we still
    //    don't have a thumbnail — guarantees a web-search attempt.
    if (!$('#gear-image').value && item.name) {
      const res = await callExtractGear({
        identity: { name: item.name, brand: item.brand || null },
      });
      if (res.data) {
        merged = { ...merged, ...res.data };
        applyExtracted(merged);
      }
    }
    $('#gear-search-status').textContent = $('#gear-image').value
      ? ''
      : 'No thumbnail found — you can still save.';
  } catch (err) {
    $('#gear-search-status').textContent = 'Couldn\u2019t enrich: ' + err.message;
  } finally {
    setPreviewLoading(false);
  }
}

async function extractFromUrl(url) {
  const status = $('#fetch-status');
  status.textContent = 'Fetching product page…';
  try {
    const res = await callExtractGear({ url });
    applyExtracted(res.data);
    status.textContent = 'Filled in what we could find — review and save.';
  } catch (err) {
    status.textContent = err.message;
  }
}

async function fileToResizedDataUrl(file, maxDim = 1600) {
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read file'));
    r.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Could not decode image'));
    i.src = dataUrl;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const H = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = H;
  canvas.getContext('2d').drawImage(img, 0, 0, w, H);
  const mediaType = 'image/jpeg';
  const resized = canvas.toDataURL(mediaType, 0.85);
  const base64 = resized.split(',')[1];
  return { base64, mediaType, dataUrl: resized };
}

function resetScreenshotUI() {
  const dz = $('#screenshot-dropzone');
  dz.querySelector('.dropzone-idle').classList.remove('hidden');
  dz.querySelector('.dropzone-preview').classList.add('hidden');
  $('#screenshot-preview').removeAttribute('src');
  setScreenshotProgress(null);
}

function setScreenshotState(which) {
  const dz = $('#screenshot-dropzone');
  dz.querySelector('.dropzone-idle').classList.toggle('hidden', which !== 'idle');
  dz.querySelector('.dropzone-preview').classList.toggle('hidden', which !== 'preview');
}

function setScreenshotProgress(text) {
  const wrap = $('#screenshot-progress');
  const label = $('#screenshot-status');
  if (!text) {
    wrap.classList.add('hidden');
    label.textContent = '';
    return;
  }
  label.textContent = text;
  wrap.classList.remove('hidden');
}

async function handleScreenshotFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  if ($('#gear-modal').classList.contains('hidden')) openAddGear();
  try {
    setScreenshotProgress('Preparing screenshot…');
    const { base64, mediaType, dataUrl } = await fileToResizedDataUrl(file);
    $('#screenshot-preview').src = dataUrl;
    setScreenshotState('preview');
    setScreenshotProgress('Reading the screenshot with Claude…');
    $('#fetch-status').textContent = '';
    const res = await callExtractGear({ image: { base64, mediaType } });
    applyExtracted(res.data);
    setScreenshotProgress(null);
    $('#fetch-status').textContent = 'Filled in what we could see — review and save.';
  } catch (err) {
    setScreenshotProgress(null);
    setScreenshotState($('#screenshot-preview').getAttribute('src') ? 'preview' : 'idle');
    $('#fetch-status').textContent = err.message || 'Could not read the screenshot.';
  }
}

// ------------------------------------------------------------------
// Activity modal
// ------------------------------------------------------------------
function openNewActivity() {
  editingActivityId = null;
  $('#activity-modal-title').textContent = 'New activity';
  $('#activity-name').value = '';
  $('#activity-emoji').value = '';
  $('#activity-delete-btn').classList.add('hidden');
  showModal('activity-modal');
  requestAnimationFrame(() => $('#activity-name').focus());
}

function openEditActivity(id) {
  const a = activities.find((x) => x.id === id);
  if (!a) return;
  editingActivityId = id;
  $('#activity-modal-title').textContent = 'Edit activity';
  $('#activity-name').value = a.name || '';
  $('#activity-emoji').value = a.emoji || '';
  $('#activity-delete-btn').classList.remove('hidden');
  showModal('activity-modal');
}

async function handleSaveActivity() {
  const name = $('#activity-name').value.trim();
  const emoji = $('#activity-emoji').value.trim() || null;
  if (!name) return;
  if (editingActivityId) {
    const { error } = await supabase.from('activities').update({ name, emoji }).eq('id', editingActivityId);
    if (error) { toast(error.message, 'error'); return; }
    const a = activities.find((x) => x.id === editingActivityId);
    if (a) { a.name = name; a.emoji = emoji; }
    hideModal('activity-modal');
    render();
    return;
  }
  const position = activities.length;
  const { data, error } = await supabase
    .from('activities')
    .insert({ name, emoji, position })
    .select()
    .single();
  if (error) { toast(error.message, 'error'); return; }
  activities.push(data);
  activeActivityId = data.id;
  hideModal('activity-modal');
  render();
}

async function handleDeleteActivity() {
  if (!editingActivityId) return;
  const a = activities.find((x) => x.id === editingActivityId);
  if (!a) return;
  if (!confirm(`Delete "${a.name}" and all its items?`)) return;
  const { error } = await supabase.from('activities').delete().eq('id', editingActivityId);
  if (error) { toast(error.message, 'error'); return; }
  activities = activities.filter((x) => x.id !== editingActivityId);
  delete itemsByActivity[editingActivityId];
  delete customFiltersByActivity[editingActivityId];
  if (activeActivityId === editingActivityId) {
    activeActivityId = activities[0]?.id || null;
  }
  hideModal('activity-modal');
  render();
}

// ------------------------------------------------------------------
// Wiring
// ------------------------------------------------------------------
function wire() {
  // Header
  $('#add-gear-btn').addEventListener('click', openAddGear);
  $('#unit-toggle').addEventListener('click', () => {
    const i = UNIT_CYCLE.indexOf(displayUnit);
    displayUnit = UNIT_CYCLE[(i + 1) % UNIT_CYCLE.length];
    localStorage.setItem(LS_UNIT_KEY, displayUnit);
    render();
  });
  $('#sign-out-btn').addEventListener('click', () => supabase.auth.signOut());

  // Auth: toggle between chooser and signup form
  $('#show-signup-btn').addEventListener('click', () => {
    $('#auth-chooser').hidden = true;
    $('#auth-signup').hidden = false;
    setAuthStatus('');
    setTimeout(() => $('#signup-name').focus(), 0);
  });
  $('#signup-back-btn').addEventListener('click', () => {
    $('#auth-signup').hidden = true;
    $('#auth-chooser').hidden = false;
    setAuthStatus('');
  });

  // Sign up form (new user) — collects name + email, sends magic link
  $('#signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#signup-name').value.trim();
    const email = $('#signup-email').value.trim();
    if (!name || !email) return;
    $('#signup-submit').disabled = true;
    setAuthStatus('Creating your account…');
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
        shouldCreateUser: true,
        data: { full_name: name },
      },
    });
    $('#signup-submit').disabled = false;
    if (error) { setAuthStatus(`Could not send: ${error.message}`, 'error'); return; }
    setAuthStatus(`Check ${email} — click the link to finish signing up. You can close this tab.`, 'ok');
  });

  // Sign in form (existing user) — email only, magic link
  $('#signin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#signin-email').value.trim();
    if (!email) return;
    $('#signin-submit').disabled = true;
    setAuthStatus('Sending magic link…');
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin, shouldCreateUser: false },
    });
    $('#signin-submit').disabled = false;
    if (error) {
      const msg = /signups not allowed|user not found|not_found/i.test(error.message)
        ? `No account for ${email}. Try "Sign up as a new user" above.`
        : `Could not send: ${error.message}`;
      setAuthStatus(msg, 'error');
      return;
    }
    setAuthStatus(`Check ${email} — click the link to sign in. You can close this tab.`, 'ok');
  });

  // Gear search
  $('#gear-search').addEventListener('input', (e) => {
    gearSearchQuery = e.target.value;
    renderLibrary();
  });

  // Library edit mode
  $('#library-edit-toggle').addEventListener('click', () => {
    libraryEditMode = !libraryEditMode;
    renderLibrary();
  });

  // Activity footer
  $('#reset-checklist-btn').addEventListener('click', () => {
    if (!activeActivityId) return;
    const a = activeActivity();
    if (!a) return;
    const items = itemsFor(a.id);
    if (!items.length) return;
    if (!confirm(`Uncheck all ${items.length} items in "${a.name}"?`)) return;
    resetChecklist(a.id);
  });
  $('#edit-activity-btn').addEventListener('click', () => {
    if (activeActivityId) openEditActivity(activeActivityId);
  });

  // Gear modal
  $('#fetch-details-btn').addEventListener('click', () => {
    const url = $('#gear-url').value.trim();
    if (!url) return;
    extractFromUrl(url);
  });
  $('#gear-search-input').addEventListener('input', onGearSearchInput);
  $('#gear-search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hideGearSuggestions(); }
  });
  document.addEventListener('click', (e) => {
    const within = e.target.closest && e.target.closest('.gear-search-field');
    if (!within) hideGearSuggestions();
  });
  $('#gear-save-btn').addEventListener('click', handleSaveGear);
  $('#gear-delete-btn').addEventListener('click', handleDeleteGear);
  ['gear-name', 'gear-brand', 'gear-weight', 'gear-image'].forEach((id) => {
    $('#' + id).addEventListener('input', updateGearPreview);
  });
  $('#gear-preview-img-remove').addEventListener('click', () => {
    $('#gear-image').value = '';
    updateGearPreview();
  });

  // Activity modal
  $('#activity-save-btn').addEventListener('click', handleSaveActivity);
  $('#activity-delete-btn').addEventListener('click', handleDeleteActivity);
  // Enter-to-save in activity name field
  $('#activity-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSaveActivity(); }
  });

  // Modal close
  $$('[data-close]').forEach((el) => {
    el.addEventListener('click', () => hideModal(el.dataset.close));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $$('.modal:not(.hidden)').forEach((m) => m.classList.add('hidden'));
  });

  // Screenshot dropzone inside gear modal
  const dz = $('#screenshot-dropzone');
  const fileInput = $('#screenshot-file-input');
  dz.addEventListener('click', () => fileInput.click());
  dz.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) handleScreenshotFile(f);
  });
  $('#screenshot-remove').addEventListener('click', () => {
    resetScreenshotUI();
  });
  dz.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items || [];
    for (const it of items) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        e.preventDefault();
        handleScreenshotFile(it.getAsFile());
        return;
      }
    }
  });
  dz.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    dz.classList.add('drag-over');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    dz.classList.remove('drag-over');
    const f = e.dataTransfer.files?.[0];
    if (f) handleScreenshotFile(f);
  });

  // Activity body DnD
  $('#activity-body').addEventListener('dragover', handleBodyDragOver);
  $('#activity-body').addEventListener('dragleave', handleBodyDragLeave);
  $('#activity-body').addEventListener('drop', handleBodyDrop);

  // Remove dropzone
  const rz = $('#remove-dropzone');
  rz.addEventListener('dragover', (e) => { e.preventDefault(); rz.classList.add('active'); });
  rz.addEventListener('dragleave', () => rz.classList.remove('active'));
  rz.addEventListener('drop', (e) => { e.preventDefault(); rz.classList.remove('active'); handleRemoveDropzone(); });

  // Global drop-anywhere for screenshots → opens Add Gear flow
  const overlay = $('#global-drop-overlay');
  let dragDepth = 0;
  const isFileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!isFileDrag(e)) return;
    dragDepth++;
    if ($('#gear-modal').classList.contains('hidden')) overlay.classList.add('active');
  });
  window.addEventListener('dragover', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!isFileDrag(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) overlay.classList.remove('active');
  });
  window.addEventListener('drop', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth = 0;
    overlay.classList.remove('active');
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith('image/')) handleScreenshotFile(f);
  });
}

// ------------------------------------------------------------------
// Auth state + boot
// ------------------------------------------------------------------
async function syncDisplayName(user) {
  const fullName = user?.user_metadata?.full_name;
  if (!fullName) return;
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .maybeSingle();
  if (profile?.display_name) return;
  await supabase
    .from('profiles')
    .upsert({ id: user.id, display_name: fullName }, { onConflict: 'id' });
}


async function onSignedIn(session) {
  currentUser = session.user;
  $('#user-email').textContent = currentUser.email || '';
  showMain();
  await syncDisplayName(currentUser);
  await loadAll();
  // Seed default activities on first login
  if (!activities.length) {
    const seed = [
      { name: 'Climbing', emoji: '🧗', position: 0 },
      { name: 'Highlining', emoji: '🎪', position: 1 },
      { name: 'Paragliding', emoji: '🪂', position: 2 },
      { name: 'Hiking', emoji: '🥾', position: 3 },
    ];
    const { data, error } = await supabase.from('activities').insert(seed).select();
    if (!error && data) {
      activities = data;
      activeActivityId = data[0]?.id || null;
      render();
    }
  }
}

function onSignedOut() {
  currentUser = null;
  gearList = [];
  activities = [];
  itemsByActivity = {};
  customFiltersByActivity = {};
  activeActivityId = null;
  showAuth();
}

async function consumeTokenHashFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const token_hash = params.get('token_hash');
  const type = params.get('type');
  if (!token_hash || !type) return null;
  console.log('[auth] exchanging token_hash from URL, type=', type);
  const { data, error } = await supabase.auth.verifyOtp({ token_hash, type });
  cleanAuthParamsFromUrl();
  if (error) { console.warn('[auth] verifyOtp failed', error); return { error }; }
  return { session: data?.session || null };
}

supabase.auth.onAuthStateChange((event, session) => {
  console.log('[auth] event:', event, 'session:', !!session);
  if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') cleanAuthParamsFromUrl();
  if (session?.user) onSignedIn(session);
  else if (event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') {
    if (!session) onSignedOut();
  }
});

// ------------------------------------------------------------------
// Init
// ------------------------------------------------------------------
wire();

(async () => {
  const hashErr = readHashError();
  if (hashErr) {
    setAuthStatus(`Sign-in link failed: ${hashErr}. Enter your email to get a new one.`, 'error');
    cleanAuthParamsFromUrl();
  }
  try {
    const consumed = await consumeTokenHashFromUrl();
    if (consumed?.session?.user) { await onSignedIn(consumed.session); return; }
    if (consumed?.error) {
      setAuthStatus(
        `That sign-in link didn't work (${consumed.error.message}). Enter your email to get a fresh one.`,
        'error'
      );
    }
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) console.warn('[auth] getSession error', error);
    if (session?.user) { cleanAuthParamsFromUrl(); await onSignedIn(session); }
    else showAuth();
  } catch (err) {
    console.error('[auth] boot error', err);
    showAuth();
  }
})();
