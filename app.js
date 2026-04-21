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

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storageKey: 'pack.auth.v1',
  },
});

// ------------------------------------------------------------------
// State
// ------------------------------------------------------------------
const LS_STATE_KEY = 'packlist.state.v1';
const LS_IMPORTED_FLAG = 'packlist.imported.v1';
const LS_UNIT_KEY = 'pack.displayUnit';

let currentUser = null;
let gearList = [];
let activities = [];
let itemsByActivity = {}; // activityId -> items[]
let activeActivityId = null;
let displayUnit = localStorage.getItem(LS_UNIT_KEY) || 'g';
let gearSearch = '';

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
  const [gearRes, actRes, itemRes] = await Promise.all([
    supabase.from('gear').select('*').order('created_at', { ascending: false }),
    supabase.from('activities').select('*').order('position', { ascending: true }),
    supabase.from('activity_items').select('*').order('position', { ascending: true }),
  ]);
  if (gearRes.error) return setStatus(statusEl, `Load gear: ${gearRes.error.message}`, 'error');
  if (actRes.error) return setStatus(statusEl, `Load activities: ${actRes.error.message}`, 'error');
  if (itemRes.error) return setStatus(statusEl, `Load items: ${itemRes.error.message}`, 'error');

  gearList = gearRes.data || [];
  activities = actRes.data || [];
  itemsByActivity = {};
  for (const it of itemRes.data || []) {
    (itemsByActivity[it.activity_id] ||= []).push(it);
  }
  if (!activeActivityId || !activities.some((a) => a.id === activeActivityId)) {
    activeActivityId = activities[0]?.id || null;
  }
  setStatus(statusEl, '');
  render();
  maybeShowImportBanner();
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
    b.addEventListener('click', () => { activeActivityId = a.id; render(); });
    el.appendChild(b);
  }
  const add = document.createElement('button');
  add.className = 'activity-tab activity-tab-new';
  add.textContent = '+ New';
  add.addEventListener('click', addActivityPrompt);
  el.appendChild(add);
}

function renderActivityBody() {
  const title = $('activity-title');
  const ul = $('activity-items');
  const footer = $('activity-footer');
  ul.innerHTML = '';
  const act = activities.find((a) => a.id === activeActivityId);
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

  const items = itemsByActivity[act.id] || [];
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No items yet. Use “Add” on any gear to include it here.';
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
    main.append(name, meta);

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
  footer.textContent =
    items.length === 0
      ? ''
      : `Total: ${formatWeight(totalGrams)} (${formatWeight(packedGrams)} packed)`;
}

function renderGearList() {
  const ul = $('gear-list');
  ul.innerHTML = '';
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
    li.className = 'gear-item';

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

    const actions = document.createElement('div');
    actions.className = 'gear-actions';
    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-primary';
    addBtn.textContent = activeActivityId ? 'Add' : 'No list';
    addBtn.disabled = !activeActivityId;
    addBtn.addEventListener('click', () => addGearToActiveActivity(g.id));
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-ghost';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => deleteGear(g.id, g.name));
    actions.append(addBtn, delBtn);

    li.append(thumb, main, actions);
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

async function addGearToActiveActivity(gearId) {
  if (!activeActivityId) return;
  const existing = (itemsByActivity[activeActivityId] || []).find((i) => i.gear_id === gearId);
  if (existing) {
    return updateItemQuantity(existing.id, (existing.quantity || 1) + 1);
  }
  const position = (itemsByActivity[activeActivityId] || []).length;
  const { data, error } = await supabase
    .from('activity_items')
    .insert({ activity_id: activeActivityId, gear_id: gearId, position, quantity: 1 })
    .select()
    .single();
  if (error) return setStatus(statusEl, error.message, 'error');
  (itemsByActivity[activeActivityId] ||= []).push(data);
  render();
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
// Add-gear form
// ------------------------------------------------------------------
const addGearToggle = $('add-gear-toggle');
const addGearForm = $('add-gear-form');
addGearToggle.addEventListener('click', () => {
  addGearForm.hidden = !addGearForm.hidden;
  if (!addGearForm.hidden) $('gear-name').focus();
});
$('gear-cancel').addEventListener('click', () => {
  addGearForm.reset();
  addGearForm.hidden = true;
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
  const { data, error } = await supabase.from('gear').insert(payload).select().single();
  if (error) return setStatus(statusEl, error.message, 'error');
  gearList.unshift(data);
  addGearForm.reset();
  $('gear-quantity').value = '1';
  addGearForm.hidden = true;
  render();
});

$('gear-search').addEventListener('input', (e) => {
  gearSearch = e.target.value;
  renderGearList();
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
// Local-data import
// ------------------------------------------------------------------
function readLocalPackState() {
  try {
    const raw = localStorage.getItem(LS_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function maybeShowImportBanner() {
  const banner = $('import-banner');
  const imported = localStorage.getItem(LS_IMPORTED_FLAG);
  if (imported) return (banner.hidden = true);
  const local = readLocalPackState();
  if (!local) return (banner.hidden = true);
  const gearCount = (local.gear || []).length;
  const actCount = (local.activities || []).length;
  if (!gearCount && !actCount) return (banner.hidden = true);
  $('import-summary').textContent =
    ` ${gearCount} gear · ${actCount} list${actCount === 1 ? '' : 's'} stored in this browser.`;
  banner.hidden = false;
}

$('import-dismiss').addEventListener('click', () => {
  localStorage.setItem(LS_IMPORTED_FLAG, `dismissed:${new Date().toISOString()}`);
  $('import-banner').hidden = true;
});

$('import-btn').addEventListener('click', async () => {
  const local = readLocalPackState();
  if (!local) return;
  const btn = $('import-btn');
  btn.disabled = true;
  btn.textContent = 'Importing…';
  try {
    await importLocalPackState(local);
    localStorage.setItem(LS_IMPORTED_FLAG, `ok:${new Date().toISOString()}`);
    $('import-banner').hidden = true;
    await loadAll();
    setStatus(statusEl, 'Imported local gear & lists.', 'ok');
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Import failed: ${err.message || err}`, 'error');
    btn.disabled = false;
    btn.textContent = 'Import to my account';
  }
});

async function importLocalPackState(local) {
  const gearIdMap = new Map();
  const gearRows = (local.gear || []).map((g) => ({
    name: g.name || 'Untitled',
    brand: g.brand || null,
    weight_grams:
      typeof g.weightGrams === 'number'
        ? g.weightGrams
        : g.weight_grams ?? null,
    url: g.url || null,
    image_url: g.imageUrl || g.image_url || null,
    notes: g.notes || null,
    color: g.color || null,
    available_colors: g.availableColors || g.available_colors || [],
    quantity: Math.max(0, Math.round(Number(g.quantity) || 1)),
  }));

  if (gearRows.length) {
    const { data, error } = await supabase.from('gear').insert(gearRows).select();
    if (error) throw error;
    (local.gear || []).forEach((g, i) => gearIdMap.set(g.id, data[i].id));
  }

  const actRows = (local.activities || []).map((a, i) => ({
    name: a.name || `Activity ${i + 1}`,
    emoji: a.emoji || null,
    position: i,
    active_weathers: a.activeWeathers || a.active_weathers || [],
  }));

  let insertedActs = [];
  if (actRows.length) {
    const { data, error } = await supabase.from('activities').insert(actRows).select();
    if (error) throw error;
    insertedActs = data;
  }

  const itemRows = [];
  (local.activities || []).forEach((a, i) => {
    const newAct = insertedActs[i];
    if (!newAct) return;
    (a.items || []).forEach((it, j) => {
      const newGearId = gearIdMap.get(it.gearId || it.gear_id);
      if (!newGearId) return;
      itemRows.push({
        activity_id: newAct.id,
        gear_id: newGearId,
        position: j,
        packed: !!it.packed,
        quantity: Math.max(0, Math.round(Number(it.quantity) || 1)),
        note: it.note || null,
        weather_tags: it.weatherTags || it.weather_tags || [],
      });
    });
  });

  if (itemRows.length) {
    const { error } = await supabase.from('activity_items').insert(itemRows);
    if (error) throw error;
  }

  if (local.settings?.displayUnit) {
    displayUnit = local.settings.displayUnit;
    localStorage.setItem(LS_UNIT_KEY, displayUnit);
    unitSelect.value = displayUnit;
  }
}

// ------------------------------------------------------------------
// Bootstrap + auth state wiring
// ------------------------------------------------------------------
async function onSignedIn(session) {
  currentUser = session.user;
  $('user-email').textContent = currentUser.email || '';
  showMain();
  await loadAll();

  // Seed default activities if the user has none AND no local data to import.
  const localHasData = !!readLocalPackState();
  if (!activities.length && !localHasData) {
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
  if (session?.user) {
    onSignedIn(session);
  } else {
    onSignedOut();
  }
});

(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    await onSignedIn(session);
  } else {
    showAuth();
  }
})();
