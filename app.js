/* ========================================================================
   Pack — Gear & Packing List
   Single-file vanilla JS app. State persists in localStorage under
   `packlist.state.v1`. No backend; URL auto-fetch uses public CORS proxies
   with an optional Claude API fallback (user-provided key).
   ======================================================================== */

(() => {
  'use strict';

  // ---------- Constants ----------
  const STORAGE_KEY = 'packlist.state.v1';
  const CORS_PROXIES = [
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  ];
  const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
  const UNIT_CYCLE = ['g', 'kg', 'oz', 'lb'];

  const DEFAULT_ACTIVITIES = [
    { name: 'Climbing', emoji: '🧗' },
    { name: 'Highlining', emoji: '🎪' },
    { name: 'Paragliding', emoji: '🪂' },
    { name: 'Hiking', emoji: '🥾' },
  ];

  const WEATHER_TYPES = [
    { id: 'sunny', label: 'Sunny', emoji: '🌞' },
    { id: 'cold',  label: 'Cold',  emoji: '❄️' },
    { id: 'rain',  label: 'Rain',  emoji: '🌧' },
    { id: 'snow',  label: 'Snow',  emoji: '🌨' },
  ];
  const WEATHER_IDS = WEATHER_TYPES.map((w) => w.id);

  // ---------- State ----------
  let state = loadState();
  let activeActivityId = state.activities[0]?.id || null;
  let gearSearchQuery = '';
  let editingGearId = null;       // null = adding new
  let editingActivityId = null;   // null = adding new
  let lastFetchedHtml = null;     // cache for "Improve with AI"
  let currentScreenshot = null;   // { base64, mediaType, dataUrl } — cleared on modal close
  let libraryEditMode = false;
  let brandFilter = null; // lowercase brand name, or null for "all"
  // Tracks an in-flight background image lookup kicked off by the screenshot
  // pipeline. If the user saves before it finishes, the record id is stored
  // here so the image can be patched in when the lookup resolves.
  let activeImagePipeline = null;

  // Known outdoor / climbing / paragliding brand palettes. Keys are lowercase.
  const BRAND_STYLES = {
    'black diamond':      { abbr: 'BD',  bg: '#0a0a0a', fg: '#FFC82E' },
    'patagonia':          { abbr: 'P',   bg: '#0B3C5D', fg: '#F4B942' },
    'arc\'teryx':         { abbr: 'Arc', bg: '#1A1A1A', fg: '#EFEFEF' },
    'arcteryx':           { abbr: 'Arc', bg: '#1A1A1A', fg: '#EFEFEF' },
    'the north face':     { abbr: 'TNF', bg: '#000000', fg: '#E8492D' },
    'north face':         { abbr: 'TNF', bg: '#000000', fg: '#E8492D' },
    'rei':                { abbr: 'REI', bg: '#006241', fg: '#FFFFFF' },
    'rei co-op':          { abbr: 'REI', bg: '#006241', fg: '#FFFFFF' },
    'mountain hardwear':  { abbr: 'MH',  bg: '#1B4E8C', fg: '#FFFFFF' },
    'mammut':             { abbr: 'Mm',  bg: '#E4002B', fg: '#FFFFFF' },
    'salewa':             { abbr: 'Sa',  bg: '#E30613', fg: '#FFFFFF' },
    'petzl':              { abbr: 'Pz',  bg: '#F28C00', fg: '#000000' },
    'osprey':             { abbr: 'Os',  bg: '#00857A', fg: '#FFFFFF' },
    'gregory':            { abbr: 'Gr',  bg: '#2E4E3F', fg: '#FFFFFF' },
    'msr':                { abbr: 'MSR', bg: '#E60023', fg: '#FFFFFF' },
    'smartwool':          { abbr: 'SW',  bg: '#D7282F', fg: '#FFFFFF' },
    'la sportiva':        { abbr: 'LS',  bg: '#FFC200', fg: '#000000' },
    'scarpa':             { abbr: 'Sc',  bg: '#E4032E', fg: '#FFFFFF' },
    'hyperlite mountain gear': { abbr: 'HMG', bg: '#C8C8C8', fg: '#000000' },
    'hyperlite':          { abbr: 'HMG', bg: '#C8C8C8', fg: '#000000' },
    'zpacks':             { abbr: 'Zp',  bg: '#2E7D32', fg: '#FFFFFF' },
    'ortovox':            { abbr: 'Ov',  bg: '#1F7A33', fg: '#FFFFFF' },
    'mystery ranch':      { abbr: 'MR',  bg: '#2F2F2F', fg: '#F28C00' },
    'dmm':                { abbr: 'DMM', bg: '#ED1C24', fg: '#FFFFFF' },
    'edelrid':            { abbr: 'Ed',  bg: '#FFC220', fg: '#000000' },
    'fjallraven':         { abbr: 'Fj',  bg: '#B22222', fg: '#FFFFFF' },
    'fjällräven':         { abbr: 'Fj',  bg: '#B22222', fg: '#FFFFFF' },
    'columbia':           { abbr: 'Co',  bg: '#1B365C', fg: '#FFFFFF' },
    'marmot':             { abbr: 'Mt',  bg: '#1A1A1A', fg: '#F28C00' },
    'outdoor research':   { abbr: 'OR',  bg: '#3A4A5C', fg: '#FFFFFF' },
    'sea to summit':      { abbr: 'S2S', bg: '#00A9CE', fg: '#FFFFFF' },
    'therm-a-rest':       { abbr: 'TaR', bg: '#F4B942', fg: '#0B3C5D' },
    'thermarest':         { abbr: 'TaR', bg: '#F4B942', fg: '#0B3C5D' },
    'nemo':               { abbr: 'Ne',  bg: '#FF6B00', fg: '#FFFFFF' },
    'big agnes':          { abbr: 'BA',  bg: '#006633', fg: '#FFFFFF' },
    'garmin':             { abbr: 'Ga',  bg: '#000000', fg: '#007CC3' },
    'gopro':              { abbr: 'GP',  bg: '#000000', fg: '#FFFFFF' },
    'ozone':              { abbr: 'Oz',  bg: '#000000', fg: '#FFCC00' },
    'advance':            { abbr: 'Ad',  bg: '#E4002B', fg: '#FFFFFF' },
    'icaro':              { abbr: 'Ic',  bg: '#0055A5', fg: '#FFFFFF' },
    'skywalk':            { abbr: 'Sk',  bg: '#003DA5', fg: '#FFFFFF' },
    'gin gliders':        { abbr: 'Gin', bg: '#E30613', fg: '#FFFFFF' },
    'niviuk':             { abbr: 'Nv',  bg: '#F28C00', fg: '#000000' },
    'supair':             { abbr: 'Sp',  bg: '#003B5C', fg: '#FFFFFF' },
    'gibbon':             { abbr: 'Gb',  bg: '#FF6B00', fg: '#FFFFFF' },
    'balance community':  { abbr: 'BC',  bg: '#228B22', fg: '#FFFFFF' },
    'slackline industries': { abbr: 'SLI', bg: '#FF4500', fg: '#FFFFFF' },
  };

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

  function brandBadgeEl(brand, { title } = {}) {
    const s = brandStyle(brand);
    if (!s) return null;
    return h('span', {
      class: 'brand-badge',
      style: `background: ${s.bg}; color: ${s.fg};`,
      title: title || brand,
    }, s.abbr);
  }

  function emptyState() {
    return {
      gear: [],
      activities: DEFAULT_ACTIVITIES.map((a) => ({
        id: uid(),
        name: a.name,
        emoji: a.emoji,
        items: [],
        activeWeathers: [],
        customFilters: [],
        activeCustomFilterIds: [],
      })),
      settings: {
        displayUnit: 'g',
        anthropicApiKey: null,
      },
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw);
      // Shallow validation
      if (!parsed.gear || !parsed.activities || !parsed.settings) {
        return emptyState();
      }
      // Migrate weather fields. Tags moved from gear-global to per-item,
      // so copy any old gear.weatherTags down into every item that references that gear.
      const gearTagMap = new Map();
      for (const g of parsed.gear) {
        if (Array.isArray(g.weatherTags) && g.weatherTags.length) {
          gearTagMap.set(g.id, g.weatherTags.slice());
        }
        delete g.weatherTags;
        if (typeof g.color !== 'string') g.color = null;
        if (!Array.isArray(g.availableColors)) g.availableColors = [];
        if (!Number.isFinite(g.quantity) || g.quantity < 1) g.quantity = 1;
      }
      for (const a of parsed.activities) {
        if (!Array.isArray(a.activeWeathers)) a.activeWeathers = [];
        if (!Array.isArray(a.customFilters)) a.customFilters = [];
        if (!Array.isArray(a.activeCustomFilterIds)) a.activeCustomFilterIds = [];
        const validFilterIds = new Set(a.customFilters.map((f) => f.id));
        a.activeCustomFilterIds = a.activeCustomFilterIds.filter((id) => validFilterIds.has(id));
        for (const it of a.items) {
          if (!Array.isArray(it.weatherTags)) {
            it.weatherTags = gearTagMap.get(it.gearId)?.slice() || [];
          }
          if (!Array.isArray(it.customFilterIds)) it.customFilterIds = [];
          it.customFilterIds = it.customFilterIds.filter((id) => validFilterIds.has(id));
          if (!Number.isFinite(it.quantity) || it.quantity < 1) it.quantity = 1;
        }
      }
      return parsed;
    } catch (err) {
      console.warn('Failed to load state; starting fresh.', err);
      return emptyState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      toast('Could not save — storage may be full.', 'error');
      console.error(err);
    }
  }

  function uid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  // ---------- Unit conversion ----------
  // Storage is always grams. Display unit is user-selectable.
  const UNIT_TO_G = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592 };

  function gramsToUnit(grams, unit) {
    if (grams == null || isNaN(grams)) return null;
    return grams / UNIT_TO_G[unit];
  }
  function unitToGrams(value, unit) {
    if (value == null || isNaN(value)) return null;
    return value * UNIT_TO_G[unit];
  }
  function formatWeight(grams, unit = state.settings.displayUnit) {
    if (grams == null || isNaN(grams)) return '—';
    const v = gramsToUnit(grams, unit);
    // Choose decimals: g/oz → 0–1, kg/lb → 2
    const decimals = (unit === 'g') ? 0 : (unit === 'kg' || unit === 'lb') ? 2 : 1;
    return `${v.toFixed(decimals)} ${unit}`;
  }

  // ---------- DOM helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

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
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }

  function escapeHost(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch { return null; }
  }

  // <img> element that retries via the weserv image proxy if the direct URL
  // fails (hotlink protection, CORS). Falls back to a placeholder div if both
  // paths fail. Use this anywhere gear images are rendered.
  function gearImageEl(url, { className = '', alt = '' } = {}) {
    if (!url) return h('div', { class: ('placeholder-img ' + className).trim() }, '🎒');
    const img = h('img', { src: url, alt, class: className });
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

  // ---------- Toasts ----------
  let toastTimeout = null;
  function toast(message, kind = '') {
    const el = $('#toast');
    el.textContent = message;
    el.className = `toast show ${kind}`.trim();
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      el.className = 'toast hidden';
    }, 3200);
  }

  // ---------- Rendering ----------
  function render() {
    renderLibrary();
    renderTabs();
    renderCustomFilterBar();
    renderWeatherFilter();
    renderActivity();
    renderUnitToggle();
  }

  function renderCustomFilterBar() {
    const host = $('#custom-filter-pills');
    const hint = $('#custom-filter-hint');
    const wrap = $('#custom-filter');
    if (!host) return;
    host.innerHTML = '';

    const activity = state.activities.find((a) => a.id === activeActivityId);
    if (!activity) {
      wrap.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');

    const active = new Set(activity.activeCustomFilterIds || []);
    for (const f of activity.customFilters || []) {
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

    if (hint) {
      if (!activity.customFilters.length) {
        hint.textContent = 'Click + to add sub-filters (e.g. Trad, Sport, Bouldering)';
      } else if (active.size) {
        hint.textContent = 'Showing equipment + items tagged for selected filters';
      } else {
        hint.textContent = 'All items';
      }
    }
  }

  function renderWeatherFilter() {
    const host = $('#weather-toggles');
    const hint = $('#weather-filter-hint');
    const wrap = $('#weather-filter');
    if (!host) return;
    host.innerHTML = '';

    const activity = state.activities.find((a) => a.id === activeActivityId);
    if (!activity) {
      wrap.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');

    const active = new Set(activity.activeWeathers || []);
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

    if (hint) {
      hint.textContent = active.size
        ? 'Showing equipment + matching clothing'
        : 'All items';
    }
  }

  function renderUnitToggle() {
    $('#unit-toggle').textContent = state.settings.displayUnit;
  }

  function renderLibrary() {
    const list = $('#gear-list');
    const empty = $('#gear-empty');
    const count = $('#gear-count');
    const editToggle = $('#library-edit-toggle');
    list.innerHTML = '';

    renderBrandFilters();

    // If the currently-filtered brand no longer exists in the library, clear it.
    if (brandFilter && !state.gear.some((g) => (g.brand || '').trim().toLowerCase() === brandFilter)) {
      brandFilter = null;
    }

    const q = gearSearchQuery.trim().toLowerCase();
    let items = state.gear;
    if (q) {
      items = items.filter((g) =>
        (g.name || '').toLowerCase().includes(q) ||
        (g.brand || '').toLowerCase().includes(q) ||
        (g.notes || '').toLowerCase().includes(q));
    }
    if (brandFilter) {
      items = items.filter((g) => (g.brand || '').trim().toLowerCase() === brandFilter);
    }

    count.textContent = state.gear.length ? `${state.gear.length}` : '';

    // Edit mode is meaningless with no gear; force-off so the toggle can't stick.
    if (!state.gear.length && libraryEditMode) libraryEditMode = false;
    list.classList.toggle('edit-mode', libraryEditMode);
    if (editToggle) {
      editToggle.textContent = libraryEditMode ? 'Done' : 'Edit';
      editToggle.setAttribute('aria-pressed', libraryEditMode ? 'true' : 'false');
      editToggle.disabled = !state.gear.length;
    }

    if (!state.gear.length) {
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
    if (!host) return;
    host.innerHTML = '';

    // Count gear per brand (case-insensitive key, preserve first-seen casing).
    const counts = new Map(); // key -> { label, count }
    for (const g of state.gear) {
      const label = (g.brand || '').trim();
      if (!label) continue;
      const key = label.toLowerCase();
      const entry = counts.get(key) || { label, count: 0 };
      entry.count++;
      counts.set(key, entry);
    }

    // Only show the row when there are 2+ distinct brands (filtering one brand is pointless).
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
    const img = gearImageEl(gear.imageUrl);

    const weight = h('div', { class: 'gear-weight' }, formatWeight(gear.weightGrams));
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
        gear.url ? h('span', {}, escapeHost(gear.url) || 'link') : null,
      ),
    );

    const cardProps = {
      class: 'gear-card',
      dataset: { gearId: gear.id },
    };
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

  function handleInlineDeleteGear(id) {
    const gear = state.gear.find((g) => g.id === id);
    if (!gear) return;
    const usedIn = state.activities.filter((a) => a.items.some((i) => i.gearId === id));
    const msg = usedIn.length
      ? `Delete "${gear.name}"? It will also be removed from: ${usedIn.map((a) => a.name).join(', ')}.`
      : `Delete "${gear.name}"?`;
    if (!confirm(msg)) return;
    deleteGear(id);
    render();
  }

  function renderTabs() {
    const tabs = $('#activity-tabs');
    tabs.innerHTML = '';

    for (const a of state.activities) {
      const tab = h('button', {
        class: 'activity-tab' + (a.id === activeActivityId ? ' active' : ''),
        dataset: { activityId: a.id },
        role: 'tab',
        onclick: () => {
          activeActivityId = a.id;
          render();
        },
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

  function renderActivity() {
    const list = $('#activity-list');
    const empty = $('#activity-empty');
    const totalEl = $('#activity-total');
    const packedEl = $('#activity-packed');
    const resetBtn = $('#reset-checklist-btn');
    const editBtn = $('#edit-activity-btn');

    list.innerHTML = '';
    const activity = state.activities.find((a) => a.id === activeActivityId);
    if (!activity) {
      empty.classList.add('hidden');
      totalEl.textContent = 'Total: —';
      packedEl.textContent = '';
      resetBtn.disabled = true;
      editBtn.disabled = true;
      return;
    }
    resetBtn.disabled = !activity.items.length;
    editBtn.disabled = false;

    const activeWeather = new Set(activity.activeWeathers || []);
    const activeCustom = new Set(activity.activeCustomFilterIds || []);
    const passWeather = (item) => {
      if (!activeWeather.size) return true;
      const tags = item.weatherTags || [];
      if (!tags.length) return true; // untagged = equipment, always shown
      return tags.some((t) => activeWeather.has(t));
    };
    const passCustom = (item) => {
      if (!activeCustom.size) return true;
      const tags = item.customFilterIds || [];
      if (!tags.length) return true; // untagged = equipment
      return tags.some((t) => activeCustom.has(t));
    };

    const visibleItems = [];
    for (const item of activity.items) {
      const gear = state.gear.find((g) => g.id === item.gearId);
      if (!gear) continue;
      if (passWeather(item) && passCustom(item)) visibleItems.push({ item, gear });
    }

    if (!activity.items.length) {
      empty.classList.remove('hidden');
    } else if (!visibleItems.length) {
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
      const w = (gear?.weightGrams || 0) * qty;
      total += w;
      if (item.packed) { packed += w; packedCount += 1; }
    }
    totalEl.textContent = `Total: ${formatWeight(total)}`;
    packedEl.textContent = visibleItems.length
      ? `${formatWeight(packed)} packed • ${packedCount}/${visibleItems.length} items`
      : '';
  }

  function activityItemRow(activity, item, gear) {
    const imgEl = gearImageEl(gear.imageUrl);

    const weatherSet = new Set(item.weatherTags || []);
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
        onclick: (e) => { e.stopPropagation(); toggleItemWeather(activity.id, gear.id, w.id); },
      }, w.emoji)),
    );

    const customSet = new Set(item.customFilterIds || []);
    const customChips = (activity.customFilters || []).length
      ? h('div', {
          class: 'custom-chips',
          title: 'Tag this item by sub-filter (leave blank for equipment)',
          onclick: (e) => e.stopPropagation(),
        },
          ...activity.customFilters.map((f) => h('button', {
            class: 'custom-chip' + (customSet.has(f.id) ? ' active' : ''),
            type: 'button',
            title: f.label,
            'aria-pressed': customSet.has(f.id) ? 'true' : 'false',
            onclick: (e) => { e.stopPropagation(); toggleItemCustomFilter(activity.id, gear.id, f.id); },
          }, f.label)),
        )
      : null;

    const ownedQty = Number.isFinite(gear.quantity) && gear.quantity >= 1 ? gear.quantity : 1;
    const itemQty = Number.isFinite(item.quantity) && item.quantity >= 1 ? item.quantity : 1;
    const showStepper = ownedQty > 1;
    const totalWeight = (gear.weightGrams || 0) * itemQty;

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
            onclick: (e) => { e.stopPropagation(); setItemQuantity(activity.id, gear.id, itemQty - 1); },
          }, '−'),
          h('input', {
            class: 'item-qty-input',
            type: 'number',
            min: 1,
            step: 1,
            value: String(itemQty),
            onclick: (e) => e.stopPropagation(),
            onchange: (e) => setItemQuantity(activity.id, gear.id, parseInt(e.target.value, 10)),
          }),
          h('button', {
            class: 'item-qty-btn',
            type: 'button',
            onclick: (e) => { e.stopPropagation(); setItemQuantity(activity.id, gear.id, itemQty + 1); },
          }, '+'),
          h('span', { class: 'item-qty-owned muted' }, `/ ${ownedQty}`),
        )
      : null;

    const weightLabel = gear.weightGrams == null
      ? '—'
      : (itemQty > 1
          ? `${formatWeight(totalWeight)} (${itemQty}× ${formatWeight(gear.weightGrams)})`
          : formatWeight(gear.weightGrams));

    const row = h('div', {
      class: 'activity-item' + (item.packed ? ' packed' : ''),
      draggable: 'true',
      dataset: { gearId: gear.id },
      ondragstart: (e) => handleItemDragStart(e, activity.id, gear.id),
      ondragend: handleDragEnd,
      ondragover: handleItemDragOver,
      ondragleave: handleItemDragLeave,
      ondrop: (e) => handleItemDrop(e, activity.id, gear.id),
    },
      h('input', {
        type: 'checkbox',
        checked: item.packed,
        onchange: () => togglePacked(activity.id, gear.id),
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

  // ---------- Mutations ----------
  function addGear(data) {
    const gear = {
      id: uid(),
      name: data.name || 'Unnamed gear',
      weightGrams: data.weightGrams ?? null,
      url: data.url || null,
      imageUrl: data.imageUrl || null,
      brand: data.brand || null,
      notes: data.notes || '',
      color: data.color || null,
      availableColors: Array.isArray(data.availableColors) ? data.availableColors : [],
      quantity: Number.isFinite(data.quantity) && data.quantity >= 1 ? Math.floor(data.quantity) : 1,
      createdAt: Date.now(),
    };
    state.gear.unshift(gear);
    saveState();
    return gear;
  }

  function updateGear(id, patch) {
    const idx = state.gear.findIndex((g) => g.id === id);
    if (idx === -1) return;
    state.gear[idx] = { ...state.gear[idx], ...patch };
    saveState();
  }

  function deleteGear(id) {
    state.gear = state.gear.filter((g) => g.id !== id);
    for (const a of state.activities) {
      a.items = a.items.filter((i) => i.gearId !== id);
    }
    saveState();
  }

  function addActivity({ name, emoji }) {
    const a = {
      id: uid(),
      name: name || 'New activity',
      emoji: emoji || null,
      items: [],
      activeWeathers: [],
      customFilters: [],
      activeCustomFilterIds: [],
    };
    state.activities.push(a);
    saveState();
    return a;
  }

  function updateActivity(id, patch) {
    const idx = state.activities.findIndex((a) => a.id === id);
    if (idx === -1) return;
    state.activities[idx] = { ...state.activities[idx], ...patch };
    saveState();
  }

  function deleteActivity(id) {
    state.activities = state.activities.filter((a) => a.id !== id);
    if (activeActivityId === id) {
      activeActivityId = state.activities[0]?.id || null;
    }
    saveState();
  }

  function duplicateActivity(id) {
    const src = state.activities.find((a) => a.id === id);
    if (!src) return null;
    const copy = {
      id: uid(),
      name: `${src.name} copy`,
      emoji: src.emoji || null,
      items: src.items.map((i) => ({
        gearId: i.gearId,
        packed: false,
        note: i.note || '',
        weatherTags: Array.isArray(i.weatherTags) ? i.weatherTags.slice() : [],
        customFilterIds: Array.isArray(i.customFilterIds) ? i.customFilterIds.slice() : [],
        quantity: Number.isFinite(i.quantity) && i.quantity >= 1 ? i.quantity : 1,
      })),
      activeWeathers: Array.isArray(src.activeWeathers) ? src.activeWeathers.slice() : [],
      customFilters: Array.isArray(src.customFilters) ? src.customFilters.map((f) => ({ ...f })) : [],
      activeCustomFilterIds: Array.isArray(src.activeCustomFilterIds) ? src.activeCustomFilterIds.slice() : [],
    };
    const idx = state.activities.findIndex((a) => a.id === id);
    state.activities.splice(idx + 1, 0, copy);
    saveState();
    return copy;
  }

  function addGearToActivity(activityId, gearId) {
    const a = state.activities.find((a) => a.id === activityId);
    if (!a) return;
    if (a.items.some((i) => i.gearId === gearId)) {
      toast('Already in this list.');
      return;
    }
    a.items.push({ gearId, packed: false, note: '', weatherTags: [], customFilterIds: [], quantity: 1 });
    saveState();
  }

  function setItemQuantity(activityId, gearId, qty) {
    const a = state.activities.find((x) => x.id === activityId);
    if (!a) return;
    const it = a.items.find((i) => i.gearId === gearId);
    if (!it) return;
    const n = Math.max(1, Math.floor(Number(qty) || 1));
    it.quantity = n;
    saveState();
    render();
  }

  function removeGearFromActivity(activityId, gearId) {
    const a = state.activities.find((a) => a.id === activityId);
    if (!a) return;
    a.items = a.items.filter((i) => i.gearId !== gearId);
    saveState();
    render();
  }

  function togglePacked(activityId, gearId) {
    const a = state.activities.find((a) => a.id === activityId);
    if (!a) return;
    const it = a.items.find((i) => i.gearId === gearId);
    if (!it) return;
    it.packed = !it.packed;
    saveState();
    render();
  }

  function resetChecklist(activityId) {
    const a = state.activities.find((a) => a.id === activityId);
    if (!a) return;
    a.items.forEach((i) => { i.packed = false; });
    saveState();
    render();
  }

  function toggleItemWeather(activityId, gearId, weather) {
    if (!WEATHER_IDS.includes(weather)) return;
    const a = state.activities.find((a) => a.id === activityId);
    if (!a) return;
    const it = a.items.find((i) => i.gearId === gearId);
    if (!it) return;
    if (!Array.isArray(it.weatherTags)) it.weatherTags = [];
    const idx = it.weatherTags.indexOf(weather);
    if (idx === -1) it.weatherTags.push(weather);
    else it.weatherTags.splice(idx, 1);
    saveState();
    render();
  }

  function toggleActivityWeather(activityId, weather) {
    if (!WEATHER_IDS.includes(weather)) return;
    const a = state.activities.find((a) => a.id === activityId);
    if (!a) return;
    if (!Array.isArray(a.activeWeathers)) a.activeWeathers = [];
    const idx = a.activeWeathers.indexOf(weather);
    if (idx === -1) a.activeWeathers.push(weather);
    else a.activeWeathers.splice(idx, 1);
    saveState();
    render();
  }

  // ---------- Custom filter mutations ----------
  function addCustomFilter(activityId, label) {
    const a = state.activities.find((x) => x.id === activityId);
    if (!a) return null;
    const clean = (label || '').trim();
    if (!clean) return null;
    if (!Array.isArray(a.customFilters)) a.customFilters = [];
    if (a.customFilters.some((f) => f.label.toLowerCase() === clean.toLowerCase())) {
      toast(`"${clean}" already exists.`, 'error');
      return null;
    }
    const filter = { id: uid(), label: clean };
    a.customFilters.push(filter);
    saveState();
    return filter;
  }

  function renameCustomFilter(activityId, filterId, label) {
    const a = state.activities.find((x) => x.id === activityId);
    if (!a) return;
    const f = (a.customFilters || []).find((x) => x.id === filterId);
    if (!f) return;
    const clean = (label || '').trim();
    if (!clean) return;
    f.label = clean;
    saveState();
  }

  function deleteCustomFilter(activityId, filterId) {
    const a = state.activities.find((x) => x.id === activityId);
    if (!a) return;
    a.customFilters = (a.customFilters || []).filter((f) => f.id !== filterId);
    a.activeCustomFilterIds = (a.activeCustomFilterIds || []).filter((id) => id !== filterId);
    for (const it of a.items) {
      if (Array.isArray(it.customFilterIds)) {
        it.customFilterIds = it.customFilterIds.filter((id) => id !== filterId);
      }
    }
    saveState();
  }

  function toggleActivityCustomFilter(activityId, filterId) {
    const a = state.activities.find((x) => x.id === activityId);
    if (!a) return;
    if (!Array.isArray(a.activeCustomFilterIds)) a.activeCustomFilterIds = [];
    const idx = a.activeCustomFilterIds.indexOf(filterId);
    if (idx === -1) a.activeCustomFilterIds.push(filterId);
    else a.activeCustomFilterIds.splice(idx, 1);
    saveState();
    render();
  }

  function toggleItemCustomFilter(activityId, gearId, filterId) {
    const a = state.activities.find((x) => x.id === activityId);
    if (!a) return;
    const it = a.items.find((i) => i.gearId === gearId);
    if (!it) return;
    if (!Array.isArray(it.customFilterIds)) it.customFilterIds = [];
    const idx = it.customFilterIds.indexOf(filterId);
    if (idx === -1) it.customFilterIds.push(filterId);
    else it.customFilterIds.splice(idx, 1);
    saveState();
    render();
  }

  function addCustomFilterPrompt(activityId) {
    const label = prompt('New sub-filter label (e.g. Trad, Sport, Bouldering):');
    if (label == null) return;
    const filter = addCustomFilter(activityId, label);
    if (filter) render();
  }

  function editCustomFilterPrompt(activityId, filterId) {
    const a = state.activities.find((x) => x.id === activityId);
    const f = a?.customFilters?.find((x) => x.id === filterId);
    if (!f) return;
    const next = prompt(
      `Rename this sub-filter, or leave blank to delete it.\n\nCurrent: "${f.label}"`,
      f.label,
    );
    if (next == null) return;
    const clean = next.trim();
    if (!clean) {
      if (!confirm(`Delete sub-filter "${f.label}"? Items tagged with it will become untagged (shown as equipment).`)) return;
      deleteCustomFilter(activityId, filterId);
    } else if (clean !== f.label) {
      renameCustomFilter(activityId, filterId, clean);
    }
    render();
  }

  function reorderActivityItems(activityId, fromGearId, toGearId, position) {
    const a = state.activities.find((a) => a.id === activityId);
    if (!a) return;
    const fromIdx = a.items.findIndex((i) => i.gearId === fromGearId);
    if (fromIdx === -1) return;
    const [moved] = a.items.splice(fromIdx, 1);
    let toIdx = a.items.findIndex((i) => i.gearId === toGearId);
    if (toIdx === -1) {
      a.items.push(moved);
    } else {
      if (position === 'below') toIdx += 1;
      a.items.splice(toIdx, 0, moved);
    }
    saveState();
    render();
  }

  // ---------- Gear Modal ----------
  function openAddGear() {
    editingGearId = null;
    lastFetchedHtml = null;
    currentScreenshot = null;
    $('#gear-modal-title').textContent = 'Add gear';
    $('#gear-delete-btn').classList.add('hidden');
    setGearForm({ url: '', name: '', brand: '', weightGrams: null, imageUrl: '', notes: '', color: null, availableColors: [], quantity: 1 });
    $('#fetch-status').textContent = '';
    resetScreenshotUI();
    updateAIButton();
    showModal('gear-modal');
    $('#screenshot-dropzone').focus();
  }

  function openEditGear(id) {
    const gear = state.gear.find((g) => g.id === id);
    if (!gear) return;
    editingGearId = id;
    lastFetchedHtml = null;
    currentScreenshot = null;
    $('#gear-modal-title').textContent = 'Edit gear';
    $('#gear-delete-btn').classList.remove('hidden');
    setGearForm({
      url: gear.url || '',
      name: gear.name || '',
      brand: gear.brand || '',
      weightGrams: gear.weightGrams,
      imageUrl: gear.imageUrl || '',
      notes: gear.notes || '',
      color: gear.color || null,
      availableColors: gear.availableColors || [],
      quantity: gear.quantity || 1,
    });
    $('#fetch-status').textContent = '';
    resetScreenshotUI();
    updateAIButton();
    showModal('gear-modal');
    $('#gear-name').focus();
  }

  function setGearForm(data) {
    $('#gear-url').value = data.url || '';
    $('#gear-name').value = data.name || '';
    $('#gear-brand').value = data.brand || '';
    $('#gear-image').value = data.imageUrl || '';
    $('#gear-notes').value = data.notes || '';
    $('#gear-color').value = data.color || '';
    $('#gear-quantity').value = Number.isFinite(data.quantity) && data.quantity >= 1 ? data.quantity : 1;
    const unit = state.settings.displayUnit;
    $('#gear-weight-unit').textContent = unit;
    const display = data.weightGrams != null ? gramsToUnit(data.weightGrams, unit) : null;
    $('#gear-weight').value = display != null ? +display.toFixed(unit === 'g' ? 0 : 2) : '';
    renderGearColorChips(data.availableColors || [], data.color || null);
    updateGearColorFindButton();
    updateGearPreview();
  }

  function renderGearColorChips(colors, selected) {
    const host = $('#gear-colors');
    if (!host) return;
    host.innerHTML = '';
    const deduped = Array.from(new Set((colors || []).map((c) => (c || '').trim()).filter(Boolean)));
    for (const c of deduped) {
      const active = selected && c.toLowerCase() === selected.toLowerCase();
      const chip = h('button', {
        class: 'color-chip' + (active ? ' active' : ''),
        type: 'button',
        'aria-pressed': active ? 'true' : 'false',
        onclick: () => selectGearColor(c),
      },
        h('span', { class: 'color-swatch', style: `background:${cssColorFor(c)}` }),
        h('span', {}, c),
      );
      host.appendChild(chip);
    }
  }

  function selectGearColor(colorName) {
    $('#gear-color').value = colorName || '';
    // Re-render chips so the newly-picked one gets the active class.
    const colors = currentAvailableColors();
    renderGearColorChips(colors, colorName);
    updateGearColorFindButton();
  }

  function currentAvailableColors() {
    const host = $('#gear-colors');
    return Array.from(host.querySelectorAll('.color-chip span:last-child'))
      .map((el) => el.textContent.trim())
      .filter(Boolean);
  }

  function updateGearColorFindButton() {
    const btn = $('#gear-color-find-btn');
    if (!btn) return;
    const hasKey = !!state.settings.anthropicApiKey;
    const hasColor = !!$('#gear-color').value.trim();
    const hasName = !!$('#gear-name').value.trim();
    btn.disabled = !(hasKey && hasColor && hasName);
    btn.title = !hasKey
      ? 'Add your Anthropic API key in Settings first'
      : !hasName ? 'Enter the product name first'
      : !hasColor ? 'Pick or type a color first'
      : 'Search the web for an image in this color';
  }

  // Best-effort CSS color from a marketing name (for the swatch dot).
  // Extracts any recognizable CSS color word; falls back to a neutral grey.
  function cssColorFor(name) {
    const n = (name || '').toLowerCase();
    const dict = {
      black: '#111', white: '#f5f5f5', grey: '#888', gray: '#888',
      silver: '#c0c0c0', slate: '#6c7a8a', charcoal: '#36454f',
      red: '#d33', crimson: '#b11030', tomato: '#ff6347', burgundy: '#6b1028', wine: '#722f37',
      orange: '#e77a1c', rust: '#b7410e', coral: '#ff7f50', amber: '#ffbf00',
      yellow: '#e6c200', mustard: '#c9a227', gold: '#d4af37',
      green: '#2a8a3e', olive: '#708238', forest: '#228b22', lime: '#a3d62a', kiwi: '#8ee53f', sage: '#9caf88', teal: '#1f8a8a', mint: '#a8e6cf',
      blue: '#1e66d0', navy: '#1b2a4e', azure: '#2378d6', cobalt: '#1c39bb', denim: '#4a6fa5', sky: '#87ceeb',
      purple: '#6a3ba7', violet: '#7a3cb8', plum: '#8e4585', lilac: '#c8a2c8',
      pink: '#e87fa1', rose: '#d35d6e', magenta: '#c2185b', fuchsia: '#c2185b',
      brown: '#6f4e37', tan: '#c19a6b', beige: '#d9c8a9', khaki: '#b2ac6e', sand: '#c2b280', earth: '#9c7c4d', camel: '#c19a6b',
    };
    for (const key of Object.keys(dict)) {
      if (n.includes(key)) return dict[key];
    }
    return '#c8c8c8';
  }

  function readGearForm() {
    const unit = state.settings.displayUnit;
    const weightVal = parseFloat($('#gear-weight').value);
    const qtyVal = parseInt($('#gear-quantity').value, 10);
    return {
      url: $('#gear-url').value.trim() || null,
      name: $('#gear-name').value.trim(),
      brand: $('#gear-brand').value.trim() || null,
      imageUrl: $('#gear-image').value.trim() || null,
      notes: $('#gear-notes').value.trim(),
      weightGrams: isNaN(weightVal) ? null : unitToGrams(weightVal, unit),
      color: $('#gear-color').value.trim() || null,
      availableColors: currentAvailableColors(),
      quantity: Number.isFinite(qtyVal) && qtyVal >= 1 ? qtyVal : 1,
    };
  }

  function updateGearPreview() {
    const url = $('#gear-image').value.trim();
    const img = $('#gear-preview-img');
    const meta = $('#gear-preview-meta');
    const removeBtn = $('#gear-preview-img-remove');
    if (url) {
      img.src = url;
      img.style.display = '';
      if (removeBtn) removeBtn.classList.remove('hidden');
      // Retry through the weserv proxy on first error (hotlink / CORS blocks)
      img.onerror = () => {
        if (img.dataset.retried || url.startsWith('https://images.weserv.nl/') || url.startsWith('data:')) {
          img.removeAttribute('src');
          img.style.display = 'none';
          return;
        }
        img.dataset.retried = '1';
        img.src = 'https://images.weserv.nl/?url=' + encodeURIComponent(url.replace(/^https?:\/\//, ''));
      };
      img.dataset.retried = '';
    } else {
      img.removeAttribute('src');
      img.style.display = 'none';
      img.onerror = null;
      img.dataset.retried = '';
      if (removeBtn) removeBtn.classList.add('hidden');
    }
    const name = $('#gear-name').value.trim();
    const brand = $('#gear-brand').value.trim();
    const weight = $('#gear-weight').value;
    const unit = state.settings.displayUnit;
    meta.textContent = [name, brand, weight ? `${weight} ${unit}` : null].filter(Boolean).join(' • ')
      || 'Preview will appear here once fields are filled.';
  }

  function updateAIButton() {
    const btn = $('#improve-ai-btn');
    if (state.settings.anthropicApiKey) {
      btn.classList.remove('hidden');
      btn.disabled = !$('#gear-url').value.trim();
      btn.title = btn.disabled ? 'Paste a URL first' : 'Re-run extraction with Claude';
    } else {
      btn.classList.remove('hidden');
      btn.disabled = false;
      btn.title = 'Add your Anthropic API key in Settings to enable';
    }
  }

  async function handleFetchDetails() {
    const url = $('#gear-url').value.trim();
    if (!url) {
      toast('Paste a product URL first.', 'error');
      return;
    }
    const btn = $('#fetch-details-btn');
    const status = $('#fetch-status');
    btn.disabled = true;
    status.textContent = 'Fetching…';
    try {
      const { data, html } = await scrapeUrl(url);
      lastFetchedHtml = html;
      // Merge: keep user-entered fields that are already non-empty
      mergeIntoForm(data);
      const missing = [];
      if (data.weightGrams == null) missing.push('weight');
      if (!data.name) missing.push('name');
      status.textContent = missing.length
        ? `Fetched. Missing: ${missing.join(', ')}. Review below or try AI.`
        : 'Fetched. Review and save.';
    } catch (err) {
      console.error(err);
      status.textContent = `Couldn't fetch: ${err.message}. Enter details manually or try AI.`;
    } finally {
      btn.disabled = false;
      updateAIButton();
    }
  }

  function mergeIntoForm(data) {
    const cur = readGearForm();
    const mergedColors = mergeColorLists(cur.availableColors, data.availableColors);
    const merged = {
      url: cur.url || data.url || $('#gear-url').value.trim() || null,
      name: cur.name || data.name || '',
      brand: cur.brand || data.brand || null,
      imageUrl: cur.imageUrl || data.imageUrl || null,
      notes: cur.notes || data.description || '',
      weightGrams: cur.weightGrams ?? data.weightGrams ?? null,
      color: cur.color || data.selectedColor || null,
      availableColors: mergedColors,
    };
    setGearForm(merged);
  }

  function mergeColorLists(a, b) {
    const seen = new Set();
    const out = [];
    for (const c of [...(a || []), ...(b || [])]) {
      const v = (c || '').trim();
      if (!v) continue;
      const key = v.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
    return out;
  }

  async function handleImproveWithAI() {
    if (!state.settings.anthropicApiKey) {
      toast('Add your Anthropic API key in Settings first.', 'error');
      showModal('settings-modal');
      populateSettings();
      return;
    }
    const url = $('#gear-url').value.trim();
    if (!url) {
      toast('Paste a product URL first.', 'error');
      return;
    }
    const btn = $('#improve-ai-btn');
    const status = $('#fetch-status');
    btn.disabled = true;
    status.textContent = '✨ Asking Claude…';
    try {
      const data = await enhanceWithClaude(url, lastFetchedHtml, readGearForm());
      // AI takes priority over prior values
      const merged = {
        url: url,
        name: data.name || $('#gear-name').value,
        brand: data.brand || $('#gear-brand').value || null,
        imageUrl: data.imageUrl || $('#gear-image').value || null,
        notes: data.description || $('#gear-notes').value,
        weightGrams: data.weightGrams ?? readGearForm().weightGrams,
      };
      setGearForm(merged);
      status.textContent = '✨ Updated by Claude.';
    } catch (err) {
      console.error(err);
      status.textContent = `AI call failed: ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  }

  function handleSaveGear() {
    const data = readGearForm();
    if (!data.name) {
      toast('Name is required.', 'error');
      $('#gear-name').focus();
      return;
    }
    let savedId;
    if (editingGearId) {
      updateGear(editingGearId, data);
      savedId = editingGearId;
    } else {
      const created = addGear(data);
      savedId = created.id;
    }
    // If an image lookup is still running, remember the record id so the
    // resolved imageUrl can be patched in once it completes.
    if (activeImagePipeline && !activeImagePipeline.done && !data.imageUrl) {
      activeImagePipeline.savedGearId = savedId;
    }
    hideModal('gear-modal');
    render();
  }

  function handleDeleteGear() {
    if (!editingGearId) return;
    const gear = state.gear.find((g) => g.id === editingGearId);
    if (!gear) return;
    const usedIn = state.activities.filter((a) => a.items.some((i) => i.gearId === gear.id));
    const msg = usedIn.length
      ? `Delete "${gear.name}"? It will also be removed from: ${usedIn.map(a => a.name).join(', ')}.`
      : `Delete "${gear.name}"?`;
    if (!confirm(msg)) return;
    deleteGear(editingGearId);
    hideModal('gear-modal');
    render();
  }

  // ---------- Settings Modal ----------
  function populateSettings() {
    $('#setting-unit').value = state.settings.displayUnit;
    $('#setting-api-key').value = state.settings.anthropicApiKey || '';
  }

  function handleSaveSettings() {
    state.settings.displayUnit = $('#setting-unit').value;
    const key = $('#setting-api-key').value.trim();
    state.settings.anthropicApiKey = key || null;
    saveState();
    hideModal('settings-modal');
    render();
  }

  function handleResetAll() {
    if (!confirm('Erase ALL gear, activities, and settings? This cannot be undone.')) return;
    localStorage.removeItem(STORAGE_KEY);
    state = emptyState();
    activeActivityId = state.activities[0]?.id || null;
    hideModal('settings-modal');
    render();
    toast('All data erased.');
  }

  // ---------- Activity Modal ----------
  function openNewActivity() {
    editingActivityId = null;
    $('#activity-modal-title').textContent = 'New activity';
    $('#activity-delete-btn').classList.add('hidden');
    $('#activity-duplicate-btn').classList.add('hidden');
    $('#activity-emoji').value = '';
    $('#activity-name').value = '';
    showModal('activity-modal');
    $('#activity-name').focus();
  }

  function openEditActivity(id) {
    const a = state.activities.find((a) => a.id === id);
    if (!a) return;
    editingActivityId = id;
    $('#activity-modal-title').textContent = 'Edit activity';
    $('#activity-delete-btn').classList.remove('hidden');
    $('#activity-duplicate-btn').classList.remove('hidden');
    $('#activity-emoji').value = a.emoji || '';
    $('#activity-name').value = a.name || '';
    showModal('activity-modal');
    $('#activity-name').focus();
  }

  function handleSaveActivity() {
    const name = $('#activity-name').value.trim();
    const emoji = $('#activity-emoji').value.trim() || null;
    if (!name) { toast('Name is required.', 'error'); return; }
    if (editingActivityId) {
      updateActivity(editingActivityId, { name, emoji });
    } else {
      const a = addActivity({ name, emoji });
      activeActivityId = a.id;
    }
    hideModal('activity-modal');
    render();
  }

  function handleDeleteActivity() {
    if (!editingActivityId) return;
    const a = state.activities.find((a) => a.id === editingActivityId);
    if (!a) return;
    if (!confirm(`Delete activity "${a.name}"? Gear in the library is kept.`)) return;
    deleteActivity(editingActivityId);
    hideModal('activity-modal');
    render();
  }

  function handleDuplicateActivity() {
    if (!editingActivityId) return;
    const copy = duplicateActivity(editingActivityId);
    if (!copy) return;
    activeActivityId = copy.id;
    hideModal('activity-modal');
    render();
    toast(`Duplicated as "${copy.name}".`, 'success');
  }

  // ---------- Modal helpers ----------
  function showModal(id) { $('#' + id).classList.remove('hidden'); }
  function hideModal(id) { $('#' + id).classList.add('hidden'); }

  // ---------- URL scraping ----------
  async function scrapeUrl(url) {
    let html, lastErr;
    for (const makeProxy of CORS_PROXIES) {
      try {
        const res = await fetch(makeProxy(url), { method: 'GET' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        html = await res.text();
        if (html && html.length > 200) break;
      } catch (err) { lastErr = err; }
    }
    if (!html) throw new Error(`All proxies failed${lastErr ? ': ' + lastErr.message : ''}`);
    const data = extractFromHtml(html, url);
    return { data, html };
  }

  function extractFromHtml(html, sourceUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const meta = (sel) => {
      const el = doc.querySelector(sel);
      return el?.getAttribute('content')?.trim() || null;
    };

    const og = {
      title: meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]') || doc.querySelector('title')?.textContent?.trim() || null,
      image: meta('meta[property="og:image"]')
        || meta('meta[property="og:image:secure_url"]')
        || meta('meta[property="og:image:url"]')
        || meta('meta[name="twitter:image"]')
        || meta('meta[name="twitter:image:src"]')
        || meta('meta[property="product:image"]')
        || meta('meta[itemprop="image"]')
        || doc.querySelector('link[rel="image_src"]')?.getAttribute('href')
        || null,
      description: meta('meta[property="og:description"]') || meta('meta[name="description"]') || null,
      siteName: meta('meta[property="og:site_name"]') || null,
    };

    // JSON-LD — often the most reliable source for weight/brand
    const jsonLd = extractJsonLd(doc);

    // Weight: prefer JSON-LD, fall back to regex search on body text
    let weightGrams = jsonLd.weightGrams;
    if (weightGrams == null) {
      weightGrams = findWeightInText(doc.body?.innerText || doc.body?.textContent || '');
    }

    // Name
    let name = jsonLd.name || og.title;
    if (name) {
      // Strip trailing " | Retailer" or " - Brand" style suffixes for cleaner display
      name = name.replace(/\s*[|–—-]\s*[^|–—-]{2,40}$/, '').trim();
    }

    // Brand heuristic: JSON-LD brand > og:site_name > host
    let brand = jsonLd.brand || og.siteName;
    if (!brand && sourceUrl) brand = escapeHost(sourceUrl);

    // Build a list of image candidates (largest wins later)
    const imageCandidates = [];
    const push = (u) => { if (u && !imageCandidates.includes(u)) imageCandidates.push(u); };
    push(jsonLd.image);
    push(og.image);
    // Any preload hints for product images
    doc.querySelectorAll('link[rel="preload"][as="image"]').forEach((el) => push(el.getAttribute('href')));
    // Largest <img> on the page that isn't obviously a logo/icon
    const imgEls = Array.from(doc.querySelectorAll('img'))
      .map((el) => {
        const src = el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('data-original') || '';
        const srcset = el.getAttribute('srcset') || '';
        const fromSrcset = srcset.split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).pop();
        const w = parseInt(el.getAttribute('width') || '0', 10);
        const h = parseInt(el.getAttribute('height') || '0', 10);
        const alt = (el.getAttribute('alt') || '').toLowerCase();
        const classy = (el.className || '').toLowerCase();
        return { src: fromSrcset || src, w, h, alt, classy };
      })
      .filter((i) => i.src && !/^data:/.test(i.src))
      .filter((i) => !/(logo|icon|sprite|avatar|favicon|flag|badge|spinner)/.test(i.alt + ' ' + i.classy));
    // Prefer ones that appear large via width/height hints, else keep page order
    imgEls.sort((a, b) => (b.w * b.h) - (a.w * a.h));
    imgEls.slice(0, 5).forEach((i) => push(i.src));

    // Resolve relative URLs + drop invalid ones
    const resolved = imageCandidates
      .map((u) => {
        if (!u) return null;
        if (u.startsWith('//')) return 'https:' + u;
        if (/^https?:\/\//i.test(u)) return u;
        try { return new URL(u, sourceUrl).toString(); } catch { return null; }
      })
      .filter(Boolean);

    return {
      name: name || null,
      brand,
      imageUrl: resolved[0] || null,      // primary (backcompat)
      imageUrls: resolved,                 // ordered candidates
      weightGrams,
      description: og.description || null,
      url: sourceUrl,
    };
  }

  function extractJsonLd(doc) {
    const out = { name: null, brand: null, image: null, weightGrams: null };
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      let json;
      try { json = JSON.parse(s.textContent); }
      catch { continue; }
      const candidates = Array.isArray(json) ? json : [json];
      for (const obj of candidates) {
        walkJsonLd(obj, out);
        if (obj['@graph']) {
          for (const g of obj['@graph']) walkJsonLd(g, out);
        }
      }
    }
    return out;
  }

  function walkJsonLd(obj, out) {
    if (!obj || typeof obj !== 'object') return;
    const type = obj['@type'];
    const isProduct = type === 'Product' || (Array.isArray(type) && type.includes('Product'));
    if (isProduct) {
      if (!out.name && typeof obj.name === 'string') out.name = obj.name;
      if (!out.image) {
        if (typeof obj.image === 'string') out.image = obj.image;
        else if (Array.isArray(obj.image) && obj.image.length) out.image = obj.image[0];
        else if (obj.image?.url) out.image = obj.image.url;
      }
      if (!out.brand) {
        if (typeof obj.brand === 'string') out.brand = obj.brand;
        else if (obj.brand?.name) out.brand = obj.brand.name;
      }
      if (out.weightGrams == null && obj.weight) {
        const w = obj.weight;
        if (typeof w === 'object' && w.value && w.unitCode) {
          out.weightGrams = normalizeWeight(parseFloat(w.value), w.unitCode);
        } else if (typeof w === 'object' && w.value && w.unitText) {
          out.weightGrams = normalizeWeight(parseFloat(w.value), w.unitText);
        } else if (typeof w === 'string') {
          out.weightGrams = findWeightInText(w);
        }
      }
    }
  }

  // Match Schema.org / UN/CEFACT unit codes
  function normalizeWeight(value, unit) {
    if (isNaN(value)) return null;
    const u = String(unit).toLowerCase();
    if (['grm', 'g', 'gram', 'grams'].includes(u)) return value;
    if (['kgm', 'kg', 'kilogram', 'kilograms'].includes(u)) return value * 1000;
    if (['ozm', 'oz', 'ounce', 'ounces'].includes(u)) return value * 28.3495;
    if (['lbr', 'lb', 'lbs', 'pound', 'pounds'].includes(u)) return value * 453.592;
    return null;
  }

  // Scan text for weight-like patterns; score proximity to the word "weight"
  function findWeightInText(text) {
    if (!text) return null;
    const weightRe = /(\d+(?:[.,]\d+)?)\s*(kg|kilograms?|g|gr|grams?|oz|ounces?|lbs?|pounds?)\b/gi;
    const keywordRe = /\b(weight|mass|peso|gewicht|masse|poids)\b/gi;
    const keywordPositions = [];
    let km;
    while ((km = keywordRe.exec(text)) !== null) keywordPositions.push(km.index);

    let best = null, bestScore = -Infinity;
    let m;
    while ((m = weightRe.exec(text)) !== null) {
      const value = parseFloat(m[1].replace(',', '.'));
      const unit = m[2].toLowerCase();
      const grams = normalizeWeight(value, unit);
      if (grams == null) continue;
      // Plausibility: 1g..50kg for a piece of outdoor gear
      if (grams < 1 || grams > 50_000) continue;
      // Score: +10 if a weight keyword is within 80 chars
      let score = 0;
      const pos = m.index;
      const near = keywordPositions.some((kp) => Math.abs(kp - pos) < 80);
      if (near) score += 10;
      // Prefer metric listings (more often the canonical spec for gear)
      if (['g', 'grams', 'gram', 'kg', 'kilograms', 'kilogram'].includes(unit)) score += 2;
      if (score > bestScore) { bestScore = score; best = grams; }
    }
    // If nothing scored above zero, still accept the single best plausible match
    return best;
  }

  // ---------- Screenshot drop & vision ----------
  function resetScreenshotUI() {
    currentScreenshot = null;
    if (activeImagePipeline && !activeImagePipeline.done) {
      activeImagePipeline.cancelled = true;
      activeImagePipeline = null;
    }
    setScreenshotState('idle');
    const img = $('#screenshot-preview');
    img.removeAttribute('src');
    $('#screenshot-status').textContent = 'Analyzing screenshot…';
    const hint = $('#screenshot-preview-status');
    if (hint) { hint.textContent = ''; hint.classList.add('hidden'); }
  }

  function setScreenshotState(which) {
    // which: 'idle' | 'preview' | 'loading'
    $('.dropzone-idle', $('#screenshot-dropzone')).classList.toggle('hidden', which !== 'idle');
    $('.dropzone-preview', $('#screenshot-dropzone')).classList.toggle('hidden', which !== 'preview');
    $('.dropzone-loading', $('#screenshot-dropzone')).classList.toggle('hidden', which !== 'loading');
  }

  async function handleScreenshotFile(file) {
    if (!file || !file.type?.startsWith('image/')) {
      toast('That is not an image.', 'error');
      return;
    }
    if (!state.settings.anthropicApiKey) {
      toast('Add your Anthropic API key in Settings to use screenshot analysis.', 'error');
      showModal('settings-modal');
      populateSettings();
      return;
    }
    try {
      const resized = await resizeImage(file, 1568);
      currentScreenshot = {
        base64: resized.base64,
        mediaType: resized.mediaType,
        dataUrl: resized.dataUrl,
      };
      // Preview, then flip to loading
      $('#screenshot-preview').src = resized.dataUrl;
      setScreenshotState('loading');
      $('#screenshot-status').textContent = '👀 Reading the screenshot…';

      const vision = await extractFromScreenshot(currentScreenshot);

      // Apply vision results to form (don't overwrite user-entered fields)
      mergeIntoForm({
        name: vision.name,
        brand: vision.brand,
        imageUrl: null, // never use the screenshot; we'll fetch a clean one
        weightGrams: vision.weightGrams,
        description: vision.description,
        url: vision.url,
      });
      if (vision.url && !$('#gear-url').value) $('#gear-url').value = vision.url;

      // Enrich: look up clean image + any missing details via web search
      $('#screenshot-status').textContent = '🌐 Searching for product details…';
      let enrichment = null;
      try {
        enrichment = await enrichWithClaudeSearch({
          name: vision.name || $('#gear-name').value,
          brand: vision.brand || $('#gear-brand').value,
          hintedUrl: vision.url || $('#gear-url').value,
          knownWeightGrams: vision.weightGrams,
        });
        mergeEnrichmentIntoForm(enrichment);
      } catch (err) {
        console.warn('Web search enrichment failed:', err);
        toast(`Search failed: ${err.message}`, 'error');
      }

      // Flip to preview now so the user can review + save immediately.
      setScreenshotState('preview');
      toast('Screenshot processed — review and save. Image lookup continues in the background.', 'success');

      // Kick the image lookup off in the background. If the user clicks
      // Save before it resolves, handleSaveGear stashes the new gear id
      // into the pipeline so the image can be patched in post-save.
      if (!$('#gear-image').value) {
        const pipeline = { savedGearId: null, done: false, cancelled: false };
        activeImagePipeline = pipeline;
        runBackgroundImageLookup(pipeline, { enrichment });
      }
    } catch (err) {
      console.error(err);
      setScreenshotState('preview');
      toast(`Couldn't analyze screenshot: ${err.message}`, 'error');
    }
  }

  async function runBackgroundImageLookup(pipeline, { enrichment }) {
    const hint = $('#screenshot-preview-status');
    const showHint = (text) => {
      if (!hint) return;
      hint.classList.remove('hidden');
      hint.innerHTML = '';
      hint.appendChild(h('span', { class: 'spinner-sm' }));
      hint.appendChild(document.createTextNode(text));
    };
    const clearHint = () => { if (hint) { hint.textContent = ''; hint.classList.add('hidden'); } };

    showHint('Looking up a clean product image…');
    try {
      const candidates = [];
      if (enrichment?.officialUrl) candidates.push(enrichment.officialUrl);
      if (Array.isArray(enrichment?.retailerUrls)) candidates.push(...enrichment.retailerUrls);
      const hinted = $('#gear-url').value;
      if (hinted && !candidates.includes(hinted)) candidates.unshift(hinted);

      let found = await findProductImageFromUrls(candidates);
      if (pipeline.cancelled) return;
      if (!found) {
        const extra = await searchForProductPageUrls({
          name: enrichment?.name || $('#gear-name').value,
          brand: enrichment?.brand || $('#gear-brand').value,
        });
        if (pipeline.cancelled) return;
        if (extra.length) found = await findProductImageFromUrls(extra);
      }
      if (pipeline.cancelled) return;

      const modalOpen = !$('#gear-modal').classList.contains('hidden');
      if (found) {
        if (pipeline.savedGearId) {
          updateGear(pipeline.savedGearId, { imageUrl: found.imageUrl });
          render();
          toast(`Image added to saved gear (${escapeHost(found.sourceUrl) || 'web'}).`, 'success');
        } else if (modalOpen) {
          $('#gear-image').value = found.imageUrl;
          updateGearPreview();
          toast(`Image from ${escapeHost(found.sourceUrl) || 'web'}.`, 'success');
        }
        // else: user closed without saving — silently drop.
      } else if (modalOpen) {
        toast('Couldn\'t find a clean product image — paste one manually.', 'error');
      }
    } catch (err) {
      console.warn('Image lookup failed:', err);
    } finally {
      pipeline.done = true;
      if (activeImagePipeline === pipeline) activeImagePipeline = null;
      clearHint();
    }
  }

  // Downscale + JPEG-encode an image file for vision API
  async function resizeImage(file, maxDim) {
    const img = await fileToImage(file);
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h); // flatten transparency to white (saves bytes)
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const base64 = dataUrl.split(',')[1];
    return { dataUrl, base64, mediaType: 'image/jpeg', width: w, height: h };
  }

  function fileToImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not decode image'));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsDataURL(file);
    });
  }

  async function extractFromScreenshot({ base64, mediaType }) {
    const apiKey = state.settings.anthropicApiKey;
    if (!apiKey) throw new Error('No API key');

    const prompt = [
      'This is a screenshot of an outdoor gear product page.',
      'Extract as much product information as you can see in the image.',
      '',
      'Return ONLY a JSON object (no markdown fences, no prose). Use null when unknown:',
      '{',
      '  "name": string (concise product name, e.g. "Solution Harness"),',
      '  "brand": string|null (manufacturer, e.g. "Black Diamond"),',
      '  "weightGrams": number|null (convert from any shown unit to grams),',
      '  "description": string|null (1–2 short sentences of key details visible: material, features, size, color),',
      '  "availableColors": string[] (every color/variant name you can see the product offered in — from a color picker row, swatches, dropdown, or listed specs. Use the exact names shown, e.g. ["Black", "Slate", "Tomato Red"]. Empty array if none visible.),',
      '  "selectedColor": string|null (the color that appears selected/highlighted in the screenshot — must match one of availableColors),',
      '  "url": string|null (full product URL if visible anywhere in the screenshot — browser address bar, page text, QR, etc.)',
      '}',
      '',
      'Rules:',
      '- Prefer listed "product weight" over shipping weight.',
      '- For availableColors: list EVERY color variant you can see, not just the selected one.',
      '- Do NOT describe the screenshot itself; only extract the gear product data.',
    ].join('\n');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Vision API ${res.status}: ${text.slice(0, 200)}`);
    }
    const payload = await res.json();
    const text = collectText(payload).trim();
    return coerceGearJson(text);
  }

  async function enrichWithClaudeSearch({ name, brand, hintedUrl, knownWeightGrams }) {
    const apiKey = state.settings.anthropicApiKey;
    if (!apiKey) throw new Error('No API key');

    const productLabel = [brand, name].filter(Boolean).join(' ') || hintedUrl || 'this product';
    const prompt = [
      `Find authoritative product information for: ${productLabel}.`,
      hintedUrl ? `A hinted URL is: ${hintedUrl}` : '',
      '',
      'Using web search, locate the manufacturer\'s official product page AND up to 3 reputable retailer product pages (Backcountry, REI, Moosejaw, Outdoor Gear Exchange, Campsaver, Amazon, etc.).',
      'Return ONLY a JSON object (no markdown, no prose) with:',
      '{',
      '  "name": string (official product name),',
      '  "brand": string,',
      '  "weightGrams": number|null,',
      '  "officialUrl": string|null (manufacturer product page),',
      '  "retailerUrls": string[] (up to 3 retailer product page URLs),',
      '  "availableColors": string[] (all color/variant names the product is sold in — from the manufacturer\'s listing. Empty array if unknown.),',
      '  "description": string|null (1–2 short sentences: key features or materials)',
      '}',
      '',
      'Rules:',
      '- weightGrams must be a number in grams (convert from oz, lbs, kg as needed).',
      '- officialUrl and retailerUrls must be full product-detail page URLs (not search results, not category pages). We will fetch these pages to extract the product image.',
      '- Prefer URLs you actually encountered during search over guesses.',
      knownWeightGrams ? `- We already have a weight estimate of ~${Math.round(knownWeightGrams)}g from the screenshot; prefer the manufacturer\'s spec if you can confirm it.` : '',
    ].filter(Boolean).join('\n');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 2000,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      // Graceful fallback if web_search tool isn't available on this account
      if (/tool/i.test(text) || res.status === 400) {
        throw new Error('Web search tool unavailable on this API key');
      }
      throw new Error(`Search API ${res.status}: ${text.slice(0, 200)}`);
    }
    const payload = await res.json();
    const text = collectText(payload).trim();
    return coerceGearJson(text);
  }

  async function findImageForColor({ name, brand, color }) {
    const apiKey = state.settings.anthropicApiKey;
    if (!apiKey) throw new Error('No API key');
    if (!name || !color) throw new Error('Need product name and color');

    const label = [brand, name].filter(Boolean).join(' ');
    const prompt = [
      `Find a direct product image URL for: ${label} in color "${color}".`,
      '',
      'Using web search, locate the manufacturer\'s official page or a reputable retailer page that shows this exact color variant, and return the main product image URL.',
      '',
      'Return ONLY a JSON object (no prose, no markdown):',
      '{',
      '  "imageUrl": string (direct https URL to the product image in the requested color — .jpg/.jpeg/.png/.webp),',
      '  "sourceUrl": string|null (the product page where this image was found),',
      '  "matchedColor": string (the color label on the source page — must correspond to the requested color)',
      '}',
      '',
      'Rules:',
      '- imageUrl MUST point at the image file itself (ends in .jpg/.jpeg/.png/.webp, or a CDN path that serves one). Not a page URL.',
      '- The image MUST show the product in the requested color, not a different variant.',
      '- Prefer the manufacturer\'s site; fall back to Backcountry, REI, Moosejaw, Campsaver, Amazon.',
    ].join('\n');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1500,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Search ${res.status}: ${text.slice(0, 200)}`);
    }
    const payload = await res.json();
    const text = collectText(payload).trim();
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Model returned no JSON');
    let parsed;
    try { parsed = JSON.parse(match[0]); } catch { throw new Error('Bad JSON from model'); }
    const imageUrl = typeof parsed.imageUrl === 'string' ? parsed.imageUrl : null;
    if (!imageUrl) throw new Error('No imageUrl in response');
    return {
      imageUrl,
      sourceUrl: typeof parsed.sourceUrl === 'string' ? parsed.sourceUrl : null,
      matchedColor: typeof parsed.matchedColor === 'string' ? parsed.matchedColor : color,
    };
  }

  async function handleFindColorImage() {
    const color = $('#gear-color').value.trim();
    const name = $('#gear-name').value.trim();
    const brand = $('#gear-brand').value.trim();
    if (!color || !name) {
      toast('Enter a product name and pick a color first.', 'error');
      return;
    }
    if (!state.settings.anthropicApiKey) {
      toast('Add your Anthropic API key in Settings first.', 'error');
      showModal('settings-modal');
      populateSettings();
      return;
    }
    const btn = $('#gear-color-find-btn');
    const hint = $('#gear-color-hint');
    btn.disabled = true;
    hint.textContent = `Searching for a "${color}" image…`;
    try {
      const result = await findImageForColor({ name, brand, color });
      // Verify the image actually loads before accepting it
      let finalUrl = result.imageUrl;
      if (!(await imageLoads(finalUrl))) {
        const proxied = proxiedImageUrl(finalUrl);
        if (await imageLoads(proxied)) finalUrl = proxied;
        else throw new Error('Found URL did not load');
      }
      $('#gear-image').value = finalUrl;
      updateGearPreview();
      hint.textContent = result.sourceUrl
        ? `Updated from ${escapeHost(result.sourceUrl) || 'web'} (${result.matchedColor}).`
        : `Updated (${result.matchedColor}).`;
      toast('Image updated to match color.', 'success');
    } catch (err) {
      console.warn('Color image search failed:', err);
      hint.textContent = `Couldn't find a "${color}" image: ${err.message}.`;
      toast('No matching color image found.', 'error');
    } finally {
      updateGearColorFindButton();
    }
  }

  // ---------- Image lookup ----------
  // Route an image URL through a public proxy to sidestep hotlink protection
  // and serve with permissive CORS. images.weserv.nl caches aggressively.
  function proxiedImageUrl(url) {
    if (!url) return null;
    if (url.startsWith('https://images.weserv.nl/')) return url; // don't double-wrap
    const stripped = url.replace(/^https?:\/\//, '');
    return `https://images.weserv.nl/?url=${encodeURIComponent(stripped)}`;
  }

  // Given a list of product-page URLs, fetch each via our CORS proxy and extract
  // image candidates, then test-load each. Falls back to the weserv proxy if a
  // direct URL is blocked (hotlink / CORS). Returns { imageUrl, sourceUrl } or null.
  async function findProductImageFromUrls(urls) {
    const seen = new Set();
    for (const raw of urls || []) {
      if (!raw || typeof raw !== 'string') continue;
      const url = raw.trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      try {
        console.log('[pack] scraping page for image:', url);
        const { data } = await scrapeUrl(url);
        const candidates = (data.imageUrls && data.imageUrls.length)
          ? data.imageUrls
          : (data.imageUrl ? [data.imageUrl] : []);
        console.log('[pack] image candidates from', url, '→', candidates.length);
        for (const candidate of candidates) {
          // Try the raw URL first so we store the clean original when possible
          if (await imageLoads(candidate)) {
            console.log('[pack] ✓ direct load ok:', candidate);
            return { imageUrl: candidate, sourceUrl: url };
          }
          // Hotlink or CORS block? Try the proxy.
          const proxied = proxiedImageUrl(candidate);
          if (await imageLoads(proxied)) {
            console.log('[pack] ✓ proxied load ok:', candidate);
            return { imageUrl: proxied, sourceUrl: url };
          }
          console.log('[pack] ✗ failed both paths:', candidate);
        }
      } catch (err) {
        console.warn('[pack] scrape failed:', url, err?.message);
      }
    }
    return null;
  }

  // Verify an image URL actually loads (catches 404s, hotlink blocks, etc.)
  function imageLoads(url) {
    return new Promise((resolve) => {
      const img = new Image();
      let settled = false;
      const finish = (ok) => { if (!settled) { settled = true; resolve(ok); } };
      img.onload = () => finish(img.naturalWidth > 1 && img.naturalHeight > 1);
      img.onerror = () => finish(false);
      img.src = url;
      setTimeout(() => finish(false), 6000);
    });
  }

  // Last-resort image search: ask Claude (with web search) for page URLs only.
  async function searchForProductPageUrls({ name, brand }) {
    const apiKey = state.settings.anthropicApiKey;
    if (!apiKey) return [];
    const label = [brand, name].filter(Boolean).join(' ');
    if (!label) return [];

    const prompt = [
      `Search the web for the product: ${label}`,
      '',
      'Return ONLY a JSON array of up to 6 direct product-detail page URLs (manufacturer + retailers — Backcountry, REI, Moosejaw, Amazon, Campsaver, etc.).',
      'Each URL must be a specific product page (not a search result, not a category listing).',
      'Example response: ["https://...","https://..."]',
      'No prose. No markdown.',
    ].join('\n');

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 800,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) return [];
      const payload = await res.json();
      const text = collectText(payload).trim();
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (!match) return [];
      const arr = JSON.parse(match[0]);
      return Array.isArray(arr) ? arr.filter((u) => typeof u === 'string' && /^https?:\/\//.test(u)) : [];
    } catch {
      return [];
    }
  }

  function mergeEnrichmentIntoForm(data) {
    const cur = readGearForm();
    // Enrichment wins for fields we know are often unreliable from the screenshot
    const merged = {
      url: cur.url || data.officialUrl || null,
      name: data.name || cur.name || '',
      brand: data.brand || cur.brand || null,
      imageUrl: data.imageUrl || cur.imageUrl || null, // clean image from the web
      notes: cur.notes || data.description || '',
      weightGrams: data.weightGrams ?? cur.weightGrams ?? null,
      color: cur.color || data.selectedColor || null,
      availableColors: mergeColorLists(cur.availableColors, data.availableColors),
    };
    setGearForm(merged);
    // Validate the found image actually loads — if it 404s, the <img> onerror handler hides it
    const imgEl = $('#gear-preview-img');
    if (merged.imageUrl) {
      imgEl.onerror = () => {
        imgEl.removeAttribute('src');
        imgEl.style.display = 'none';
        toast('The found image URL didn\'t load — you can paste one manually.', 'error');
      };
    }
  }

  // Pull all text-type content blocks out of a messages response
  function collectText(payload) {
    if (!payload?.content) return '';
    return payload.content
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');
  }

  // Parse Claude's JSON response, tolerating markdown fences
  function coerceGearJson(text) {
    let cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    // If there's prose around a JSON object, grab the first {...} block
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) cleaned = match[0];
    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch { throw new Error('Model returned non-JSON'); }
    const colors = Array.isArray(parsed.availableColors)
      ? parsed.availableColors.filter((c) => typeof c === 'string' && c.trim()).map((c) => c.trim())
      : [];
    const selectedColor = typeof parsed.selectedColor === 'string' && parsed.selectedColor.trim()
      ? parsed.selectedColor.trim()
      : null;
    return {
      name: typeof parsed.name === 'string' ? parsed.name : null,
      brand: typeof parsed.brand === 'string' ? parsed.brand : null,
      weightGrams: typeof parsed.weightGrams === 'number' ? parsed.weightGrams : null,
      imageUrl: typeof parsed.imageUrl === 'string' ? parsed.imageUrl : null,
      officialUrl: typeof parsed.officialUrl === 'string' ? parsed.officialUrl : null,
      retailerUrls: Array.isArray(parsed.retailerUrls)
        ? parsed.retailerUrls.filter((u) => typeof u === 'string' && /^https?:\/\//.test(u))
        : [],
      url: typeof parsed.url === 'string' ? parsed.url : null,
      description: typeof parsed.description === 'string' ? parsed.description : null,
      availableColors: colors,
      selectedColor,
    };
  }

  function initScreenshotDropzone() {
    const dz = $('#screenshot-dropzone');
    const fileInput = $('#screenshot-file-input');

    dz.addEventListener('click', (e) => {
      // Don't reopen picker when interacting with inner controls
      if (e.target.closest('button')) return;
      fileInput.click();
    });
    dz.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) handleScreenshotFile(file);
      fileInput.value = ''; // allow re-selecting same file
    });

    dz.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.add('drag-over');
    });
    dz.addEventListener('dragleave', (e) => {
      e.stopPropagation();
      dz.classList.remove('drag-over');
    });
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.remove('drag-over');
      const file = e.dataTransfer.files?.[0];
      if (file) handleScreenshotFile(file);
    });

    $('#screenshot-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      resetScreenshotUI();
    });

    // Paste anywhere in the gear modal
    document.addEventListener('paste', (e) => {
      if ($('#gear-modal').classList.contains('hidden')) return;
      const items = e.clipboardData?.items || [];
      for (const it of items) {
        if (it.type && it.type.startsWith('image/')) {
          const file = it.getAsFile();
          if (file) {
            e.preventDefault();
            handleScreenshotFile(file);
            return;
          }
        }
      }
    });
  }

  // Global drag-and-drop: a file dragged anywhere on the page shows a
  // fullscreen prompt; dropping an image opens the Add Gear modal and
  // routes the file into the screenshot-analysis flow.
  function initGlobalScreenshotDrop() {
    const overlay = $('#global-drop-overlay');
    if (!overlay) return;

    // Chrome quirk: dragenter/leave counters on window get out of sync
    // because child elements with their own handlers (stopPropagation etc.)
    // break the pairing. Instead, show on dragover (fires continuously and
    // is idempotent) and hide on a debounced dragleave/drop/mouseout.
    let hideTimer = null;
    const scheduleHide = () => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => overlay.classList.remove('active'), 80);
    };
    const cancelHide = () => { clearTimeout(hideTimer); hideTimer = null; };

    // Detect external file drags. Internal gear drags don't include "Files".
    const hasFiles = (e) => {
      const dt = e.dataTransfer;
      if (!dt) return false;
      const types = dt.types;
      if (!types) return false;
      // DOMStringList in Chrome; use a loop to be safe.
      for (let i = 0; i < types.length; i++) {
        if (types[i] === 'Files') return true;
      }
      return false;
    };

    // If the gear modal is already open, the inner dropzone handles drops.
    // Stay out of the way to avoid double-processing the file.
    const modalOpen = () => !$('#gear-modal').classList.contains('hidden');

    // Use capture phase so we run before any child handlers that stopPropagation.
    window.addEventListener('dragenter', (e) => {
      if (modalOpen() || !hasFiles(e)) return;
      e.preventDefault();
      cancelHide();
      overlay.classList.add('active');
    }, true);

    window.addEventListener('dragover', (e) => {
      if (modalOpen() || !hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      cancelHide();
      overlay.classList.add('active');
    }, true);

    window.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return;
      // relatedTarget is null when the drag truly leaves the window.
      if (!e.relatedTarget) scheduleHide();
    }, true);

    window.addEventListener('drop', (e) => {
      if (modalOpen() || !hasFiles(e)) return;
      e.preventDefault();
      cancelHide();
      overlay.classList.remove('active');
      const file = Array.from(e.dataTransfer.files || []).find((f) => f.type?.startsWith('image/'));
      if (!file) {
        toast('Drop an image file to add gear.', 'error');
        return;
      }
      openAddGear();
      handleScreenshotFile(file);
    }, true);
  }

  // ---------- Claude API fallback ----------
  async function enhanceWithClaude(url, cachedHtml, currentGuess) {
    const apiKey = state.settings.anthropicApiKey;
    if (!apiKey) throw new Error('No API key set');

    // Truncate HTML to keep token use reasonable
    let htmlSnippet = cachedHtml;
    if (!htmlSnippet) {
      try {
        const { html } = await scrapeUrl(url);
        htmlSnippet = html;
      } catch {
        htmlSnippet = null; // Claude will try the URL from general knowledge / description
      }
    }
    if (htmlSnippet && htmlSnippet.length > 40000) {
      htmlSnippet = htmlSnippet.slice(0, 40000);
    }

    const prompt = [
      'You are extracting gear data from a product page for a packing-list app.',
      'Return ONLY a JSON object with these fields (use null when unknown):',
      '{"name": string, "brand": string|null, "weightGrams": number|null, "imageUrl": string|null, "description": string|null}',
      '',
      `URL: ${url}`,
      '',
      `Current best guess (may be wrong): ${JSON.stringify(currentGuess)}`,
      '',
      htmlSnippet ? `Page HTML (truncated):\n${htmlSnippet}` : '(HTML unavailable — infer from the URL and your knowledge if possible.)',
      '',
      'Rules:',
      '- Convert weight to grams as a number (no units in the value).',
      '- Prefer the listed product weight over shipping weight.',
      '- name should be concise (e.g. "Solution Harness" not the full retailer title).',
      '- Return only valid JSON, no markdown fences.',
    ].join('\n');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
    }
    const payload = await res.json();
    const text = payload?.content?.[0]?.text || '';
    // Strip fences if Claude ignored the instruction
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch (err) { throw new Error('Claude returned non-JSON'); }
    // Coerce types
    return {
      name: parsed.name || null,
      brand: parsed.brand || null,
      weightGrams: typeof parsed.weightGrams === 'number' ? parsed.weightGrams : null,
      imageUrl: parsed.imageUrl || null,
      description: parsed.description || null,
    };
  }

  // ---------- Drag & Drop ----------
  // Two kinds of drags:
  //   kind=gear        — from library; payload { gearId }
  //   kind=item        — within an activity list; payload { activityId, gearId }
  let dragState = null;

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
    $$('.drop-above, .drop-below').forEach((el) => {
      el.classList.remove('drop-above', 'drop-below');
    });
  }

  function handleTabDragOver(e) {
    if (!dragState || dragState.kind !== 'gear') return;
    e.preventDefault();
    e.currentTarget.classList.add('drop-target');
  }
  function handleTabDragLeave(e) {
    e.currentTarget.classList.remove('drop-target');
  }
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
    if (!dragState) return;
    if (dragState.kind !== 'gear') return;
    e.preventDefault();
    e.currentTarget.classList.add('drop-target');
  }
  function handleBodyDragLeave(e) {
    // Only clear when we actually leave the container
    if (e.target === e.currentTarget) {
      e.currentTarget.classList.remove('drop-target');
    }
  }
  function handleBodyDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drop-target');
    if (dragState?.kind === 'gear' && activeActivityId) {
      addGearToActivity(activeActivityId, dragState.gearId);
      render();
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
  function handleItemDragLeave(e) {
    e.currentTarget.classList.remove('drop-above', 'drop-below');
  }
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
      render();
    }
    e.stopPropagation();
  }

  function handleRemoveDropzone(e) {
    e.preventDefault();
    if (dragState?.kind === 'item') {
      removeGearFromActivity(dragState.activityId, dragState.gearId);
    }
  }

  // ---------- Event wiring ----------
  function wire() {
    // Header
    $('#add-gear-btn').addEventListener('click', openAddGear);
    $('#settings-btn').addEventListener('click', () => { populateSettings(); showModal('settings-modal'); });
    $('#unit-toggle').addEventListener('click', () => {
      const i = UNIT_CYCLE.indexOf(state.settings.displayUnit);
      state.settings.displayUnit = UNIT_CYCLE[(i + 1) % UNIT_CYCLE.length];
      saveState();
      render();
    });

    // Gear search
    $('#gear-search').addEventListener('input', (e) => {
      gearSearchQuery = e.target.value;
      renderLibrary();
    });

    // Library edit mode toggle
    $('#library-edit-toggle').addEventListener('click', () => {
      libraryEditMode = !libraryEditMode;
      renderLibrary();
    });

    // Activity footer
    $('#reset-checklist-btn').addEventListener('click', () => {
      if (!activeActivityId) return;
      const a = state.activities.find((a) => a.id === activeActivityId);
      if (!a || !a.items.length) return;
      if (!confirm(`Uncheck all ${a.items.length} items in "${a.name}"?`)) return;
      resetChecklist(activeActivityId);
      toast('Checklist reset.', 'success');
    });
    $('#edit-activity-btn').addEventListener('click', () => {
      if (activeActivityId) openEditActivity(activeActivityId);
    });

    // Gear modal
    $('#fetch-details-btn').addEventListener('click', handleFetchDetails);
    $('#improve-ai-btn').addEventListener('click', handleImproveWithAI);
    $('#gear-save-btn').addEventListener('click', handleSaveGear);
    $('#gear-delete-btn').addEventListener('click', handleDeleteGear);
    $('#gear-url').addEventListener('input', updateAIButton);
    ['gear-name', 'gear-brand', 'gear-weight', 'gear-image'].forEach((id) => {
      $('#' + id).addEventListener('input', updateGearPreview);
    });
    $('#gear-preview-img-remove').addEventListener('click', () => {
      $('#gear-image').value = '';
      updateGearPreview();
    });
    $('#gear-image-upload-btn').addEventListener('click', () => {
      $('#gear-image-file-input').click();
    });
    $('#gear-image-file-input').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        toast('Please choose an image file.');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        $('#gear-image').value = String(reader.result || '');
        updateGearPreview();
      };
      reader.onerror = () => toast('Could not read that file.');
      reader.readAsDataURL(file);
    });
    $('#gear-color-find-btn').addEventListener('click', handleFindColorImage);
    $('#gear-color').addEventListener('input', () => {
      renderGearColorChips(currentAvailableColors(), $('#gear-color').value.trim());
      updateGearColorFindButton();
    });
    $('#gear-name').addEventListener('input', updateGearColorFindButton);

    // Settings modal
    $('#settings-save-btn').addEventListener('click', handleSaveSettings);
    $('#reset-all-btn').addEventListener('click', handleResetAll);

    // Activity modal
    $('#activity-save-btn').addEventListener('click', handleSaveActivity);
    $('#activity-delete-btn').addEventListener('click', handleDeleteActivity);
    $('#activity-duplicate-btn').addEventListener('click', handleDuplicateActivity);

    // Modal close buttons / backdrops
    $$('[data-close]').forEach((el) => {
      el.addEventListener('click', () => hideModal(el.dataset.close));
    });
    // Esc to close topmost modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        $$('.modal:not(.hidden)').forEach((m) => m.classList.add('hidden'));
      }
    });

    // Screenshot drop zone in add-gear modal
    initScreenshotDropzone();

    // Global drop-anywhere for screenshots → opens Add Gear flow
    initGlobalScreenshotDrop();

    // Drop zones on activity body and tab strip
    $('#activity-body').addEventListener('dragover', handleBodyDragOver);
    $('#activity-body').addEventListener('dragleave', handleBodyDragLeave);
    $('#activity-body').addEventListener('drop', handleBodyDrop);
    // Library side: accept drops to clear from the remove dropzone? No — library can't be dropped to.

    // Remove dropzone
    const rz = $('#remove-dropzone');
    rz.addEventListener('dragover', (e) => { e.preventDefault(); rz.classList.add('active'); });
    rz.addEventListener('dragleave', () => rz.classList.remove('active'));
    rz.addEventListener('drop', (e) => { rz.classList.remove('active'); handleRemoveDropzone(e); });
  }

  // ---------- Init ----------
  wire();
  render();
  // Expose for debugging in the console
  window.Pack = { state, render, save: saveState };
})();
