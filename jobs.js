import {
  flattenJobs, filterJobs, sortJobs, facet, companiesFrom, mergePins, withinWindow, parseAppHash, buildAppHash, jobFilterCount,
  postedLabel, savedToCsv, STATUSES, MAX_AGE_DAYS,
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
const NS = 'http://www.w3.org/2000/svg';
function icon(d, size = 18, fill = false) {
  const s = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true' })) s.setAttribute(k, v);
  const p = document.createElementNS(NS, 'path');
  for (const [k, v] of Object.entries({ d, fill: fill ? 'currentColor' : 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' })) p.setAttribute(k, v);
  s.append(p);
  return s;
}
const BOOKMARK = 'M6 3.5h12v17l-6-4.2-6 4.2z';
const CLOSE = 'M6 6l12 12M18 6 6 18';

const PAGE = 24;
const TINTS = ['#e8e2ff', '#dcf2e6', '#ffe6d3', '#d9eaff', '#fde0e9', '#f2edc6'];
const tint = (name) => TINTS[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % TINTS.length];
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const dateLabel = (j) => (j.postedAt ? fmtDate(j.postedAt) : j.firstSeen ? `Seen ${fmtDate(j.firstSeen)}` : 'Recently');
const cityLabel = (c) => state.data.cities[c]?.label || c;

const state = { data: null, jobs: [], saved: {}, shown: PAGE, storageOk: true, ...parseAppHash(location.hash) };

/* ---------- boot ---------- */
async function boot() {
  state.saved = loadSaved();
  wire();
  try {
    const res = await fetch('data/jobs.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
    state.data.pins = withinWindow(mergePins(state.data.pins));
    state.jobs = flattenJobs(state.data.pins);
  } catch (e) {
    $('stat').textContent = 'The job data could not be loaded.';
    $('grid').replaceChildren(el('div', { class: 'empty' }, el('h2', { text: 'Could not load roles' }), el('p', { text: `The file data/jobs.json failed to load (${e.message}). Reload the page to try again.` })));
    route();
    return;
  }
  route();
}

function wire() {
  for (const id of ['fq', 'fcity', 'farea', 'fdept', 'fsort', 'fdays', 'ffresh']) $(id).addEventListener('input', onFilterInput);
  $('cq').addEventListener('input', () => { state.q = $('cq').value; state.shown = PAGE; commit(); });
  for (const b of $('cseg').querySelectorAll('button')) b.addEventListener('click', () => { state.city = b.dataset.city; commit(); });
  $('searchForm').addEventListener('submit', (e) => { e.preventDefault(); $('rcount').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  $('freset').addEventListener('click', () => { Object.assign(state, { city: '', area: '', dept: '', type: '', work: '', company: '', fresh: false, days: MAX_AGE_DAYS }); commit(); });
  $('more').addEventListener('click', () => { state.shown += PAGE; render(); });
  $('fopen').addEventListener('click', () => toggleSheet(true));
  $('fclose').addEventListener('click', () => toggleSheet(false));
  $('fdone').addEventListener('click', () => toggleSheet(false));
  $('scrim').addEventListener('click', () => toggleSheet(false));
  addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleSheet(false); });
  addEventListener('hashchange', () => route());
  // On phones the city, area and team fields live in the filter sheet so the search card stays short.
  const mq = matchMedia('(max-width: 900px)');
  const place = () => {
    const btn = $('searchForm').querySelector('button[type="submit"]');
    for (const id of ['fcity', 'farea', 'fdept']) {
      const label = $(id).closest('label');
      if (mq.matches) $('sheetFields').append(label);
      else $('searchForm').insertBefore(label, btn);
    }
  };
  mq.addEventListener('change', place);
  place();
  $('jobDialog').addEventListener('click', (e) => { if (e.target === $('jobDialog')) $('jobDialog').close(); });
}

function toggleSheet(open) {
  $('filterPanel').toggleAttribute('data-open', open);
  $('scrim').hidden = !open;
  $('fopen').setAttribute('aria-expanded', String(open));
  if (!open && document.activeElement && $('filterPanel').contains(document.activeElement)) $('fopen').focus();
}

function onFilterInput() {
  state.q = $('fq').value;
  state.city = $('fcity').value;
  state.area = $('farea').value;
  state.dept = $('fdept').value;
  state.sort = $('fsort').value;
  state.days = Number($('fdays').value);
  state.fresh = $('ffresh').checked;
  state.shown = PAGE;
  commit();
}

/** Writes the state to the URL (so a search can be shared) and redraws. */
function commit() {
  history.replaceState(null, '', buildAppHash(state));
  render();
}

function route() {
  Object.assign(state, parseAppHash(location.hash));
  state.shown = PAGE;
  toggleSheet(false);
  render();
}

/* ---------- render ---------- */
function render() {
  const titles = { jobs: 'Find jobs', companies: 'Companies', saved: 'Saved roles', about: 'About' };
  document.title = `${titles[state.view]} · Startup Arena`;
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== `view-${state.view}`;
  for (const a of document.querySelectorAll('.mainnav a[data-view]')) {
    if (a.dataset.view === state.view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const n = Object.keys(state.saved).length;
  $('navSaved').textContent = n ? `(${n})` : '';
  $('savedDot').hidden = !n;
  if (!state.data) return;

  if (state.view === 'jobs') renderJobs();
  else if (state.view === 'companies') renderCompanies();
  else if (state.view === 'saved') renderSaved();
}

function fillSelect(id, first, values, current) {
  const sel = $(id);
  sel.replaceChildren(el('option', { value: '', text: first }), ...values.map((v) => el('option', { value: v, text: v })));
  sel.value = values.includes(current) ? current : '';
}

function radioList(host, name, items, current, onPick) {
  host.replaceChildren(
    el('label', { class: 'opt' }, el('input', { type: 'radio', name, value: '', checked: current === '', onchange: () => onPick('') }), el('span', { text: 'Any' })),
    ...items.map(([v, c]) =>
      el('label', { class: 'opt' },
        el('input', { type: 'radio', name, value: v, checked: current === v, onchange: () => onPick(v) }),
        el('span', { text: cap(v) }), el('span', { class: 'n', text: String(c) })))
  );
}

function renderJobs() {
  const inCity = filterJobs(state.jobs, { city: state.city });
  const stats = (j) => new Set(j.map((x) => x.company)).size;
  $('stat').textContent = state.jobs.length
    ? `${plural(state.jobs.length, 'role', 'roles')} at ${plural(stats(state.jobs), 'company', 'companies')}, posted in the last ${MAX_AGE_DAYS} days. Last checked ${new Date(state.data.generatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.`
    : `No roles posted in the last ${MAX_AGE_DAYS} days right now. The list refreshes every 5 hours.`;
  $('promoN').textContent = String(state.jobs.length);

  // options reflect the chosen city, so a filter can never lead to an empty result by itself
  fillSelect('farea', 'All areas', facet(inCity, 'area').map((x) => x[0]).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })), state.area);
  fillSelect('fdept', 'All teams', facet(inCity, 'department').map((x) => x[0]).sort(), state.dept);
  state.area = $('farea').value;
  state.dept = $('fdept').value;
  $('fq').value = state.q;
  $('fcity').value = state.city;
  $('fsort').value = state.sort;
  $('fdays').value = String(state.days);
  $('fdaysOut').textContent = state.days >= MAX_AGE_DAYS ? 'Any time in the last 7 days' : state.days === 1 ? 'Last 24 hours' : `Last ${state.days} days`;
  $('ffresh').checked = state.fresh;
  radioList($('typeList'), 'type', facet(inCity, 'type'), state.type, (v) => { state.type = v; state.shown = PAGE; commit(); });
  radioList($('workList'), 'work', facet(inCity, 'workplace'), state.work, (v) => { state.work = v; state.shown = PAGE; commit(); });

  const results = sortJobs(filterJobs(state.jobs, state), state.sort);
  const nf = jobFilterCount(state);
  $('fbadge').textContent = nf ? String(nf) : '';
  $('fdone').textContent = results.length ? `Show ${plural(results.length, 'role', 'roles')}` : 'No roles match';
  $('rcount').textContent = results.length ? `${plural(results.length, 'role', 'roles')}` : 'No roles';

  renderChips();
  const page = results.slice(0, state.shown);
  $('grid').replaceChildren(...(page.length ? page.map(jobCard) : [emptyJobs()]));
  $('more').hidden = results.length <= state.shown;
  $('more').textContent = `Show more roles (${results.length - state.shown} left)`;
}

function renderChips() {
  const label = {
    city: () => cityLabel(state.city), area: () => state.area, dept: () => state.dept, type: () => cap(state.type), work: () => cap(state.work),
    company: () => state.company, fresh: () => 'Open to freshers', days: () => (state.days === 1 ? 'Last 24 hours' : `Last ${state.days} days`),
  };
  const reset = { city: '', area: '', dept: '', type: '', work: '', company: '', fresh: false, days: MAX_AGE_DAYS };
  const active = Object.keys(label).filter((k) => (k === 'days' ? state.days < MAX_AGE_DAYS : state[k]));
  $('chips').replaceChildren(...active.map((k) =>
    el('button', { class: 'chip', type: 'button', 'aria-label': `Remove filter ${label[k]()}`, onclick: () => { state[k] = reset[k]; state.shown = PAGE; commit(); } }, label[k](), icon(CLOSE, 12))));
}

function emptyJobs() {
  const filtered = jobFilterCount(state) || state.q;
  return el('div', { class: 'empty' },
    el('h2', { text: filtered ? 'No roles match these filters' : 'No fresh roles right now' }),
    el('p', { text: filtered ? `Only roles posted in the last ${MAX_AGE_DAYS} days are shown. Try removing a filter or searching for something broader.` : 'New roles appear here after each 5-hourly refresh.' }),
    filtered ? el('button', { class: 'btn-dark', type: 'button', onclick: () => { state.q = ''; $('freset').click(); } }, 'Clear search and filters') : null);
}

/* ---------- job card + details ---------- */
function bookmarkButton(j) {
  const btn = el('button', { class: 'bm', type: 'button', 'aria-pressed': String(Boolean(state.saved[j.id])), 'aria-label': `Save ${j.title}` }, icon(BOOKMARK, 16, Boolean(state.saved[j.id])));
  btn.addEventListener('click', () => {
    toggleSave(j);
    const on = Boolean(state.saved[j.id]);
    btn.setAttribute('aria-pressed', String(on));
    btn.replaceChildren(icon(BOOKMARK, 16, on));
  });
  return btn;
}

const logo = (company) => el('span', { class: 'logo', 'aria-hidden': 'true', style: `--tint:${tint(company)}`, text: company.trim()[0]?.toUpperCase() || '?' });
const tagsFor = (j) => [j.type, j.workplace, j.department].filter(Boolean).map(cap);

function jobCard(j) {
  return el('article', { class: 'job', 'data-city': j.city },
    el('div', { class: 'jt' }, logo(j.company), el('span', { class: 'datepill', text: dateLabel(j) }), bookmarkButton(j)),
    el('p', { class: 'jc' }, el('span', { class: 'cdot', 'aria-hidden': 'true' }), `${j.company}, ${cityLabel(j.city)}`),
    el('h3', { class: 'jtitle' }, el('button', { type: 'button', onclick: () => openJob(j), text: j.title })),
    el('ul', { class: 'jtags' }, tagsFor(j).map((t) => el('li', { text: t }))),
    el('p', { class: 'jloc', text: j.area ? `${j.area}, ${cityLabel(j.city)}` : cityLabel(j.city) }),
    el('div', { class: 'jf' },
      j.isNew ? el('span', { class: 'tag new', text: 'New' }) : null,
      j.fresher ? el('span', { class: 'tag fresh', text: 'Freshers' }) : null,
      el('button', { class: 'pill', type: 'button', onclick: () => openJob(j), 'aria-label': `Details for ${j.title}`, text: 'Details' })));
}

function openJob(j) {
  const dlg = $('jobDialog');
  const rows = [
    ['Location', j.area ? `${j.area}, ${cityLabel(j.city)}` : cityLabel(j.city)],
    ['Team', j.department], ['Job type', cap(j.type)], ['Workplace', cap(j.workplace)], ['Posted', postedLabel(j.postedAt).replace('Posted ', '')],
  ].filter(([, v]) => v);
  dlg.replaceChildren(
    el('div', { class: 'dlg', 'data-city': j.city },
      el('div', { class: 'jt' }, logo(j.company),
        el('p', { class: 'jc' }, el('span', { class: 'cdot', 'aria-hidden': 'true' }), `${j.company}, ${cityLabel(j.city)}`),
        el('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Close details', onclick: () => dlg.close() }, icon(CLOSE, 16))),
      el('h2', { id: 'dlgTitle', text: j.title }),
      el('div', { class: 'jf' }, j.isNew ? el('span', { class: 'tag new', text: 'New' }) : null, j.fresher ? el('span', { class: 'tag fresh', text: 'Open to freshers' }) : null),
      el('dl', {}, rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])),
      el('div', { class: 'acts' },
        el('a', { class: 'btn-dark', href: j.url, target: '_blank', rel: 'noopener noreferrer', text: 'Apply on company site' }),
        el('a', { class: 'btn-light', href: `map.html#/${j.city}?q=${encodeURIComponent(j.company)}`, text: 'See on map' })),
      el('p', { class: 'note', text: 'You apply on the company’s own job board. Nothing is sent from here.' })));
  dlg.showModal();
}

/* ---------- companies ---------- */
function renderCompanies() {
  $('cq').value = state.q;
  for (const b of $('cseg').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.city === state.city));
  const list = companiesFrom(filterJobs(state.jobs, { city: state.city, q: state.q }));
  const roles = list.reduce((n, c) => n + c.jobs.length, 0);
  $('cstat').textContent = list.length ? `${plural(list.length, 'company', 'companies')} with ${plural(roles, 'open role', 'open roles')} from the last ${MAX_AGE_DAYS} days.` : 'No companies match.';
  $('cogrid').replaceChildren(...(list.length
    ? list.map((c) =>
        el('article', { class: 'co', 'data-city': c.city },
          el('div', { class: 'jt' }, logo(c.company), el('span', { class: 'count', text: plural(c.jobs.length, 'role', 'roles') })),
          el('h3', { text: c.company }),
          el('p', { class: 'jc' }, el('span', { class: 'cdot', 'aria-hidden': 'true' }), c.area ? `${c.area}, ${cityLabel(c.city)}` : cityLabel(c.city)),
          el('ul', { class: 'samples' }, c.jobs.slice(0, 2).map((j) => el('li', { text: j.title }))),
          el('div', { class: 'jf' },
            c.jobs.some((j) => j.fresher) ? el('span', { class: 'tag fresh', text: 'Freshers' }) : null,
            el('a', { class: 'pill', href: buildAppHash({ view: 'jobs', company: c.company, city: c.city, days: MAX_AGE_DAYS }), text: 'View roles' }))))
    : [el('div', { class: 'empty' }, el('h2', { text: 'No companies match' }), el('p', { text: 'Try a different name or city.' }))]));

  const needle = state.q.trim().toLowerCase();
  const watch = state.data.watch.filter((w) => (!state.city || w.city === state.city) && (!needle || w.name.toLowerCase().includes(needle)));
  $('watchBlock').hidden = !watch.length;
  $('watchGrid').replaceChildren(...watch.map((w) =>
    el('article', { class: 'co hollow', 'data-city': w.city },
      el('div', { class: 'jt' }, logo(w.name)),
      el('h3', { text: w.name }),
      el('p', { class: 'jc' }, el('span', { class: 'cdot', 'aria-hidden': 'true' }), w.area ? `${w.area}, ${cityLabel(w.city)}` : cityLabel(w.city)),
      el('div', { class: 'jf' }, el('a', { class: 'pill', href: w.site, target: '_blank', rel: 'noopener noreferrer', text: 'Visit careers page' })))));
}

/* ---------- saved ---------- */
function renderSaved() {
  const live = new Set(state.jobs.map((j) => j.id));
  const items = Object.values(state.saved).sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
  $('savedbar').replaceChildren(...(items.length
    ? [el('p', { text: `${plural(items.length, 'saved role', 'saved roles')}${state.storageOk ? '' : '. Your browser blocked storage, so they will be lost when you close this tab'}` }),
       el('button', { class: 'btn-light', type: 'button', onclick: exportCsv, text: 'Download as CSV' })]
    : []));
  $('savedlist').replaceChildren(...(items.length
    ? items.map((s) => {
        const sel = el('select', { 'aria-label': `Status for ${s.title}` }, STATUSES.map((st) => el('option', { value: st, text: st, selected: st === s.status })));
        sel.addEventListener('change', () => { state.saved[s.id].status = sel.value; save(); });
        return el('article', { class: 'saved', 'data-city': s.city },
          logo(s.company),
          el('a', { class: 'title', href: s.url, target: '_blank', rel: 'noopener noreferrer', text: s.title }),
          el('div', { class: 'meta' }, el('span', { class: 'cdot', 'aria-hidden': 'true' }), el('span', { text: `${s.company}, ${cityLabel(s.city)}` }),
            live.has(s.id) ? null : el('span', { class: 'tag gone', text: 'No longer listed' })),
          el('div', { class: 'acts' }, sel,
            el('button', { class: 'linkbtn', type: 'button', onclick: () => { delete state.saved[s.id]; save(); render(); }, text: 'Remove' })));
      })
    : [el('div', { class: 'empty' },
        el('h2', { text: 'Nothing saved yet' }),
        el('p', { text: 'Tap the bookmark on a role to keep it here. Saved roles stay on this device.' }),
        el('a', { class: 'btn-dark', href: '#/jobs', text: 'Find jobs' }))]));
}

/* ---------- saved store ---------- */
function save() {
  state.storageOk = persistSaved(state.saved);
  const n = Object.keys(state.saved).length;
  $('navSaved').textContent = n ? `(${n})` : '';
  $('savedDot').hidden = !n;
}

function toggleSave(j) {
  if (state.saved[j.id]) delete state.saved[j.id];
  else state.saved[j.id] = { id: j.id, company: j.company, city: j.city, title: j.title, url: j.url, status: STATUSES[0], savedAt: new Date().toISOString() };
  save();
}

function exportCsv() {
  const url = URL.createObjectURL(new Blob([savedToCsv(state.saved)], { type: 'text/csv;charset=utf-8' }));
  const a = el('a', { href: url, download: 'startup-arena-saved.csv' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

boot();
