import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// ------------------------------------------------------------------
// Boot / env
// ------------------------------------------------------------------
const { SUPABASE_URL, SUPABASE_ANON_KEY } = (window.ENV || {});

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const authStatusEl = $('auth-status');

function setStatus(el, msg, kind) {
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('error', kind === 'error');
  el.classList.toggle('ok', kind === 'ok');
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  setStatus(authStatusEl, 'Missing SUPABASE env vars.', 'error');
  throw new Error('missing-env');
}

// Use implicit flow for magic links: Supabase appends the access/refresh
// tokens in the URL hash after redirect, so no PKCE code_verifier is needed.
// (PKCE breaks if the link is opened in a different browser/tab from the one
// that requested it, or if localStorage was cleared in between — which is what
// caused the previous post-click loop back to the email entry screen.)
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
// State
// ------------------------------------------------------------------
const LS_UNIT_KEY = 'pack.displayUnit';

let currentUser = null;
let gearList = [];
let activities = [];
let itemsByActivity = {}; // activityId -> items[]
let customFiltersByActivity = {}; // activityId -> custom_filters[]
let activeActivityId = null;
let displayUnit = localStorage.getItem(LS_UNIT_KEY) || 'g';
let gearSearch = '';
let gearEditMode = false;
let editingGearId = null;
let customFilterEditMode = false;

const WEATHERS = [
  { id: 'sunny', label: 'Sunny', emoji: '☀️' },
  { id: 'cold',  label: 'Cold',  emoji: '🥶' },
  { id: 'rain',  label: 'Rain',  emoji: '🌧️' },
  { id: 'snow',  label: 'Snow',  emoji: '❄️' },
];

// ------------------------------------------------------------------
// Weight helpers
// ------------------------------------------------------------------
const UNIT_TO_GRAMS = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592 };

function gramsToUnit(g, unit) {
  if (g == null) return null;
  return g / UNIT_TO_GRAMS[unit];
}
function unitToGrams(v, unit) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n * UNIT_TO_GRAMS[unit];
}
function formatWeight(g, unit = displayUnit) {
  if (g == null) return '';
  const v = gramsToUnit(g, unit);
  const rounded = unit === 'g' ? Math.round(v) : Number(v.toFixed(2));
  return `${rounded} ${unit}`;
}

// ------------------------------------------------------------------
// Auth view
// ------------------------------------------------------------------
const authView = $('auth-view');
const mainView = $('main-view');
const authForm = $('auth-form');
const authEmail = $('auth-email');
const authSubmit = $('auth-submit');

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = authEmail.value.trim();
  if (!email) return;
  authSubmit.disabled = true;
  setStatus(authStatusEl, 'Sending magic link…');
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.origin,
      shouldCreateUser: true,
    },
  });
  authSubmit.disabled = false;
  if (error) {
    setStatus(authStatusEl, `Could not send: ${error.message}`, 'error');
    return;
  }
  setStatus(
    authStatusEl,
    `Check ${email} — click the link to sign in. You can close this tab.`,
    'ok'
  );
});

$('sign-out-btn').addEventListener('click', async () => {
  await supabase.auth.signOut();
});

function showAuth() {
  mainView.hidden = true;
  authView.hidden = false;
}
function showMain() {
  authView.hidden = true;
  mainView.hidden = false;
}

// ------------------------------------------------------------------
// Data loading
// ------------------------------------------------------------------
async function loadAll() {
  setStatus(statusEl, 'Loading…');
  const [gearRes, actRes, itemRes, filterRes] = await Promise.all([
    supabase.from('gear').select('*').order('created_at', { ascending: false }),
    supabase.from('activities').select('*').order('position', { ascending: true }),
    supabase.from('activity_items').select('*').order('position', { ascending: true }),
    supabase.from('custom_filters').select('*').order('position', { ascending: true }),
  ]);
  if (gearRes.error) return setStatus(statusEl, `Load gear: ${gearRes.error.message}`, 'error');
  if (actRes.error) return setStatus(statusEl, `Load activities: ${actRes.error.message}`, 'error');
  if (itemRes.error) return setStatus(statusEl, `Load items: ${itemRes.error.message}`, 'error');
  if (filterRes.error) return setStatus(statusEl, `Load filters: ${filterRes.error.message}`, 'error');

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
  setStatus(statusEl, '');
  render();
}

// ------------------------------------------------------------------
// Rendering
// ------------------------------------------------------------------
function render() {
  renderTabs();
  renderActivityBody();
  renderGearList();
  $('gear-weight-unit').textContent = displayUnit;
}

function renderTabs() {
  const el = $('activity-tabs');
  el.innerHTML = '';
  for (const a of activities) {
    const b = document.createElement('button');
    b.className = 'activity-tab' + (a.id === activeActivityId ? ' active' : '');
    b.textContent = `${a.emoji ? a.emoji + ' ' : ''}${a.name}`;
    b.addEventListener('click', () => {
      activeActivityId = a.id;
      customFilterEditMode = false;
      render();
    });
    wireDropTarget(b, () => a.id);
    el.appendChild(b);
  }
  const add = document.createElement('button');
  add.className = 'activity-tab activity-tab-new';
  add.textContent = '+ New';
  add.addEventListener('click', addActivityPrompt);
  el.appendChild(add);
}

function itemPassesFilters(item, activity) {
  const activeWeathers = activity.active_weathers || [];
  if (activeWeathers.length) {
    const tags = item.weather_tags || [];
    if (tags.length && !tags.some((t) => activeWeathers.includes(t))) return false;
  }
  const activeCustom = activity.active_custom_filter_ids || [];
  if (activeCustom.length) {
    const tags = item.custom_filter_ids || [];
    if (tags.length && !tags.some((t) => activeCustom.includes(t))) return false;
  }
  return true;
}

function renderFilterBar(act) {
  const bar = $('filter-bar');
  if (!act) { bar.hidden = true; return; }
  bar.hidden = false;

  const weatherWrap = $('weather-filter-chips');
  weatherWrap.innerHTML = '';
  const activeWeathers = new Set(act.active_weathers || []);
  for (const w of WEATHERS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip chip-weather' + (activeWeathers.has(w.id) ? ' on' : '');
    chip.title = w.label;
    chip.textContent = `${w.emoji} ${w.label}`;
    chip.addEventListener('click', () => toggleActivityWeather(w.id));
    weatherWrap.appendChild(chip);
  }

  const customWrap = $('custom-filter-chips');
  customWrap.innerHTML = '';
  const filters = customFiltersByActivity[act.id] || [];
  const activeCustom = new Set(act.active_custom_filter_ids || []);
  if (!filters.length) {
    const hint = document.createElement('span');
    hint.className = 'muted';
    hint.textContent = 'None yet';
    customWrap.appendChild(hint);
  }
  for (const f of filters) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip chip-custom' + (activeCustom.has(f.id) ? ' on' : '');
    chip.textContent = f.label;
    if (customFilterEditMode) {
      const editIcon = document.createElement('span');
      editIcon.className = 'chip-edit';
      editIcon.textContent = '✎';
      editIcon.title = 'Rename';
      editIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        renameCustomFilter(f);
      });
      const delIcon = document.createElement('span');
      delIcon.className = 'chip-del';
      delIcon.textContent = '×';
      delIcon.title = 'Delete';
      delIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteCustomFilter(f);
      });
      chip.append(' ', editIcon, delIcon);
    }
    chip.addEventListener('click', () => {
      if (customFilterEditMode) return;
      toggleActivityCustomFilter(f.id);
    });
    customWrap.appendChild(chip);
  }

  const editBtn = $('edit-custom-filters');
  editBtn.textContent = customFilterEditMode ? 'Done' : 'Edit';
  editBtn.classList.toggle('btn-primary', customFilterEditMode);
  editBtn.classList.toggle('btn-ghost', !customFilterEditMode);
  editBtn.hidden = filters.length === 0;
}

function renderItemTagRow(it, act) {
  const row = document.createElement('div');
  row.className = 'item-tags';

  const itemWeathers = new Set(it.weather_tags || []);
  for (const w of WEATHERS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tag tag-weather' + (itemWeathers.has(w.id) ? ' on' : '');
    chip.title = `Tag as ${w.label.toLowerCase()}`;
    chip.textContent = w.emoji;
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleItemWeather(it.id, w.id);
    });
    row.appendChild(chip);
  }

  const filters = customFiltersByActivity[act.id] || [];
  const itemCustom = new Set(it.custom_filter_ids || []);
  if (filters.length) {
    const sep = document.createElement('span');
    sep.className = 'tag-sep';
    row.appendChild(sep);
  }
  for (const f of filters) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tag tag-custom' + (itemCustom.has(f.id) ? ' on' : '');
    chip.textContent = f.label;
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleItemCustomFilter(it.id, f.id);
    });
    row.appendChild(chip);
  }

  return row;
}

function renderActivityBody() {
  const title = $('activity-title');
  const ul = $('activity-items');
  const footer = $('activity-footer');
  ul.innerHTML = '';
  wireDropTarget(ul, () => activeActivityId);
  const act = activities.find((a) => a.id === activeActivityId);
  renderFilterBar(act);
  if (!act) {
    title.textContent = 'No activity';
    footer.textContent = '';
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Create an activity with the “+ New” button above.';
    ul.appendChild(li);
    return;
  }
  title.textContent = `${act.emoji ? act.emoji + ' ' : ''}${act.name}`;

  const allItems = itemsByActivity[act.id] || [];
  const items = allItems.filter((it) => itemPassesFilters(it, act));
  const hiddenCount = allItems.length - items.length;

  if (!allItems.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No items yet. Drag gear from the library into this list.';
    ul.appendChild(li);
  } else if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'All items are hidden by the current filters.';
    ul.appendChild(li);
  }

  let totalGrams = 0;
  let packedGrams = 0;
  for (const it of items) {
    const gear = gearList.find((g) => g.id === it.gear_id);
    if (!gear) continue;
    const qty = it.quantity || 1;
    const w = (gear.weight_grams || 0) * qty;
    totalGrams += w;
    if (it.packed) packedGrams += w;

    const li = document.createElement('li');
    li.className = 'activity-item' + (it.packed ? ' packed' : '');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!it.packed;
    cb.addEventListener('change', () => togglePacked(it.id, cb.checked));

    const main = document.createElement('div');
    main.className = 'gear-main';
    const name = document.createElement('div');
    name.className = 'item-name';
    name.textContent = gear.name;
    const meta = document.createElement('div');
    meta.className = 'item-meta';
    const metaBits = [];
    if (gear.brand) metaBits.push(gear.brand);
    if (gear.weight_grams != null) metaBits.push(formatWeight(gear.weight_grams));
    meta.textContent = metaBits.join(' · ');
    main.append(name, meta, renderItemTagRow(it, act));

    const qtyWrap = document.createElement('label');
    qtyWrap.className = 'item-qty';
    const qtyInput = document.createElement('input');
    qtyInput.type = 'number';
    qtyInput.min = '0';
    qtyInput.step = '1';
    qtyInput.value = String(qty);
    qtyInput.addEventListener('change', () => {
      const n = Math.max(0, Math.round(Number(qtyInput.value) || 0));
      updateItemQuantity(it.id, n);
    });
    qtyWrap.append(qtyInput, document.createTextNode('×'));

    const remove = document.createElement('button');
    remove.className = 'item-remove';
    remove.title = 'Remove from list';
    remove.textContent = '×';
    remove.addEventListener('click', () => removeItem(it.id));

    li.append(cb, main, qtyWrap, remove);
    ul.appendChild(li);
  }

  const totalLine =
    allItems.length === 0
      ? ''
      : `Total: ${formatWeight(totalGrams)} (${formatWeight(packedGrams)} packed)`;
  footer.textContent = hiddenCount
    ? `${totalLine}  ·  ${hiddenCount} hidden by filters`
    : totalLine;
}

function renderGearList() {
  const ul = $('gear-list');
  ul.innerHTML = '';
  ul.classList.toggle('edit-mode', gearEditMode);
  const q = gearSearch.trim().toLowerCase();
  const filtered = q
    ? gearList.filter(
        (g) =>
          (g.name || '').toLowerCase().includes(q) ||
          (g.brand || '').toLowerCase().includes(q)
      )
    : gearList;
  if (!filtered.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = gearList.length
      ? 'No matches.'
      : 'No gear yet. Click “+ Add gear” to add some.';
    ul.appendChild(li);
    return;
  }
  for (const g of filtered) {
    const li = document.createElement('li');
    li.className = 'gear-item' + (editingGearId === g.id ? ' editing' : '');

    if (!gearEditMode) {
      li.draggable = true;
      li.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/gear-id', g.id);
        li.classList.add('dragging');
      });
      li.addEventListener('dragend', () => li.classList.remove('dragging'));
    }

    const thumb = g.image_url
      ? Object.assign(document.createElement('img'), {
          src: g.image_url,
          alt: g.name,
          className: 'gear-thumb',
          loading: 'lazy',
        })
      : Object.assign(document.createElement('div'), {
          className: 'gear-thumb placeholder',
          textContent: '—',
        });

    const main = document.createElement('div');
    main.className = 'gear-main';
    const name = document.createElement('div');
    name.className = 'gear-name';
    name.textContent = g.name;
    const meta = document.createElement('div');
    meta.className = 'gear-meta';
    const bits = [];
    if (g.brand) bits.push(g.brand);
    if (g.weight_grams != null) bits.push(formatWeight(g.weight_grams));
    if (g.quantity && g.quantity !== 1) bits.push(`own ${g.quantity}`);
    meta.textContent = bits.join(' · ') || '—';
    main.append(name, meta);
    if (g.url) {
      const a = document.createElement('a');
      a.href = g.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'link';
      a.className = 'muted';
      a.style.fontSize = '0.8rem';
      main.appendChild(a);
    }

    li.append(thumb, main);

    if (gearEditMode) {
      const actions = document.createElement('div');
      actions.className = 'gear-actions';
      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn-primary';
      editBtn.textContent = editingGearId === g.id ? 'Editing…' : 'Edit';
      editBtn.disabled = editingGearId === g.id;
      editBtn.addEventListener('click', () => beginEditGear(g));
      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-ghost danger';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => deleteGear(g.id, g.name));
      actions.append(editBtn, delBtn);
      li.append(actions);
    }

    ul.appendChild(li);
  }
}

// ------------------------------------------------------------------
// Mutations
// ------------------------------------------------------------------
async function togglePacked(itemId, packed) {
  const { error } = await supabase.from('activity_items').update({ packed }).eq('id', itemId);
  if (error) return setStatus(statusEl, error.message, 'error');
  const items = itemsByActivity[activeActivityId] || [];
  const item = items.find((i) => i.id === itemId);
  if (item) item.packed = packed;
  render();
}

async function updateItemQuantity(itemId, quantity) {
  const { error } = await supabase
    .from('activity_items')
    .update({ quantity })
    .eq('id', itemId);
  if (error) return setStatus(statusEl, error.message, 'error');
  const items = itemsByActivity[activeActivityId] || [];
  const item = items.find((i) => i.id === itemId);
  if (item) item.quantity = quantity;
  render();
}

async function removeItem(itemId) {
  const { error } = await supabase.from('activity_items').delete().eq('id', itemId);
  if (error) return setStatus(statusEl, error.message, 'error');
  itemsByActivity[activeActivityId] = (itemsByActivity[activeActivityId] || []).filter(
    (i) => i.id !== itemId
  );
  render();
}

async function addGearToActivity(gearId, activityId = activeActivityId) {
  if (!activityId) return;
  const existing = (itemsByActivity[activityId] || []).find((i) => i.gear_id === gearId);
  if (existing) {
    const { error } = await supabase
      .from('activity_items')
      .update({ quantity: (existing.quantity || 1) + 1 })
      .eq('id', existing.id);
    if (error) return setStatus(statusEl, error.message, 'error');
    existing.quantity = (existing.quantity || 1) + 1;
    render();
    return;
  }
  const position = (itemsByActivity[activityId] || []).length;
  const { data, error } = await supabase
    .from('activity_items')
    .insert({ activity_id: activityId, gear_id: gearId, position, quantity: 1 })
    .select()
    .single();
  if (error) return setStatus(statusEl, error.message, 'error');
  (itemsByActivity[activityId] ||= []).push(data);
  render();
}

function toggleInArray(arr, value) {
  const list = Array.isArray(arr) ? [...arr] : [];
  const idx = list.indexOf(value);
  if (idx === -1) list.push(value);
  else list.splice(idx, 1);
  return list;
}

async function toggleActivityWeather(weatherId) {
  const act = activities.find((a) => a.id === activeActivityId);
  if (!act) return;
  const next = toggleInArray(act.active_weathers, weatherId);
  const { error } = await supabase
    .from('activities')
    .update({ active_weathers: next })
    .eq('id', act.id);
  if (error) return setStatus(statusEl, error.message, 'error');
  act.active_weathers = next;
  render();
}

async function toggleActivityCustomFilter(filterId) {
  const act = activities.find((a) => a.id === activeActivityId);
  if (!act) return;
  const next = toggleInArray(act.active_custom_filter_ids, filterId);
  const { error } = await supabase
    .from('activities')
    .update({ active_custom_filter_ids: next })
    .eq('id', act.id);
  if (error) return setStatus(statusEl, error.message, 'error');
  act.active_custom_filter_ids = next;
  render();
}

async function toggleItemWeather(itemId, weatherId) {
  const items = itemsByActivity[activeActivityId] || [];
  const it = items.find((i) => i.id === itemId);
  if (!it) return;
  const next = toggleInArray(it.weather_tags, weatherId);
  const { error } = await supabase
    .from('activity_items')
    .update({ weather_tags: next })
    .eq('id', itemId);
  if (error) return setStatus(statusEl, error.message, 'error');
  it.weather_tags = next;
  render();
}

async function toggleItemCustomFilter(itemId, filterId) {
  const items = itemsByActivity[activeActivityId] || [];
  const it = items.find((i) => i.id === itemId);
  if (!it) return;
  const next = toggleInArray(it.custom_filter_ids, filterId);
  const { error } = await supabase
    .from('activity_items')
    .update({ custom_filter_ids: next })
    .eq('id', itemId);
  if (error) return setStatus(statusEl, error.message, 'error');
  it.custom_filter_ids = next;
  render();
}

async function addCustomFilterPrompt() {
  if (!activeActivityId) return;
  const label = prompt('Filter name? (e.g. Trad climbing)');
  if (!label || !label.trim()) return;
  const existing = customFiltersByActivity[activeActivityId] || [];
  const position = existing.length;
  const { data, error } = await supabase
    .from('custom_filters')
    .insert({ activity_id: activeActivityId, label: label.trim(), position })
    .select()
    .single();
  if (error) return setStatus(statusEl, error.message, 'error');
  (customFiltersByActivity[activeActivityId] ||= []).push(data);
  render();
}

async function renameCustomFilter(filter) {
  const label = prompt('Rename filter:', filter.label);
  if (!label || !label.trim() || label.trim() === filter.label) return;
  const { error } = await supabase
    .from('custom_filters')
    .update({ label: label.trim() })
    .eq('id', filter.id);
  if (error) return setStatus(statusEl, error.message, 'error');
  filter.label = label.trim();
  render();
}

async function deleteCustomFilter(filter) {
  if (!confirm(`Delete filter "${filter.label}"?`)) return;
  const { error } = await supabase.from('custom_filters').delete().eq('id', filter.id);
  if (error) return setStatus(statusEl, error.message, 'error');
  const list = customFiltersByActivity[filter.activity_id] || [];
  customFiltersByActivity[filter.activity_id] = list.filter((f) => f.id !== filter.id);
  const act = activities.find((a) => a.id === filter.activity_id);
  if (act && (act.active_custom_filter_ids || []).includes(filter.id)) {
    const next = act.active_custom_filter_ids.filter((id) => id !== filter.id);
    act.active_custom_filter_ids = next;
    await supabase.from('activities').update({ active_custom_filter_ids: next }).eq('id', act.id);
  }
  for (const it of itemsByActivity[filter.activity_id] || []) {
    if ((it.custom_filter_ids || []).includes(filter.id)) {
      it.custom_filter_ids = it.custom_filter_ids.filter((id) => id !== filter.id);
    }
  }
  render();
}

function wireDropTarget(el, getActivityId) {
  el.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/gear-id')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    el.classList.add('drop-hover');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-hover'));
  el.addEventListener('drop', (e) => {
    const gearId = e.dataTransfer.getData('text/gear-id');
    el.classList.remove('drop-hover');
    if (!gearId) return;
    e.preventDefault();
    addGearToActivity(gearId, getActivityId());
  });
}

async function deleteGear(gearId, name) {
  if (!confirm(`Delete "${name}"? This also removes it from every list.`)) return;
  const { error } = await supabase.from('gear').delete().eq('id', gearId);
  if (error) return setStatus(statusEl, error.message, 'error');
  gearList = gearList.filter((g) => g.id !== gearId);
  for (const k of Object.keys(itemsByActivity)) {
    itemsByActivity[k] = itemsByActivity[k].filter((i) => i.gear_id !== gearId);
  }
  render();
}

async function addActivityPrompt() {
  const name = prompt('Activity name? (e.g. Climbing)');
  if (!name) return;
  const emoji = prompt('Emoji for the tab? (optional)') || null;
  const position = activities.length;
  const { data, error } = await supabase
    .from('activities')
    .insert({ name, emoji, position })
    .select()
    .single();
  if (error) return setStatus(statusEl, error.message, 'error');
  activities.push(data);
  activeActivityId = data.id;
  render();
}

$('rename-activity').addEventListener('click', async () => {
  const act = activities.find((a) => a.id === activeActivityId);
  if (!act) return;
  const name = prompt('New name?', act.name);
  if (!name || name === act.name) return;
  const { error } = await supabase.from('activities').update({ name }).eq('id', act.id);
  if (error) return setStatus(statusEl, error.message, 'error');
  act.name = name;
  render();
});

$('delete-activity').addEventListener('click', async () => {
  const act = activities.find((a) => a.id === activeActivityId);
  if (!act) return;
  if (!confirm(`Delete "${act.name}" and all its items?`)) return;
  const { error } = await supabase.from('activities').delete().eq('id', act.id);
  if (error) return setStatus(statusEl, error.message, 'error');
  activities = activities.filter((a) => a.id !== act.id);
  delete itemsByActivity[act.id];
  activeActivityId = activities[0]?.id || null;
  render();
});

$('add-custom-filter').addEventListener('click', addCustomFilterPrompt);

$('edit-custom-filters').addEventListener('click', () => {
  customFilterEditMode = !customFilterEditMode;
  render();
});

$('reset-checklist').addEventListener('click', async () => {
  if (!activeActivityId) return;
  const { error } = await supabase
    .from('activity_items')
    .update({ packed: false })
    .eq('activity_id', activeActivityId);
  if (error) return setStatus(statusEl, error.message, 'error');
  for (const i of itemsByActivity[activeActivityId] || []) i.packed = false;
  render();
});

// ------------------------------------------------------------------
// Add / edit gear modal + extraction
// ------------------------------------------------------------------
const addGearToggle = $('add-gear-toggle');
const editGearToggle = $('edit-gear-toggle');
const gearModal = $('gear-modal');
const gearModalTitle = $('gear-modal-title');
const gearModalStatus = $('gear-modal-status');
const addGearForm = $('add-gear-form');
const addGearSubmit = addGearForm.querySelector('button[type="submit"]');
const gearDropzone = $('gear-dropzone');
const gearUrlInput = $('gear-url-input');
const gearFileInput = $('gear-file-input');
const gearPreviewImg = $('gear-preview-img');

const DZ_IDLE = gearDropzone.querySelector('.dropzone-idle');
const DZ_PREVIEW = gearDropzone.querySelector('.dropzone-preview');
const DZ_LOADING = gearDropzone.querySelector('.dropzone-loading');

function setDropzoneState(which) {
  DZ_IDLE.hidden = which !== 'idle';
  DZ_PREVIEW.hidden = which !== 'preview';
  DZ_LOADING.hidden = which !== 'loading';
}

function resetGearForm() {
  addGearForm.reset();
  $('gear-quantity').value = '1';
  editingGearId = null;
  addGearSubmit.textContent = 'Save gear';
  gearModalTitle.textContent = 'Add gear';
  gearUrlInput.value = '';
  gearPreviewImg.removeAttribute('src');
  setDropzoneState('idle');
  setStatus(gearModalStatus, '');
}

function openGearModal() {
  gearModal.hidden = false;
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => gearUrlInput.focus());
}

function closeGearModal() {
  gearModal.hidden = true;
  document.body.style.overflow = '';
  resetGearForm();
  renderGearList();
}

function openAddGearForm() {
  resetGearForm();
  openGearModal();
}

function beginEditGear(g) {
  resetGearForm();
  editingGearId = g.id;
  gearModalTitle.textContent = 'Edit gear';
  $('gear-name').value = g.name || '';
  $('gear-weight').value =
    g.weight_grams == null ? '' : String(gramsToUnit(g.weight_grams, displayUnit));
  $('gear-quantity').value = String(g.quantity ?? 1);
  $('gear-brand').value = g.brand || '';
  $('gear-url').value = g.url || '';
  $('gear-image').value = g.image_url || '';
  $('gear-notes').value = g.notes || '';
  addGearSubmit.textContent = 'Save changes';
  openGearModal();
  renderGearList();
}

addGearToggle.addEventListener('click', openAddGearForm);

editGearToggle.addEventListener('click', () => {
  gearEditMode = !gearEditMode;
  editGearToggle.textContent = gearEditMode ? 'Done' : 'Edit';
  editGearToggle.classList.toggle('btn-primary', gearEditMode);
  editGearToggle.classList.toggle('btn-ghost', !gearEditMode);
  render();
});

$('gear-cancel').addEventListener('click', closeGearModal);
$('gear-modal-close').addEventListener('click', closeGearModal);
gearModal.addEventListener('click', (e) => { if (e.target === gearModal) closeGearModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !gearModal.hidden) closeGearModal();
});

addGearForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('gear-name').value.trim();
  if (!name) return;
  const weightRaw = $('gear-weight').value;
  const qty = Math.max(0, Math.round(Number($('gear-quantity').value) || 1));
  const payload = {
    name,
    brand: $('gear-brand').value.trim() || null,
    weight_grams: weightRaw === '' ? null : unitToGrams(weightRaw, displayUnit),
    url: $('gear-url').value.trim() || null,
    image_url: $('gear-image').value.trim() || null,
    notes: $('gear-notes').value.trim() || null,
    quantity: qty,
  };
  if (editingGearId) {
    const id = editingGearId;
    const { data, error } = await supabase
      .from('gear')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    if (error) return setStatus(gearModalStatus, error.message, 'error');
    const idx = gearList.findIndex((g) => g.id === id);
    if (idx >= 0) gearList[idx] = data;
    closeGearModal();
    render();
    return;
  }
  const { data, error } = await supabase.from('gear').insert(payload).select().single();
  if (error) return setStatus(gearModalStatus, error.message, 'error');
  gearList.unshift(data);
  closeGearModal();
  render();
});

$('gear-search').addEventListener('input', (e) => {
  gearSearch = e.target.value;
  renderGearList();
});

// ------------------------------------------------------------------
// Extraction: URL or screenshot → Supabase Edge Function → form fields
// ------------------------------------------------------------------
function applyExtracted(data) {
  if (!data) return;
  const setIfEmpty = (id, val) => {
    if (val == null || val === '') return;
    const el = $(id);
    if (!el.value) el.value = val;
  };
  setIfEmpty('gear-name', data.name);
  setIfEmpty('gear-brand', data.brand);
  setIfEmpty('gear-url', data.url);
  setIfEmpty('gear-image', data.imageUrl);
  setIfEmpty('gear-notes', data.notes);
  if (data.weightGrams != null && !$('gear-weight').value) {
    const v = gramsToUnit(data.weightGrams, displayUnit);
    $('gear-weight').value = displayUnit === 'g' ? String(Math.round(v)) : v.toFixed(2);
  }
}

async function callExtractGear(payload) {
  const { data: sessionRes } = await supabase.auth.getSession();
  const token = sessionRes?.session?.access_token;
  if (!token) throw new Error('Not signed in');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/extract-gear`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Extraction failed (${res.status})`);
  return body.data;
}

async function extractFromUrl(url) {
  setStatus(gearModalStatus, 'Fetching product page…');
  setDropzoneState('loading');
  $('gear-loading-msg').textContent = 'Reading the product page…';
  try {
    const data = await callExtractGear({ url });
    applyExtracted(data);
    setStatus(gearModalStatus, 'Filled in what we could find — review and save.', 'ok');
  } catch (err) {
    setStatus(gearModalStatus, err.message, 'error');
  } finally {
    setDropzoneState(gearPreviewImg.getAttribute('src') ? 'preview' : 'idle');
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
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  const mediaType = 'image/jpeg';
  const resized = canvas.toDataURL(mediaType, 0.85);
  const base64 = resized.split(',')[1];
  return { base64, mediaType, dataUrl: resized };
}

async function handleScreenshotFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  if (gearModal.hidden) openAddGearForm();
  setStatus(gearModalStatus, '');
  try {
    const { base64, mediaType, dataUrl } = await fileToResizedDataUrl(file);
    gearPreviewImg.src = dataUrl;
    setDropzoneState('loading');
    $('gear-loading-msg').textContent = 'Reading the screenshot…';
    const data = await callExtractGear({ image: { base64, mediaType } });
    applyExtracted(data);
    setDropzoneState('preview');
    setStatus(gearModalStatus, 'Filled in what we could see — review and save.', 'ok');
  } catch (err) {
    setDropzoneState(gearPreviewImg.getAttribute('src') ? 'preview' : 'idle');
    setStatus(gearModalStatus, err.message, 'error');
  }
}

// URL fetch button + Enter key
$('gear-url-fetch').addEventListener('click', () => {
  const url = gearUrlInput.value.trim();
  if (!url) return;
  extractFromUrl(url);
});
gearUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('gear-url-fetch').click();
  }
});

// File picker
gearFileInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) handleScreenshotFile(file);
  e.target.value = '';
});

// Clear preview → back to idle (so user can pick a different image)
$('gear-preview-clear').addEventListener('click', () => {
  gearPreviewImg.removeAttribute('src');
  setDropzoneState('idle');
});

// Paste an image from clipboard into the dropzone/modal
gearDropzone.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items || [];
  for (const it of items) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      e.preventDefault();
      handleScreenshotFile(it.getAsFile());
      return;
    }
  }
});

// Drop directly on the modal's inner dropzone
gearDropzone.addEventListener('dragover', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  gearDropzone.classList.add('drag-over');
});
gearDropzone.addEventListener('dragleave', () => gearDropzone.classList.remove('drag-over'));
gearDropzone.addEventListener('drop', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  gearDropzone.classList.remove('drag-over');
  const file = e.dataTransfer.files?.[0];
  if (file) handleScreenshotFile(file);
});

// Drop-anywhere: any file dragged onto the window opens the modal + extracts
const globalSplash = $('global-drop-splash');
let dragDepth = 0;
function isFileDrag(e) {
  return Array.from(e.dataTransfer?.types || []).includes('Files');
}
window.addEventListener('dragenter', (e) => {
  if (!isFileDrag(e)) return;
  dragDepth++;
  // When the modal is open, its inner dropzone handles the UI — skip the splash.
  if (gearModal.hidden) globalSplash.hidden = false;
});
window.addEventListener('dragover', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', (e) => {
  if (!isFileDrag(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) globalSplash.hidden = true;
});
window.addEventListener('drop', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth = 0;
  globalSplash.hidden = true;
  const file = e.dataTransfer.files?.[0];
  if (file && file.type.startsWith('image/')) handleScreenshotFile(file);
});

// ------------------------------------------------------------------
// Unit toggle
// ------------------------------------------------------------------
const unitSelect = $('unit-select');
unitSelect.value = displayUnit;
unitSelect.addEventListener('change', () => {
  displayUnit = unitSelect.value;
  localStorage.setItem(LS_UNIT_KEY, displayUnit);
  render();
});

// ------------------------------------------------------------------
// Bootstrap + auth state wiring
// ------------------------------------------------------------------
async function onSignedIn(session) {
  currentUser = session.user;
  $('user-email').textContent = currentUser.email || '';
  showMain();
  await loadAll();

  if (!activities.length) {
    const seed = [
      { name: 'Climbing', emoji: '🧗', position: 0 },
      { name: 'Highlining', emoji: '🪢', position: 1 },
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
  activeActivityId = null;
  showAuth();
}

supabase.auth.onAuthStateChange((event, session) => {
  console.log('[auth] event:', event, 'session:', !!session);
  if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
    cleanAuthParamsFromUrl();
  }
  if (session?.user) {
    onSignedIn(session);
  } else if (event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') {
    // Only show auth on explicit sign-out or truly-no-session startup;
    // do NOT clobber a SIGNED_IN in flight.
    if (!session) onSignedOut();
  }
});

async function consumeTokenHashFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const token_hash = params.get('token_hash');
  const type = params.get('type');
  if (!token_hash || !type) return null;
  console.log('[auth] exchanging token_hash from URL, type=', type);
  const { data, error } = await supabase.auth.verifyOtp({ token_hash, type });
  cleanAuthParamsFromUrl();
  if (error) {
    console.warn('[auth] verifyOtp failed', error);
    return { error };
  }
  return { session: data?.session || null };
}

(async () => {
  // Surface any error the Supabase verify endpoint appended to the hash
  // (e.g. expired link, invalid token) before we process the session.
  const hashErr = readHashError();
  if (hashErr) {
    setStatus(authStatusEl, `Sign-in link failed: ${hashErr}. Enter your email to get a new one.`, 'error');
    cleanAuthParamsFromUrl();
  }

  try {
    // 1) New token_hash flow (custom email template): ?token_hash=…&type=…
    //    This runs client-side so email link scanners can't pre-consume the token.
    const consumed = await consumeTokenHashFromUrl();
    if (consumed?.session?.user) {
      await onSignedIn(consumed.session);
      return;
    }
    if (consumed?.error) {
      setStatus(
        authStatusEl,
        `That sign-in link didn't work (${consumed.error.message}). Enter your email to get a fresh one.`,
        'error'
      );
    }

    // 2) Fallback: implicit-flow hash (#access_token=…) or an already-stored session.
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) console.warn('[auth] getSession error', error);
    if (session?.user) {
      cleanAuthParamsFromUrl();
      await onSignedIn(session);
    } else {
      showAuth();
    }
  } catch (err) {
    console.error('[auth] boot error', err);
    showAuth();
  }
})();
