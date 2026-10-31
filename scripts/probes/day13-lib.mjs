// Shared Node helpers for the Day 13 drivers (verify-day13, verify-glasses, soak).
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

export const sh = (cmd, timeout = 600000) => {
  try {
    return execSync(cmd, { encoding: 'utf8', shell: 'bash', timeout, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
  } catch (e) {
    return `${e.stdout ?? ''}${e.stderr ?? ''}\nCOMMAND FAILED: ${cmd}`;
  }
};
export const sleep = (s) => sh(`sleep ${s}`);
export const q = (o) => `'${JSON.stringify(o)}'`;
/** Run a CLI action with --raw and return the parsed JSON ({} when unparseable). */
export function cli(args, input, timeout = 60000) {
  const out = sh(`npx @iwsdk/cli ${args}${input ? ` --input-json ${q(input)}` : ''} --raw --timeout ${timeout}`, timeout + 30000);
  try {
    return JSON.parse(out);
  } catch {
    return { raw: out };
  }
}
/** Run a browser-run probe script and return its parsed result. */
export function probe(file, timeout = 105000) {
  const j = cli(`browser run ${file}`, null, timeout);
  const r = j.data?.result ?? j.result;
  if (r == null) throw new Error(`probe ${file} failed: ${JSON.stringify(j).slice(0, 400)}`);
  return typeof r === 'string' ? JSON.parse(r) : r;
}
/** Leave XR, reload the page, and wait until the debug API is back. */
export function fresh() {
  sh('npx @iwsdk/cli xr exit --raw', 60000);
  sh('npx @iwsdk/cli browser reload --raw', 60000);
  sleep(12);
}
export function makeChecker() {
  const results = [];
  const check = (label, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${detail}`);
  };
  return { check, results };
}
/** The number the console-log buffer reports for errors and warnings. */
export function consoleCount() {
  const j = cli('browser logs', { count: 500 });
  const logs = j.data?.logs ?? j.data?.result?.logs ?? j.logs ?? [];
  return { logs, raw: j };
}

/** Read the emulator device from iwsdk.config.json. */
export function emulatorDevice() {
  return JSON.parse(readFileSync('iwsdk.config.json', 'utf8')).dev.emulator.device;
}
/**
 * Switch dev.emulator.device (Vite restarts in place and the page reloads), then wait for the
 * browser bridge. Edits only that one value, so the file's formatting is kept.
 */
export function setEmulatorDevice(device) {
  const text = readFileSync('iwsdk.config.json', 'utf8');
  const next = text.replace(/("device":\s*")[A-Za-z0-9]+(")/, `$1${device}$2`);
  if (next === text && emulatorDevice() !== device) throw new Error('could not edit dev.emulator.device');
  if (next === text) return;
  sh('npx @iwsdk/cli xr exit --raw', 60000);
  writeFileSync('iwsdk.config.json', next, 'utf8');
  for (let i = 0; i < 60; i++) {
    sleep(3);
    const out = sh('npx @iwsdk/cli dev status', 60000);
    if (/"browserCommandReady":\s*true/.test(out)) {
      sleep(4);
      return;
    }
  }
  throw new Error('dev server did not become ready after the config change');
}

/** Run statements in the page (`d` = the debug API, `en` = the engine) and return what they return. */
export function evalInPage(body) {
  mkdirSync('scripts/probes/_tmp', { recursive: true });
  const file = 'scripts/probes/_tmp/eval.mjs';
  writeFileSync(
    file,
    `export default async function run({ page, frame }) {
  const app = frame ?? page;
  return JSON.stringify(await app.evaluate(async () => {
    const d = window.__dropRoom;
    const en = d.engine();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (p, ms) => { const end = performance.now() + ms; while (!p()) { if (performance.now() > end) throw new Error('timeout'); await sleep(80); } };
    ${body}
  }));
}
`,
    'utf8',
  );
  try {
    return probe(file, 90000);
  } finally {
    rmSync(file, { force: true });
  }
}
