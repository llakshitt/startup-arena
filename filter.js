// Pure logic shared by the pages. Imported by scripts/test-ui.mjs, so keep it free of DOM and storage access.

export const STATUSES = ['To do', 'Applied', 'Interview', 'Offer', 'Rejected'];
export const MAX_AGE_DAYS = 7; // roles older than this are never shown

export function ageInDays(postedAt, now = Date.now()) {
  if (!postedAt) return null;
  const t = new Date(postedAt).getTime();
  return Number.isNaN(t) ? null : Math.floor((now - t) / 864e5);
}

/**
 * Keeps only roles from the last MAX_AGE_DAYS days. A role's age counts from its posted date,
 * or from when we first saw it when the company publishes no date. The daily data job already
 * does this; doing it again here means a stale data file can never show an old role.
 */
export function withinWindow(pins, now = Date.now()) {
  const out = [];
  for (const p of pins) {
    const jobs = p.jobs.filter((j) => {
      const age = ageInDays(j.postedAt || j.firstSeen, now);
      return age === null || age <= MAX_AGE_DAYS;
    });
    if (jobs.length) out.push({ ...p, jobs });
  }
  return out;
}

/** Pins for one city, each carrying only the roles that pass the filters. Pins with no passing role are dropped. */
export function filterPins(pins, { city, q = '', area = '', dept = '', freshers = false }) {
  const needle = q.trim().toLowerCase();
  const out = [];
  for (const p of pins) {
    if (p.city !== city) continue;
    const companyHit = needle && p.company.toLowerCase().includes(needle);
    const jobs = p.jobs.filter((j) => {
      if (area && j.area !== area) return false;
      if (freshers && !j.fresher) return false;
      if (dept && j.department !== dept) return false;
      if (!needle || companyHit) return true;
      return `${j.title} ${j.department || ''}`.toLowerCase().includes(needle);
    });
    if (jobs.length) out.push({ ...p, jobs });
  }
  return out;
}

export function sortPins(pins, sort = 'roles') {
  const copy = [...pins];
  const newest = (p) => p.jobs.reduce((m, j) => (j.postedAt && j.postedAt > m ? j.postedAt : m), '');
  if (sort === 'name') copy.sort((a, b) => a.company.localeCompare(b.company));
  else if (sort === 'new') copy.sort((a, b) => newest(b).localeCompare(newest(a)) || b.jobs.length - a.jobs.length);
  else copy.sort((a, b) => b.jobs.length - a.jobs.length || a.company.localeCompare(b.company));
  return copy;
}

/**
 * One pin per company per city. The data file may hold several pins for one company
 * (one per area); this merges them, tags every role with its own area, and keeps the
 * pin at the location of the area with the most roles.
 */
export function mergePins(pins) {
  const by = new Map();
  for (const p of pins) {
    const k = `${p.company}|${p.city}`;
    const jobs = p.jobs.map((j) => ({ ...j, area: j.area ?? p.area ?? null }));
    const g = by.get(k);
    if (!g) {
      by.set(k, { ...p, jobs, best: p.jobs.length });
    } else {
      g.jobs.push(...jobs);
      if (p.jobs.length > g.best) Object.assign(g, { lat: p.lat, lng: p.lng, area: p.area, approx: p.approx, best: p.jobs.length });
    }
  }
  return [...by.values()].map(({ best, ...p }) => {
    p.jobs.sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''));
    return p;
  });
}

export function areasFor(pins, watch, city) {
  const set = new Set();
  for (const p of pins) if (p.city === city) for (const j of p.jobs) if (j.area) set.add(j.area);
  for (const w of watch) if (w.city === city && w.area) set.add(w.area);
  return [...set].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

export function deptsFor(pins, city) {
  const set = new Set();
  for (const p of pins) if (p.city === city) for (const j of p.jobs) if (j.department) set.add(j.department);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function postedLabel(postedAt, now = Date.now()) {
  const d = ageInDays(postedAt, now);
  if (d === null) return 'Date not listed';
  if (d <= 0) return 'Posted today';
  if (d === 1) return 'Posted yesterday';
  if (d < 30) return `Posted ${d} days ago`;
  return `Posted ${new Date(postedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

/* ---------- shareable URL state: #/noida?q=react&fresh=1 ---------- */

export function parseHash(hash) {
  const m = /^#\/(jaipur|noida)(?:\?(.*))?$/.exec(hash || '');
  const p = new URLSearchParams(m?.[2] || '');
  return {
    city: m ? m[1] : 'jaipur',
    q: p.get('q') || '',
    area: p.get('area') || '',
    dept: p.get('dept') || '',
    fresh: p.get('fresh') === '1',
    view: p.get('view') === 'map' ? 'map' : 'list',
    sort: ['roles', 'new', 'name'].includes(p.get('sort')) ? p.get('sort') : 'roles',
  };
}

export function buildHash(s) {
  const p = new URLSearchParams();
  if (s.q) p.set('q', s.q);
  if (s.area) p.set('area', s.area);
  if (s.dept) p.set('dept', s.dept);
  if (s.fresh) p.set('fresh', '1');
  if (s.sort && s.sort !== 'roles') p.set('sort', s.sort);
  if (s.view === 'map') p.set('view', 'map');
  const qs = p.toString();
  return `#/${s.city}${qs ? `?${qs}` : ''}`;
}

export function activeFilterCount(s) {
  return [s.area, s.dept, s.fresh, s.sort !== 'roles'].filter(Boolean).length;
}

/* ---------- landing page numbers ---------- */

export function cityStats(pins, city) {
  const mine = pins.filter((p) => p.city === city);
  const jobs = mine.flatMap((p) => p.jobs);
  return { roles: jobs.length, companies: new Set(mine.map((p) => p.company)).size, freshers: jobs.filter((j) => j.fresher).length };
}

/** The most recently posted roles across both cities, newest first. */
export function newestRoles(pins, limit = 6) {
  return pins
    .flatMap((p) => p.jobs.map((j) => ({ ...j, company: p.company, city: p.city })))
    .sort((a, b) => (b.postedAt || b.firstSeen || '').localeCompare(a.postedAt || a.firstSeen || ''))
    .slice(0, limit);
}

export function topHiring(pins, limit = 8) {
  const by = new Map();
  for (const p of pins) {
    const k = `${p.company}|${p.city}`;
    by.set(k, { company: p.company, city: p.city, roles: (by.get(k)?.roles || 0) + p.jobs.length });
  }
  return [...by.values()].sort((a, b) => b.roles - a.roles || a.company.localeCompare(b.company)).slice(0, limit);
}

/* ---------- saved roles ---------- */

const CSV_FORMULA = /^[=+\-@\t\r]/;
const csvCell = (v) => {
  let s = String(v ?? '');
  if (CSV_FORMULA.test(s)) s = `'${s}`; // stops spreadsheet apps running a cell as a formula
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function savedToCsv(saved) {
  const rows = [['Company', 'City', 'Role', 'Status', 'Link', 'Saved on']];
  for (const s of Object.values(saved).sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''))) {
    rows.push([s.company, s.city, s.title, s.status, s.url, (s.savedAt || '').slice(0, 10)]);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
