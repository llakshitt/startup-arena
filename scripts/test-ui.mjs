// Run: node scripts/test-ui.mjs — tests the pages' pure logic (no browser needed).
import assert from 'node:assert/strict';
import {
  filterPins, sortPins, mergePins, areasFor, deptsFor, postedLabel, ageInDays, parseHash, buildHash, activeFilterCount,
  cityStats, topHiring, savedToCsv,
} from '../filter.js';

const now = new Date('2026-10-24T00:00:00Z').getTime();
const day = (n) => new Date(now - n * 864e5).toISOString();
const raw = [
  { company: 'Alpha', city: 'jaipur', area: 'Malviya Nagar', lat: 1, lng: 1, jobs: [
    { id: '1', title: 'React Developer', department: 'Eng', postedAt: day(3), fresher: false },
    { id: '2', title: 'Sales Intern', department: 'Sales', postedAt: day(200), fresher: true },
    { id: '3', title: 'Support Associate', department: null, postedAt: null, fresher: false },
  ] },
  { company: 'Beta', city: 'noida', area: 'Sector 62', lat: 1, lng: 1, jobs: [
    { id: '4', title: 'Data Analyst', department: 'Data', postedAt: day(10), fresher: false },
    { id: '5', title: 'Data Intern', department: 'Data', postedAt: day(1), fresher: true },
  ] },
  { company: 'Gamma', city: 'noida', area: null, lat: 1, lng: 1, jobs: [{ id: '6', title: 'Designer', department: 'Design', postedAt: day(40), fresher: false }] },
];
// A second Alpha pin in another area, as the data file can contain (one pin per company and area).
raw.push({ company: 'Alpha', city: 'jaipur', area: 'Jagatpura', lat: 2, lng: 2, approx: true, jobs: [{ id: '7', title: 'QA Engineer', department: 'Eng', postedAt: day(2), fresher: false }] });
const pins = mergePins(raw);
let n = 0;
const t = (name, fn) => { fn(); console.log(`ok  ${++n}. ${name}`); };

t('merge: one pin per company and city, roles keep their own area', () => {
  assert.equal(pins.filter((p) => p.company === 'Alpha').length, 1);
  const alpha = pins.find((p) => p.company === 'Alpha');
  assert.equal(alpha.jobs.length, 4);
  assert.equal(alpha.area, 'Malviya Nagar'); // pin sits with the area that has the most roles
  assert.equal(alpha.jobs.find((j) => j.id === '7').area, 'Jagatpura');
  assert.equal(alpha.jobs[0].id, '7'); // newest first
});
t('area filter works per role', () => {
  const r = filterPins(pins, { city: 'jaipur', area: 'Jagatpura', maxAge: 0 }, now);
  assert.deepEqual(r[0].jobs.map((j) => j.id), ['7']);
});
t('city filter', () => assert.equal(filterPins(pins, { city: 'noida' }, now).length, 2));
t('90-day window drops the 200-day-old role but keeps undated ones', () => {
  const titles = filterPins(pins, { city: 'jaipur', maxAge: 90 }, now)[0].jobs.map((j) => j.title);
  assert.deepEqual(titles.sort(), ['QA Engineer', 'React Developer', 'Support Associate']);
});
t('any time keeps old roles', () => assert.equal(filterPins(pins, { city: 'jaipur', maxAge: 0 }, now)[0].jobs.length, 4));
t('freshers only', () => {
  const r = filterPins(pins, { city: 'jaipur', maxAge: 0, freshers: true }, now);
  assert.deepEqual(r[0].jobs.map((j) => j.title), ['Sales Intern']);
});
t('team filter', () => {
  const r = filterPins(pins, { city: 'noida', dept: 'Design' }, now);
  assert.deepEqual(r.map((p) => p.company), ['Gamma']);
});
t('search by title, team and company name', () => {
  assert.equal(filterPins(pins, { city: 'jaipur', q: 'react' }, now)[0].jobs.length, 1);
  assert.equal(filterPins(pins, { city: 'jaipur', q: 'sales', maxAge: 0 }, now)[0].jobs.length, 1);
  assert.equal(filterPins(pins, { city: 'jaipur', q: 'alpha', maxAge: 0 }, now)[0].jobs.length, 4);
});
t('no matches drops the pin', () => assert.equal(filterPins(pins, { city: 'jaipur', q: 'zzz' }, now).length, 0));
t('area filter, area and team lists', () => {
  assert.equal(filterPins(pins, { city: 'jaipur', area: 'Mansarovar' }, now).length, 0);
  assert.deepEqual(areasFor(pins, [{ city: 'jaipur', area: 'Sitapura' }], 'jaipur'), ['Jagatpura', 'Malviya Nagar', 'Sitapura']);
  assert.deepEqual(deptsFor(pins, 'noida'), ['Data', 'Design']);
});
t('sorting', () => {
  const noida = filterPins(pins, { city: 'noida' }, now);
  assert.deepEqual(sortPins(noida, 'roles').map((p) => p.company), ['Beta', 'Gamma']);
  assert.deepEqual(sortPins(noida, 'name').map((p) => p.company), ['Beta', 'Gamma']);
  assert.deepEqual(sortPins(noida, 'new').map((p) => p.company), ['Beta', 'Gamma']);
  assert.deepEqual(noida.map((p) => p.company), ['Beta', 'Gamma'], 'sorting must not mutate the input');
});
t('date labels', () => {
  assert.equal(postedLabel(null, now), 'Date not listed');
  assert.equal(postedLabel(day(0), now), 'Posted today');
  assert.equal(postedLabel(day(5), now), 'Posted 5 days ago');
  assert.equal(ageInDays('garbage', now), null);
});
t('url state round-trips', () => {
  const s = parseHash('#/noida?q=data%20eng&fresh=1&age=30&area=Sector%2062&sort=new&view=map');
  assert.deepEqual(s, { city: 'noida', q: 'data eng', area: 'Sector 62', dept: '', age: 30, fresh: true, view: 'map', sort: 'new' });
  assert.equal(parseHash(buildHash(s)).q, 'data eng');
  assert.deepEqual(parseHash(buildHash(s)), s);
  assert.equal(buildHash({ city: 'jaipur', q: '', area: '', dept: '', age: 90, fresh: false, view: 'list', sort: 'roles' }), '#/jaipur');
});
t('bad url values fall back safely', () => {
  const s = parseHash('#/nowhere?age=7&sort=evil&view=x');
  assert.equal(s.city, 'jaipur'); assert.equal(s.age, 90); assert.equal(s.sort, 'roles'); assert.equal(s.view, 'list');
  assert.equal(parseHash('').city, 'jaipur');
});
t('active filter count', () => {
  assert.equal(activeFilterCount(parseHash('#/jaipur')), 0);
  assert.equal(activeFilterCount(parseHash('#/jaipur?fresh=1&age=0&dept=Eng')), 3);
});
t('landing numbers', () => {
  assert.deepEqual(cityStats(pins, 'noida'), { roles: 3, companies: 2, freshers: 1 });
  assert.deepEqual(topHiring(pins, 2).map((x) => `${x.company}:${x.roles}`), ['Alpha:4', 'Beta:2']);
});
t('csv export escapes quotes and blocks spreadsheet formulas', () => {
  const csv = savedToCsv({
    a: { company: 'Co, Inc', city: 'noida', title: 'Says "hi"', status: 'Applied', url: 'https://x.test/1', savedAt: '2026-10-24T01:00:00Z' },
    b: { company: '=HYPERLINK("http://evil")', city: 'jaipur', title: '+cmd', status: 'To do', url: 'https://x.test/2', savedAt: '2026-10-23T01:00:00Z' },
  });
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'Company,City,Role,Status,Link,Saved on');
  assert.equal(lines[1], '"Co, Inc",noida,"Says ""hi""",Applied,https://x.test/1,2026-10-24');
  assert.ok(lines[2].startsWith(`"'=HYPERLINK(""http://evil"")"`));
  assert.ok(lines[2].includes(",'+cmd,"));
});
console.log(`\nAll ${n} UI checks passed.`);
