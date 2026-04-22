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
  for (const k of ['code', 'error', 'error_description', 'error_code', 'token_hash', 'type', 'redirect_to']) {
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

// Keyword heuristics for smart empty-state suggestions + dynamic filter-hint
// examples. `match` identifies the activity from its name; `keywords` are
// substrings we scan gear names/notes for when pulling library items that
// belong in this kind of list; `generic` are the text-only fallbacks we show
// when the user's library doesn't have anything matching; `filterExamples`
// is what we show in the "Tap + to add (e.g. …)" hint.
const ACTIVITY_PRESETS = [
  { match: /hik|trail|trek|backpack/i, label: 'hiking', emoji: '🥾',
    keywords: ['hik','boot','daypack','trek','pole','gaiter','blister','map','compass'],
    generic: ['Hiking boots','Daypack','Trekking poles','Blister kit','Map / GPS'],
    filterExamples: 'Day hike, Backpacking' },
  { match: /climb|whitney|alpine|crag|boulder|trad|sport/i, label: 'climbing', emoji: '🧗',
    keywords: ['climb','harness','chalk','quickdraw','cam','nut','rope','belay','crash pad','approach','rappel'],
    generic: ['Harness','Climbing shoes','Chalk bag','Helmet','Belay device'],
    filterExamples: 'Trad, Sport, Bouldering' },
  { match: /ski|snowboard|split|skin/i, label: 'skiing', emoji: '🎿',
    keywords: ['ski','snowboard','goggle','skin','avy','probe','beacon','shovel','helmet'],
    generic: ['Skis or snowboard','Boots','Goggles','Gloves','Avy beacon'],
    filterExamples: 'Resort, Backcountry' },
  { match: /camp|overnight|bivy/i, label: 'camping', emoji: '⛺',
    keywords: ['tent','sleeping','pad','stove','bivy','tarp','fuel','headlamp','lantern'],
    generic: ['Tent','Sleeping bag','Sleeping pad','Stove','Headlamp'],
    filterExamples: 'Car camp, Backpacking' },
  { match: /bike|cycl|mtb|gravel/i, label: 'cycling', emoji: '🚴',
    keywords: ['bike','cycl','saddle','pedal','tube','chain','helmet'],
    generic: ['Helmet','Gloves','Water bottle','Repair kit','Bike lights'],
    filterExamples: 'Road, Gravel, MTB' },
  { match: /run|marathon|jog/i, label: 'running', emoji: '🏃',
    keywords: ['run','shoe','short'],
    generic: ['Running shoes','Shorts','Moisture-wicking top','Water bottle'],
    filterExamples: 'Trail, Road' },
  { match: /paragli|fly|speed ?fly|acro/i, label: 'flying', emoji: '🪂',
    keywords: ['glider','wing','harness','reserve','vario','helmet'],
    generic: ['Paraglider / wing','Harness','Helmet','Reserve','Vario'],
    filterExamples: 'XC, Acro' },
  { match: /highlin|slackline/i, label: 'highlining', emoji: '🎪',
    keywords: ['webbing','slackline','leash','backup','sling','anchor'],
    generic: ['Webbing','Tensioning system','Harness','Leash'],
    filterExamples: 'Longline, Waterline' },
];

const DEFAULT_ACTIVITY_EMOJI = '🎒';

// Curated set shown in the desktop emoji-picker overlay. Leading block
// mirrors the ACTIVITY_PRESETS so the most-likely match is one click away;
// the rest are adjacent outdoor / water / seasonal / general-travel choices.
const EMOJI_PICKER_CHOICES = [
  '🥾','🧗','⛺','🎿','🚴','🏃','🪂','🎪',
  '🎒','🧳','🏕','🏞','🗻','🏔','🌲','🌊',
  '🛶','🏄','🏊','🎣','🏂','⛷','🧘','🏇',
  '🔥','☀️','❄️','🌙','🌄','🌅','⛰','🌋',
  '🏝','🧭','⛵','🚤','🚁','🛫','🗺','📍',
];

// Keywords/generic fallbacks that apply regardless of activity — the
// "layers + essentials" that basically any outdoor list wants.
const UNIVERSAL_KEYWORDS = [
  'jacket','hoody','hoodie','fleece','puffy','shell','layer','houdini','nano puff','down','rain',
  'pants','beanie','hat','sunscreen','water bottle','bladder','headlamp','knife','first aid',
  'snack','bar','sunglass','buff','glove','sock',
];
const UNIVERSAL_GENERIC = ['Rain shell','Warm layer','Sun hat','Sunscreen','Water bottle','Snacks'];

function presetForActivity(activity) {
  const name = (activity?.name || '').toLowerCase();
  return ACTIVITY_PRESETS.find((p) => p.match.test(name)) || null;
}

function gearMatchesKeyword(gear, keywords) {
  if (!gear) return false;
  const hay = `${gear.name || ''} ${gear.notes || ''} ${gear.brand || ''}`.toLowerCase();
  return keywords.some((kw) => hay.includes(kw));
}

// Build a ranked suggestion set for an empty list. Returns:
//   { linked: [gear, …], generic: [labelString, …] }
// `linked` = items already in the user's gear library that the keywords hit.
// `generic` = text-only fallbacks for items the user probably still needs but
// doesn't have in their library yet.
function suggestionsForActivity(activity) {
  const preset = presetForActivity(activity);
  const activityKeywords = preset ? preset.keywords : [];
  const allKeywords = [...activityKeywords, ...UNIVERSAL_KEYWORDS];

  const existingIds = new Set((itemsFor(activity.id) || []).map((it) => it.gear_id));
  const linked = [];
  const seen = new Set();
  for (const gear of gearList) {
    if (existingIds.has(gear.id)) continue;
    if (seen.has(gear.id)) continue;
    if (gearMatchesKeyword(gear, allKeywords)) {
      linked.push(gear);
      seen.add(gear.id);
    }
    if (linked.length >= 6) break;
  }

  // Generic fallbacks — dedupe against anything we already showed as a linked
  // library item (substring match, case-insensitive) so we don't say "Rain
  // shell" as a generic when they already have a "Patagonia rain shell" in
  // the linked section.
  const linkedNames = linked.map((g) => (g.name || '').toLowerCase());
  const genericPool = preset
    ? [...preset.generic, ...UNIVERSAL_GENERIC]
    : [...UNIVERSAL_GENERIC];
  const generic = [];
  const seenGeneric = new Set();
  for (const label of genericPool) {
    const key = label.toLowerCase();
    if (seenGeneric.has(key)) continue;
    seenGeneric.add(key);
    const overlaps = linkedNames.some((n) => n.includes(key) || key.split(/\s+/).every((t) => n.includes(t)));
    if (overlaps) continue;
    generic.push(label);
    if (generic.length >= 6) break;
  }

  return { linked, generic, preset };
}

// Known outdoor / climbing / paragliding brand palettes. Keys are lowercase.
// `domain` is fetched via Google's favicon service to render a tiny logo image.
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
let membersByActivity = {};           // activity_id -> array of {activity_id, user_id, role, joined_at}
let invitesByActivity = {};           // activity_id (owner only) -> array of pending invites
let viewsByActivity = {};             // activity_id -> {last_seen_at, digest_sent_at} for current user
let profilesById = {};                // user_id -> {id, display_name, email}
let foreignGearById = {};             // gear_id -> gear row (for gear owned by co-members)
let activeActivityId = null;
let displayUnit = localStorage.getItem(LS_UNIT_KEY) || 'g';
let gearSearchQuery = '';
let brandFilter = null;               // lowercase brand label, or null
let brandFilterExpanded = false;       // mobile: is the pill strip open?
let libraryEditMode = false;
let editingGearId = null;             // null = adding
let editingActivityId = null;         // null = adding
let dragState = null;
let mobileMode = localStorage.getItem('pack:mobileMode') || 'library'; // 'library' | 'packing'
let realtimeChannel = null;
let realtimeChannelActivityId = null;
// One channel per table that needs cross-tab live updates. The per-activity
// channel (syncRealtimeSubscription) only watches the active tab; these
// listen across every row the user can see and skip events for the active
// activity to avoid double-applying.
let globalItemsChannel = null;
let globalActivitiesChannel = null;
let globalMembersChannel = null;
let globalCustomFiltersChannel = null;
let globalGearChannel = null;
let shareModalActivityId = null;
let pendingInviteToken = null;        // consumed from ?invite= on boot, applied after sign-in
let pendingShareToken = null;         // consumed from ?share= on boot, applied after sign-in
let pendingOpenActivityId = null;     // consumed from ?activity= on boot, applied after sign-in
let shareLandingLoaded = false;       // guard so we only fetch the preview once per page load
let currentShareLinkToken = null;     // token for the active share modal's copy-link row
// onSignedIn fires from multiple code paths (boot IIFE, auth state change,
// token-hash verify). Guard against concurrent/duplicate runs per user so we
// don't seed defaults twice or re-run loadAll uselessly.
let signedInForUserId = null;
// Captured from accept-invite so the onboarding modal can say "Ben invited
// you to 'Sierra Traverse'". Cleared after the modal renders once.
let onboardingContext = null;

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
    src: `https://www.google.com/s2/favicons?domain=${s.domain}&sz=64`,
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
  $('#share-landing-view').hidden = true;
  $('#auth-view').hidden = false;
  $('#main-view').hidden = true;
}
function showMain() {
  $('#share-landing-view').hidden = true;
  $('#auth-view').hidden = true;
  $('#main-view').hidden = false;
}
function showShareLanding() {
  $('#share-landing-view').hidden = false;
  $('#auth-view').hidden = true;
  $('#main-view').hidden = true;
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
  const myId = currentUser?.id;
  // Library only shows own gear. Shared activities pull foreign gear separately
  // after activity_items are loaded.
  const gearQuery = myId
    ? supabase.from('gear').select('*').eq('owner_id', myId).order('created_at', { ascending: false })
    : supabase.from('gear').select('*').order('created_at', { ascending: false });
  const [gearRes, actRes, itemRes, filterRes, memberRes, inviteRes, viewRes] = await Promise.all([
    gearQuery,
    supabase.from('activities').select('*').order('position', { ascending: true }),
    supabase.from('activity_items').select('*').order('position', { ascending: true }),
    supabase.from('custom_filters').select('*').order('position', { ascending: true }),
    supabase.from('activity_members').select('*'),
    supabase.from('activity_invites').select('*').is('accepted_at', null),
    supabase.from('activity_views').select('*'),
  ]);
  for (const [name, res] of [
    ['gear', gearRes], ['activities', actRes], ['items', itemRes],
    ['filters', filterRes],
  ]) {
    if (res.error) { setStatus(`Load ${name}: ${res.error.message}`, 'error'); return; }
  }
  // Members + invites + views are optional (shared-activities feature). If
  // their tables are missing or unreachable, log and treat as empty rather
  // than blocking core data (gear, activities, items, filters) from loading.
  for (const [name, res] of [['members', memberRes], ['invites', inviteRes], ['views', viewRes]]) {
    if (res.error) console.warn(`Load ${name}: ${res.error.message}`);
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
  membersByActivity = {};
  for (const m of memberRes.data || []) {
    (membersByActivity[m.activity_id] ||= []).push(m);
  }
  invitesByActivity = {};
  for (const inv of inviteRes.data || []) {
    (invitesByActivity[inv.activity_id] ||= []).push(inv);
  }
  viewsByActivity = {};
  for (const v of viewRes.data || []) {
    viewsByActivity[v.activity_id] = v;
  }
  if (!activeActivityId || !activities.some((a) => a.id === activeActivityId)) {
    activeActivityId = activities[0]?.id || null;
  }
  await loadForeignGear();
  await loadCoMemberProfiles();
  setStatus('');
  render();
  syncRealtimeSubscription();
  setupGlobalRealtime();
  // Whatever the user lands on at boot, mark it as seen so the badge there
  // clears immediately on next render.
  if (activeActivityId) markActivitySeen(activeActivityId);
}

// Gear rows referenced by activity_items but not in the user's own library —
// i.e. gear contributed by co-members on shared activities. RLS allows SELECT
// on any gear row referenced by an activity_item of an activity we're a
// member of. We store these separately from gearList so the Gear Library UI
// keeps showing only your own stuff.
async function loadForeignGear() {
  const myOwned = new Set(gearList.map((g) => g.id));
  const needed = new Set();
  for (const items of Object.values(itemsByActivity)) {
    for (const it of items) {
      if (it.gear_id && !myOwned.has(it.gear_id)) needed.add(it.gear_id);
    }
  }
  if (!needed.size) {
    foreignGearById = {};
    return;
  }
  const { data, error } = await supabase
    .from('gear')
    .select('*')
    .in('id', Array.from(needed));
  if (error) {
    console.warn('loadForeignGear error', error);
    foreignGearById = {};
    return;
  }
  const next = {};
  for (const g of data || []) next[g.id] = g;
  foreignGearById = next;
}

async function loadCoMemberProfiles() {
  const needed = new Set();
  for (const ms of Object.values(membersByActivity)) {
    for (const m of ms) if (m.user_id) needed.add(m.user_id);
  }
  for (const g of Object.values(foreignGearById)) {
    if (g.owner_id) needed.add(g.owner_id);
  }
  if (currentUser?.id) needed.delete(currentUser.id);
  if (!needed.size) {
    profilesById = currentUser
      ? { [currentUser.id]: {
          id: currentUser.id,
          display_name: currentUser.user_metadata?.full_name || null,
          email: currentUser.email || null,
        } }
      : {};
    return;
  }
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, email')
    .in('id', Array.from(needed));
  const next = {};
  if (currentUser?.id) {
    next[currentUser.id] = {
      id: currentUser.id,
      display_name: currentUser.user_metadata?.full_name || null,
      email: currentUser.email || null,
    };
  }
  if (error) {
    console.warn('loadCoMemberProfiles error', error);
  } else {
    for (const p of data || []) next[p.id] = p;
  }
  profilesById = next;
}

function activeActivity() {
  return activities.find((a) => a.id === activeActivityId) || null;
}
function itemsFor(activityId) {
  const arr = itemsByActivity[activityId] || [];
  // Always render items by position so all members see the same order,
  // regardless of whether rows arrived via initial load or realtime events.
  return [...arr].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}
function customFiltersFor(activityId) {
  return customFiltersByActivity[activityId] || [];
}
function membersFor(activityId) {
  return membersByActivity[activityId] || [];
}
function invitesFor(activityId) {
  return invitesByActivity[activityId] || [];
}
function getGearById(id) {
  return gearList.find((g) => g.id === id) || foreignGearById[id] || null;
}
function isOwnerOf(activityId) {
  const a = activities.find((x) => x.id === activityId);
  return !!(a && currentUser && a.owner_id === currentUser.id);
}
// Items added by other members since the user last opened this activity (or
// since they joined, whichever is later). Items the current user added are
// excluded — they're not "new" to them.
function unreadCountFor(activityId) {
  const me = currentUser?.id;
  if (!me) return 0;
  const items = itemsByActivity[activityId] || [];
  if (items.length === 0) return 0;
  const view = viewsByActivity[activityId];
  const myMembership = (membersByActivity[activityId] || []).find((m) => m.user_id === me);
  // Don't count anything from before the user joined the activity.
  const baseline = view?.last_seen_at || myMembership?.joined_at || null;
  if (!baseline) return 0;
  const baselineMs = Date.parse(baseline);
  let n = 0;
  for (const it of items) {
    if (!it.added_by || it.added_by === me) continue;
    if (Date.parse(it.created_at) > baselineMs) n++;
  }
  return n;
}
// Fire-and-forget RPC + optimistic local update so the badge clears
// immediately on tab open. Concurrent renders see the new last_seen_at right
// away rather than waiting for the round trip.
async function markActivitySeen(activityId) {
  if (!activityId || !currentUser?.id) return;
  const now = new Date().toISOString();
  const prev = viewsByActivity[activityId];
  if (prev?.last_seen_at && Date.parse(prev.last_seen_at) > Date.now() - 2000) {
    // Already marked seen within the last couple seconds — skip the round trip
    // (avoids a flood when multiple item-insert events arrive in quick succession).
    return;
  }
  viewsByActivity[activityId] = { ...(prev || {}), activity_id: activityId, last_seen_at: now };
  try {
    const { error } = await supabase.rpc('mark_activity_seen', { p_activity_id: activityId });
    if (error) console.warn('mark_activity_seen', error.message);
  } catch (err) {
    console.warn('mark_activity_seen failed', err);
  }
}
function isSharedActivity(activityId) {
  return (membersFor(activityId).length + invitesFor(activityId).length) > 1
    || membersFor(activityId).length > 1;
}
function displayNameFor(userId) {
  const p = profilesById[userId];
  const name = (p?.display_name || '').trim();
  if (name) return name;
  if (userId === currentUser?.id && currentUser.email) return currentUser.email;
  if (p?.email) return p.email;
  return null;
}
// "Ben Langholz" -> "BL", "Ben" -> "B", "blangholz@x.com" -> "BL".
// Two chars when we can, one when the name is a single word.
function initialsFrom(source) {
  const s = (source || '').trim();
  if (!s) return '?';
  if (s.includes('@')) {
    const prefix = s.split('@')[0].replace(/[^a-z0-9]/gi, '');
    return (prefix.slice(0, 2) || '?').toUpperCase();
  }
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0][0].toUpperCase();
}
function ownerChipEl(userId, { size = '' } = {}) {
  const label = displayNameFor(userId) || '';
  const initials = initialsFrom(label);
  const hue = hashHue(userId || '');
  const cls = 'owner-chip' + (size ? ` owner-chip-${size}` : '');
  return h('span', {
    class: cls,
    title: label || 'Member',
    style: `background: hsl(${hue} 58% 42%); color: #fff;`,
    'aria-label': label || 'Member',
  }, initials);
}

// Unread-count badge — sits to the LEFT of the activity emoji on a tab when
// other members have added gear since the user last opened the tab. Hidden on
// the active tab (the user is already looking at it) and on tabs with zero
// unread.
function unreadBadgeForActivity(activityId) {
  if (activityId === activeActivityId) return null;
  const n = unreadCountFor(activityId);
  if (n <= 0) return null;
  const label = n > 99 ? '99+' : String(n);
  return h('span', {
    class: 'activity-tab-unread',
    'aria-label': `${n} new ${n === 1 ? 'item' : 'items'}`,
    title: `${n} new ${n === 1 ? 'item' : 'items'} from your crew`,
  }, label);
}

// Facepile of overlapping member avatars — shown on tabs of shared activities.
// 1-4 members → render all. 5+ → render first 3 + "+N" overflow chip.
// Owner is always pinned to the front so the list "looks like" the owner's.
function facepileForActivity(activityId) {
  const members = membersFor(activityId);
  if (members.length <= 1) return null;
  const sorted = [...members].sort((a, b) => {
    if (a.role === 'owner' && b.role !== 'owner') return -1;
    if (b.role === 'owner' && a.role !== 'owner') return 1;
    return (a.joined_at || '').localeCompare(b.joined_at || '');
  });
  const visible = sorted.length > 4 ? sorted.slice(0, 3) : sorted;
  const overflow = sorted.length - visible.length;
  const wrap = h('span', {
    class: 'activity-tab-facepile',
    'aria-label': `${sorted.length} members`,
  });
  for (const m of visible) wrap.appendChild(ownerChipEl(m.user_id, { size: 'xs' }));
  if (overflow > 0) {
    wrap.appendChild(h('span', {
      class: 'owner-chip owner-chip-xs facepile-overflow',
      title: `+${overflow} more`,
    }, `+${overflow}`));
  }
  return wrap;
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

function setMobileMode(mode) {
  mobileMode = mode;
  localStorage.setItem('pack:mobileMode', mode);
  document.body.dataset.mobileMode = mode;
  for (const tab of document.querySelectorAll('.mobile-tab[data-mobile-mode]')) {
    tab.classList.toggle('active', tab.dataset.mobileMode === mode);
  }
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
  const toggle = $('#brand-filter-toggle');
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
    host.classList.remove('has-active');
    toggle.classList.add('hidden');
    return;
  }
  toggle.classList.remove('hidden');
  host.classList.remove('hidden');
  host.classList.toggle('has-active', !!brandFilter);

  // Always render the pills into the DOM; mobile CSS controls whether the
  // strip is visible. The user is in full control — tapping the toggle
  // collapses even when a brand filter is active (the label still shows
  // the active brand so they know filtering is on).
  const showStrip = brandFilterExpanded;
  host.classList.toggle('expanded', showStrip);
  toggle.setAttribute('aria-expanded', showStrip ? 'true' : 'false');
  const arrow = showStrip ? '▴' : '▾';
  toggle.textContent = brandFilter
    ? `Filtering by ${counts.get(brandFilter)?.label || brandFilter} ${arrow}`
    : `Filter by brand ${arrow}`;

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
  const imgNode = gearImageEl(gear.image_url);
  const imgWrap = gear.image_url
    ? h('button', {
        class: 'gear-image-link',
        type: 'button',
        title: 'Tap to preview',
        'aria-label': `Preview ${gear.name || 'image'}`,
        onclick: (e) => { e.stopPropagation(); openImagePreview(gear); },
        ondragstart: (e) => e.preventDefault(),
      }, imgNode)
    : imgNode;
  const weight = h('div', { class: 'gear-weight' }, formatWeight(gear.weight_grams));
  const badge = brandBadgeEl(gear.brand);
  const ownedQty = Number.isFinite(gear.quantity) && gear.quantity >= 1 ? gear.quantity : 1;
  const qtyBadge = ownedQty > 1
    ? h('div', { class: 'gear-qty-badge', title: `You own ${ownedQty}` }, `×${ownedQty}`)
    : null;
  const right = h('div', { class: 'gear-right' }, badge, qtyBadge, weight);

  const meta = h('div', { class: 'gear-meta' },
    h('div', { class: 'gear-name' }, gear.name || 'Unnamed'),
    gear.brand ? h('div', { class: 'gear-sub' }, gear.brand) : null,
  );

  const cardProps = { class: 'gear-card', dataset: { gearId: gear.id } };
  if (!libraryEditMode) {
    cardProps.draggable = 'true';
    cardProps.onclick = () => openActivityPicker(gear.id);
    cardProps.title = 'Tap to add to a packing list';
    cardProps.ondragstart = (e) => handleGearDragStart(e, gear.id);
    cardProps.ondragend = handleDragEnd;
  }

  const children = [imgWrap, meta, right];
  if (libraryEditMode) {
    const actionButtons = [
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
    ];
    if (gear.url) {
      actionButtons.unshift(h('a', {
        class: 'btn btn-ghost btn-sm',
        href: gear.url,
        target: '_blank',
        rel: 'noopener noreferrer',
        onclick: (e) => e.stopPropagation(),
      }, 'Open page ↗'));
    }
    children.push(h('div', { class: 'gear-card-actions' }, ...actionButtons));
  }
  return h('div', cardProps, ...children);
}

function openImagePreview(gear) {
  if (!gear || !gear.image_url) return;
  const img = $('#image-preview-img');
  img.src = gear.image_url;
  img.alt = gear.name || 'Gear preview';
  const caption = $('#image-preview-caption');
  caption.textContent = gear.name || '';
  showModal('image-preview-modal');
}

function renderTabs() {
  const tabs = $('#activity-tabs');
  tabs.innerHTML = '';
  for (const a of activities) {
    const tab = h('button', {
      class: 'activity-tab' + (a.id === activeActivityId ? ' active' : ''),
      dataset: { activityId: a.id },
      role: 'tab',
      onclick: () => {
        activeActivityId = a.id;
        render();
        syncRealtimeSubscription();
        markActivitySeen(a.id);
      },
      ondblclick: () => openEditActivity(a.id),
      ondragover: handleTabDragOver,
      ondragleave: handleTabDragLeave,
      ondrop: (e) => handleTabDrop(e, a.id),
    },
      unreadBadgeForActivity(a.id),
      a.emoji ? h('span', { class: 'activity-tab-emoji' }, a.emoji) : null,
      h('span', {}, a.name),
      facepileForActivity(a.id),
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
    const preset = presetForActivity(activity);
    const examples = preset ? preset.filterExamples : 'Trad, Sport';
    hint.textContent = `Tap + to add (e.g. ${examples})`;
  } else if (active.size) {
    hint.textContent = 'Filtered';
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
  const resetBtn = $('#reset-checklist-btn');
  const editBtn = $('#edit-activity-btn');
  const shareBtn = $('#share-activity-btn');
  const shareCount = $('#share-activity-count');

  list.innerHTML = '';
  const activity = activeActivity();
  if (!activity) {
    empty.classList.add('hidden');
    totalEl.textContent = 'Total: —';
    resetBtn.disabled = true;
    editBtn.disabled = true;
    if (shareBtn) shareBtn.disabled = true;
    if (shareCount) { shareCount.textContent = ''; shareCount.classList.remove('visible'); }
    return;
  }
  const items = itemsFor(activity.id);
  resetBtn.disabled = !items.length;
  editBtn.disabled = false;
  if (shareBtn) shareBtn.disabled = false;

  // Share-button badge: show combined member + pending-invite count when > 1.
  if (shareCount) {
    const total = membersFor(activity.id).length + invitesFor(activity.id).length;
    if (total > 1) {
      shareCount.textContent = String(total);
      shareCount.classList.add('visible');
    } else {
      shareCount.textContent = '';
      shareCount.classList.remove('visible');
    }
  }

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

  const shared = membersFor(activity.id).length > 1;
  const visibleItems = [];
  for (const item of items) {
    const gear = getGearById(item.gear_id);
    if (!gear) continue;
    if (passWeather(item) && passCustom(item)) visibleItems.push({ item, gear });
  }

  if (!items.length) {
    renderActivityEmptyState(activity, 'empty');
    empty.classList.remove('hidden');
  } else if (!visibleItems.length) {
    renderActivityEmptyState(activity, 'filtered');
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    for (const { item, gear } of visibleItems) {
      list.appendChild(activityItemRow(activity, item, gear, { shared }));
    }
  }

  let total = 0;
  for (const { item, gear } of visibleItems) {
    const qty = Number.isFinite(item.quantity) && item.quantity >= 1 ? item.quantity : 1;
    total += (gear.weight_grams || 0) * qty;
  }
  totalEl.textContent = `Total: ${formatWeight(total)}`;
}

// Render the "#activity-empty" container based on state:
//   reason === 'filtered' → there are items but filters hide them all
//   reason === 'empty'    → no items yet; show smart suggestions
function renderActivityEmptyState(activity, reason) {
  const empty = $('#activity-empty');
  if (!empty) return;
  empty.innerHTML = '';

  if (reason === 'filtered') {
    empty.appendChild(h('p', {}, 'No items match the active filters.'));
    empty.appendChild(h('p', { class: 'muted' }, 'Turn off a filter above to see the rest of the list.'));
    return;
  }

  const { linked, generic, preset } = suggestionsForActivity(activity);
  const hasAny = linked.length || generic.length;

  if (!hasAny) {
    empty.appendChild(h('p', {}, 'Nothing packed yet.'));
    empty.appendChild(h('p', { class: 'muted' }, 'Drag gear from the library into this list.'));
    return;
  }

  const label = preset ? preset.label : 'this trip';
  empty.appendChild(h('p', { class: 'empty-suggestions-title' },
    `Suggestions for ${label}`));
  empty.appendChild(h('p', { class: 'muted empty-suggestions-sub' },
    'Tap + to add. These aren\'t packed yet.'));

  if (linked.length) {
    const linkedWrap = h('div', { class: 'suggestion-list suggestion-list-linked' });
    for (const gear of linked) linkedWrap.appendChild(suggestionRow(activity, gear));
    empty.appendChild(linkedWrap);
  }

  if (generic.length) {
    if (linked.length) {
      empty.appendChild(h('p', { class: 'muted empty-suggestions-divider' },
        'Not in your library yet:'));
    }
    const genericWrap = h('div', { class: 'suggestion-list suggestion-list-generic' });
    for (const label of generic) genericWrap.appendChild(suggestionGenericRow(label));
    empty.appendChild(genericWrap);
  }
}

function suggestionRow(activity, gear) {
  const imgNode = gearImageEl(gear.image_url, { className: 'gear-image suggestion-image' });
  const name = h('div', { class: 'suggestion-name' }, gear.name || 'Untitled');
  const brand = gear.brand ? h('div', { class: 'suggestion-brand muted' }, gear.brand) : null;
  const meta = h('div', { class: 'suggestion-meta' }, name, brand);
  const addBtn = h('button', {
    class: 'suggestion-add',
    type: 'button',
    title: 'Add to list',
    'aria-label': `Add ${gear.name || 'item'} to this list`,
    onclick: (e) => {
      e.stopPropagation();
      addGearToActivity(activity.id, gear.id);
    },
  }, '+');
  return h('div', { class: 'suggestion-item suggestion-item-linked' }, imgNode, meta, addBtn);
}

function suggestionGenericRow(label) {
  const icon = h('div', { class: 'suggestion-image suggestion-image-generic', 'aria-hidden': 'true' }, '✨');
  const name = h('div', { class: 'suggestion-name' }, label);
  const hint = h('div', { class: 'suggestion-brand muted' }, 'Add to your gear library to include');
  const meta = h('div', { class: 'suggestion-meta' }, name, hint);
  const addBtn = h('button', {
    class: 'suggestion-add suggestion-add-generic',
    type: 'button',
    title: 'Add to your gear library',
    'aria-label': `Add ${label} to your gear library`,
    onclick: (e) => {
      e.stopPropagation();
      openAddGear();
      const nameInput = $('#gear-name');
      if (nameInput) { nameInput.value = label; nameInput.focus(); }
    },
  }, '+');
  return h('div', { class: 'suggestion-item suggestion-item-generic' }, icon, meta, addBtn);
}

function activityItemRow(activity, item, gear, opts = {}) {
  const shared = !!opts.shared;
  const imgNode = gearImageEl(gear.image_url);
  const imgEl = gear.image_url
    ? h('button', {
        class: 'activity-item-image-link',
        type: 'button',
        title: 'Tap to preview',
        'aria-label': `Preview ${gear.name || 'image'}`,
        onclick: (e) => { e.stopPropagation(); openImagePreview(gear); },
        ondragstart: (e) => e.preventDefault(),
      }, imgNode)
    : imgNode;

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

  const weightEl = gear.weight_grams == null
    ? h('div', { class: 'item-weight' }, '—')
    : (itemQty > 1
        ? h('div', { class: 'item-weight' },
            h('span', { class: 'item-weight-total' }, formatWeight(totalWeight)),
            h('span', { class: 'item-weight-breakdown' }, `(${itemQty}× ${formatWeight(gear.weight_grams)})`),
          )
        : h('div', { class: 'item-weight' }, formatWeight(gear.weight_grams)));

  // Owner chip: only visible on shared activities. Helps distinguish whose
  // gear is on each row without leaking avatars when a list is solo.
  const chip = shared ? ownerChipEl(gear.owner_id) : null;

  // Delete permission: on shared lists, anyone can delete rows for gear they
  // own; the activity owner can delete any row. RLS enforces this server-side
  // too — this is just a UX guard so the button isn't presented when the
  // server would reject it.
  const canRemove = !shared
    || (currentUser && (gear.owner_id === currentUser.id || isOwnerOf(activity.id)));

  const row = h('div', {
    class: 'activity-item'
      + (item.packed ? ' packed' : '')
      + (shared ? ' shared' : '')
      + (pendingFlashGearIds.has(gear.id) ? ' flash-bump' : ''),
    draggable: 'true',
    dataset: { gearId: gear.id, itemId: item.id },
    role: 'button',
    'aria-pressed': item.packed ? 'true' : 'false',
    title: item.packed ? 'Tap to mark unpacked' : 'Tap to mark packed',
    onclick: () => togglePacked(item.id, !item.packed),
    ondragstart: (e) => handleItemDragStart(e, activity.id, gear.id),
    ondragend: handleDragEnd,
    ondragover: handleItemDragOver,
    ondragleave: handleItemDragLeave,
    ondrop: (e) => handleItemDrop(e, activity.id, gear.id),
  },
    h('input', {
      type: 'checkbox',
      class: 'item-checkbox',
      checked: item.packed,
      onchange: () => togglePacked(item.id, !item.packed),
      onclick: (e) => e.stopPropagation(),
    }),
    h('div', { class: 'item-check-badge', 'aria-hidden': 'true' }, '✓'),
    chip,
    imgEl,
    h('div', { class: 'activity-item-meta' },
      h('div', { class: 'gear-name-row' }, gear.name || 'Unnamed'),
      h('div', { class: 'gear-sub-row' },
        [gear.brand, escapeHost(gear.url)].filter(Boolean).join(' • ')),
      stepperEl,
      customChips,
      weatherChips,
    ),
    weightEl,
    canRemove
      ? h('button', {
          class: 'item-remove',
          title: 'Remove from this list',
          onclick: (e) => { e.stopPropagation(); removeGearFromActivity(activity.id, gear.id); },
        }, '×')
      : null,
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

// Pulse the activity-item row for `gearId` so the user notices the quantity
// bumped (otherwise re-dragging a gear looks like it did nothing). Tracked
// in a Set because the realtime echo of the user's own UPDATE re-renders
// the list ~100-200ms later — without this, the fresh DOM node replaces
// the flashing one before the animation is visible. activityItemRow reads
// this set when building each row, so the class re-applies across rebuilds
// until the timeout clears it.
const pendingFlashGearIds = new Set();
function flashActivityItem(gearId) {
  pendingFlashGearIds.add(gearId);
  renderActivity();
  setTimeout(() => {
    pendingFlashGearIds.delete(gearId);
    const row = document.querySelector(
      `#activity-list .activity-item[data-gear-id="${CSS.escape(String(gearId))}"]`
    );
    if (row) row.classList.remove('flash-bump');
  }, 800);
}

async function addGearToActivity(activityId, gearId, insertIdx) {
  if (!activityId) return;
  const existing = itemsFor(activityId).find((i) => i.gear_id === gearId);
  if (existing) {
    const q = (existing.quantity || 1) + 1;
    const { error } = await supabase.from('activity_items').update({ quantity: q }).eq('id', existing.id);
    if (error) { toast(error.message, 'error'); return; }
    existing.quantity = q;
    render();
    flashActivityItem(gearId);
    return;
  }
  const items = itemsFor(activityId).slice();
  // Use max(position) + 1 so concurrent adds from different users don't collide
  // on the same position value (which would make ordering non-deterministic).
  const appendPos = items.reduce((m, it) => Math.max(m, it.position ?? -1), -1) + 1;
  const { data, error } = await supabase
    .from('activity_items')
    .insert({ activity_id: activityId, gear_id: gearId, position: appendPos, quantity: 1 })
    .select()
    .single();
  if (error) { toast(error.message, 'error'); return; }
  items.push(data);
  if (insertIdx != null && insertIdx >= 0 && insertIdx < items.length - 1) {
    const [moved] = items.splice(items.length - 1, 1);
    items.splice(insertIdx, 0, moved);
    itemsByActivity[activityId] = items;
    render();
    const updates = items.map((it, i) =>
      supabase.from('activity_items').update({ position: i }).eq('id', it.id)
    );
    const results = await Promise.all(updates);
    const failed = results.find((r) => r.error);
    if (failed) toast(failed.error.message, 'error');
    return;
  }
  itemsByActivity[activityId] = items;
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
    syncRealtimeSubscription();
    markActivitySeen(activityId);
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
    const items = itemsFor(activityId);
    const targetIdx = items.findIndex((i) => i.gear_id === targetGearId);
    const insertIdx = targetIdx < 0 ? undefined : targetIdx + (above ? 0 : 1);
    addGearToActivity(activityId, dragState.gearId, insertIdx);
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
function showModal(id) {
  $('#' + id).classList.remove('hidden');
  document.body.classList.add('modal-open');
}
function hideModal(id) {
  $('#' + id).classList.add('hidden');
  if (!document.querySelector('.modal:not(.hidden)')) {
    document.body.classList.remove('modal-open');
  }
}

// ------------------------------------------------------------------
// Activity picker (mobile per-card "+" → choose which list)
// ------------------------------------------------------------------
function openActivityPicker(gearId) {
  const gear = gearList.find((g) => g.id === gearId);
  if (!gear) return;
  $('#activity-picker-gear').textContent = gear.name || 'this item';

  const list = $('#activity-picker-list');
  list.innerHTML = '';
  if (!activities.length) {
    const empty = h('p', { class: 'muted activity-picker-empty' },
      'You don\u2019t have any packing lists yet. Tap below to create one.');
    list.appendChild(empty);
  }
  for (const a of activities) {
    const inList = itemsFor(a.id).some((i) => i.gear_id === gearId);
    const main = h('button', {
      class: 'activity-picker-main' + (inList ? ' in-list' : ''),
      type: 'button',
      onclick: async () => {
        if (inList) return;
        hideModal('activity-picker');
        await addGearToActivity(a.id, gearId);
      },
      'aria-disabled': inList ? 'true' : 'false',
    },
      h('span', { class: 'activity-picker-emoji' }, a.emoji || '🎒'),
      h('span', { class: 'activity-picker-name' }, a.name),
      inList
        ? h('span', { class: 'activity-picker-badge' }, '✓ in list')
        : h('span', { class: 'activity-picker-add' }, '+'),
    );
    const row = h('div', { class: 'activity-picker-row' + (inList ? ' in-list' : '') }, main);
    if (inList) {
      const removeBtn = h('button', {
        class: 'activity-picker-remove',
        type: 'button',
        title: `Remove from ${a.name}`,
        'aria-label': `Remove from ${a.name}`,
        onclick: async () => {
          hideModal('activity-picker');
          await removeGearFromActivity(a.id, gearId);
        },
      }, '−');
      row.appendChild(removeBtn);
    }
    list.appendChild(row);
  }
  showModal('activity-picker');
}

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
  setIdentifyPhotoStatus(null);
  $('#gear-save-btn').disabled = false;
  $('#gear-save-btn').textContent = '＋ Add to library';
  $('#identify-photo-btn').disabled = false;
  if (typeof clearPhotoQueue === 'function') clearPhotoQueue();
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
  $('#take-photo-section').classList.toggle('hidden', !!url);
  updateGearSaveBtnState();
}

// Gate the "Add to library" button during the photo flow so a user can't
// submit before Claude finishes identifying the image (or before they type a
// name themselves on an error). Outside the photo flow this is a no-op; the
// manual Add Gear path still relies on the standard name-required validation
// in handleSaveGear.
function updateGearSaveBtnState() {
  const btn = $('#gear-save-btn');
  if (!btn) return;
  if (!isPhotoFlowActive()) return;
  const entry = photoQueue[photoIndex];
  const analyzing = !entry || entry.status === 'pending' || entry.status === 'analyzing';
  const hasName = $('#gear-name').value.trim().length > 0;
  btn.disabled = analyzing || !hasName;
}

// Read a File from <input type="file" capture> and return a JPEG data URL,
// resized so the longest side is at most maxSide pixels.
async function fileToThumbnailDataUrl(file, maxSide = 600, quality = 0.85) {
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Could not decode image'));
    i.src = dataUrl;
  });
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

function openAddGear() {
  resetGearForm();
  showModal('gear-modal');
  // Focus synchronously inside the user gesture so iOS Safari brings up the keyboard.
  $('#gear-search-input').focus();
}

function openEditGear(id) {
  const gear = gearList.find((g) => g.id === id);
  if (!gear) return;
  resetGearForm();
  editingGearId = id;
  $('#gear-modal-title').textContent = 'Edit gear';
  $('#gear-save-btn').textContent = 'Save changes';
  $('#gear-delete-btn').classList.remove('hidden');
  setGearForm(gear);
  showModal('gear-modal');
}

async function handleSaveGear() {
  enrichmentSeq++; // cancel any in-flight foreground enrichment
  const payload = readGearForm();
  if (!payload.name) { $('#fetch-status').textContent = 'Name is required.'; return; }
  let saved;
  if (editingGearId) {
    const { data, error } = await supabase.from('gear').update(payload).eq('id', editingGearId).select().single();
    if (error) { toast(error.message, 'error'); return; }
    const idx = gearList.findIndex((g) => g.id === editingGearId);
    if (idx >= 0) gearList[idx] = data;
    saved = data;
  } else {
    const { data, error } = await supabase.from('gear').insert(payload).select().single();
    if (error) { toast(error.message, 'error'); return; }
    gearList.unshift(data);
    saved = data;
  }
  // If we're in a multi-photo queue, advance to the next photo instead of closing.
  if (isPhotoFlowActive() && photoQueue.length > 1 && photoIndex < photoQueue.length - 1) {
    photoQueue[photoIndex].status = 'saved';
    toast(`Added "${saved.name}" to library`, 'info');
    render();
    if (saved && !saved.image_url && saved.name) {
      backgroundEnrichThumbnail(saved).catch(() => {});
    }
    // Reset form fields for the next photo (preserve the photo workflow UI).
    resetGearFormFields();
    advancePhotoQueue();
    return;
  }
  hideModal('gear-modal');
  render();
  if (saved && !saved.image_url && saved.name) {
    backgroundEnrichThumbnail(saved).catch(() => { /* silent */ });
  }
}

// Used between photos in a multi-photo queue: clear form fields without
// touching the photo workflow state.
function resetGearFormFields() {
  editingGearId = null;
  $('#gear-name').value = '';
  $('#gear-brand').value = '';
  $('#gear-weight').value = '';
  $('#gear-quantity').value = '1';
  $('#gear-url').value = '';
  $('#gear-image').value = '';
  $('#gear-notes').value = '';
  $('#gear-delete-btn').classList.add('hidden');
  $('#fetch-status').textContent = '';
  updateGearPreview();
}

// After a gear is saved without a thumbnail, keep trying in the background.
// When an image is found, patch the row and re-render the library.
async function backgroundEnrichThumbnail(gear) {
  let imageUrl = null;
  if (gear.url) {
    try {
      const res = await callExtractGear({ url: gear.url });
      if (res.data?.imageUrl) imageUrl = res.data.imageUrl;
    } catch (_) {}
  }
  if (!imageUrl) {
    try {
      const res = await callExtractGear({
        identity: { name: gear.name, brand: gear.brand || null },
      });
      if (res.data?.imageUrl) imageUrl = res.data.imageUrl;
    } catch (_) {}
  }
  if (!imageUrl) return;
  const { data, error } = await supabase
    .from('gear')
    .update({ image_url: imageUrl })
    .eq('id', gear.id)
    .select()
    .single();
  if (error || !data) return;
  const idx = gearList.findIndex((g) => g.id === gear.id);
  if (idx >= 0) {
    gearList[idx] = data;
    render();
  }
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
// Incremented when the user saves the gear modal — in-flight foreground
// enrichment checks this to abort cleanly.
let enrichmentSeq = 0;

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
  const mySeq = ++enrichmentSeq;
  setPreviewLoading(true);
  $('#gear-search-status').textContent = 'Fetching thumbnail… you can save anytime.';

  let merged = { ...item };
  try {
    if (item.url) {
      try {
        const res = await callExtractGear({ url: item.url });
        if (mySeq !== enrichmentSeq) return;
        if (res.data) {
          merged = { ...merged, ...res.data };
          applyExtracted(merged);
        }
      } catch (_) { /* fall through to identity */ }
    }
    if (mySeq !== enrichmentSeq) return;
    if (!$('#gear-image').value && item.name) {
      const res = await callExtractGear({
        identity: { name: item.name, brand: item.brand || null },
      });
      if (mySeq !== enrichmentSeq) return;
      if (res.data) {
        merged = { ...merged, ...res.data };
        applyExtracted(merged);
      }
    }
    if (mySeq !== enrichmentSeq) return;
    $('#gear-search-status').textContent = $('#gear-image').value
      ? ''
      : 'No thumbnail found — you can still save.';
  } catch (err) {
    if (mySeq === enrichmentSeq) {
      $('#gear-search-status').textContent = 'Couldn\u2019t enrich: ' + err.message;
    }
  } finally {
    if (mySeq === enrichmentSeq) setPreviewLoading(false);
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

function setIdentifyPhotoStatus(text, { loading = false, error = false } = {}) {
  const el = $('#identify-photo-status');
  el.classList.remove('error', 'loading');
  el.innerHTML = '';
  if (!text) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  if (loading) {
    el.classList.add('loading');
    el.appendChild(h('span', { class: 'spinner-sm', 'aria-hidden': 'true' }));
  }
  if (error) el.classList.add('error');
  el.appendChild(h('span', { class: 'identify-photo-status-text' }, text));
}

// ------------------------------------------------------------------
// Photo workflow (mobile single-shot + desktop multi-photo queue)
// ------------------------------------------------------------------
const IS_TOUCH = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
const MAX_PHOTO_QUEUE = 12;

// photoQueue[i] = { id, file, dataUrl, status, candidates, confidence, selectedIndex, error }
//   status: 'pending' | 'analyzing' | 'ready' | 'error'
let photoQueue = [];
let photoIndex = -1;
let photoSeq = 0;

function isPhotoFlowActive() {
  return photoQueue.length > 0;
}

function clearPhotoQueue() {
  photoSeq++;
  photoQueue = [];
  photoIndex = -1;
  $('#photo-workflow').classList.add('hidden');
  $('#gear-entry-methods').classList.remove('hidden');
  $('#gear-skip-btn').classList.add('hidden');
  document.body.classList.remove('photo-workflow-active');
  setPhotoWorkflowStatus(null);
  $('#photo-candidates').classList.add('hidden');
  $('#photo-workflow-progress').classList.add('hidden');
  $('#photo-reidentify-btn').classList.add('hidden');
  $('#photo-cancel-btn').classList.add('hidden');
  // Re-enable the save button now that photo flow is over. The save guard in
  // updateGearSaveBtnState() only runs while photo flow is active, so without
  // this the button would stay disabled after cancel.
  const btn = $('#gear-save-btn');
  if (btn) btn.disabled = false;
}

function setPhotoWorkflowStatus(text, { loading = false, error = false, success = false } = {}) {
  const el = $('#photo-workflow-status');
  el.classList.remove('error', 'loading', 'success');
  el.innerHTML = '';
  if (!text) {
    el.textContent = '';
    return;
  }
  if (loading) {
    el.classList.add('loading');
    el.appendChild(h('span', { class: 'spinner-sm', 'aria-hidden': 'true' }));
  }
  if (error) el.classList.add('error');
  if (success) el.classList.add('success');
  el.appendChild(h('span', { class: 'photo-workflow-status-text' }, text));
}

function renderPhotoProgress() {
  const wrap = $('#photo-workflow-progress');
  if (photoQueue.length <= 1) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  $('#photo-workflow-progress-label').textContent =
    `Photo ${photoIndex + 1} of ${photoQueue.length}`;
  const dots = $('#photo-workflow-progress-dots');
  dots.innerHTML = '';
  photoQueue.forEach((entry, i) => {
    const cls = ['photo-progress-dot'];
    if (i === photoIndex) cls.push('current');
    if (entry.status === 'saved') cls.push('saved');
    else if (entry.status === 'skipped') cls.push('skipped');
    else if (entry.status === 'error') cls.push('error');
    dots.appendChild(h('span', { class: cls.join(' '), title: `Photo ${i + 1}` }));
  });
}

function renderCandidatesPicker(entry) {
  const list = $('#photo-candidates-list');
  list.innerHTML = '';
  const wrap = $('#photo-candidates');
  if (!entry.candidates || entry.candidates.length <= 1) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  const labelEl = $('#photo-candidates-label');
  if (entry.confidence === 'high') {
    labelEl.textContent = 'Best guess is selected — pick a different one if it\u2019s wrong:';
  } else if (entry.confidence === 'medium') {
    labelEl.textContent = 'A few possibilities — pick the closest match:';
  } else {
    labelEl.textContent = 'We weren\u2019t sure — does it look like one of these?';
  }
  entry.candidates.forEach((c, i) => {
    const card = h('button', {
      type: 'button',
      class: 'photo-candidate-card' + (i === entry.selectedIndex ? ' selected' : ''),
      role: 'radio',
      'aria-checked': i === entry.selectedIndex ? 'true' : 'false',
    });
    const imgWrap = h('div', { class: 'photo-candidate-img-wrap' });
    if (c.imageUrl) {
      const img = h('img', { class: 'photo-candidate-img', alt: c.name || 'Candidate', referrerpolicy: 'no-referrer' });
      img.dataset.retriedProxy = '';
      img.onerror = () => {
        if (!img.dataset.retriedProxy && !img.src.startsWith('https://images.weserv.nl/')) {
          img.dataset.retriedProxy = '1';
          img.src = 'https://images.weserv.nl/?url=' + encodeURIComponent(c.imageUrl.replace(/^https?:\/\//, ''));
        } else {
          img.style.display = 'none';
        }
      };
      img.src = c.imageUrl;
      imgWrap.appendChild(img);
    } else {
      imgWrap.appendChild(h('div', { class: 'photo-candidate-img-placeholder' }, '?'));
    }
    card.appendChild(imgWrap);
    const body = h('div', { class: 'photo-candidate-body' });
    body.appendChild(h('div', { class: 'photo-candidate-name' }, c.name || '(unnamed)'));
    const metaParts = [];
    if (c.brand) metaParts.push(c.brand);
    if (c.weightGrams != null) {
      const v = gramsToUnit(c.weightGrams, displayUnit);
      metaParts.push(displayUnit === 'g' ? `${Math.round(v)} g` : `${v.toFixed(2)} ${displayUnit}`);
    }
    if (metaParts.length) body.appendChild(h('div', { class: 'photo-candidate-meta' }, metaParts.join(' · ')));
    card.appendChild(body);
    card.appendChild(h('span', { class: 'photo-candidate-check', 'aria-hidden': 'true' }, '✓'));
    card.addEventListener('click', () => selectCandidate(i));
    list.appendChild(card);
  });
}

function applyCandidateForce(c, photoDataUrl) {
  $('#gear-name').value = c.name || '';
  $('#gear-brand').value = c.brand || '';
  $('#gear-url').value = c.url || '';
  $('#gear-notes').value = c.notes || '';
  if (c.weightGrams != null) {
    const v = gramsToUnit(c.weightGrams, displayUnit);
    $('#gear-weight').value = displayUnit === 'g' ? String(Math.round(v)) : v.toFixed(2);
  } else {
    $('#gear-weight').value = '';
  }
  $('#gear-quantity').value = String(c.quantity ?? 1);
  // Use Claude's product image if it exists, otherwise fall back to the user's photo.
  $('#gear-image').value = c.imageUrl || photoDataUrl || '';
  updateGearPreview();
}

function selectCandidate(i) {
  if (!isPhotoFlowActive()) return;
  const entry = photoQueue[photoIndex];
  if (!entry || !entry.candidates || i < 0 || i >= entry.candidates.length) return;
  entry.selectedIndex = i;
  const c = entry.candidates[i];
  applyCandidateForce(c, entry.dataUrl);
  renderCandidatesPicker(entry);
  // Server only eagerly enriches the top candidate (to keep Anthropic call
  // counts bounded for multi-photo bursts). Lazy-enrich an alternate when
  // it's clicked, then re-apply if the user is still on it.
  if (i > 0 && c && c.name && !c.enriched) maybeEnrichCandidate(entry, i);
}

async function maybeEnrichCandidate(entry, idx) {
  const c = entry.candidates[idx];
  if (!c || c.enriching || c.enriched) return;
  if (c.weightGrams != null && c.url && c.imageUrl) {
    c.enriched = true;
    return;
  }
  c.enriching = true;
  try {
    const res = await callExtractGear({ identity: { name: c.name, brand: c.brand } });
    const d = res.data || {};
    c.weightGrams = c.weightGrams ?? d.weightGrams ?? null;
    c.url = c.url || d.url || null;
    c.imageUrl = c.imageUrl || d.imageUrl || null;
    c.enriched = true;
    if (
      isPhotoFlowActive()
      && photoQueue[photoIndex] === entry
      && entry.selectedIndex === idx
    ) {
      applyCandidateForce(c, entry.dataUrl);
      renderCandidatesPicker(entry);
    }
  } catch (_) {
    // Enrichment failure is non-fatal — user can still save with what we have.
  } finally {
    c.enriching = false;
  }
}

function showCurrentPhoto() {
  const entry = photoQueue[photoIndex];
  if (!entry) return;
  $('#photo-workflow').classList.remove('hidden');
  $('#gear-entry-methods').classList.add('hidden');
  document.body.classList.add('photo-workflow-active');
  $('#photo-workflow-preview').src = entry.dataUrl || '';
  renderPhotoProgress();
  // Skip is only meaningful when there are more photos in the queue.
  $('#gear-skip-btn').classList.toggle('hidden', photoQueue.length <= 1);
  // Save button text adapts to queue position.
  const saveBtn = $('#gear-save-btn');
  const moreAfter = photoQueue.length > 1 && photoIndex < photoQueue.length - 1;
  if (editingGearId) {
    saveBtn.textContent = 'Save changes';
  } else if (moreAfter) {
    saveBtn.textContent = '＋ Add & next photo';
  } else {
    saveBtn.textContent = '＋ Add to library';
  }
  if (entry.status === 'analyzing' || entry.status === 'pending') {
    setPhotoWorkflowStatus('Analyzing your photo with Claude…', { loading: true });
    $('#photo-candidates').classList.add('hidden');
    $('#photo-reidentify-btn').classList.add('hidden');
    $('#photo-cancel-btn').classList.remove('hidden');
  } else if (entry.status === 'error') {
    setPhotoWorkflowStatus(entry.error || 'Could not identify gear in that photo.', { error: true });
    $('#photo-candidates').classList.add('hidden');
    $('#photo-reidentify-btn').classList.remove('hidden');
    $('#photo-cancel-btn').classList.remove('hidden');
    // Use the photo as a fallback thumbnail so the user can still type a name and save.
    if (!$('#gear-image').value && entry.dataUrl) {
      $('#gear-image').value = entry.dataUrl;
      updateGearPreview();
    }
  } else if (entry.status === 'ready') {
    const c = entry.candidates[entry.selectedIndex];
    const label = c ? [c.brand, c.name].filter(Boolean).join(' ') : '';
    let msg;
    if (entry.confidence === 'high') msg = `Identified: ${label}`;
    else msg = `Best guess: ${label}`;
    setPhotoWorkflowStatus(msg, { success: entry.confidence === 'high' });
    renderCandidatesPicker(entry);
    // Re-apply selected candidate to the form (in case this entry was
    // prefetched in the background and the form was cleared between photos).
    if (c) applyCandidateForce(c, entry.dataUrl);
    $('#photo-reidentify-btn').classList.remove('hidden');
    $('#photo-cancel-btn').classList.remove('hidden');
  }
  updateGearSaveBtnState();
}

async function processPhotoEntry(entry, { forceMultiple = false } = {}) {
  const mySeq = photoSeq;
  entry.status = 'analyzing';
  entry.error = null;
  if (photoQueue[photoIndex] === entry) showCurrentPhoto();
  try {
    const { base64, mediaType } = await fileToResizedDataUrl(entry.file);
    if (mySeq !== photoSeq) return;
    const res = await callExtractGear({
      image: { base64, mediaType },
      mode: entry.mode || 'photo',
      forceMultiple,  // confidence drives this — high → 1 candidate, else 2-3
    });
    if (mySeq !== photoSeq) return;
    const candidates = Array.isArray(res.candidates) ? res.candidates : (res.data ? [res.data] : []);
    if (candidates.length === 0) {
      entry.status = 'error';
      entry.error = 'Could not identify gear in this photo.';
    } else {
      entry.candidates = candidates;
      entry.confidence = res.confidence || 'low';
      entry.selectedIndex = 0;
      entry.status = 'ready';
      // Auto-apply the top candidate to the form (queue-current entry only).
      if (photoQueue[photoIndex] === entry) {
        applyCandidateForce(candidates[0], entry.dataUrl);
      }
    }
  } catch (err) {
    if (mySeq !== photoSeq) return;
    entry.status = 'error';
    entry.error = err.message || 'Could not identify gear from that photo.';
  } finally {
    if (mySeq === photoSeq && photoQueue[photoIndex] === entry) showCurrentPhoto();
    renderPhotoProgress();
  }
}

async function enqueuePhotos(files, { forceMultiple = false, mode = 'photo' } = {}) {
  const valid = Array.from(files || []).filter((f) => f && f.type && f.type.startsWith('image/'));
  if (valid.length === 0) return;
  const accepted = valid.slice(0, MAX_PHOTO_QUEUE);
  if (valid.length > MAX_PHOTO_QUEUE) {
    toast(`Processing the first ${MAX_PHOTO_QUEUE} photos`, 'info');
  }
  // Always start fresh when no queue is in progress — clears any leftover
  // edit state so the photo workflow opens against a clean form.
  if (!isPhotoFlowActive()) {
    if ($('#gear-modal').classList.contains('hidden')) {
      openAddGear();
    } else {
      resetGearFormFields();
      clearPhotoQueue();
    }
  }
  // Lock the save button immediately — thumbnail decoding can take a few
  // hundred ms before showCurrentPhoto runs, and we don't want the user
  // saving an empty form during that gap.
  $('#gear-save-btn').disabled = true;
  // First entry kicks off immediately; the rest sit pending.
  for (const f of accepted) {
    let dataUrl = '';
    try { dataUrl = await fileToThumbnailDataUrl(f, 600, 0.8); } catch { /* ignore preview failure */ }
    photoQueue.push({
      id: Math.random().toString(36).slice(2),
      file: f,
      dataUrl,
      mode,
      status: 'pending',
      candidates: null,
      confidence: null,
      selectedIndex: 0,
      error: null,
    });
  }
  if (photoIndex < 0) photoIndex = 0;
  showCurrentPhoto();
  // Process current first; once done, prefetch the next in background.
  await processPhotoEntry(photoQueue[photoIndex], { forceMultiple });
  prefetchNextPhotos();
}

function prefetchNextPhotos() {
  // Pre-analyze the next photo in the background so it's ready when the user advances.
  const nextIdx = photoIndex + 1;
  if (nextIdx >= photoQueue.length) return;
  const next = photoQueue[nextIdx];
  if (next.status === 'pending') {
    processPhotoEntry(next).catch(() => {});
  }
}

function advancePhotoQueue() {
  // Mark current as moved-on (saved/skipped already set by caller).
  const next = photoIndex + 1;
  if (next >= photoQueue.length) {
    clearPhotoQueue();
    return false;
  }
  photoIndex = next;
  showCurrentPhoto();
  if (photoQueue[photoIndex].status === 'pending') {
    processPhotoEntry(photoQueue[photoIndex]);
  }
  prefetchNextPhotos();
  return true;
}

function reidentifyCurrentPhoto() {
  const entry = photoQueue[photoIndex];
  if (!entry) return;
  // Always force multiple candidates on re-identify.
  entry.status = 'pending';
  entry.candidates = null;
  entry.confidence = null;
  entry.selectedIndex = 0;
  processPhotoEntry(entry, { forceMultiple: true });
}

// Back-compat shim — the mobile single-photo button still calls into the
// queue with a single file.
async function handleGearPhotoFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  // Reset any prior queue (single-photo flow always starts fresh).
  clearPhotoQueue();
  await enqueuePhotos([file]);
}

// ------------------------------------------------------------------
// Activity modal
// ------------------------------------------------------------------
// Auto-emoji state: stays true until the user explicitly picks or types an
// emoji, at which point we stop overwriting their choice as they keep
// editing the name. Reset each time the modal opens.
let activityEmojiAutoDerive = true;

function syncActivityEmojiDisplay() {
  const hidden = $('#activity-emoji');
  const display = $('#activity-emoji-display');
  if (!hidden || !display) return;
  const v = (hidden.value || '').trim();
  display.textContent = v || DEFAULT_ACTIVITY_EMOJI;
  $('#activity-emoji-btn')?.classList.toggle('is-placeholder', !v);
}

function autoDeriveActivityEmoji() {
  if (!activityEmojiAutoDerive) return;
  const name = $('#activity-name').value;
  const preset = presetForActivity({ name });
  const emoji = preset ? preset.emoji : '';
  $('#activity-emoji').value = emoji;
  syncActivityEmojiDisplay();
}

function resetActivityModalToFormView() {
  $('#activity-form-view').hidden = false;
  $('#activity-created-view').hidden = true;
  $('#activity-save-btn').classList.remove('hidden');
  $('#activity-cancel-btn').classList.remove('hidden');
  $('#activity-done-btn').classList.add('hidden');
}

function openNewActivity() {
  editingActivityId = null;
  $('#activity-modal-title').textContent = 'New activity';
  $('#activity-name').value = '';
  $('#activity-emoji').value = '';
  $('#activity-invite-emails').value = '';
  $('#activity-invite-field').classList.remove('hidden');
  $('#activity-delete-btn').classList.add('hidden');
  $('#activity-duplicate-btn').classList.add('hidden');
  // Share glyph only makes sense on existing lists.
  $('#activity-modal-share-btn').classList.add('hidden');
  resetActivityModalToFormView();
  activityEmojiAutoDerive = true;
  syncActivityEmojiDisplay();
  hideEmojiPicker();
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
  $('#activity-invite-emails').value = '';
  // Hide the emails-on-create field when editing an existing list — use the
  // share modal for that instead.
  $('#activity-invite-field').classList.add('hidden');
  $('#activity-delete-btn').classList.toggle('hidden', !isOwnerOf(id));
  $('#activity-duplicate-btn').classList.remove('hidden');
  // Show the share glyph for anyone — RLS gates what they can actually do.
  $('#activity-modal-share-btn').classList.remove('hidden');
  resetActivityModalToFormView();
  // In edit mode we respect whatever emoji was saved — either the user picked
  // it deliberately, or it was auto-derived at create time and they're happy
  // with it. Either way, don't silently rewrite it as they retype the name.
  activityEmojiAutoDerive = !a.emoji;
  syncActivityEmojiDisplay();
  hideEmojiPicker();
  showModal('activity-modal');
}

// ---- Emoji picker overlay ----
function isDesktopPointer() {
  return typeof matchMedia === 'function'
    && matchMedia('(hover: hover) and (pointer: fine)').matches;
}

function buildEmojiPicker() {
  const host = $('#activity-emoji-picker');
  if (!host || host.dataset.built === '1') return;
  host.dataset.built = '1';
  for (const e of EMOJI_PICKER_CHOICES) {
    const btn = h('button', {
      class: 'emoji-picker-option',
      type: 'button',
      'aria-label': `Use ${e}`,
      onclick: () => pickActivityEmoji(e),
    }, e);
    host.appendChild(btn);
  }
}

function showEmojiPicker() {
  buildEmojiPicker();
  $('#activity-emoji-picker')?.classList.remove('hidden');
  $('#activity-emoji-btn')?.setAttribute('aria-expanded', 'true');
}

function hideEmojiPicker() {
  $('#activity-emoji-picker')?.classList.add('hidden');
  $('#activity-emoji-btn')?.setAttribute('aria-expanded', 'false');
}

function pickActivityEmoji(emoji) {
  $('#activity-emoji').value = emoji;
  activityEmojiAutoDerive = false;
  syncActivityEmojiDisplay();
  hideEmojiPicker();
}

function handleActivityEmojiBtnClick() {
  if (isDesktopPointer()) {
    const picker = $('#activity-emoji-picker');
    if (picker && !picker.classList.contains('hidden')) hideEmojiPicker();
    else showEmojiPicker();
  } else {
    // Mobile: pop open the native keyboard so the user can use their
    // system emoji picker. User-typed emoji wins over auto-derive.
    const input = $('#activity-emoji');
    if (!input) return;
    input.classList.add('is-editing');
    input.focus();
    input.select();
  }
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
  // A trigger auto-enrolls the creator as owner in activity_members —
  // reflect that optimistically so UI state matches without a reload.
  if (currentUser) {
    membersByActivity[data.id] = [{
      activity_id: data.id,
      user_id: currentUser.id,
      role: 'owner',
      joined_at: new Date().toISOString(),
    }];
  }
  const emails = parseEmailList($('#activity-invite-emails').value);
  render();
  syncRealtimeSubscription();
  // Fire email invites in the background while the user sees the success
  // view. They don't need to wait for Resend to resolve before getting the
  // share link in their clipboard.
  if (emails.length) {
    fanOutInvitesForNewActivity(data.id, emails).then(() => render());
  }
  // Swap the modal to its post-create success state so the user can grab
  // the share link right here instead of needing a second trip through the
  // share modal.
  await showActivityCreatedSuccess(data, emails);
}

async function showActivityCreatedSuccess(activity, invitedEmails) {
  $('#activity-form-view').hidden = true;
  $('#activity-created-view').hidden = false;
  $('#activity-modal-title').textContent = 'List created';
  $('#activity-save-btn').classList.add('hidden');
  $('#activity-cancel-btn').classList.add('hidden');
  $('#activity-done-btn').classList.remove('hidden');
  $('#activity-delete-btn').classList.add('hidden');
  $('#activity-duplicate-btn').classList.add('hidden');
  $('#activity-modal-share-btn').classList.add('hidden');

  const emojiEl = $('#activity-created-emoji');
  if (emojiEl) emojiEl.textContent = (activity?.emoji || '').trim() || '🎒';

  const titleEl = $('#activity-created-title');
  if (titleEl && activity?.name) {
    titleEl.textContent = `${activity.name} is ready!`;
  } else if (titleEl) {
    titleEl.textContent = 'List created!';
  }

  const emailsNote = $('#activity-created-emails-note');
  if (emailsNote) {
    if (Array.isArray(invitedEmails) && invitedEmails.length) {
      const label = invitedEmails.length === 1
        ? `Invite email sent to ${invitedEmails[0]}.`
        : `Invite emails sent to ${invitedEmails.length} people.`;
      emailsNote.textContent = label;
      emailsNote.hidden = false;
    } else {
      emailsNote.hidden = true;
      emailsNote.textContent = '';
    }
  }

  const input = $('#activity-created-share-url');
  const copyBtn = $('#activity-created-share-copy');
  if (input) input.value = 'Loading…';
  if (copyBtn) { copyBtn.disabled = true; copyBtn.textContent = 'Copy'; copyBtn.classList.remove('share-link-copied'); }

  const url = await fetchShareLinkUrl(activity.id);
  if (input) input.value = url || '';
  if (copyBtn) copyBtn.disabled = !url;
  // Auto-select so a long-press "Copy" on mobile or ⌘A/C on desktop is one
  // fewer interaction for a user who wants it in their clipboard fast.
  if (url && input) {
    requestAnimationFrame(() => {
      try { input.focus({ preventScroll: true }); input.select(); } catch {}
    });
  }
}

function handleActivityCreatedShareCopy() {
  return copyShareLink($('#activity-created-share-url'), $('#activity-created-share-copy'));
}

function handleActivityDoneBtn() {
  hideModal('activity-modal');
}

// Duplicate an activity and everything scoped to it: its custom filters,
// its packed-item rows (with quantity/note/tags), and the filter/weather
// toggles that were active on the source. Custom-filter IDs get remapped
// from source → copy so the new activity's toggles/items reference the
// new filter rows, not the originals.
async function handleDuplicateActivity() {
  if (!editingActivityId) return;
  const source = activities.find((x) => x.id === editingActivityId);
  if (!source) return;

  const existing = new Set(activities.map((a) => a.name));
  let newName = `${source.name} (copy)`;
  for (let i = 2; existing.has(newName) && i < 100; i++) {
    newName = `${source.name} (copy ${i})`;
  }

  const { data: newAct, error: actErr } = await supabase
    .from('activities')
    .insert({
      name: newName,
      emoji: source.emoji,
      position: activities.length,
      active_weathers: source.active_weathers || [],
      active_custom_filter_ids: [],
    })
    .select()
    .single();
  if (actErr) { toast(actErr.message, 'error'); return; }

  const filterIdMap = new Map();
  let newFilters = [];
  const srcFilters = [...(customFiltersByActivity[editingActivityId] || [])]
    .sort((a, b) => a.position - b.position);
  if (srcFilters.length) {
    const { data: inserted, error: fErr } = await supabase
      .from('custom_filters')
      .insert(srcFilters.map((f) => ({
        activity_id: newAct.id,
        label: f.label,
        position: f.position,
      })))
      .select();
    if (fErr) { toast(fErr.message, 'error'); return; }
    newFilters = [...inserted].sort((a, b) => a.position - b.position);
    srcFilters.forEach((oldF, i) => filterIdMap.set(oldF.id, newFilters[i].id));
  }

  let newItems = [];
  const srcItems = itemsByActivity[editingActivityId] || [];
  if (srcItems.length) {
    const { data: inserted, error: iErr } = await supabase
      .from('activity_items')
      .insert(srcItems.map((it) => ({
        activity_id: newAct.id,
        gear_id: it.gear_id,
        position: it.position,
        packed: false,
        quantity: it.quantity,
        note: it.note,
        weather_tags: it.weather_tags || [],
        custom_filter_ids: (it.custom_filter_ids || [])
          .map((fid) => filterIdMap.get(fid))
          .filter(Boolean),
      })))
      .select();
    if (iErr) { toast(iErr.message, 'error'); return; }
    newItems = inserted;
  }

  const remappedActiveFilters = (source.active_custom_filter_ids || [])
    .map((fid) => filterIdMap.get(fid))
    .filter(Boolean);
  if (remappedActiveFilters.length) {
    await supabase
      .from('activities')
      .update({ active_custom_filter_ids: remappedActiveFilters })
      .eq('id', newAct.id);
    newAct.active_custom_filter_ids = remappedActiveFilters;
  }

  activities.push(newAct);
  itemsByActivity[newAct.id] = newItems;
  customFiltersByActivity[newAct.id] = newFilters;
  if (currentUser) {
    membersByActivity[newAct.id] = [{
      activity_id: newAct.id,
      user_id: currentUser.id,
      role: 'owner',
      joined_at: new Date().toISOString(),
    }];
  }
  activeActivityId = newAct.id;
  hideModal('activity-modal');
  render();
  syncRealtimeSubscription();
  toast(`Duplicated "${source.name}"`);
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
  delete membersByActivity[editingActivityId];
  delete invitesByActivity[editingActivityId];
  if (activeActivityId === editingActivityId) {
    activeActivityId = activities[0]?.id || null;
  }
  hideModal('activity-modal');
  render();
  syncRealtimeSubscription();
}

// ------------------------------------------------------------------
// Share / collaboration
// ------------------------------------------------------------------

async function callEdgeFunction(name, body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: 'Not signed in' };
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${session.access_token}`,
      'apikey': SUPABASE_ANON_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  let json;
  try { json = await res.json(); } catch { json = {}; }
  if (!res.ok) return { error: json?.error || `HTTP ${res.status}`, status: res.status };
  return { data: json };
}

function openShareModal(activityId) {
  const a = activities.find((x) => x.id === activityId);
  if (!a) return;
  shareModalActivityId = activityId;
  $('#share-modal-title').textContent = `Share "${a.emoji ? a.emoji + ' ' : ''}${a.name}"`;
  const subtitle = $('#share-modal-subtitle');
  if (isOwnerOf(activityId)) {
    subtitle.textContent = `Invite friends by email. They'll see this list and can add gear from their own library.`;
  } else {
    const coCount = Math.max(0, membersFor(activityId).length - 1);
    subtitle.textContent = `You're packing this list together with ${coCount} other${coCount === 1 ? '' : 's'}.`;
  }
  $('#share-invite-email').value = '';
  setShareInviteStatus('', '');
  // Hide invite form for non-owners.
  $('#share-invite-form').classList.toggle('hidden', !isOwnerOf(activityId));
  // Show Leave button for members (not owner).
  $('#share-leave-btn').classList.toggle('hidden', isOwnerOf(activityId));
  renderShareModal();
  showModal('share-modal');
  // Kick off the share-link fetch; it populates (or hides) the top section
  // independently of the rest of the modal.
  loadShareLinkForModal(activityId).catch((err) => {
    console.warn('[share-link] load failed', err);
  });
  requestAnimationFrame(() => {
    if (isOwnerOf(activityId)) $('#share-invite-email').focus();
  });
}

function renderShareModal() {
  if (!shareModalActivityId) return;
  const activityId = shareModalActivityId;
  const memberList = $('#share-members-list');
  const inviteList = $('#share-invites-list');
  memberList.innerHTML = '';
  inviteList.innerHTML = '';

  const ms = [...membersFor(activityId)].sort((a, b) => {
    if (a.role === 'owner' && b.role !== 'owner') return -1;
    if (b.role === 'owner' && a.role !== 'owner') return 1;
    return (a.joined_at || '').localeCompare(b.joined_at || '');
  });
  for (const m of ms) memberList.appendChild(shareMemberRow(activityId, m));

  const invs = [...invitesFor(activityId)].sort((a, b) =>
    (a.created_at || '').localeCompare(b.created_at || ''));
  const invitesSection = $('#share-invites-section');
  if (isOwnerOf(activityId) && invs.length) {
    invitesSection.classList.remove('hidden');
    for (const inv of invs) inviteList.appendChild(shareInviteRow(activityId, inv));
  } else {
    invitesSection.classList.add('hidden');
  }
}

function shareMemberRow(activityId, member) {
  const name = displayNameFor(member.user_id)
    || (member.user_id === currentUser?.id ? 'You' : 'Member');
  const isSelf = member.user_id === currentUser?.id;
  const canKick = isOwnerOf(activityId) && !isSelf && member.role !== 'owner';
  return h('li', { class: 'share-member-row' },
    ownerChipEl(member.user_id, { size: 'lg' }),
    h('div', { class: 'share-member-main' },
      h('div', { class: 'share-member-name' }, isSelf ? `${name} (you)` : name),
      member.role === 'owner'
        ? h('div', { class: 'share-member-sub' }, 'List admin')
        : h('div', { class: 'share-member-sub' }, 'Member'),
    ),
    h('span', {
      class: 'share-role-badge' + (member.role === 'owner' ? ' role-owner' : ''),
    }, member.role),
    h('div', { class: 'share-row-actions' },
      canKick
        ? h('button', {
            class: 'btn btn-ghost btn-sm',
            type: 'button',
            title: 'Remove member',
            onclick: () => removeMember(activityId, member.user_id, name),
          }, 'Remove')
        : null,
    ),
  );
}

function shareInviteRow(activityId, invite) {
  return h('li', { class: 'share-invite-row' },
    h('div', { class: 'share-member-main' },
      h('div', { class: 'share-member-name' }, invite.email),
      h('div', { class: 'share-invite-sub' }, 'Invite sent — waiting for them to accept'),
    ),
    h('div', { class: 'share-row-actions' },
      h('button', {
        class: 'btn btn-ghost btn-sm',
        type: 'button',
        onclick: (e) => resendInvite(activityId, invite, e.currentTarget),
      }, 'Resend'),
      h('button', {
        class: 'btn btn-ghost btn-sm',
        type: 'button',
        onclick: () => cancelInvite(invite.id),
      }, 'Cancel'),
    ),
  );
}

function setShareInviteStatus(text, kind = '') {
  const el = $('#share-invite-status');
  el.textContent = text;
  el.classList.remove('success', 'error');
  if (kind === 'success') el.classList.add('success');
  else if (kind === 'error') el.classList.add('error');
}

async function handleShareInviteSubmit(e) {
  e.preventDefault();
  const activityId = shareModalActivityId;
  if (!activityId) return;
  const email = $('#share-invite-email').value.trim();
  if (!email) return;
  const btn = $('#share-invite-submit');
  btn.disabled = true;
  setShareInviteStatus('Sending invite…');
  const result = await sendShareInvite(activityId, email);
  btn.disabled = false;
  if (result?.error) {
    setShareInviteStatus(result.error, 'error');
    return;
  }
  $('#share-invite-email').value = '';
  if (result?.status === 'added') {
    setShareInviteStatus(`Added ${email} to this list.`, 'success');
  } else {
    setShareInviteStatus(`Invite sent to ${email}.`, 'success');
  }
  renderShareModal();
  render();
}

async function sendShareInvite(activityId, email) {
  const { data, error } = await callEdgeFunction('share-activity', {
    activity_id: activityId,
    email,
  });
  if (error) return { error };
  // Optimistic local update so the UI reflects new state before realtime catches up.
  if (data?.status === 'added' && data.member) {
    const list = membersByActivity[activityId] || (membersByActivity[activityId] = []);
    if (!list.some((m) => m.user_id === data.member.user_id)) list.push(data.member);
    // Load their profile so their chip has a name.
    loadCoMemberProfiles().catch(() => {});
  } else if (data?.status === 'invited' && data.invite) {
    const list = invitesByActivity[activityId] || (invitesByActivity[activityId] = []);
    if (!list.some((i) => i.id === data.invite.id)) list.push(data.invite);
  }
  return data;
}

async function resendInvite(activityId, invite, btn) {
  if (btn) btn.disabled = true;
  setShareInviteStatus(`Resending invite to ${invite.email}…`);
  const { error } = await callEdgeFunction('share-activity', {
    activity_id: activityId,
    email: invite.email,
  });
  if (btn) btn.disabled = false;
  if (error) setShareInviteStatus(error, 'error');
  else setShareInviteStatus(`Invite resent to ${invite.email}.`, 'success');
}

async function cancelInvite(inviteId) {
  if (!confirm('Cancel this invite? They won\'t be able to accept it.')) return;
  const { error } = await supabase.from('activity_invites').delete().eq('id', inviteId);
  if (error) { toast(error.message, 'error'); return; }
  for (const aid of Object.keys(invitesByActivity)) {
    invitesByActivity[aid] = invitesByActivity[aid].filter((i) => i.id !== inviteId);
  }
  renderShareModal();
  render();
}

async function removeMember(activityId, userId, name) {
  if (!confirm(`Remove ${name} from this list?`)) return;
  const { error } = await supabase
    .from('activity_members')
    .delete()
    .eq('activity_id', activityId)
    .eq('user_id', userId);
  if (error) { toast(error.message, 'error'); return; }
  if (membersByActivity[activityId]) {
    membersByActivity[activityId] = membersByActivity[activityId].filter((m) => m.user_id !== userId);
  }
  renderShareModal();
  render();
}

async function handleLeaveActivity() {
  const activityId = shareModalActivityId;
  if (!activityId || !currentUser) return;
  const a = activities.find((x) => x.id === activityId);
  if (!a) return;
  if (!confirm(`Leave "${a.name}"? You won't see this list anymore (the owner can re-invite you).`)) return;
  const { error } = await supabase
    .from('activity_members')
    .delete()
    .eq('activity_id', activityId)
    .eq('user_id', currentUser.id);
  if (error) { toast(error.message, 'error'); return; }
  activities = activities.filter((x) => x.id !== activityId);
  delete itemsByActivity[activityId];
  delete customFiltersByActivity[activityId];
  delete membersByActivity[activityId];
  delete invitesByActivity[activityId];
  if (activeActivityId === activityId) activeActivityId = activities[0]?.id || null;
  hideModal('share-modal');
  shareModalActivityId = null;
  render();
  syncRealtimeSubscription();
  toast(`Left "${a.name}"`);
}

// ---- New-activity invite fan-out -----------------------------------------

// After a new activity is created, if the creator typed emails in the
// "Share with" field, fire one share-activity call per address in parallel
// and surface a summary toast. Errors are reported but don't block the save.
async function fanOutInvitesForNewActivity(activityId, emails) {
  if (!activityId || !emails || !emails.length) return;
  const results = await Promise.allSettled(
    emails.map((email) => sendShareInvite(activityId, email)),
  );
  let added = 0, invited = 0, failed = 0;
  const errors = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && !r.value?.error) {
      if (r.value?.status === 'added') added++;
      else invited++;
    } else {
      failed++;
      const msg = r.status === 'fulfilled' ? r.value?.error : (r.reason?.message || String(r.reason));
      errors.push(`${emails[i]}: ${msg}`);
    }
  });
  const parts = [];
  if (added) parts.push(`${added} added`);
  if (invited) parts.push(`${invited} invited`);
  if (failed) parts.push(`${failed} failed`);
  if (parts.length) toast(parts.join(' · '), failed ? 'error' : '');
  if (errors.length) console.warn('Invite fan-out errors', errors);
}

function parseEmailList(raw) {
  return (raw || '')
    .split(/[,\n;]/)
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

// ---- Realtime -------------------------------------------------------------

async function syncRealtimeSubscription() {
  const nextId = activeActivityId;
  if (realtimeChannelActivityId === nextId) return;
  if (realtimeChannel) {
    try { supabase.removeChannel(realtimeChannel); } catch {}
    realtimeChannel = null;
  }
  realtimeChannelActivityId = nextId;
  if (!nextId) return;
  // Belt-and-suspenders: make sure the realtime socket is using the current
  // user's JWT (not the anon key). v2 auto-propagates after onAuthStateChange,
  // but calling here guards against races where we subscribe before that
  // propagation has flushed.
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (token && typeof supabase.realtime?.setAuth === 'function') {
      supabase.realtime.setAuth(token);
    }
  } catch (err) {
    console.warn('[realtime] setAuth failed', err);
  }
  const aid = nextId;
  const channel = supabase
    .channel(`activity-${aid}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'activity_items', filter: `activity_id=eq.${aid}` },
      (payload) => onRealtimeItemChange(aid, payload))
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'activity_members', filter: `activity_id=eq.${aid}` },
      (payload) => onRealtimeMemberChange(aid, payload))
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'custom_filters', filter: `activity_id=eq.${aid}` },
      (payload) => onRealtimeCustomFilterChange(aid, payload))
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'activities', filter: `id=eq.${aid}` },
      (payload) => onRealtimeActivityChange(aid, payload))
    .subscribe((status, err) => {
      console.log(`[realtime] channel activity-${aid} status=${status}`, err || '');
    });
  realtimeChannel = channel;
}

// Sets up unfiltered subscriptions to every table that needs cross-tab live
// updates. RLS gates membership so each user only receives events for rows
// they can read. Handlers below skip events for the active activity (handled
// by syncRealtimeSubscription's per-activity channel) to avoid double-apply.
async function setupGlobalRealtime() {
  for (const ch of [
    globalItemsChannel,
    globalActivitiesChannel,
    globalMembersChannel,
    globalCustomFiltersChannel,
    globalGearChannel,
  ]) {
    if (ch) { try { supabase.removeChannel(ch); } catch {} }
  }
  globalItemsChannel = null;
  globalActivitiesChannel = null;
  globalMembersChannel = null;
  globalCustomFiltersChannel = null;
  globalGearChannel = null;
  if (!currentUser) return;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (token && typeof supabase.realtime?.setAuth === 'function') {
      supabase.realtime.setAuth(token);
    }
  } catch (err) {
    console.warn('[realtime] setAuth failed (global)', err);
  }
  globalItemsChannel = supabase
    .channel('items-global')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_items' }, onGlobalItemsChange)
    .subscribe((status, err) => console.log(`[realtime] items-global=${status}`, err || ''));
  globalActivitiesChannel = supabase
    .channel('activities-global')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'activities' }, onGlobalActivitiesChange)
    .subscribe((status, err) => console.log(`[realtime] activities-global=${status}`, err || ''));
  globalMembersChannel = supabase
    .channel('members-global')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_members' }, onGlobalMembersChange)
    .subscribe((status, err) => console.log(`[realtime] members-global=${status}`, err || ''));
  globalCustomFiltersChannel = supabase
    .channel('custom-filters-global')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'custom_filters' }, onGlobalCustomFiltersChange)
    .subscribe((status, err) => console.log(`[realtime] custom-filters-global=${status}`, err || ''));
  globalGearChannel = supabase
    .channel('gear-global')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'gear' }, onGlobalGearChange)
    .subscribe((status, err) => console.log(`[realtime] gear-global=${status}`, err || ''));
}

async function onGlobalItemsChange(payload) {
  const aid = payload.new?.activity_id || payload.old?.activity_id;
  if (!aid) return;
  // Active tab is owned by the per-activity channel; skipping here keeps us
  // from double-applying the same event.
  if (aid === activeActivityId) return;
  const items = itemsByActivity[aid] || (itemsByActivity[aid] = []);
  if (payload.eventType === 'INSERT') {
    if (items.some((i) => i.id === payload.new.id)) return;
    items.push(payload.new);
    if (payload.new.gear_id && !getGearById(payload.new.gear_id)) {
      await loadForeignGear();
      await loadCoMemberProfiles();
    }
  } else if (payload.eventType === 'UPDATE') {
    const idx = items.findIndex((i) => i.id === payload.new.id);
    if (idx >= 0) items[idx] = payload.new;
    else items.push(payload.new);
  } else if (payload.eventType === 'DELETE') {
    itemsByActivity[aid] = items.filter((i) => i.id !== payload.old.id);
  }
  renderTabs();
}

// Activities INSERT/UPDATE/DELETE across every activity the user can read.
// New shared activity invitations show up as INSERTs (RLS lets the user
// SELECT once activity_members has their row); deletions remove the tab.
function onGlobalActivitiesChange(payload) {
  if (payload.eventType === 'INSERT') {
    if (activities.some((a) => a.id === payload.new.id)) return;
    activities.push(payload.new);
    activities.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    render();
  } else if (payload.eventType === 'UPDATE') {
    if (payload.new.id === activeActivityId) return; // per-activity channel
    const idx = activities.findIndex((a) => a.id === payload.new.id);
    if (idx >= 0) activities[idx] = payload.new;
    else activities.push(payload.new);
    renderTabs();
  } else if (payload.eventType === 'DELETE') {
    const id = payload.old.id;
    activities = activities.filter((a) => a.id !== id);
    delete itemsByActivity[id];
    delete customFiltersByActivity[id];
    delete membersByActivity[id];
    delete invitesByActivity[id];
    delete viewsByActivity[id];
    if (activeActivityId === id) {
      activeActivityId = activities[0]?.id || null;
      syncRealtimeSubscription();
    }
    render();
  }
}

// Members across every activity. Detects when the user themselves is added
// to a new activity (so their tabs appear) and when they're removed (so the
// stale tab disappears immediately).
async function onGlobalMembersChange(payload) {
  const aid = payload.new?.activity_id || payload.old?.activity_id;
  if (!aid) return;
  if (aid === activeActivityId) return; // per-activity channel handles it
  const me = currentUser?.id;
  const list = membersByActivity[aid] || (membersByActivity[aid] = []);
  if (payload.eventType === 'INSERT') {
    if (!list.some((m) => m.user_id === payload.new.user_id)) list.push(payload.new);
    // If the new member is me, this is a fresh activity I just got invited
    // to — the activities INSERT may not have arrived yet (or arrived
    // before the membership row, in which case RLS hid it). Reload the
    // activity row + its items so the tab populates.
    if (payload.new.user_id === me && !activities.some((a) => a.id === aid)) {
      const { data: a } = await supabase.from('activities').select('*').eq('id', aid).maybeSingle();
      if (a) {
        activities.push(a);
        activities.sort((x, y) => (x.position ?? 0) - (y.position ?? 0));
      }
      const { data: items } = await supabase.from('activity_items').select('*').eq('activity_id', aid);
      if (items) itemsByActivity[aid] = items;
      await loadForeignGear();
    }
    await loadCoMemberProfiles();
  } else if (payload.eventType === 'UPDATE') {
    const idx = list.findIndex((m) => m.user_id === payload.new.user_id);
    if (idx >= 0) list[idx] = payload.new;
  } else if (payload.eventType === 'DELETE') {
    membersByActivity[aid] = list.filter((m) => m.user_id !== payload.old.user_id);
    // If I was just removed from this activity, drop it from my view entirely.
    if (payload.old.user_id === me) {
      activities = activities.filter((a) => a.id !== aid);
      delete itemsByActivity[aid];
      delete customFiltersByActivity[aid];
      delete membersByActivity[aid];
      delete viewsByActivity[aid];
      if (activeActivityId === aid) {
        activeActivityId = activities[0]?.id || null;
        syncRealtimeSubscription();
      }
    }
  }
  render();
}

function onGlobalCustomFiltersChange(payload) {
  const aid = payload.new?.activity_id || payload.old?.activity_id;
  if (!aid) return;
  if (aid === activeActivityId) return;
  const list = customFiltersByActivity[aid] || (customFiltersByActivity[aid] = []);
  if (payload.eventType === 'INSERT') {
    if (!list.some((f) => f.id === payload.new.id)) list.push(payload.new);
  } else if (payload.eventType === 'UPDATE') {
    const idx = list.findIndex((f) => f.id === payload.new.id);
    if (idx >= 0) list[idx] = payload.new;
    else list.push(payload.new);
  } else if (payload.eventType === 'DELETE') {
    customFiltersByActivity[aid] = list.filter((f) => f.id !== payload.old.id);
  }
}

// Gear updates from any owner. A co-member renaming their "BD Camalot" to
// "BD C4" should reflect immediately in everyone's packing list — items
// render via gear_id lookup, so we just have to keep the gear row fresh.
function onGlobalGearChange(payload) {
  const me = currentUser?.id;
  if (payload.eventType === 'DELETE') {
    const id = payload.old.id;
    gearList = gearList.filter((g) => g.id !== id);
    delete foreignGearById[id];
    render();
    return;
  }
  if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
    const row = payload.new;
    if (row.owner_id === me) {
      const idx = gearList.findIndex((g) => g.id === row.id);
      if (idx >= 0) gearList[idx] = row;
      else if (payload.eventType === 'INSERT') gearList.unshift(row);
    } else if (foreignGearById[row.id]) {
      // Only track co-member gear we've already loaded into the foreign cache —
      // adding a stranger's gear blindly would balloon the cache. The cache is
      // populated lazily when activity_items reference it.
      foreignGearById[row.id] = row;
    } else {
      return;
    }
    render();
  }
}

async function onRealtimeItemChange(aid, payload) {
  console.log('[realtime] item change', payload.eventType, payload.new?.id || payload.old?.id);
  const items = itemsByActivity[aid] || (itemsByActivity[aid] = []);
  if (payload.eventType === 'INSERT') {
    if (!items.some((i) => i.id === payload.new.id)) items.push(payload.new);
    if (payload.new.gear_id && !getGearById(payload.new.gear_id)) {
      await loadForeignGear();
      await loadCoMemberProfiles();
    }
  } else if (payload.eventType === 'UPDATE') {
    const idx = items.findIndex((i) => i.id === payload.new.id);
    if (idx >= 0) items[idx] = payload.new;
    else items.push(payload.new);
  } else if (payload.eventType === 'DELETE') {
    itemsByActivity[aid] = items.filter((i) => i.id !== payload.old.id);
  }
  if (aid === activeActivityId) {
    renderActivity();
    // The user is actively looking at this list — keep the badge cleared
    // even as new items stream in.
    if (payload.eventType === 'INSERT' && payload.new.added_by !== currentUser?.id) {
      markActivitySeen(aid);
    }
  }
}

async function onRealtimeMemberChange(aid, payload) {
  const list = membersByActivity[aid] || (membersByActivity[aid] = []);
  if (payload.eventType === 'INSERT') {
    if (!list.some((m) => m.user_id === payload.new.user_id)) list.push(payload.new);
    await loadCoMemberProfiles();
  } else if (payload.eventType === 'UPDATE') {
    const idx = list.findIndex((m) => m.user_id === payload.new.user_id);
    if (idx >= 0) list[idx] = payload.new;
  } else if (payload.eventType === 'DELETE') {
    membersByActivity[aid] = list.filter((m) => m.user_id !== payload.old.user_id);
  }
  if (shareModalActivityId === aid) renderShareModal();
  render();
}

function onRealtimeCustomFilterChange(aid, payload) {
  const list = customFiltersByActivity[aid] || (customFiltersByActivity[aid] = []);
  if (payload.eventType === 'INSERT') {
    if (!list.some((f) => f.id === payload.new.id)) list.push(payload.new);
  } else if (payload.eventType === 'UPDATE') {
    const idx = list.findIndex((f) => f.id === payload.new.id);
    if (idx >= 0) list[idx] = payload.new;
  } else if (payload.eventType === 'DELETE') {
    customFiltersByActivity[aid] = list.filter((f) => f.id !== payload.old.id);
  }
  if (aid === activeActivityId) render();
}

function onRealtimeActivityChange(aid, payload) {
  const idx = activities.findIndex((a) => a.id === aid);
  if (idx >= 0) activities[idx] = payload.new;
  if (aid === activeActivityId) render();
  else renderTabs();
}

// ---- Invite acceptance via URL (?invite=...) ------------------------------

async function applyPendingInvite() {
  if (!pendingInviteToken || !currentUser) return;
  const token = pendingInviteToken;
  pendingInviteToken = null;
  showInviteBanner('Joining packing list…');
  const { data, error } = await callEdgeFunction('accept-invite', { token });
  if (error) {
    showInviteBanner(error, { kind: 'error', autoHide: 6000 });
    return;
  }
  if (data?.activity_name || data?.inviter_name) {
    onboardingContext = {
      activityName: data.activity_name || null,
      activityEmoji: data.activity_emoji || null,
      inviterName: data.inviter_name || null,
    };
  }
  await loadAll();
  if (data?.activity_id) {
    activeActivityId = data.activity_id;
    render();
    syncRealtimeSubscription();
    markActivitySeen(data.activity_id);
    const a = activities.find((x) => x.id === data.activity_id);
    showInviteBanner(
      data.already_accepted
        ? `You're already on "${a?.name || 'this list'}".`
        : `Welcome! You're packing "${a?.name || 'this list'}" together.`,
      { autoHide: 4500 },
    );
  }
}

async function applyPendingShareToken() {
  if (!pendingShareToken || !currentUser) return;
  const token = pendingShareToken;
  pendingShareToken = null;
  showInviteBanner('Joining packing list…');
  const { data, error } = await callEdgeFunction('accept-share-link', { token });
  if (error) {
    showInviteBanner(error, { kind: 'error', autoHide: 6000 });
    return;
  }
  if (data?.activity_name || data?.inviter_name) {
    onboardingContext = {
      activityName: data.activity_name || null,
      activityEmoji: data.activity_emoji || null,
      inviterName: data.inviter_name || null,
    };
  }
  await loadAll();
  if (data?.activity_id) {
    activeActivityId = data.activity_id;
    render();
    syncRealtimeSubscription();
    markActivitySeen(data.activity_id);
    const a = activities.find((x) => x.id === data.activity_id);
    showInviteBanner(
      `Welcome! You're packing "${a?.name || 'this list'}" together.`,
      { autoHide: 4500 },
    );
  }
}

function applyPendingOpenActivity() {
  if (!pendingOpenActivityId) return;
  const id = pendingOpenActivityId;
  pendingOpenActivityId = null;
  if (activities.some((a) => a.id === id)) {
    activeActivityId = id;
    render();
    syncRealtimeSubscription();
    markActivitySeen(id);
  }
}

let inviteBannerTimeout = null;
function showInviteBanner(text, { kind = '', autoHide = 0 } = {}) {
  const el = $('#invite-banner');
  if (!el) return;
  el.innerHTML = '';
  el.classList.remove('hidden', 'error');
  if (kind === 'error') el.classList.add('error');
  el.appendChild(h('span', {}, text));
  el.appendChild(h('button', {
    class: 'invite-banner-close',
    'aria-label': 'Dismiss',
    onclick: () => el.classList.add('hidden'),
  }, '×'));
  if (inviteBannerTimeout) { clearTimeout(inviteBannerTimeout); inviteBannerTimeout = null; }
  if (autoHide > 0) {
    inviteBannerTimeout = setTimeout(() => el.classList.add('hidden'), autoHide);
  }
}

// ------------------------------------------------------------------
// First-time onboarding: capture display_name before the user sees the app.
// Triggered whenever a signed-in user has a blank profile.display_name.
// ------------------------------------------------------------------
async function maybePromptForOnboarding() {
  if (!currentUser) return;
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', currentUser.id)
    .maybeSingle();
  if (error) { console.warn('[onboarding] profile fetch failed', error); return; }
  const name = (profile?.display_name || '').trim();
  const email = (currentUser.email || '').trim().toLowerCase();
  const emailLocal = email.split('@')[0] || '';
  const looksAutoDerived =
    !!name && !!email && (name.toLowerCase() === email || name.toLowerCase() === emailLocal);
  console.log('[onboarding] profile display_name=', JSON.stringify(profile?.display_name),
    'email=', email, 'looksAutoDerived=', looksAutoDerived);
  if (name && !looksAutoDerived) return;
  showOnboardingModal();
}

function showOnboardingModal() {
  const modal = $('#onboarding-modal');
  const titleEl = $('#onboarding-title');
  const subEl = $('#onboarding-sub');
  const input = $('#onboarding-name');
  const error = $('#onboarding-error');
  const submit = $('#onboarding-submit');
  if (!modal || !titleEl || !subEl || !input) return;

  if (onboardingContext?.activityName) {
    const emoji = onboardingContext.activityEmoji ? `${onboardingContext.activityEmoji} ` : '';
    const listLabel = `"${emoji}${onboardingContext.activityName}"`;
    const inviter = onboardingContext.inviterName || 'Someone';
    titleEl.textContent = `${inviter} invited you to pack ${listLabel}`;
    subEl.textContent = "Just one quick step before you get to your packing list.";
  } else {
    titleEl.textContent = 'Welcome to PackUpGear!';
    subEl.textContent = "Just one quick step before we get you packing.";
  }
  if (error) error.textContent = '';
  input.value = '';
  if (submit) { submit.disabled = false; submit.textContent = "Let's go →"; }

  modal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  setTimeout(() => input.focus(), 50);
}

async function handleOnboardingSubmit(e) {
  e.preventDefault();
  if (!currentUser) return;
  const input = $('#onboarding-name');
  const error = $('#onboarding-error');
  const submit = $('#onboarding-submit');
  if (!input) return;
  const name = (input.value || '').trim();
  if (!name) {
    if (error) error.textContent = 'Please enter a name.';
    input.focus();
    return;
  }
  if (name.length > 80) {
    if (error) error.textContent = 'Keep it to 80 characters.';
    return;
  }

  if (submit) { submit.disabled = true; submit.textContent = 'Saving…'; }
  if (error) error.textContent = '';
  const { error: upErr } = await supabase
    .from('profiles')
    .update({ display_name: name })
    .eq('id', currentUser.id);
  if (upErr) {
    console.warn('[onboarding] update failed', upErr);
    if (error) error.textContent = "Couldn't save your name. Try again.";
    if (submit) { submit.disabled = false; submit.textContent = "Let's go →"; }
    return;
  }
  profilesById[currentUser.id] = {
    id: currentUser.id,
    display_name: name,
    email: currentUser.email || null,
  };
  const modal = $('#onboarding-modal');
  if (modal) modal.classList.add('hidden');
  document.body.classList.remove('modal-open');
  onboardingContext = null;
  render();
}

function consumeInviteParamsFromUrl() {
  const url = new URL(window.location.href);
  let changed = false;
  const inv = url.searchParams.get('invite');
  if (inv) { pendingInviteToken = inv; url.searchParams.delete('invite'); changed = true; }
  const shr = url.searchParams.get('share');
  if (shr) { pendingShareToken = shr; url.searchParams.delete('share'); changed = true; }
  const act = url.searchParams.get('activity');
  if (act) { pendingOpenActivityId = act; url.searchParams.delete('activity'); changed = true; }
  if (changed) history.replaceState({}, '', url.toString());
}

// ------------------------------------------------------------------
// Share-link invite landing (shown when ?share=<token> + not signed in).
// ------------------------------------------------------------------

async function callPublicEdgeFunction(name, body) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    let json;
    try { json = await res.json(); } catch { json = {}; }
    if (!res.ok) return { error: json?.error || `HTTP ${res.status}`, status: res.status };
    return { data: json };
  } catch (err) {
    return { error: err?.message || 'Network error' };
  }
}

async function showShareLandingWithPreview(token) {
  showShareLanding();
  if (shareLandingLoaded) return;
  shareLandingLoaded = true;

  const loading = $('#share-landing-loading');
  const bodyEl = $('#share-landing-body');
  const invalid = $('#share-landing-invalid');
  loading.hidden = false;
  bodyEl.hidden = true;
  invalid.hidden = true;

  const { data, error, status } = await callPublicEdgeFunction('share-link-preview', { token });
  loading.hidden = true;

  if (error || !data) {
    if (status === 404 || /not_found/i.test(error || '')) {
      invalid.hidden = false;
    } else {
      invalid.hidden = false;
      const para = invalid.querySelector('.muted');
      if (para) para.textContent = error || 'Something went wrong loading this invite.';
    }
    return;
  }

  renderShareLandingPreview(data);
  bodyEl.hidden = false;
}

function renderShareLandingPreview(data) {
  const inviter = (data?.inviter_name || '').trim() || 'A friend';
  const emoji = (data?.activity_emoji || '').trim();
  const name = (data?.activity_name || '').trim() || 'this packing list';
  $('#share-landing-inviter').textContent = inviter;
  $('#share-landing-activity').textContent = emoji ? `${emoji} ${name}` : name;

  const itemsUl = $('#share-landing-items');
  itemsUl.innerHTML = '';
  const items = Array.isArray(data.items_preview) ? data.items_preview : [];
  for (const item of items) {
    itemsUl.appendChild(
      h('li', { class: 'invite-preview-row' },
        item.image_url
          ? h('img', { class: 'invite-preview-img', src: item.image_url, alt: '', loading: 'lazy' })
          : h('div', { class: 'invite-preview-img invite-preview-img-placeholder', 'aria-hidden': 'true' }, '🎒'),
        h('div', { class: 'invite-preview-text' },
          h('div', { class: 'invite-preview-name' }, item.name || 'Gear'),
          item.brand ? h('div', { class: 'invite-preview-brand' }, item.brand) : null,
        ),
      )
    );
  }

  const more = Math.max(0, data?.more_count || 0);
  const moreEl = $('#share-landing-more');
  if (more > 0) {
    moreEl.textContent = `+ ${more} more item${more === 1 ? '' : 's'}`;
    moreEl.hidden = false;
  } else {
    moreEl.hidden = true;
  }
}

function setShareLandingStatus(msg, kind) {
  const el = $('#share-landing-status');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('error', kind === 'error');
  el.classList.toggle('ok', kind === 'ok');
}

function toggleShareLandingMode(mode) {
  const signup = $('#share-signup-form');
  const signin = $('#share-signin-form');
  const toggle = $('#share-landing-signin-toggle');
  if (mode === 'signin') {
    signup.hidden = true;
    signin.hidden = false;
    if (toggle) toggle.parentElement.style.display = 'none';
    setTimeout(() => $('#share-signin-email').focus(), 0);
  } else {
    signup.hidden = false;
    signin.hidden = true;
    if (toggle) toggle.parentElement.style.display = '';
  }
  setShareLandingStatus('', '');
}

async function handleShareSignupSubmit(e) {
  e.preventDefault();
  if (!pendingShareToken) return;
  const first = $('#share-signup-first').value.trim();
  const last = $('#share-signup-last').value.trim();
  const email = $('#share-signup-email').value.trim();
  if (!first || !last || !email) return;
  const fullName = `${first} ${last}`;
  const btn = $('#share-signup-submit');
  btn.disabled = true;
  setShareLandingStatus('Sending your magic link…');
  const redirectTo = `${window.location.origin}/?share=${encodeURIComponent(pendingShareToken)}`;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo,
      shouldCreateUser: true,
      data: { full_name: fullName },
    },
  });
  btn.disabled = false;
  if (error) {
    setShareLandingStatus(`Could not send: ${error.message}`, 'error');
    return;
  }
  setShareLandingStatus(
    `Check ${email} — tap the link to join the list. You can close this tab.`,
    'ok',
  );
}

async function handleShareSigninSubmit(e) {
  e.preventDefault();
  if (!pendingShareToken) return;
  const email = $('#share-signin-email').value.trim();
  if (!email) return;
  const btn = $('#share-signin-submit');
  btn.disabled = true;
  setShareLandingStatus('Sending sign-in link…');
  const redirectTo = `${window.location.origin}/?share=${encodeURIComponent(pendingShareToken)}`;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
  });
  btn.disabled = false;
  if (error) {
    const msg = /signups not allowed|user not found|not_found/i.test(error.message)
      ? `No account for ${email}. Switch to sign up to create one.`
      : `Could not send: ${error.message}`;
    setShareLandingStatus(msg, 'error');
    return;
  }
  setShareLandingStatus(
    `Check ${email} — tap the link to sign in. You can close this tab.`,
    'ok',
  );
}

// ------------------------------------------------------------------
// Share modal: Copy link row.
// ------------------------------------------------------------------

async function fetchShareLinkUrl(activityId) {
  const { data, error } = await supabase
    .from('activity_share_links')
    .select('token')
    .eq('activity_id', activityId)
    .maybeSingle();
  if (error || !data?.token) return null;
  return `${window.location.origin}/?share=${encodeURIComponent(data.token)}`;
}

async function loadShareLinkForModal(activityId) {
  const section = $('#share-link-section');
  const input = $('#share-link-url');
  const copyBtn = $('#share-link-copy');
  currentShareLinkToken = null;
  if (!section || !input) return;
  input.value = 'Loading…';
  if (copyBtn) copyBtn.disabled = true;

  const url = await fetchShareLinkUrl(activityId);
  if (!url) {
    // Hide the section cleanly if we can't read it (e.g. backfill missed, or
    // a race with a just-inserted activity).
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  // Token is the part after ?share= in the URL; store it for any downstream
  // callers that want it without re-parsing.
  try {
    currentShareLinkToken = new URL(url).searchParams.get('share');
  } catch {}
  input.value = url;
  if (copyBtn) {
    copyBtn.disabled = false;
    copyBtn.textContent = 'Copy';
    copyBtn.classList.remove('share-link-copied');
  }
}

// Copy a read-only URL input into the clipboard, flipping the adjacent button
// to "✓ Link copied" for 2s. Works for both the share modal and the
// post-create success view in the activity modal.
async function copyShareLink(input, btn) {
  if (!input || !btn || !input.value) return;
  const url = input.value;
  let copied = false;
  try {
    await navigator.clipboard.writeText(url);
    copied = true;
  } catch {
    try {
      input.select();
      input.setSelectionRange(0, url.length);
      copied = document.execCommand('copy');
    } catch {}
  }
  if (copied) {
    btn.textContent = '✓ Link copied';
    btn.classList.add('share-link-copied');
    setTimeout(() => {
      btn.textContent = 'Copy';
      btn.classList.remove('share-link-copied');
    }, 2000);
  } else {
    btn.textContent = 'Press ⌘C';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2500);
  }
}

function handleShareLinkCopy() {
  return copyShareLink($('#share-link-url'), $('#share-link-copy'));
}

// ------------------------------------------------------------------
// Wiring
// ------------------------------------------------------------------
function wire() {
  // Onboarding form (shown for users with a blank display_name)
  const onboardingForm = $('#onboarding-form');
  if (onboardingForm) onboardingForm.addEventListener('submit', handleOnboardingSubmit);

  // Mobile mode init + tab bar
  setMobileMode(mobileMode);
  for (const tab of document.querySelectorAll('.mobile-tab[data-mobile-mode]')) {
    tab.addEventListener('click', () => setMobileMode(tab.dataset.mobileMode));
  }

  // Activity picker — "+ New packing list" jumps to packing tab and opens new-activity modal
  $('#activity-picker-new').addEventListener('click', () => {
    hideModal('activity-picker');
    setMobileMode('packing');
    openNewActivity();
  });

  // Header
  $('#add-gear-btn').addEventListener('click', openAddGear);
  $('#gear-empty-add-btn').addEventListener('click', openAddGear);
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

  // Share-link landing: sign-up / sign-in forms + toggle + copy button.
  const shareSignup = $('#share-signup-form');
  if (shareSignup) shareSignup.addEventListener('submit', handleShareSignupSubmit);
  const shareSignin = $('#share-signin-form');
  if (shareSignin) shareSignin.addEventListener('submit', handleShareSigninSubmit);
  const shareToggle = $('#share-landing-signin-toggle');
  if (shareToggle) shareToggle.addEventListener('click', () => toggleShareLandingMode('signin'));
  const shareBack = $('#share-signin-back-btn');
  if (shareBack) shareBack.addEventListener('click', () => toggleShareLandingMode('signup'));
  const copyBtn = $('#share-link-copy');
  if (copyBtn) copyBtn.addEventListener('click', handleShareLinkCopy);

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

  // Mobile-only brand filter toggle
  $('#brand-filter-toggle').addEventListener('click', () => {
    brandFilterExpanded = !brandFilterExpanded;
    renderBrandFilters();
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
  $('#share-activity-btn').addEventListener('click', () => {
    if (activeActivityId) openShareModal(activeActivityId);
  });
  $('#activity-modal-share-btn').addEventListener('click', () => {
    if (editingActivityId) {
      hideModal('activity-modal');
      openShareModal(editingActivityId);
    }
  });

  // Share modal
  $('#share-invite-form').addEventListener('submit', handleShareInviteSubmit);
  $('#share-leave-btn').addEventListener('click', handleLeaveActivity);

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
  $('#activity-duplicate-btn').addEventListener('click', handleDuplicateActivity);
  $('#activity-done-btn').addEventListener('click', handleActivityDoneBtn);
  $('#activity-created-share-copy').addEventListener('click', handleActivityCreatedShareCopy);
  // Enter-to-save in activity name field
  $('#activity-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSaveActivity(); }
  });
  // Auto-derive emoji from the name unless the user has picked one.
  $('#activity-name').addEventListener('input', autoDeriveActivityEmoji);
  // Clicking the emoji chip opens the picker on desktop, or focuses the
  // hidden input on mobile to pop the native emoji keyboard.
  $('#activity-emoji-btn').addEventListener('click', handleActivityEmojiBtnClick);
  // If the user typed an emoji directly (mobile native keyboard), treat it
  // as a manual pick and stop auto-deriving.
  $('#activity-emoji').addEventListener('input', () => {
    activityEmojiAutoDerive = false;
    syncActivityEmojiDisplay();
  });
  // Click-outside closes the picker.
  document.addEventListener('click', (e) => {
    const picker = $('#activity-emoji-picker');
    if (!picker || picker.classList.contains('hidden')) return;
    if (e.target.closest('#activity-emoji-picker')) return;
    if (e.target.closest('#activity-emoji-btn')) return;
    hideEmojiPicker();
  });
  // Build the picker grid once at init.
  buildEmojiPicker();

  // Modal close
  $$('[data-close]').forEach((el) => {
    el.addEventListener('click', () => hideModal(el.dataset.close));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Onboarding is unskippable — users must enter a name to proceed.
      $$('.modal:not(.hidden)').forEach((m) => {
        if (m.id === 'onboarding-modal') return;
        m.classList.add('hidden');
      });
      if (!document.querySelector('.modal:not(.hidden)')) {
        document.body.classList.remove('modal-open');
      }
    }
  });

  // Take-a-photo (mobile) — capture, resize client-side, store as data URL
  $('#take-photo-btn').addEventListener('click', () => $('#take-photo-input').click());
  $('#take-photo-input').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const dataUrl = await fileToThumbnailDataUrl(f);
      $('#gear-image').value = dataUrl;
      updateGearPreview();
    } catch (err) {
      toast(err.message || 'Could not process photo', 'error');
    }
  });

  // Identify gear from a photo (mobile) — first time shows the tips modal,
  // afterward jumps straight to the camera. Both paths must call the file
  // input synchronously inside the click handler so iOS keeps the gesture.
  const PHOTO_EXPLAINER_KEY = 'pack:photoExplainerSeen';
  function openCameraForIdentify() {
    $('#identify-photo-input').click();
  }
  $('#identify-photo-btn').addEventListener('click', () => {
    if (localStorage.getItem(PHOTO_EXPLAINER_KEY)) {
      openCameraForIdentify();
    } else {
      showModal('photo-explainer-modal');
    }
  });
  $('#photo-explainer-continue').addEventListener('click', () => {
    localStorage.setItem(PHOTO_EXPLAINER_KEY, '1');
    hideModal('photo-explainer-modal');
    openCameraForIdentify();
  });
  $('#identify-photo-input').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) handleGearPhotoFile(f);
  });

  // Photo workflow controls (re-identify, cancel, skip)
  $('#photo-reidentify-btn').addEventListener('click', () => {
    if (isPhotoFlowActive()) reidentifyCurrentPhoto();
  });
  $('#photo-cancel-btn').addEventListener('click', () => {
    if (!isPhotoFlowActive()) return;
    if (photoQueue.length > 1) {
      // In a queue: treat as skip (mark current and advance).
      photoQueue[photoIndex].status = 'skipped';
      resetGearFormFields();
      advancePhotoQueue();
    } else {
      // Single photo: just clear the workflow, keep modal open for manual entry.
      clearPhotoQueue();
      resetGearFormFields();
    }
  });
  $('#gear-skip-btn').addEventListener('click', () => {
    if (!isPhotoFlowActive()) return;
    photoQueue[photoIndex].status = 'skipped';
    resetGearFormFields();
    advancePhotoQueue();
  });

  // Unified screenshot/photo dropzone — accepts screenshots, gear photos, or
  // multiple files. Server auto-classifies via mode='auto'.
  const dz = $('#screenshot-dropzone');
  const fileInput = $('#screenshot-file-input');
  dz.addEventListener('click', () => fileInput.click());
  dz.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', (e) => {
    const fs = Array.from(e.target.files || []).filter((f) => f.type.startsWith('image/'));
    e.target.value = '';
    if (fs.length) enqueuePhotos(fs, { mode: 'auto' });
  });
  $('#screenshot-remove').addEventListener('click', () => {
    resetScreenshotUI();
    clearPhotoQueue();
  });
  dz.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items || [];
    const files = [];
    for (const it of items) {
      if (it.kind === 'file' && it.type.startsWith('image/')) files.push(it.getAsFile());
    }
    if (files.length) {
      e.preventDefault();
      enqueuePhotos(files, { mode: 'auto' });
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
    // Stop here so the window-level drop listener doesn't also process the
    // same files (which would double-enqueue them).
    e.stopPropagation();
    dz.classList.remove('drag-over');
    const fs = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith('image/'));
    if (fs.length) enqueuePhotos(fs, { mode: 'auto' });
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

  // Global drop-anywhere → opens Add Gear flow. Server auto-classifies
  // dropped files as either screenshots or gear photos via mode='auto'.
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
    // If the drop landed on the in-modal dropzone, that handler has already
    // called stopPropagation and enqueued the files — this listener won't
    // fire for those. Any other drop on the page (or anywhere inside the
    // open modal) falls through to here so the whole window is a drop
    // target.
    const fs = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith('image/'));
    if (fs.length === 0) return;
    enqueuePhotos(fs, { mode: 'auto' });
  });
}

// ------------------------------------------------------------------
// Auth state + boot
// ------------------------------------------------------------------
async function syncDisplayName(user) {
  console.log('[auth] user_metadata=', user?.user_metadata);
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
  if (!session?.user) return;
  if (signedInForUserId === session.user.id) return;
  signedInForUserId = session.user.id;
  currentUser = session.user;
  $('#user-email').textContent = currentUser.email || '';
  showMain();
  await syncDisplayName(currentUser);
  await loadAll();
  // Seed default activities on first login
  if (!activities.length && !pendingInviteToken) {
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
      if (currentUser) {
        for (const a of data) {
          membersByActivity[a.id] = [{
            activity_id: a.id,
            user_id: currentUser.id,
            role: 'owner',
            joined_at: new Date().toISOString(),
          }];
        }
      }
      render();
    }
  }
  await applyPendingInvite();
  await applyPendingShareToken();
  applyPendingOpenActivity();
  syncRealtimeSubscription();
  await maybePromptForOnboarding();
}

function onSignedOut() {
  signedInForUserId = null;
  onboardingContext = null;
  const onboardingModal = $('#onboarding-modal');
  if (onboardingModal) onboardingModal.classList.add('hidden');
  document.body.classList.remove('modal-open');
  currentUser = null;
  gearList = [];
  activities = [];
  itemsByActivity = {};
  customFiltersByActivity = {};
  membersByActivity = {};
  invitesByActivity = {};
  viewsByActivity = {};
  profilesById = {};
  foreignGearById = {};
  activeActivityId = null;
  shareModalActivityId = null;
  if (realtimeChannel) { try { supabase.removeChannel(realtimeChannel); } catch {} }
  realtimeChannel = null;
  realtimeChannelActivityId = null;
  for (const ch of [
    globalItemsChannel,
    globalActivitiesChannel,
    globalMembersChannel,
    globalCustomFiltersChannel,
    globalGearChannel,
  ]) {
    if (ch) { try { supabase.removeChannel(ch); } catch {} }
  }
  globalItemsChannel = null;
  globalActivitiesChannel = null;
  globalMembersChannel = null;
  globalCustomFiltersChannel = null;
  globalGearChannel = null;
  const banner = $('#invite-banner');
  if (banner) banner.classList.add('hidden');
  showAuth();
}

async function consumeTokenHashFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const token_hash = params.get('token_hash');
  const type = params.get('type');
  if (!token_hash || !type) return null;
  const redirectToRaw = params.get('redirect_to');
  console.log('[auth] exchanging token_hash from URL, type=', type);
  const { data, error } = await supabase.auth.verifyOtp({ token_hash, type });
  if (redirectToRaw) {
    try {
      const redirectUrl = new URL(redirectToRaw, window.location.origin);
      const curr = new URL(window.location.href);
      redirectUrl.searchParams.forEach((v, k) => {
        if (k === 'token_hash' || k === 'type' || k === 'redirect_to') return;
        curr.searchParams.set(k, v);
      });
      history.replaceState({}, '', curr.toString());
    } catch (e) {
      console.warn('[auth] could not parse redirect_to from magic link', e);
    }
  }
  consumeInviteParamsFromUrl();
  cleanAuthParamsFromUrl();
  if (error) { console.warn('[auth] verifyOtp failed', error); return { error }; }
  return { session: data?.session || null };
}

// Capture ?invite= / ?activity= synchronously at module load so they survive
// both Supabase's implicit-flow URL cleanup AND any cleanAuthParamsFromUrl
// calls that happen before the boot IIFE runs.
consumeInviteParamsFromUrl();

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
    else if (pendingShareToken) {
      await showShareLandingWithPreview(pendingShareToken);
    }
    else {
      if (pendingInviteToken) {
        setAuthStatus(
          'Sign in to join the packing list you were invited to. Enter your email and we\'ll send you a magic link.',
        );
      }
      showAuth();
    }
  } catch (err) {
    console.error('[auth] boot error', err);
    showAuth();
  }
})();
