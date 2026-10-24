// Saves the first part of each response so a reader can be fixed against the real page. Writes data/debug.json.
import { writeFile, readFile } from 'node:fs/promises';
const urls = JSON.parse(await readFile(new URL('./debug-urls.json', import.meta.url), 'utf8'));
const out = [];
for (const u of urls) {
  const r = { url: u.url, method: u.method || 'GET' };
  try {
    const res = await fetch(u.url, { method: r.method, redirect: 'follow', signal: AbortSignal.timeout(25000),
      headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36', accept: u.accept || 'text/html,application/json', ...(u.body ? { 'content-type': 'application/json' } : {}) },
      body: u.body ? JSON.stringify(u.body) : undefined });
    const text = await res.text();
    r.status = res.status; r.finalUrl = res.url; r.length = text.length;
    const at = u.find ? text.indexOf(u.find) : -1;
    r.head = text.slice(0, u.n || 1500);
    if (at >= 0) r.around = text.slice(Math.max(0, at - 300), at + (u.n || 1500));
  } catch (e) { r.error = String(e.message || e); }
  out.push(r);
}
await writeFile('data/debug.json', JSON.stringify(out, null, 2) + '\n');
for (const r of out) console.log(r.status ?? r.error, r.length, r.url);
