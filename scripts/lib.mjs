// Pure helpers: no network, no file access. Everything here is unit-tested in scripts/test.mjs.

export const CITIES = {
  jaipur: { label: 'Jaipur', rx: /\bjaipur\b/i },
  noida: { label: 'Noida', rx: /\b(?:greater\s+)?noida\b/i },
};

const FRESHER_RX =
  /\b(intern(?:ship)?s?|trainee|freshers?|graduate|apprentice|entry[\s-]?level|campus|early career|new grad)\b|\b0\s*(?:-|–|to)\s*[12]\s*\+?\s*(?:yrs?|years?)\b/i;

export function isFresherRole(title, extra = '') {
  return FRESHER_RX.test(`${title} ${extra}`);
}

/** Which of our cities does this location text mention? */
export function detectCities(texts) {
  const t = texts.filter(Boolean).join(' | ');
  return Object.keys(CITIES).filter((k) => CITIES[k].rx.test(t));
}

/** Best-effort neighbourhood / sector from free text. Returns null when unknown. */
export function detectArea(city, text, places) {
  const t = (text || '').toLowerCase();
  const known = Object.keys(places.areas[city] || {});
  for (const name of known) {
    if (t.includes(name.toLowerCase())) return name;
  }
  if (city === 'noida') {
    const m = t.match(/sector[\s-]*(\d{1,3})/);
    if (m) return `Sector ${m[1]}`;
  }
  return null;
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Coordinates for a pin. `approx` is true unless the company has an exact office override. */
export function pinCoords(company, city, area, places) {
  const override = places.offices?.[company.toLowerCase()]?.[city];
  if (override?.lat && override?.lng) {
    return { lat: override.lat, lng: override.lng, area: override.area || area, approx: false };
  }
  const areaXY = area && places.areas[city]?.[area];
  const h = hash(company);
  const unit = (n) => ((h >>> n) % 1000) / 1000 - 0.5; // -0.5 .. 0.5
  if (areaXY) {
    return { lat: areaXY[0] + unit(0) * 0.008, lng: areaXY[1] + unit(10) * 0.008, area, approx: true };
  }
  const c = places.cities[city].center;
  return { lat: c[0] + unit(0) * 0.05, lng: c[1] + unit(10) * 0.05, area: null, approx: true };
}

const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const iso = (v) => {
  if (v == null || v === '') return null;
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/* ---------- ATS adapters: raw API payload -> flat job records ---------- */

export const ADAPTERS = {
  lever: {
    url: (slug) => `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`,
    parse(data, slug) {
      return asArray(data).map((j) => ({
        rawId: j.id,
        title: j.text,
        url: j.hostedUrl || j.applyUrl,
        postedAt: iso(j.createdAt),
        department: j.categories?.team || j.categories?.department || null,
        type: j.categories?.commitment || null,
        workplace: j.workplaceType || null,
        locations: [j.categories?.location, ...asArray(j.categories?.allLocations)],
      }));
    },
  },
  greenhouse: {
    url: (slug) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`,
    parse(data) {
      return asArray(data?.jobs).map((j) => ({
        rawId: j.id,
        title: j.title,
        url: j.absolute_url,
        postedAt: iso(j.first_published || j.updated_at),
        department: j.departments?.[0]?.name || null,
        type: null,
        workplace: null,
        locations: [j.location?.name, ...asArray(j.offices).map((o) => o.location || o.name)],
      }));
    },
  },
  ashby: {
    url: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`,
    parse(data) {
      return asArray(data?.jobs)
        .filter((j) => j.isListed !== false)
        .map((j) => ({
          rawId: j.id || j.jobUrl,
          title: j.title,
          url: j.jobUrl || j.applyUrl,
          postedAt: iso(j.publishedAt),
          department: j.team || j.department || null,
          type: j.employmentType || null,
          workplace: j.isRemote ? 'remote' : null,
          locations: [j.location, ...asArray(j.secondaryLocations).map((s) => s.location || s)],
        }));
    },
  },
  workable: {
    url: (slug) => `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}`,
    parse(data) {
      return asArray(data?.jobs).map((j) => ({
        rawId: j.shortcode || j.url,
        title: j.title,
        url: j.url || j.application_url,
        postedAt: iso(j.published_on || j.created_at),
        department: j.department || null,
        type: j.employment_type || null,
        workplace: j.telecommuting ? 'remote' : null,
        locations: [
          [j.city, j.state, j.country].filter(Boolean).join(', '),
          ...asArray(j.locations).map((l) => [l.city, l.region, l.country].filter(Boolean).join(', ')),
        ],
      }));
    },
  },
  smartrecruiters: {
    // Paginated: the fetcher keeps calling with offset until totalFound is reached.
    url: (slug, offset = 0) =>
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=100&offset=${offset}`,
    paged: true,
    parse(data, slug) {
      return asArray(data?.content).map((j) => ({
        rawId: j.id,
        title: j.name,
        url: `https://jobs.smartrecruiters.com/${encodeURIComponent(slug)}/${j.id}`,
        postedAt: iso(j.releasedDate),
        department: j.department?.label || null,
        type: j.typeOfEmployment?.label || null,
        workplace: j.location?.remote ? 'remote' : null,
        locations: [[j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(', ')],
      }));
    },
  },
};

/** Turn raw jobs from one board into per-city job records. */
export function toCityJobs(board, rawJobs, places) {
  const out = [];
  for (const j of rawJobs) {
    if (!j.title || !j.url) continue;
    const cities = detectCities(j.locations);
    for (const city of cities) {
      const locText = j.locations.filter(Boolean).join(' | ');
      out.push({
        id: `${board.ats}:${board.slug}:${j.rawId}:${city}`,
        company: board.name,
        city,
        area: detectArea(city, locText, places),
        title: j.title.trim(),
        url: j.url,
        department: j.department,
        type: j.type,
        workplace: j.workplace,
        postedAt: j.postedAt,
        fresher: isFresherRole(j.title, j.type || ''),
      });
    }
  }
  return out;
}

/**
 * Build the dataset the website reads.
 * fetchBoard(board) -> { status: 'ok'|'notfound'|'error', rawJobs?: [], error?: string }
 * Injected so the whole pipeline can be tested without a network.
 */
export async function buildDataset({ boards, places, fetchBoard, prev, now = new Date(), concurrency = 6 }) {
  const prevFirstSeen = new Map((prev?.pins || []).flatMap((p) => p.jobs.map((j) => [j.id, j.firstSeen])));
  const report = [];
  const allJobs = [];
  let cursor = 0;

  async function worker() {
    while (cursor < boards.length) {
      const board = boards[cursor++];
      const res = await fetchBoard(board).catch((e) => ({ status: 'error', error: String(e?.message || e) }));
      if (res.status !== 'ok') {
        report.push({ company: board.name, ats: board.ats, slug: board.slug, status: res.status, error: res.error || null });
        continue;
      }
      const jobs = toCityJobs(board, res.rawJobs, places);
      allJobs.push(...jobs);
      report.push({
        company: board.name,
        ats: board.ats,
        slug: board.slug,
        status: 'ok',
        totalOpenRoles: res.rawJobs.length,
        matched: jobs.length,
      });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, boards.length) }, worker));

  // Group into one pin per company + city + area.
  const pinMap = new Map();
  for (const j of allJobs) {
    const key = `${j.company}|${j.city}|${j.area || ''}`;
    if (!pinMap.has(key)) {
      const xy = pinCoords(j.company, j.city, j.area, places);
      pinMap.set(key, { company: j.company, city: j.city, ...xy, jobs: [] });
    }
    const firstSeen = prevFirstSeen.get(j.id) || now.toISOString();
    const isNew = now - new Date(firstSeen) < 7 * 864e5;
    const { company, city, area, ...job } = j;
    pinMap.get(key).jobs.push({ ...job, firstSeen, isNew });
  }
  const pins = [...pinMap.values()];
  for (const p of pins) p.jobs.sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''));
  pins.sort((a, b) => b.jobs.length - a.jobs.length || a.company.localeCompare(b.company));

  const watch = (places.watch || []).map((w) => {
    const xy = pinCoords(w.name, w.city, w.area, places);
    return { ...w, lat: xy.lat, lng: xy.lng, approx: true };
  });

  const dataset = {
    generatedAt: now.toISOString(),
    cities: Object.fromEntries(
      Object.entries(places.cities).map(([k, v]) => [k, { label: v.label, center: v.center, zoom: v.zoom }])
    ),
    pins,
    watch,
  };
  report.sort((a, b) => a.company.localeCompare(b.company));
  return { dataset, report };
}
