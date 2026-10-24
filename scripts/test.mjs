// Run: node scripts/test.mjs   (no network, no dependencies)
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SCRAPERS, workdayPostedOn, parseWorkdayList, parseSuccessFactorsRows, parseZohoJobs, parseEightfold } from './scrapers.mjs';
import { ADAPTERS, buildDataset, detectCities, detectArea, isFresherRole, toCityJobs } from './lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const places = JSON.parse(await readFile(path.join(root, 'data/places.json'), 'utf8'));
const boards = JSON.parse(await readFile(path.join(root, 'data/boards.json'), 'utf8'));
let n = 0;
const t = (name, fn) => Promise.resolve(fn()).then(() => console.log(`ok  ${++n}. ${name}`));

await t('city detection', () => {
  assert.deepEqual(detectCities(['Dubai', 'Noida, Uttar Pradesh']), ['noida']);
  assert.deepEqual(detectCities(['Greater Noida']), ['noida']);
  assert.deepEqual(detectCities(['Jaipur, Rajasthan, India']), ['jaipur']);
  assert.deepEqual(detectCities(['Remote - India', 'Gurugram']), []);
  assert.deepEqual(detectCities(['Jaipur | Noida']).sort(), ['jaipur', 'noida']);
});

await t('area detection', () => {
  assert.equal(detectArea('noida', 'Sector 62, Noida', places), 'Sector 62');
  assert.equal(detectArea('noida', 'Noida Sector-144', places), 'Sector 144');
  assert.equal(detectArea('jaipur', 'Malviya Nagar, Jaipur', places), 'Malviya Nagar');
  assert.equal(detectArea('jaipur', 'Jaipur', places), null);
});

await t('fresher detection', () => {
  assert.ok(isFresherRole('Software Engineering Intern'));
  assert.ok(isFresherRole('Graduate Engineer Trainee'));
  assert.ok(isFresherRole('Support Executive (0-1 years)'));
  assert.ok(!isFresherRole('Senior Staff Engineer'));
});

// Mocked payloads, shaped like each provider's documented response.
const lever = [
  { id: 'a1', text: 'Analytics Lead', hostedUrl: 'https://jobs.lever.co/x/a1', createdAt: 1783043640931,
    categories: { location: 'Dubai', allLocations: ['Dubai', 'Noida, Uttar Pradesh'], team: 'Data', commitment: 'Full-time' }, workplaceType: 'onsite' },
  { id: 'a2', text: 'Designer', hostedUrl: 'https://jobs.lever.co/x/a2', createdAt: 1783043640931, categories: { location: 'Mumbai' } },
];
const greenhouse = { jobs: [
  { id: 7, title: 'Backend Intern', absolute_url: 'https://boards.greenhouse.io/x/jobs/7', updated_at: '2026-10-01T10:00:00Z', location: { name: 'Jaipur' } },
  { id: 8, title: 'PM', absolute_url: 'https://boards.greenhouse.io/x/jobs/8', location: { name: 'Remote' } },
] };
const ashby = { jobs: [
  { id: 'j1', title: 'ML Engineer', jobUrl: 'https://jobs.ashbyhq.com/x/j1', publishedAt: '2026-10-10T00:00:00Z', location: 'Bengaluru', secondaryLocations: [{ location: 'Noida' }], isListed: true },
  { id: 'j2', title: 'Hidden', jobUrl: 'https://jobs.ashbyhq.com/x/j2', location: 'Noida', isListed: false },
] };
const workable = { jobs: [{ shortcode: 'ABC', title: 'QA Engineer', url: 'https://apply.workable.com/x/j/ABC', city: 'Jaipur', country: 'India', published_on: '2026-09-20' }] };
const sr = { totalFound: 1, content: [{ id: '55', name: 'Sales Exec', releasedDate: '2026-10-05T00:00:00Z', location: { city: 'Noida', country: 'in' } }] };

await t('adapters normalise every provider', () => {
  const run = (ats, data) => toCityJobs({ ats, slug: 'x', name: 'Co' }, ADAPTERS[ats].parse(data, 'x'), places);
  const l = run('lever', lever);
  assert.equal(l.length, 1); assert.equal(l[0].city, 'noida'); assert.equal(l[0].department, 'Data');
  assert.equal(run('greenhouse', greenhouse).length, 1);
  assert.ok(run('greenhouse', greenhouse)[0].fresher);
  const a = run('ashby', ashby); assert.equal(a.length, 1); assert.equal(a[0].title, 'ML Engineer');
  assert.equal(run('workable', workable)[0].city, 'jaipur');
  assert.equal(run('smartrecruiters', sr)[0].url, 'https://jobs.smartrecruiters.com/x/55');
});

await t('every board in boards.json uses a known provider', () => {
  for (const b of boards) assert.ok(ADAPTERS[b.ats] || SCRAPERS[b.ats], `${b.name}: unknown ats ${b.ats}`);
});

await t('pipeline: 7-day rule, closed roles drop out, outages keep old data', async () => {
  const now = new Date('2026-10-24T00:00:00Z');
  const ago = (d) => new Date(+now - d * 864e5);
  const feeds = {
    'lever/paytm': [
      { id: 'new', text: 'Fresh role', hostedUrl: 'https://l/new', createdAt: +ago(2), categories: { location: 'Noida' } },
      { id: 'old', text: 'Stale role', hostedUrl: 'https://l/old', createdAt: +ago(9), categories: { location: 'Noida' } },
      { id: 'edge', text: 'Edge role', hostedUrl: 'https://l/edge', createdAt: +ago(6.9), categories: { location: 'Noida' } },
    ],
    'greenhouse/innovaccer': { jobs: [{ id: 7, title: 'Undated Intern', absolute_url: 'https://g/7', location: { name: 'Jaipur' } }] },
    'greenhouse/zscaler': { jobs: [{ id: 9, title: 'Zscaler role', absolute_url: 'https://g/9', updated_at: ago(1).toISOString(), location: { name: 'Noida' } }] },
  };
  let zscalerDown = false;
  const fetchBoard = async (b) => {
    const k = `${b.ats}/${b.slug}`;
    if (k === 'greenhouse/zscaler' && zscalerDown) return { status: 'error', error: 'HTTP 500' };
    if (!feeds[k]) return { status: 'notfound' };
    return { status: 'ok', rawJobs: ADAPTERS[b.ats].parse(feeds[k], b.slug) };
  };
  const bs = [
    { name: 'Paytm', ats: 'lever', slug: 'paytm' },
    { name: 'Innovaccer', ats: 'greenhouse', slug: 'innovaccer' },
    { name: 'Zscaler', ats: 'greenhouse', slug: 'zscaler' },
    { name: 'Sprinklr', ats: 'greenhouse', slug: 'sprinklr' },
  ];
  const titles = (d) => d.pins.flatMap((p) => p.jobs.map((j) => j.title)).sort();
  const at = (hours) => new Date(+now + hours * 36e5);

  // Run 1: the 9-day-old role never appears; undated role is shown (age counted from first sight).
  const r1 = await buildDataset({ boards: bs, places, fetchBoard, prev: null, now });
  assert.deepEqual(titles(r1.dataset), ['Edge role', 'Fresh role', 'Undated Intern', 'Zscaler role']);
  assert.equal(r1.report.find((r) => r.slug === 'sprinklr').status, 'notfound');
  assert.ok(r1.dataset.pins.every((p) => p.jobs.every((j) => j.isNew)), 'first sight counts as New');
  assert.equal(r1.dataset.watch.length, 6);
  assert.equal(r1.dataset.maxAgeDays, 7);

  // Run 2, 12h later, Zscaler's API is down: its role is kept, first-seen is remembered.
  zscalerDown = true;
  const r2 = await buildDataset({ boards: bs, places, fetchBoard, prev: r1.dataset, now: at(12) });
  assert.equal(r2.report.find((r) => r.slug === 'zscaler').status, 'error');
  assert.ok(titles(r2.dataset).includes('Zscaler role'), 'an outage must not remove a company');
  assert.equal(r2.dataset.pins.flatMap((p) => p.jobs).find((j) => j.title === 'Undated Intern').firstSeen, now.toISOString());

  // Run 3, 3 days later, Zscaler back: Edge role is now 9.9 days old and drops out; Paytm closed 'Fresh role' upstream.
  zscalerDown = false;
  feeds['lever/paytm'] = feeds['lever/paytm'].filter((j) => j.id !== 'new');
  const r3 = await buildDataset({ boards: bs, places, fetchBoard, prev: r2.dataset, now: at(72) });
  assert.deepEqual(titles(r3.dataset), ['Undated Intern', 'Zscaler role']);
  assert.ok(r3.dataset.pins.every((p) => p.jobs.every((j) => j.isNew === false)), 'New expires after 48 hours');

  // Run 4, 8 days after first sight: the undated role ages out too, and its first-seen memory goes with it once it closes.
  const r4 = await buildDataset({ boards: bs, places, fetchBoard, prev: r3.dataset, now: at(8 * 24) });
  assert.deepEqual(titles(r4.dataset), []);
  feeds['greenhouse/innovaccer'] = { jobs: [] };
  const r5 = await buildDataset({ boards: bs, places, fetchBoard, prev: r4.dataset, now: at(9 * 24) });
  assert.ok(!('greenhouse:innovaccer:7:jaipur' in r5.dataset.seen));
});

await t('scrapers read Workday, SuccessFactors, Zoho and Eightfold payloads', () => {
  const now = new Date('2026-10-24T06:00:00Z').getTime();
  assert.equal(workdayPostedOn('Posted Today', now), new Date(now).toISOString());
  assert.equal(workdayPostedOn('Posted Yesterday', now), new Date(now - 864e5).toISOString());
  assert.equal(workdayPostedOn('Posted 5 Days Ago', now), new Date(now - 5 * 864e5).toISOString());
  assert.equal(workdayPostedOn('Posted 30+ Days Ago', now), new Date(now - 30 * 864e5).toISOString());
  assert.equal(workdayPostedOn('', now), null);

  const wd = parseWorkdayList({ total: 1, jobPostings: [{ title: 'SDE II', externalPath: '/job/Noida/SDE-II_R1', locationsText: 'Noida, India', postedOn: 'Posted 2 Days Ago', bulletFields: ['R1'] }] }, { host: 'x.wd1.myworkdayjobs.com', site: 'careers' }, now);
  assert.equal(wd[0].url, 'https://x.wd1.myworkdayjobs.com/careers/job/Noida/SDE-II_R1');
  assert.equal(wd[0].rawId, 'R1');
  assert.deepEqual(detectCities(wd[0].locations), ['noida']);

  const sf = parseSuccessFactorsRows(`<table><tr class="data-row"><td class="colTitle"><span class="jobTitle hidden-phone"><a href="/job/Noida-Lead-Engineer/998877/" class="jobTitle-link">Lead Engineer &amp; Architect</a></span></td><td class="colLocation"><span class="jobLocation"> Noida, UP, IN </span></td><td class="colDate"><span class="jobDate">Oct 22, 2026</span></td></tr><tr class="data-row"><td><a class="jobTitle-link" href="/job/Jaipur-Analyst/11/">Analyst</a><span class="jobLocation">Jaipur, RJ, IN</span></td></tr></table>`, 'https://careers.example.com');
  assert.equal(sf.length, 2);
  assert.equal(sf[0].title, 'Lead Engineer & Architect');
  assert.equal(sf[0].url, 'https://careers.example.com/job/Noida-Lead-Engineer/998877/');
  assert.equal(sf[0].rawId, '998877');
  assert.ok(sf[0].postedAt.startsWith('2026-10-2'));
  assert.deepEqual(detectCities(sf[1].locations), ['jaipur']);

  const zoho = parseZohoJobs(`<input type="hidden" id="jobs" value='[{&quot;id&quot;:&quot;4001&quot;,&quot;Posting_Title&quot;:&quot;Graphic Designer&quot;,&quot;City&quot;:&quot;Jaipur&quot;,&quot;State&quot;:&quot;Rajasthan&quot;,&quot;Date_Opened&quot;:&quot;2026-10-21&quot;}]'>`, 'https://w.zohorecruit.in');
  assert.equal(zoho[0].title, 'Graphic Designer');
  assert.equal(zoho[0].url, 'https://w.zohorecruit.in/jobs/Careers/4001/graphic-designer?source=CareerSite');
  assert.deepEqual(detectCities(zoho[0].locations), ['jaipur']);
  assert.throws(() => parseZohoJobs('<html></html>', 'https://w.zohorecruit.in'), /not found/);

  const ef = parseEightfold({ positions: [{ id: 5, name: 'ML Engineer', location: 'Noida, India', t_create: 1792800000, canonicalPositionUrl: 'https://app.eightfold.ai/careers/job/5' }] }, 'app.eightfold.ai');
  assert.equal(ef[0].title, 'ML Engineer');
  assert.ok(ef[0].postedAt);
  assert.deepEqual(detectCities(ef[0].locations), ['noida']);
});

console.log(`\nAll ${n} checks passed.`);
