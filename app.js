import { filterPins, areasFor, postedLabel } from './filter.js';

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

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const state = { data: null, city: 'jaipur', selected: null, map: null, layer: null };

/* ---------- boot ---------- */
async function boot() {
  try {
    const res = await fetch('data/jobs.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
  } catch (e) {
    $('panel').replaceChildren(
      el('div', { class: 'empty' }, el('h2', { text: 'Could not load the job data' }), el('p', { text: `The file data/jobs.json failed to load (${e.message}). Reload the page, or check that the file is deployed.` }))
    );
    return;
  }
  setupMap();
  for (const id of ['q', 'area', 'age', 'fresh']) $(id).addEventListener('input', () => { state.selected = null; render(); });
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
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(state.map);
  state.layer = L.layerGroup().addTo(state.map);
}

function route() {
  const city = (location.hash.match(/^#\/(jaipur|noida)/) || [])[1] || 'jaipur';
  const changed = city !== state.city || !state.routed;
  state.city = city;
  state.routed = true;
  document.documentElement.dataset.city = city;
  for (const a of document.querySelectorAll('.cities a')) {
    if (a.dataset.city === city) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  state.selected = null;
  $('q').value = '';
  $('fresh').checked = false;
  fillAreas();
  if (changed && state.map) {
    const c = state.data.cities[city];
    state.map.setView(c.center, c.zoom, { animate: !reduceMotion });
  }
  render();
}

function fillAreas() {
  const { pins, watch } = state.data;
  const sel = $('area');
  sel.replaceChildren(el('option', { value: '', text: 'All areas' }), ...areasFor(pins, watch, state.city).map((a) => el('option', { value: a, text: a })));
}

/* ---------- render ---------- */
function currentFilters() {
  return { city: state.city, q: $('q').value, area: $('area').value, maxAge: Number($('age').value), freshers: $('fresh').checked };
}

function render() {
  const { pins, watch, generatedAt } = state.data;
  const f = currentFilters();
  const shown = filterPins(pins, f);
  const roles = shown.reduce((n, p) => n + p.jobs.length, 0);

  $('stamp').textContent = generatedAt
    ? `Roles checked ${new Date(generatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`
    : 'No live roles loaded yet';

  const watchShown = watch.filter(
    (w) => w.city === state.city && (!f.area || w.area === f.area) && !f.freshers && (!f.q || w.name.toLowerCase().includes(f.q.trim().toLowerCase()))
  );

  const label = state.data.cities[state.city].label;
  $('count').textContent = roles
    ? `${roles} open ${roles === 1 ? 'role' : 'roles'} at ${shown.length} ${shown.length === 1 ? 'company' : 'companies'} in ${label}`
    : `No open roles match in ${label}`;

  drawMarkers(shown, watchShown);
  if (state.selected) {
    const p = shown.find((x) => key(x) === state.selected);
    if (p) return void renderDetail(p);
    state.selected = null;
  }
  renderList(shown, watchShown, f);
}

const key = (p) => `${p.company}|${p.city}|${p.area || ''}`;

function renderList(shown, watchShown, f) {
  const panel = $('panel');
  const kids = [];
  if (!shown.length) {
    const neverFetched = !state.data.generatedAt;
    kids.push(
      neverFetched
        ? el('div', { class: 'empty' },
            el('h2', { text: 'No live roles yet' }),
            el('p', { text: 'The daily refresh has not run. It reads each company’s own job board and fills this map.' }),
            el('code', { text: 'node scripts/fetch-jobs.mjs' }))
        : el('div', { class: 'empty' },
            el('h2', { text: 'Nothing matches these filters' }),
            el('p', { text: f.maxAge ? 'Try “Any time” under Posted, or clear the search and area.' : 'Try clearing the search, area or freshers filter.' }))
    );
  }
  for (const p of shown) {
    const fresh = p.jobs.filter((j) => j.fresher).length;
    kids.push(
      el('button', { class: 'co', type: 'button', onclick: () => select(p) },
        el('strong', { text: p.company }),
        el('span', { class: 'n', text: String(p.jobs.length), 'aria-label': `${p.jobs.length} roles` }),
        el('small', { text: [p.area || state.data.cities[p.city].label, fresh ? `${fresh} for freshers` : null].filter(Boolean).join(' · ') }))
    );
  }
  if (watchShown.length) {
    kids.push(el('h3', { class: 'subhead', text: 'Based here, no live job feed' }));
    for (const w of watchShown) {
      kids.push(el('a', { class: 'watch', href: w.site, target: '_blank', rel: 'noopener noreferrer' }, w.name, ' ', el('span', { text: `· ${w.area}` })));
    }
  }
  panel.replaceChildren(...kids);
}

function renderDetail(p) {
  const approxNote = p.approx ? ' Pin location is approximate.' : '';
  $('panel').replaceChildren(
    el('div', { class: 'detail' },
      el('button', { class: 'back', type: 'button', onclick: () => { state.selected = null; render(); } }, '‹ All companies'),
      el('h2', { text: p.company }),
      el('p', { class: 'where', text: `${p.area ? p.area + ', ' : ''}${state.data.cities[p.city].label}.${approxNote}` }),
      p.jobs.map((j) =>
        el('a', { class: 'role', href: j.url, target: '_blank', rel: 'noopener noreferrer' },
          el('b', { text: j.title }),
          el('div', { class: 'meta' },
            j.isNew ? el('span', { class: 'tag new', text: 'New' }) : null,
            j.fresher ? el('span', { class: 'tag fresh', text: 'Freshers' }) : null,
            [j.department, j.type, j.workplace].filter(Boolean).map((t) => el('span', { text: t })),
            el('span', { text: postedLabel(j.postedAt) }))))
    )
  );
  $('panel').scrollTop = 0;
  $('panel').querySelector('.back')?.focus({ preventScroll: true });
}

function select(p) {
  state.selected = key(p);
  render();
  if (state.map) state.map.flyTo([p.lat, p.lng], Math.max(state.map.getZoom(), 14), { animate: !reduceMotion });
}

/* ---------- map ---------- */
function drawMarkers(shown, watchShown) {
  if (!state.map) return;
  state.layer.clearLayers();
  for (const p of shown) {
    const size = Math.min(26 + p.jobs.length * 1.2, 46);
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
    const icon = L.divIcon({ className: '', html: '<div class="pin hollow">·</div>', iconSize: [20, 20] });
    L.marker([w.lat, w.lng], { icon, title: `${w.name} (no live job feed)` })
      .bindPopup(`<b>${escapeHtml(w.name)}</b><br>No live job feed yet.<br><a href="${encodeURI(w.site)}" target="_blank" rel="noopener noreferrer">Visit site</a>`)
      .addTo(state.layer);
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

boot();
