// Run: node scripts/test-ui.mjs — tests the page's filter logic (no browser needed).
import assert from 'node:assert/strict';
import { filterPins, areasFor, postedLabel, ageInDays } from '../filter.js';

const now = new Date('2026-10-24T00:00:00Z').getTime();
const day = (n) => new Date(now - n * 864e5).toISOString();
const pins = [
  { company: 'Alpha', city: 'jaipur', area: 'Malviya Nagar', lat: 1, lng: 1, jobs: [
    { id: '1', title: 'React Developer', department: 'Eng', postedAt: day(3), fresher: false },
    { id: '2', title: 'Sales Intern', department: 'Sales', postedAt: day(200), fresher: true },
    { id: '3', title: 'Support Associate', department: null, postedAt: null, fresher: false },
  ] },
  { company: 'Beta', city: 'noida', area: 'Sector 62', lat: 1, lng: 1, jobs: [{ id: '4', title: 'Data Analyst', department: 'Data', postedAt: day(10), fresher: false }] },
];
let n = 0;
const t = (name, fn) => { fn(); console.log(`ok  ${++n}. ${name}`); };

t('city filter', () => assert.equal(filterPins(pins, { city: 'noida' }, now).length, 1));
t('default 90-day window drops the 200-day-old role but keeps undated ones', () => {
  const titles = filterPins(pins, { city: 'jaipur', maxAge: 90 }, now)[0].jobs.map((j) => j.title);
  assert.deepEqual(titles, ['React Developer', 'Support Associate']);
});
t('any time keeps old roles', () => assert.equal(filterPins(pins, { city: 'jaipur', maxAge: 0 }, now)[0].jobs.length, 3));
t('freshers only', () => {
  const r = filterPins(pins, { city: 'jaipur', maxAge: 0, freshers: true }, now);
  assert.deepEqual(r[0].jobs.map((j) => j.title), ['Sales Intern']);
});
t('search by title, department and company name', () => {
  assert.equal(filterPins(pins, { city: 'jaipur', q: 'react' }, now)[0].jobs.length, 1);
  assert.equal(filterPins(pins, { city: 'jaipur', q: 'sales', maxAge: 0 }, now)[0].jobs.length, 1);
  assert.equal(filterPins(pins, { city: 'jaipur', q: 'alpha', maxAge: 0 }, now)[0].jobs.length, 3);
});
t('no matches drops the pin', () => assert.equal(filterPins(pins, { city: 'jaipur', q: 'zzz' }, now).length, 0));
t('area filter and area list', () => {
  assert.equal(filterPins(pins, { city: 'jaipur', area: 'Mansarovar' }, now).length, 0);
  assert.deepEqual(areasFor(pins, [{ city: 'jaipur', area: 'Jagatpura' }], 'jaipur'), ['Jagatpura', 'Malviya Nagar']);
});
t('date labels', () => {
  assert.equal(postedLabel(null, now), 'Date not listed');
  assert.equal(postedLabel(day(0), now), 'Posted today');
  assert.equal(postedLabel(day(5), now), 'Posted 5 days ago');
  assert.equal(ageInDays('garbage', now), null);
});
console.log(`\nAll ${n} UI checks passed.`);
