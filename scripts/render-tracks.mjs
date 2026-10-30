// Renders every track's stems to public/audio/tracks/<id>/<stem>.ogg.
// Needs the dev server started with --allow-browser-automation, then:
//   npx @iwsdk/cli browser run scripts/render-tracks.mjs --timeout 105000
// Rendering happens in the managed browser (Web Audio, offline); this side
// writes a WAV and encodes it with ffmpeg (Opus, 96 kb/s, mono, 48 kHz).
// Existing files are skipped. A managed-browser script may run at most 110 s,
// and a whole drum stem can take that long, so stems are rendered in chunks of
// bars (cached as raw PCM in the temp folder); one call renders chunks until
// its time budget is used, so run it again until it reports nothing left.
// Delete a track's .ogg to render it again.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RATE = 48000;
const BUDGET_MS = 45000;
/** bars per chunk: drum stems are ~4x slower to render than the others */
const CHUNK_BARS = { drums: 16, bass: 48, chords: 48, melody: 48 };

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
    const { trackBars } = await import('/src/audio/track-model.ts');
    return Object.values(TRACKS).map((t) => ({ id: t.id, bars: trackBars(t) }));
  });
  const stems = ['drums', 'bass', 'chords', 'melody'];
  const started = Date.now();
  const done = [];
  const left = [];
  for (const track of tracks) {
    const dir = join(workspaceRoot, 'public', 'audio', 'tracks', track.id);
    mkdirSync(dir, { recursive: true });
    for (const stem of stems) {
      const out = join(dir, `${stem}.ogg`);
      if (existsSync(out)) continue;
      const size = CHUNK_BARS[stem];
      const chunks = [];
      for (let from = 0; from < track.bars; from += size) {
        const bars = Math.min(size, track.bars - from);
        const file = join(tmpdir(), `drop-room-${track.id}-${stem}-${from}-${bars}.pcm`);
        chunks.push(file);
        if (existsSync(file)) continue;
        if (Date.now() - started > BUDGET_MS) continue;
        const b64 = await app.evaluate(([t, s, f, n]) => window.__dropRoom.renderStemChunk(t, s, f, n), [track.id, stem, from, bars]);
        writeFileSync(file, Buffer.from(b64, 'base64'));
      }
      if (!chunks.every((file) => existsSync(file))) {
        left.push(`${track.id}/${stem}`);
        continue;
      }
      const pcm = Buffer.concat(chunks.map((file) => readFileSync(file)));
      const tmp = join(tmpdir(), `drop-room-${track.id}-${stem}.wav`);
      writeFileSync(tmp, wav(pcm));
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-c:a', 'libopus', '-b:a', '96k', '-ac', '1', out]);
      rmSync(tmp);
      for (const file of chunks) rmSync(file);
      done.push(`${track.id}/${stem}`);
    }
  }
  return `rendered: ${done.join(', ') || 'none'}; left: ${left.join(', ') || 'none'} (${Date.now() - started} ms)`;
}
