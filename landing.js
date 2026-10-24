import { cityStats, topHiring, newestRoles, postedLabel, withinWindow, MAX_AGE_DAYS } from './filter.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (v != null && v !== false) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid);
  return n;
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const shortPosted = (iso) => postedLabel(iso).replace('Posted ', '').replace('Date not listed', 'Date n/a');

async function boot() {
  let data;
  try {
    const res = await fetch('data/jobs.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
    data.pins = withinWindow(data.pins);
  } catch (e) {
    $('lede').textContent = 'The job data could not be loaded. Reload the page, or open the map directly.';
    $('cities').replaceChildren(cityLink('jaipur', 'Jaipur', null), cityLink('noida', 'Noida', null));
    $('newest').replaceChildren(el('li', { class: 'notice', text: 'Roles could not be loaded. Reload the page to try again.' }));
    return;
  }

  const stats = { jaipur: cityStats(data.pins, 'jaipur'), noida: cityStats(data.pins, 'noida') };
  const total = stats.jaipur.roles + stats.noida.roles;
  const companies = stats.jaipur.companies + stats.noida.companies;
  const when = data.generatedAt
    ? new Date(data.generatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : null;

  $('lede').textContent = total
    ? `${plural(total, 'role', 'roles')} posted in the last ${MAX_AGE_DAYS} days at ${plural(companies, 'company', 'companies')}, read from each company’s own job board. Last checked ${when}.`
    : `No roles posted in the last ${MAX_AGE_DAYS} days right now. The list refreshes every 5 hours.`;

  $('cities').replaceChildren(
    cityLink('jaipur', data.cities.jaipur.label, stats.jaipur),
    cityLink('noida', data.cities.noida.label, stats.noida)
  );

  const newest = newestRoles(data.pins, 8);
  $('newest').replaceChildren(
    ...(newest.length
      ? newest.map((j) =>
          el('li', { 'data-city': j.city },
            el('a', { href: j.url, target: '_blank', rel: 'noopener noreferrer' },
              el('span', { class: 't', text: j.title }),
              el('span', { class: 'when', text: shortPosted(j.postedAt || j.firstSeen) }),
              el('span', { class: 'm' }, el('span', { class: 'dot', 'aria-hidden': 'true' }), `${j.company}, ${data.cities[j.city].label}`))))
      : [el('li', { class: 'notice', text: 'No roles yet. They appear here after the next refresh.' })])
  );

  const top = topHiring(data.pins, 6);
  const max = top[0]?.roles || 1;
  $('top').replaceChildren(
    ...(top.length
      ? top.map((t) =>
          el('li', { 'data-city': t.city },
            el('a', { href: `map.html#/${t.city}?q=${encodeURIComponent(t.company)}` },
              el('b', { text: t.company }),
              el('span', { class: 'n', text: String(t.roles), 'aria-label': plural(t.roles, 'role', 'roles') }),
              el('span', { class: 'where', text: data.cities[t.city].label }),
              el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: `width:${Math.max(4, (t.roles / max) * 100)}%` })))))
      : [el('li', { class: 'notice', text: 'No roles yet. They appear here after the next refresh.' })])
  );
}

function cityLink(city, label, s) {
  return el('a', { class: 'citycard', href: `map.html#/${city}`, style: `--accent:${city === 'noida' ? '#1c4ed8' : '#b82d61'}` },
    el('h2', { text: label }),
    el('span', {},
      s ? el('span', { class: 'figure', text: String(s.roles) }) : null,
      el('span', { class: 'sub', text: s
        ? `${s.roles === 1 ? 'open role' : 'open roles'} at ${plural(s.companies, 'company', 'companies')}${s.freshers ? `, ${s.freshers} for freshers` : ''}`
        : 'Open the map' })),
    el('span', { class: 'go', text: `Open the ${label} map` }));
}

boot();
