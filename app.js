import {
  filterPins, sortPins, mergePins, withinWindow, areasFor, deptsFor, postedLabel, parseHash, buildHash, activeFilterCount, savedToCsv, STATUSES, MAX_AGE_DAYS,
} from './filter.js';
import { loadSaved, persistSaved } from './store.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid);
  return n;
};

const isMobile = () => matchMedia('(max-width: 800px)').matches;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const key = (p) => `${p.company}|${p.city}|${p.area || ''}`;

const state = { data: null, saved: {}, tab: 'companies', selected: null, map: null, layer: null, storageOk: true, ...parseHash(location.hash) };

/* ---------- boot ---------- */
async function boot() {
  state.saved = loadSaved();
  try {
    const res = await fetch('data/jobs.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
    state.data.pins = withinWindow(mergePins(state.data.pins));
  } catch (e) {
    $('panel').replaceChildren(
      el('div', { class: 'empty-side' },
        el('h2', { text: 'Could not load the job data' }),
        el('p', { text: `The file data/jobs.json failed to load (${e.message}). Reload the page, or check that the site is deployed with its data folder.` }))
    );
    return;
  }
  setupMap();

  for (const id of ['q', 'area', 'dept', 'sort', 'fresh']) {
    $(id).addEventListener('input', () => { readInputs(); state.selected = null; replaceHash(); render(); });
  }
  $('clear').addEventListener('click', () => {
    Object.assign(state, { area: '', dept: '', fresh: false, sort: 'roles' });
    syncInputs(); state.selected = null; replaceHash(); render();
  });
  $('filterBtn').addEventListener('click', () => toggleFilters());
  $('filterDone').addEventListener('click', () => { toggleFilters(false); $('panel').scrollTop = 0; $('filterBtn').focus(); });
  $('tabCompanies').addEventListener('click', () => setTab('companies'));
  $('tabSaved').addEventListener('click', () => setTab('saved'));
  for (const b of document.querySelectorAll('.viewbar button')) b.addEventListener('click', () => setView(b.dataset.view));
  addEventListener('hashchange', route);
  route();
}

function setupMap() {
  if (!window.L) {
    $('mapnote').hidden = false;
    $('mapnote').textContent = 'The map library did not load, so only the list is available. Check your connection and reload.';
    return;
  }
  state.map = L.map('map', { zoomControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(state.map);
  state.layer = L.layerGroup().addTo(state.map);
  state.map.on('click', () => { if (state.selected) { state.selected = null; render(); } });
}

/* ---------- state <-> url <-> inputs ---------- */
function route() {
  const prevCity = state.cityShown;
  Object.assign(state, parseHash(location.hash));
  state.selected = null;
  state.tab = 'companies';
  document.documentElement.dataset.city = state.city;
  for (const a of document.querySelectorAll('.cities a')) {
    if (a.dataset.city === state.city) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  fillSelects();
  syncInputs();
  document.body.dataset.view = state.view;
  for (const b of document.querySelectorAll('.viewbar button')) b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
  if (state.map && prevCity !== state.city) {
    const c = state.data.cities[state.city];
    state.map.setView(c.center, c.zoom, { animate: false });
  }
  state.cityShown = state.city;
  render();
  if (state.map) setTimeout(() => state.map.invalidateSize(), 0);
}

function readInputs() {
  state.q = $('q').value;
  state.area = $('area').value;
  state.dept = $('dept').value;
  state.sort = $('sort').value;
  state.fresh = $('fresh').checked;
}

function syncInputs() {
  $('q').value = state.q;
  $('area').value = state.area;
  $('dept').value = state.dept;
  $('sort').value = state.sort;
  $('fresh').checked = state.fresh;
}

function replaceHash() {
  history.replaceState(null, '', buildHash(state));
}

function fillSelects() {
  const { pins, watch } = state.data;
  const opts = (first, list) => [el('option', { value: '', text: first }), ...list.map((v) => el('option', { value: v, text: v }))];
  const areas = areasFor(pins, watch, state.city);
  const depts = deptsFor(pins, state.city);
  $('area').replaceChildren(...opts('All areas', areas));
  $('dept').replaceChildren(...opts('All teams', depts));
  if (!areas.includes(state.area)) state.area = '';
  if (!depts.includes(state.dept)) state.dept = '';
}

function toggleFilters(force) {
  const open = force ?? !$('filters').hasAttribute('data-open');
  $('filters').toggleAttribute('data-open', open);
  $('filterBtn').setAttribute('aria-expanded', String(open));
}

function setTab(tab) {
  state.tab = tab;
  state.selected = null;
  render();
}

function setView(view) {
  state.view = view;
  document.body.dataset.view = view;
  for (const b of document.querySelectorAll('.viewbar button')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  replaceHash();
  if (view === 'map' && state.map) {
    state.map.invalidateSize();
    const sel = state.selected && currentShown().find((p) => key(p) === state.selected);
    if (sel) state.map.setView([sel.lat, sel.lng], Math.max(state.map.getZoom(), 14), { animate: false });
  }
  render();
}

/* ---------- render ---------- */
const currentShown = () =>
  sortPins(filterPins(state.data.pins, { city: state.city, q: state.q, area: state.area, dept: state.dept, freshers: state.fresh }), state.sort);

function render() {
  const { pins, watch, generatedAt, cities } = state.data;
  const shown = currentShown();
  const roles = shown.reduce((n, p) => n + p.jobs.length, 0);
  const label = cities[state.city].label;

  $('stamp').textContent = generatedAt
    ? `Roles checked ${new Date(generatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`
    : 'No live roles loaded yet';

  const nFilters = activeFilterCount(state);
  $('filterCount').textContent = nFilters ? String(nFilters) : '';
  $('clear').hidden = nFilters === 0;
  const savedN = Object.keys(state.saved).length;
  $('savedCount').textContent = savedN ? `(${savedN})` : '';
  $('tabCompanies').setAttribute('aria-pressed', String(state.tab === 'companies'));
  $('tabSaved').setAttribute('aria-pressed', String(state.tab === 'saved'));

  const watchShown = watch.filter(
    (w) => w.city === state.city && (!state.area || w.area === state.area) && !state.fresh && !state.dept && (!state.q || w.name.toLowerCase().includes(state.q.trim().toLowerCase()))
  );
  drawMarkers(shown, watchShown);

  if (state.tab === 'saved') {
    $('count').textContent = savedN ? `${savedN} saved ${savedN === 1 ? 'role' : 'roles'}` : 'No saved roles yet';
    renderSaved(pins);
    renderSheet(shown);
    return;
  }

  $('count').textContent = roles
    ? `${roles} ${roles === 1 ? 'role' : 'roles'} from the last ${MAX_AGE_DAYS} days at ${shown.length} ${shown.length === 1 ? 'company' : 'companies'} in ${label}`
    : `No open roles match in ${label}`;

  if (state.selected) {
    const p = shown.find((x) => key(x) === state.selected);
    if (p) { renderDetail(p); renderSheet(shown); return; }
    state.selected = null;
  }
  renderList(shown, watchShown);
  renderSheet(shown);
}

function renderList(shown, watchShown) {
  const kids = [];
  if (!shown.length) {
    kids.push(
      !state.data.generatedAt
        ? el('div', { class: 'empty-side' },
            el('h2', { text: 'No live roles yet' }),
            el('p', { text: 'The daily refresh has not run. It reads each company’s own job board and fills this map.' }),
            el('code', { text: 'node scripts/fetch-jobs.mjs' }))
        : el('div', { class: 'empty-side' },
            el('h2', { text: 'Nothing matches these filters' }),
            el('p', { text: `Only roles posted in the last ${MAX_AGE_DAYS} days are shown. Try clearing the search and filters.` }))
    );
  }
  for (const p of shown) {
    const fresh = p.jobs.filter((j) => j.fresher).length;
    kids.push(
      el('button', { class: 'co-row', type: 'button', onclick: () => select(p) },
        el('span', { class: 'logo', 'aria-hidden': 'true', text: p.company.trim()[0]?.toUpperCase() || '?' }),
        el('strong', { text: p.company }),
        el('span', { class: 'sub', text: [p.area || state.data.cities[p.city].label, fresh ? `${fresh} for freshers` : null].filter(Boolean).join(', ') }),
        el('span', { class: 'n', text: String(p.jobs.length), 'aria-label': `${p.jobs.length} open roles` }))
    );
  }
  if (watchShown.length) {
    kids.push(el('h3', { class: 'subhead', text: 'Based here, no live job feed' }));
    for (const w of watchShown) {
      kids.push(el('a', { class: 'watch', href: w.site, target: '_blank', rel: 'noopener noreferrer' }, w.name, el('span', { text: w.area })));
    }
  }
  $('panel').replaceChildren(...kids);
}

function roleRow(p, j) {
  const isSaved = Boolean(state.saved[j.id]);
  const btn = el('button', {
    class: 'save', type: 'button', 'aria-pressed': String(isSaved),
    'aria-label': `Save ${j.title}`, text: isSaved ? '★' : '☆',
  });
  btn.addEventListener('click', () => {
    toggleSave(p, j);
    const on = Boolean(state.saved[j.id]);
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? '★' : '☆';
  });
  return el('div', { class: 'role' },
    el('a', { class: 'title', href: j.url, target: '_blank', rel: 'noopener noreferrer', text: j.title }),
    btn,
    el('div', { class: 'meta' },
      j.isNew ? el('span', { class: 'tag new', text: 'New' }) : null,
      j.fresher ? el('span', { class: 'tag fresh', text: 'Freshers' }) : null,
      [j.area, j.department, j.type, j.workplace].filter(Boolean).map((t) => el('span', { text: t })),
      el('span', { text: postedLabel(j.postedAt) })));
}

function renderDetail(p) {
  const approx = p.approx ? ' Pin location is approximate.' : '';
  $('panel').replaceChildren(
    el('div', { class: 'detail' },
      el('button', { class: 'back', type: 'button', onclick: () => { state.selected = null; render(); } }, '‹ All companies'),
      el('h2', { text: p.company }),
      el('p', { class: 'where', text: `${p.area ? `${p.area}, ` : ''}${state.data.cities[p.city].label}.${approx}` }),
      p.jobs.map((j) => roleRow(p, j)))
  );
  $('panel').scrollTop = 0;
}

function renderSaved(pins) {
  const live = new Set(pins.flatMap((p) => p.jobs.map((j) => j.id)));
  const items = Object.values(state.saved).sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
  const kids = [];
  if (!state.storageOk) kids.push(el('p', { class: 'hint', text: 'Your browser blocked storage, so saved roles will be lost when you close this tab.' }));
  if (!items.length) {
    kids.push(el('div', { class: 'empty-side' },
      el('h2', { text: 'Nothing saved yet' }),
      el('p', { text: 'Open a company and tap the star next to a role. Saved roles stay on this device, and you can mark each one as applied, interview or offer.' })));
  } else {
    kids.push(el('div', { class: 'savedbar-map' },
      el('p', { class: 'hint', text: 'Saved on this device only.' }),
      el('button', { class: 'btn light', type: 'button', onclick: exportCsv }, 'Download as CSV')));
    for (const s of items) {
      const sel = el('select', { 'aria-label': `Status for ${s.title}` }, STATUSES.map((st) => el('option', { value: st, text: st, selected: st === s.status })));
      sel.addEventListener('change', () => { state.saved[s.id].status = sel.value; save(); });
      kids.push(el('div', { class: 'savedrow' },
        el('a', { class: 'title', href: s.url, target: '_blank', rel: 'noopener noreferrer', text: s.title }),
        el('div', { class: 'meta' },
          el('span', { text: s.company }),
          el('span', { text: state.data.cities[s.city]?.label || s.city }),
          live.has(s.id) ? null : el('span', { class: 'tag gone', text: 'No longer listed' })),
        el('div', { class: 'line' }, sel,
          el('button', { class: 'rm', type: 'button', onclick: () => { delete state.saved[s.id]; save(); render(); } }, 'Remove'))));
    }
  }
  $('panel').replaceChildren(...kids);
}

function renderSheet(shown) {
  const sheet = $('sheet');
  const p = state.selected && shown.find((x) => key(x) === state.selected);
  if (!p || state.tab !== 'companies') { sheet.hidden = true; return; }
  sheet.hidden = false;
  sheet.replaceChildren(
    el('strong', { text: p.company }),
    el('span', { class: 'sub', text: `${p.jobs.length} open ${p.jobs.length === 1 ? 'role' : 'roles'}${p.area ? `, ${p.area}` : ''}` }),
    el('button', { class: 'btn', type: 'button', onclick: () => setView('list') }, 'See roles'));
}

/* ---------- saved roles ---------- */
function save() {
  state.storageOk = persistSaved(state.saved);
  $('savedCount').textContent = Object.keys(state.saved).length ? `(${Object.keys(state.saved).length})` : '';
}

function toggleSave(p, j) {
  if (state.saved[j.id]) delete state.saved[j.id];
  else state.saved[j.id] = { id: j.id, company: p.company, city: p.city, title: j.title, url: j.url, status: STATUSES[0], savedAt: new Date().toISOString() };
  save();
}

function exportCsv() {
  const blob = new Blob([savedToCsv(state.saved)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: 'startup-arena-saved.csv' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- map ---------- */
function select(p) {
  state.selected = key(p);
  state.tab = 'companies';
  render();
  if (state.map && !(isMobile() && state.view === 'list')) {
    state.map.flyTo([p.lat, p.lng], Math.max(state.map.getZoom(), 14), { animate: !reduceMotion });
  }
}

function drawMarkers(shown, watchShown) {
  if (!state.map) return;
  state.layer.clearLayers();
  for (const p of shown) {
    const size = Math.min(30 + p.jobs.length * 1.2, 50); // 30px minimum keeps pins tappable
    const icon = L.divIcon({
      className: '',
      html: `<div class="pin${state.selected === key(p) ? ' sel' : ''}">${p.jobs.length}</div>`,
      iconSize: [size, size],
    });
    L.marker([p.lat, p.lng], { icon, title: `${p.company}: ${p.jobs.length} open roles`, riseOnHover: true })
      .on('click', () => select(p))
      .addTo(state.layer);
  }
  for (const w of watchShown) {
    const icon = L.divIcon({ className: '', html: '<div class="pin hollow">·</div>', iconSize: [26, 26] });
    const box = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = w.name;
    const note = document.createElement('div');
    note.textContent = 'No live job feed yet.';
    const link = document.createElement('a');
    link.href = w.site; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Visit site';
    box.append(name, note, link);
    L.marker([w.lat, w.lng], { icon, title: `${w.name} (no live job feed)` }).bindPopup(box).addTo(state.layer);
  }
}

boot();
