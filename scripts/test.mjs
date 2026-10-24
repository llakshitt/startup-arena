// Run: node scripts/test.mjs   (no network, no dependencies)
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
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
  for (const b of boards) assert.ok(ADAPTERS[b.ats], `${b.name}: unknown ats ${b.ats}`);
});

await t('pipeline: dead boards skipped, pins grouped, closed roles drop out, new flag works', async () => {
  const feeds = { 'lever/paytm': lever, 'greenhouse/innovaccer': greenhouse };
  const fetchBoard = async (b) => {
    const k = `${b.ats}/${b.slug}`;
    if (k === 'greenhouse/zscaler') return { status: 'error', error: 'HTTP 500' };
    if (!feeds[k]) return { status: 'notfound' };
    return { status: 'ok', rawJobs: ADAPTERS[b.ats].parse(feeds[k], b.slug) };
  };
  const bs = boards.filter((b) => ['paytm', 'innovaccer', 'zscaler', 'sprinklr'].includes(b.slug));
  const now = new Date('2026-10-24T00:00:00Z');
  const first = await buildDataset({ boards: bs, places, fetchBoard, prev: null, now });
  assert.equal(first.dataset.pins.length, 2);
  assert.equal(first.report.filter((r) => r.status === 'ok').length, 2);
  assert.equal(first.report.find((r) => r.slug === 'zscaler').status, 'error');
  assert.equal(first.report.find((r) => r.slug === 'sprinklr').status, 'notfound');
  assert.ok(first.dataset.pins.every((p) => p.jobs.every((j) => j.isNew)));
  assert.ok(first.dataset.pins.every((p) => p.approx === true && p.lat && p.lng));
  assert.equal(first.dataset.watch.length, 6);

  // Next day: the Paytm role is closed (gone from the API), the Jaipur role remains and is no longer "new".
  feeds['lever/paytm'] = [];
  const later = new Date('2026-10-25T00:00:00Z');
  const second = await buildDataset({ boards: bs, places, fetchBoard, prev: first.dataset, now: later });
  assert.equal(second.dataset.pins.length, 1);
  assert.equal(second.dataset.pins[0].jobs[0].firstSeen, '2026-10-24T00:00:00.000Z');
  const week = new Date('2026-11-05T00:00:00Z');
  const third = await buildDataset({ boards: bs, places, fetchBoard, prev: second.dataset, now: week });
  assert.equal(third.dataset.pins[0].jobs[0].isNew, false);
});

console.log(`\nAll ${n} checks passed.`);
