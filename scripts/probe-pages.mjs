// Looks at each company's careers page and reports how its jobs are published (which hiring system,
// whether the page carries schema.org JobPosting data, and which job links it exposes).
// Runs in GitHub Actions (the Probe pages workflow) and writes data/page-probe.json.
import { writeFile, readFile } from 'node:fs/promises';

const targets = JSON.parse(await readFile(new URL('./probe-pages.json', import.meta.url), 'utf8'));
const HINTS = {
  greenhouse: /greenhouse\.io\/([\w-]+)/i, lever: /jobs\.lever\.co\/([\w-]+)/i, ashby: /ashbyhq\.com\/([\w.%-]+)/i,
  workable: /apply\.workable\.com\/([\w-]+)/i, smartrecruiters: /smartrecruiters\.com\/([\w-]+)/i,
  zoho: /([\w-]+)\.zohorecruit\.(?:in|com)/i, keka: /([\w-]+)\.keka\.com/i, freshteam: /([\w-]+)\.freshteam\.com/i,
  darwinbox: /([\w-]+)\.darwinbox\.in/i, workday: /([\w-]+)\.wd\d+\.myworkdayjobs\.com\/(?:[\w-]+\/)?([\w-]+)/i,
  recruitee: /([\w-]+)\.recruitee\.com/i, breezy: /([\w-]+)\.breezy\.hr/i, oracle: /([\w-]+)\.oraclecloud\.com\/hcmUI/i,
  icims: /([\w-]+)\.icims\.com/i, taleo: /([\w-]+)\.taleo\.net/i, bamboo: /([\w-]+)\.bamboohr\.com/i, personio: /([\w-]+)\.jobs\.personio/i,
  teamtailor: /([\w-]+)\.teamtailor\.com/i, hirist: /hirist\.(?:tech|com)/i, naukri: /naukri\.com\/[\w-]*jobs/i, linkedin: /linkedin\.com\/company\/([\w-]+)\/jobs/i,
};

async function look(t) {
  const out = { name: t.name, url: t.url };
  try {
    const res = await fetch(t.url, { redirect: 'follow', signal: AbortSignal.timeout(25000), headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36', accept: 'text/html,application/xhtml+xml' } });
    out.status = res.status; out.finalUrl = res.url;
    const html = await res.text();
    out.bytes = html.length;
    out.hints = {};
    for (const [k, rx] of Object.entries(HINTS)) { const m = html.match(rx); if (m) out.hints[k] = m[0].slice(0, 120); }
    out.jsonLdJobs = (html.match(/"@type"\s*:\s*"JobPosting"/g) || []).length;
    out.nextData = /id="__NEXT_DATA__"/.test(html);
    out.remix = /__remixContext/.test(html);
    out.title = (html.match(/<title[^>]*>([^<]*)/i) || [])[1]?.trim().slice(0, 120);
    out.links = [...new Set([...html.matchAll(/href="([^"#]+)"/g)].map((m) => m[1]).filter((h) => /job|career|opening|position|apply|vacanc/i.test(h)))].slice(0, 40);
    out.scripts = [...new Set([...html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map((m) => m[1]))].slice(0, 8);
    out.sample = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 600);
  } catch (e) { out.error = String(e.message || e); }
  return out;
}

const results = [];
let i = 0;
await Promise.all(Array.from({ length: 6 }, async () => { while (i < targets.length) results.push(await look(targets[i++])); }));
results.sort((a, b) => a.name.localeCompare(b.name));
await writeFile('data/page-probe.json', JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2) + '\n');
for (const r of results) console.log(r.name, r.status ?? r.error, Object.keys(r.hints || {}).join(',') || '-', `jsonld=${r.jsonLdJobs}`, r.finalUrl);
