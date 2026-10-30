// Full regression (node scripts/verify-everything.mjs): typecheck, unit tests,
// build, then every emulator check from a clean page, with a PASS/FAIL tally.
import { execSync } from 'node:child_process';

const sh = (cmd, timeout = 600000) => {
  try {
    return execSync(cmd, { encoding: 'utf8', shell: 'bash', timeout, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
  } catch (e) {
    return `${e.stdout ?? ''}${e.stderr ?? ''}\nFAIL command exited: ${cmd}`;
  }
};
const fresh = () => {
  sh('npx @iwsdk/cli xr exit --raw', 60000);
  sh('npx @iwsdk/cli browser reload --raw', 60000);
  sh('sleep 12');
};
const lines = (text) => text.split('\n').filter((l) => /^(PASS|FAIL)/.test(l));
const summary = [];
const record = (name, found) => {
  const fails = found.filter((l) => l.startsWith('FAIL'));
  summary.push(`${fails.length ? 'FAIL' : 'PASS'} ${name}: ${found.length - fails.length}/${found.length}`);
  for (const f of fails) summary.push(`     ${f}`);
  console.log(summary.slice(-1 - fails.length).join('\n'));
};

record('typecheck', [/error TS/.test(sh('npm run --if-present typecheck')) ? 'FAIL type errors' : 'PASS no type errors']);
const unit = sh('npx vitest run');
record('unit tests', [/Tests\s+.*failed/.test(unit) || !/Tests\s+.*passed/.test(unit) ? 'FAIL vitest' : 'PASS vitest']);
record('build', [/built in/.test(sh('npm run build')) ? 'PASS vite build' : 'FAIL vite build']);

for (const name of ['verify-audio', 'verify-decks', 'verify-mixer', 'verify-drop', 'verify-day9', 'verify-day9-share', 'verify-day11', 'verify-day11-show']) {
  fresh();
  const out = sh(`npx @iwsdk/cli browser run scripts/${name}.mjs --timeout 105000 --raw`);
  let text = out;
  try {
    const j = JSON.parse(out);
    const r = j.data?.result ?? j.result;
    text = typeof r === 'string' ? r : JSON.stringify(r ?? j);
  } catch {}
  const found = lines(text);
  record(name, found.length ? found : [`FAIL no results: ${text.slice(0, 200)}`]);
}
for (const name of ['verify-console', 'verify-all-controls', 'verify-coach', 'verify-placement', 'verify-pause', 'verify-crate', 'verify-club', 'verify-day11-hands']) {
  fresh();
  // the every-control sweep takes ~12 minutes of CLI round trips
  const found = lines(sh(`node scripts/${name}.mjs`, 1800000));
  record(name, found.length ? found : ['FAIL no results']);
}
console.log('\n===== SUMMARY =====\n' + summary.join('\n'));
