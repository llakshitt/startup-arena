#!/usr/bin/env node
// Pulls live open roles from each company's public job-board API and writes data/jobs.json.
// Needs Node 18+ (built-in fetch). No npm packages.
//
//   node scripts/fetch-jobs.mjs              # all boards
//   node scripts/fetch-jobs.mjs --only=paytm # one board, for debugging

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ADAPTERS, buildDataset } from './lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (rel, fallback) => {
  try {
    return JSON.parse(await readFile(path.join(root, rel), 'utf8'));
  } catch {
    return fallback;
  }
};

async function getJson(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { accept: 'application/json', 'user-agent': 'startup-arena-refresh/1.0 (daily job-board read)' },
      });
      if (res.status === 404) return { status: 'notfound' };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { status: 'ok', data: await res.json() };
    } catch (e) {
      if (attempt === 1) return { status: 'error', error: String(e.message || e) };
      await new Promise((r) => setTimeout(r, 1500));
    } finally {
      clearTimeout(timer);
    }
  }
}

async function fetchBoard(board) {
  const adapter = ADAPTERS[board.ats];
  if (!adapter) return { status: 'error', error: `unknown ats "${board.ats}"` };

  if (!adapter.paged) {
    const r = await getJson(adapter.url(board.slug));
    if (r.status !== 'ok') return r;
    return { status: 'ok', rawJobs: adapter.parse(r.data, board.slug) };
  }

  const rawJobs = [];
  for (let offset = 0; offset < 2000; offset += 100) {
    const r = await getJson(adapter.url(board.slug, offset));
    if (r.status !== 'ok') return offset === 0 ? r : { status: 'ok', rawJobs };
    const page = adapter.parse(r.data, board.slug);
    rawJobs.push(...page);
    if (!page.length || rawJobs.length >= (r.data.totalFound ?? 0)) break;
  }
  return { status: 'ok', rawJobs };
}

const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7)?.toLowerCase();
const boards = (await readJson('data/boards.json', [])).filter(
  (b) => !only || b.slug.toLowerCase() === only || b.name.toLowerCase() === only
);
const places = await readJson('data/places.json');
const prev = await readJson('data/jobs.json', null);

const { dataset, report } = await buildDataset({ boards, places, fetchBoard, prev });

const ok = report.filter((r) => r.status === 'ok');
const total = dataset.pins.reduce((n, p) => n + p.jobs.length, 0);
await writeFile(
  path.join(root, 'data/report.json'),
  JSON.stringify({ generatedAt: dataset.generatedAt, boardsTried: report.length, boardsOk: ok.length, report }, null, 2) + '\n'
);

console.log(`${ok.length}/${report.length} boards reachable, ${total} live roles in Jaipur/Noida`);
for (const r of report.filter((r) => r.status !== 'ok')) console.log(`  ✗ ${r.company} (${r.ats}/${r.slug}): ${r.status} ${r.error || ''}`);

if (ok.length === 0) {
  console.error('No board answered. Keeping the previous data/jobs.json untouched.');
  process.exit(1);
}
if (only) {
  console.log('--only run: not overwriting data/jobs.json');
} else {
  await writeFile(path.join(root, 'data/jobs.json'), JSON.stringify(dataset) + '\n');
}
