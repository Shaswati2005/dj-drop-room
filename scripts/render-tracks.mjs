// Renders every track's stems to public/audio/tracks/<id>/<stem>.ogg.
// Needs the dev server started with --allow-browser-automation, then:
//   npx @iwsdk/cli browser run scripts/render-tracks.mjs --timeout 100000
// Rendering happens in the managed browser (Web Audio, offline); this side
// writes a WAV and encodes it with ffmpeg (Opus, 96 kb/s, mono, 48 kHz).
// Existing files are skipped and one call has a time budget, so run it again
// until it reports nothing left; delete a file to render it again.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RATE = 48000;
const BUDGET_MS = 80000;

function wav(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export default async function run({ page, frame, workspaceRoot }) {
  const app = frame ?? page;
  await app.waitForFunction(() => window.__dropRoom != null, null, { timeout: 30000 });
  const tracks = await app.evaluate(async () => {
    const { TRACKS } = await import('/src/audio/tracks/catalog.ts');
    return Object.keys(TRACKS);
  });
  const stems = ['drums', 'bass', 'chords', 'melody'];
  const started = Date.now();
  const done = [];
  const left = [];
  for (const track of tracks) {
    const dir = join(workspaceRoot, 'public', 'audio', 'tracks', track);
    mkdirSync(dir, { recursive: true });
    for (const stem of stems) {
      const out = join(dir, `${stem}.ogg`);
      if (existsSync(out)) continue;
      if (Date.now() - started > BUDGET_MS) {
        left.push(`${track}/${stem}`);
        continue;
      }
      const b64 = await app.evaluate(([t, s]) => window.__dropRoom.renderStem(t, s), [track, stem]);
      const tmp = join(tmpdir(), `drop-room-${track}-${stem}.wav`);
      writeFileSync(tmp, wav(Buffer.from(b64, 'base64')));
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-c:a', 'libopus', '-b:a', '96k', '-ac', '1', out]);
      rmSync(tmp);
      done.push(`${track}/${stem}`);
    }
  }
  return `rendered: ${done.join(', ') || 'none'}; left: ${left.join(', ') || 'none'} (${Date.now() - started} ms)`;
}
