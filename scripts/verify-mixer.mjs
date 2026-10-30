// Days 5-6 check (npx @iwsdk/cli browser run scripts/verify-mixer.mjs --timeout 100000):
// every mixer control audibly changes the sound (measured on the meters), and
// the pad modes, loops, rolls, hot cues, solo and jog do what a DJ expects.
export default async function run({ page, frame }) {
  const app = frame ?? page;
  const out = [];
  const check = (label, ok, detail = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${label} ${detail}`);
  const wait = (ms) => app.waitForTimeout(ms);
  const state = () => app.evaluate(() => window.__dropRoom.state());
  const e = (fn, arg) => app.evaluate(fn, arg);
  // average level over `ms`: 'A'/'B' = channel meter (post-fader), 'master' = output
  const level = (which, ms = 1000) =>
    e(async ({ which, ms }) => {
      let sum = 0;
      let n = 0;
      const end = performance.now() + ms;
      while (performance.now() < end) {
        const s = window.__dropRoom.state();
        sum += which === 'master' ? s.level : s[which].level;
        n++;
        await new Promise((r) => setTimeout(r, 40));
      }
      return sum / n;
    }, { which, ms });
  const pct = (a, b) => `${a.toFixed(3)} → ${b.toFixed(3)}`;

  await app.waitForFunction(() => window.__dropRoom != null, null, { timeout: 30000 });
  await app.locator('#start-music').click();
  await app.waitForFunction(() => window.__dropRoom.state().A.playing, null, { timeout: 10000 });
  let s = await state();
  check('deck B holds the 2nd track, Concrete (128 BPM)', s.B.trackId === 'concrete' && Math.abs(s.B.bpm - 128) < 0.01 && s.B.duration > 130, `${s.B.trackName} ${s.B.duration.toFixed(1)} s`);
  await wait(4500); // into the build, where the kick and bass are steady

  // channel fader
  const base = await level('A');
  await e(() => window.__dropRoom.engine().setFader('A', 0));
  await wait(900); // let the meter fall (it releases with a 0.15 s time constant)
  const faded = await level('A', 600);
  check('channel fader down silences channel A', faded < base * 0.05, pct(base, faded));
  await e(() => window.__dropRoom.engine().setFader('A', 1));

  // EQ: LOW kill, then the FILTER (levels averaged over one whole 124 BPM bar, 1.94 s, so the beat phase cannot skew the comparison)
  const before = await level('A', 1940);
  await e(() => window.__dropRoom.engine().tapKnob('A', 'low'));
  await wait(300);
  const killed = await level('A', 1940);
  s = await state();
  check('LOW kill takes the kick and bass out (level drops > 30 %)', s.A.kills[2] && killed < before * 0.7, pct(before, killed));
  await e(() => window.__dropRoom.engine().tapKnob('A', 'low'));
  // the low-pass end keeps the kick, so check its cutoff; the high-pass end shows on the meter
  const lp = await e(() => { const en = window.__dropRoom.engine(); en.setKnob('A', 'filter', -1); return new Promise((r) => setTimeout(() => r(en.channels.A.lowpass.frequency.value), 200)); });
  check('FILTER hard left: low-pass closes to 150 Hz', lp < 160, `${lp.toFixed(0)} Hz`);
  await e(() => window.__dropRoom.engine().setKnob('A', 'filter', 0));
  await wait(300);
  const open = await level('A', 600);
  await e(() => window.__dropRoom.engine().setKnob('A', 'filter', 1));
  await wait(300);
  const filtered = await level('A', 600);
  check('FILTER hard right (high-pass) thins channel A out', filtered < open * 0.4, pct(open, filtered));
  await e(() => window.__dropRoom.engine().tapKnob('A', 'filter'));
  s = await state();
  check('tapping FILTER snaps it back to the centre', s.A.knobs[4] === 0);
  await wait(300);
  const untrimmed = await level('A', 600);
  await e(() => window.__dropRoom.engine().setKnob('A', 'trim', -1));
  await wait(300);
  const trimmed = await level('A', 600);
  check('TRIM down lowers the channel (-12 dB)', trimmed < untrimmed * 0.45, pct(untrimmed, trimmed));
  await e(() => window.__dropRoom.engine().tapKnob('A', 'trim'));

  // crossfader: all the way to B (paused) silences the output
  await e(() => window.__dropRoom.engine().setCrossfader(1));
  await wait(400); // let the meter fall
  const master = await level('master', 600);
  check('crossfader at B with only A playing → master silent', master < 0.02, master.toFixed(4));
  await e(() => window.__dropRoom.engine().fadeTo('A'));
  await wait(2000);
  s = await state();
  check('A end button glides the crossfader back over 4 bars', s.fadingTo === 'A' && s.crossfader < 0.6 && s.crossfader > -1, `x = ${s.crossfader.toFixed(2)}`);
  await e(() => window.__dropRoom.engine().setCrossfader(0));

  // ECHO: pausing with echo on leaves a tail
  await e(() => window.__dropRoom.engine().toggleEcho());
  await wait(2800);
  await e(() => window.__dropRoom.engine().togglePlay('A'));
  await wait(150);
  const tail = await level('master', 500);
  s = await state();
  check('ECHO on: the echo rings on after the deck stops', s.echo && tail > 0.01, `tail ${tail.toFixed(3)}`);
  await e(() => window.__dropRoom.engine().toggleEcho());
  await e(() => window.__dropRoom.engine().togglePlay('A'));
  await wait(300);

  // LOOP mode: 1-bar loop holds the playhead inside it
  await e(() => window.__dropRoom.engine().setPadMode('A', 'loop'));
  await e(() => window.__dropRoom.engine().pad('A', 0, true));
  const region = await e(() => ({ ...window.__dropRoom.engine().decks.A.region }));
  await wait(4500);
  s = await state();
  check('LOOP 1 bar: playhead stays inside the loop after 2+ bars', s.A.loopBars === 1 && s.A.position >= region.start - 0.01 && s.A.position < region.end, `${region.start.toFixed(2)}–${region.end.toFixed(2)} s, at ${s.A.position.toFixed(2)}`);
  await e(() => window.__dropRoom.engine().pad('A', 0, true));
  s = await state();
  check('same pad again exits the loop', s.A.loopBars === 0);

  // roll with slip: release lands where the track would have been
  const p0 = await e(() => {
    const en = window.__dropRoom.engine();
    const t = en.context.currentTime;
    en.pad('A', 6, true); // 1-beat roll
    return { pos: en.decks.A.position(t), t, rate: en.decks.A.rate };
  });
  await wait(1500);
  const rolled = await e(() => {
    const en = window.__dropRoom.engine();
    const t = en.context.currentTime;
    const during = { roll: en.decks.A.roll, region: { ...en.decks.A.region } };
    en.pad('A', 6, false);
    return { ...during, pos: en.decks.A.position(t + 0.05), t: t + 0.05 };
  });
  const expected = p0.pos + (rolled.t - p0.t) * p0.rate;
  check('beat roll held: a 1-beat slice repeats', rolled.roll === 2 && Math.abs(rolled.region.end - rolled.region.start - 240 / 124 / 4) < 1e-6);
  check('roll released: back in place as if never rolled (slip)', Math.abs(rolled.pos - expected) < 0.03, `${rolled.pos.toFixed(3)} vs ${expected.toFixed(3)} s`);

  // HOT CUES: set, then jump on the next beat
  await e(() => window.__dropRoom.engine().setPadMode('A', 'cues'));
  await e(() => window.__dropRoom.engine().pad('A', 0, true));
  s = await state();
  const cue = s.A.hotCues[0];
  const beat = 240 / 124 / 4;
  check('hot cue 1 stored on a beat', cue >= 0 && Math.abs(cue / beat - Math.round(cue / beat)) < 1e-6, `${cue.toFixed(3)} s`);
  await wait(2500);
  await e(() => window.__dropRoom.engine().pad('A', 0, true));
  await wait(700);
  s = await state();
  check('hot cue 1 again jumps back there', s.A.position - cue >= 0 && s.A.position - cue < 0.7, `cue ${cue.toFixed(2)}, now ${s.A.position.toFixed(2)} s`);
  await e(() => window.__dropRoom.engine().pad('A', 4, true));
  s = await state();
  check('bottom pad deletes hot cue 1', s.A.hotCues[0] === -1);

  // STEMS solo (bottom row)
  await e(() => window.__dropRoom.engine().setPadMode('A', 'stems'));
  await e(() => window.__dropRoom.engine().pad('A', 5, true));
  await wait(2300);
  s = await state();
  check('solo bass: only the bass from the next bar', JSON.stringify(s.A.stems) === '[0,1,0,0]' && s.A.soloed === 1, JSON.stringify(s.A.stems));
  await e(() => window.__dropRoom.engine().pad('A', 5, true));
  await wait(2300);
  s = await state();
  check('solo again: all stems back', s.A.stems.every((v) => v === 1), JSON.stringify(s.A.stems));

  // JOG: paused → one turn moves 1.8 s; playing → pitch bend
  const jog = await e(() => {
    const en = window.__dropRoom.engine();
    const before = en.decks.B.position(0);
    en.jog('B', Math.PI * 2, 0.5);
    const scrubbed = en.decks.B.position(0) - before;
    en.jog('A', Math.PI, 0.5);
    const bend = en.decks.A.bend;
    en.jog('A', 0, 0.016);
    return { scrubbed, bend, after: en.decks.A.bend };
  });
  check('jog on a paused deck: one turn = 1.8 s of track', Math.abs(jog.scrubbed - 1.8) < 0.001, `${jog.scrubbed.toFixed(3)} s`);
  check('jog on a playing deck bends the pitch, then lets go', jog.bend > 0.05 && jog.after === 0, `bend ${jog.bend.toFixed(3)}`);
  return out.join('\n');
}
