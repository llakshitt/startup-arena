// Readers for hiring systems that have no simple public JSON feed per company.
// Each scraper returns the same flat records as the adapters in lib.mjs:
//   { rawId, title, url, postedAt, department, type, workplace, locations[] }
// and throws when the page does not look the way we expect, so the refresh keeps the last good data.
// Parsers are pure functions so scripts/test.mjs can run them on sample payloads.

const DAY = 864e5;
const CITY_TERMS = ['Noida', 'Jaipur'];
const decode = (s) => String(s ?? '')
  .replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const strip = (s) => decode(String(s ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const iso = (v) => {
  if (v == null || v === '') return null;
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/* ---------------- Workday ---------------- */
// "Posted Today", "Posted Yesterday", "Posted 5 Days Ago", "Posted 30+ Days Ago"
export function workdayPostedOn(text, now = Date.now()) {
  const t = String(text || '').toLowerCase();
  if (!t) return null;
  if (t.includes('today')) return new Date(now).toISOString();
  if (t.includes('yesterday')) return new Date(now - DAY).toISOString();
  const m = /(\d+)\+?\s*day/.exec(t);
  return m ? new Date(now - Number(m[1]) * DAY).toISOString() : null;
}

export function parseWorkdayList(data, { host, site }, now = Date.now()) {
  return (data?.jobPostings || []).map((j) => ({
    rawId: (j.bulletFields && j.bulletFields[0]) || j.externalPath,
    title: j.title,
    url: `https://${host}/${site}${j.externalPath}`,
    path: j.externalPath,
    postedAt: workdayPostedOn(j.postedOn, now),
    locationsText: j.locationsText || '',
    department: null, type: null, workplace: null,
    locations: [j.locationsText],
  }));
}

const workday = {
  async fetch(board, http) {
    const { host, tenant, site } = board;
    const api = `https://${host}/wday/cxs/${tenant}/${site}/jobs`;
    const byId = new Map();
    for (const term of CITY_TERMS) {
      for (let offset = 0; offset < 200; offset += 20) {
        const r = await http.json(api, { method: 'POST', body: { appliedFacets: {}, limit: 20, offset, searchText: term } });
        if (r.status !== 'ok') throw new Error(`workday ${term}: ${r.status} ${r.error || ''}`);
        const rows = parseWorkdayList(r.data, { host, site });
        for (const row of rows) if (!byId.has(row.rawId)) byId.set(row.rawId, row);
        if (!rows.length || offset + 20 >= (r.data.total || 0)) break;
      }
    }
    // "2 Locations" does not say where; read the job itself for those (capped).
    let detail = 0;
    for (const row of byId.values()) {
      if (/noida|jaipur/i.test(row.locationsText) || detail >= 60) continue;
      detail++;
      const r = await http.json(`https://${host}/wday/cxs/${tenant}/${site}${row.path}`);
      const info = r.status === 'ok' ? r.data?.jobPostingInfo : null;
      if (!info) continue;
      row.locations = [info.location, ...(info.additionalLocations || [])];
      if (info.startDate) row.postedAt = iso(info.startDate) || row.postedAt;
      row.type = info.timeType || null;
    }
    return [...byId.values()];
  },
};

/* ---------------- SAP SuccessFactors career sites (e.g. HCLTech) ---------------- */
export function parseSuccessFactorsRows(html, base) {
  const rows = [];
  for (const block of String(html).split(/<tr[^>]*class="[^"]*data-row[^"]*"[^>]*>/i).slice(1)) {
    const a = /<a[^>]*href="([^"]+)"[^>]*class="[^"]*jobTitle-link[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block)
      || /<a[^>]*class="[^"]*jobTitle-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!a) continue;
    const loc = /class="[^"]*jobLocation[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(block);
    const date = /class="[^"]*jobDate[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(block);
    const dept = /class="[^"]*jobFacility[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(block);
    const href = decode(a[1]);
    rows.push({
      rawId: href.split('/').filter(Boolean).pop(),
      title: strip(a[2]),
      url: new URL(href, base).href,
      postedAt: date ? iso(strip(date[1])) : null,
      department: dept ? strip(dept[1]) || null : null,
      type: null, workplace: null,
      locations: [loc ? strip(loc[1]) : ''],
    });
  }
  return rows;
}

const successfactors = {
  async fetch(board, http) {
    const base = board.base.replace(/\/$/, '');
    const out = new Map();
    for (const term of CITY_TERMS) {
      for (let page = 0; page < 20; page++) {
        const url = `${base}/search/?createNewAlert=false&q=&locationsearch=${encodeURIComponent(term)}&sortColumn=referencedate&sortDirection=desc&startrow=${page * 25}`;
        const r = await http.text(url);
        if (r.status !== 'ok') throw new Error(`successfactors ${term}: ${r.status} ${r.error || ''}`);
        const rows = parseSuccessFactorsRows(r.data, base);
        if (!rows.length) {
          if (page === 0 && !/no\s+(jobs|results|matching)|0\s+results/i.test(r.data) && !/jobTitle-link/.test(r.data)) throw new Error('successfactors: page layout not recognised');
          break;
        }
        let fresh = 0;
        for (const row of rows) {
          if (!out.has(row.rawId)) { out.set(row.rawId, row); fresh++; }
        }
        // newest first: once a whole page is older than a week, the rest is older still
        if (!fresh || rows.every((x) => x.postedAt && Date.now() - new Date(x.postedAt) > 8 * DAY)) break;
      }
    }
    return [...out.values()];
  },
};

/* ---------------- Zoho Recruit career sites ---------------- */
export function parseZohoJobs(html, origin) {
  const m = /<input[^>]*\bid="jobs"[^>]*\bvalue=(?:"([^"]*)"|'([^']*)')/i.exec(html) || /<input[^>]*\bvalue=(?:"([^"]*)"|'([^']*)')[^>]*\bid="jobs"/i.exec(html);
  if (!m) throw new Error('zoho: job list not found on page');
  let list;
  try { list = JSON.parse(decode(m[1] ?? m[2])); } catch { throw new Error('zoho: job list is not valid JSON'); }
  return (Array.isArray(list) ? list : []).map((j) => {
    const title = j.Posting_Title || j.Job_Opening_Name || j.title || '';
    const id = j.id || j.Id || j.jobId;
    const slug = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return {
      rawId: String(id),
      title,
      url: `${origin}/jobs/Careers/${id}/${slug}?source=CareerSite`,
      postedAt: iso(j.Date_Opened || j.Created_Time || j.Posted_Date),
      department: j.Department_Name || j.Industry || null,
      type: j.Job_Type || j.Type_of_Employment || null,
      workplace: j.Remote_Job === true || j.Remote_Job === 'true' ? 'remote' : null,
      locations: [[j.City, j.State, j.Country].filter(Boolean).join(', ')],
    };
  }).filter((j) => j.title && j.rawId !== 'undefined');
}

const zoho = {
  async fetch(board, http) {
    const r = await http.text(board.url);
    if (r.status !== 'ok') throw new Error(`zoho: ${r.status} ${r.error || ''}`);
    return parseZohoJobs(r.data, new URL(board.url).origin);
  },
};

/* ---------------- Eightfold career sites ---------------- */
export function parseEightfold(data, host) {
  return (data?.positions || []).map((p) => ({
    rawId: String(p.id),
    title: p.name,
    url: p.canonicalPositionUrl || `https://${host}/careers/job/${p.id}`,
    postedAt: iso(p.t_create ? p.t_create * 1000 : p.t_update ? p.t_update * 1000 : null),
    department: p.department || null,
    type: null,
    workplace: /remote/i.test(p.work_location_option || '') ? 'remote' : null,
    locations: [p.location, ...(p.locations || [])],
  }));
}

const eightfold = {
  async fetch(board, http) {
    const out = [];
    for (let start = 0; start < 400; start += 100) {
      const r = await http.json(`https://${board.host}/api/apply/v2/jobs?domain=${encodeURIComponent(board.domain)}&start=${start}&num=100&sort_by=timestamp`);
      if (r.status !== 'ok') throw new Error(`eightfold: ${r.status} ${r.error || ''}`);
      const rows = parseEightfold(r.data, board.host);
      out.push(...rows);
      if (rows.length < 100) break;
    }
    return out;
  },
};

export const SCRAPERS = { workday, successfactors, zoho, eightfold };
