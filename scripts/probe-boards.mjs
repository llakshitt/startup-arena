// Finds which job-board provider and slug each company really uses, by trying likely slugs on every
// supported provider. Run from GitHub Actions (the Probe boards workflow); writes data/probe.json.
import { writeFile, readFile } from 'node:fs/promises';
import { ADAPTERS, detectCities } from './lib.mjs';

const names = (await readFile(new URL('./probe-names.txt', import.meta.url), 'utf8')).split('\n').map((s) => s.trim()).filter(Boolean);

const variants = (name) => {
  const base = name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9 ]/g, '').trim();
  const words = base.split(/\s+/);
  const out = new Set([words.join(''), words.join('-'), words.join('_')]);
  for (const suffix of ['india', 'hq', 'inc', 'technologies', 'tech', 'careers', 'labs']) {
    out.add(words.join('') + suffix);
    out.add(words.join('-') + '-' + suffix);
  }
  out.add(words[0]);
  return [...out];
};

async function tryBoard(ats, slug) {
  const adapter = ADAPTERS[ats];
  try {
    const res = await fetch(adapter.url(slug, 0), { signal: AbortSignal.timeout(15000), headers: { accept: 'application/json', 'user-agent': 'startup-arena-probe' } });
    if (!res.ok) return null;
    const data = await res.json();
    const jobs = adapter.parse(data, slug);
    if (!jobs.length && ats === 'smartrecruiters' && !data.totalFound) return null;
    const cities = jobs.map((j) => detectCities(j.locations));
    return { ats, slug, total: jobs.length, jaipur: cities.filter((c) => c.includes('jaipur')).length, noida: cities.filter((c) => c.includes('noida')).length };
  } catch { return null; }
}

const hits = [];
const queue = names.flatMap((name) => variants(name).flatMap((slug) => Object.keys(ADAPTERS).map((ats) => ({ name, ats, slug }))));
let i = 0;
await Promise.all(Array.from({ length: 10 }, async () => {
  while (i < queue.length) {
    const q = queue[i++];
    const r = await tryBoard(q.ats, q.slug);
    if (r) hits.push({ company: q.name, ...r });
  }
}));
hits.sort((a, b) => a.company.localeCompare(b.company) || b.total - a.total);
await writeFile('data/probe.json', JSON.stringify({ generatedAt: new Date().toISOString(), tried: queue.length, hits }, null, 2) + '\n');
console.log(`tried ${queue.length}, hits ${hits.length}`);
for (const h of hits) console.log(h.company, h.ats, h.slug, `total=${h.total} jaipur=${h.jaipur} noida=${h.noida}`);
