// Pure filtering logic for the page. Also imported by scripts/test-ui.mjs.

export function ageInDays(postedAt, now = Date.now()) {
  if (!postedAt) return null;
  const t = new Date(postedAt).getTime();
  return Number.isNaN(t) ? null : Math.floor((now - t) / 864e5);
}

/**
 * Returns pins for one city, each with only the roles that pass the filters.
 * Pins with no passing role are dropped. Roles without a posted date are kept
 * (some boards don't publish one) and shown as "date not listed".
 */
export function filterPins(pins, { city, q = '', area = '', maxAge = 0, freshers = false }, now = Date.now()) {
  const needle = q.trim().toLowerCase();
  const out = [];
  for (const p of pins) {
    if (p.city !== city) continue;
    if (area && p.area !== area) continue;
    const companyHit = needle && p.company.toLowerCase().includes(needle);
    const jobs = p.jobs.filter((j) => {
      if (freshers && !j.fresher) return false;
      if (maxAge) {
        const age = ageInDays(j.postedAt, now);
        if (age !== null && age > maxAge) return false;
      }
      if (!needle || companyHit) return true;
      return `${j.title} ${j.department || ''}`.toLowerCase().includes(needle);
    });
    if (jobs.length) out.push({ ...p, jobs });
  }
  return out;
}

export function areasFor(pins, watch, city) {
  const set = new Set();
  for (const p of [...pins, ...watch]) if (p.city === city && p.area) set.add(p.area);
  return [...set].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

export function postedLabel(postedAt, now = Date.now()) {
  const d = ageInDays(postedAt, now);
  if (d === null) return 'Date not listed';
  if (d <= 0) return 'Posted today';
  if (d === 1) return 'Posted yesterday';
  if (d < 30) return `Posted ${d} days ago`;
  return `Posted ${new Date(postedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
