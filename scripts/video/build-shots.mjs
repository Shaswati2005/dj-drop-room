// node scripts/video/build-shots.mjs: writes scripts/video/shots/*.json, one file per shot of the
// demo video (adapted to what exists at the Day 12 freeze). Edit here, rebuild, commit
// the JSON. Each file is { id, title, timing, device, setup[], steps[], expect }, where every
// { "seq": ... } step is exactly an `xr run-sequence` input (so it also runs by hand with
// `npx @iwsdk/cli xr run-sequence --input-json "$(jq -c .steps[0].seq shots/NN.json)"`).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');
fs.mkdirSync(dir, { recursive: true });

// the resting hand sits by the hip, clear of the console (never over a pad)
const REST = { 'hand-left': { x: -0.35, y: -0.25, z: -0.05 }, 'hand-right': { x: 0.35, y: -0.25, z: -0.05 } };
const rest = (hand, lift = 0.06) => ({ label: 'rest', anchor: 'wrist', position: { relativeTo: 'head', ...REST[hand] }, depart: { distance: lift } });
/** A poke: head turns to the pad, the hand arcs over (minimum-jerk), presses, lifts and rests. */
// `over` is how far above the pad the hand arcs in (and lifts out), for pads that sit behind other controls
// `via` (optional) routes the hand through a raised point in front of the chest on the way in and
// out, for controls whose straight path from the hip would cross other controls
const VIA = { 'hand-left': { x: -0.18, y: -0.18, z: -0.22 }, 'hand-right': { x: 0.18, y: -0.18, z: -0.22 } };
const viaStep = (hand) => ({ label: 'raise', anchor: 'wrist', position: { relativeTo: 'head', ...VIA[hand] } });
const press = (name, hand, over = 0.05, hold = 0.15, via = false) => ({
  seq: {
    device: hand,
    steps: [
      ...(via ? [viaStep(hand)] : []),
      { label: name, target: { name, face: 'top' }, approach: { distance: over }, press: { hold } },
      ...(via ? [{ ...viaStep(hand), depart: { distance: Math.max(0.06, over) } }, rest(hand, 0.02)] : [rest(hand, Math.max(0.06, over))]),
    ],
  },
});
/** A held poke (ECHO / SPACE): the fingertip is put 8 mm into the pad and left there. */
const hold = (name, hand, seconds, over = 0.05, via = false) => ({
  seq: {
    device: hand,
    steps: [
      ...(via ? [viaStep(hand)] : []),
      { label: name, target: { name, face: 'top' }, anchor: 'index-tip', poseId: 'point', approach: { distance: over }, offset: { normal: -0.008 } },
      { label: 'hold', duration: seconds },
      ...(via ? [{ ...viaStep(hand), depart: { distance: Math.max(0.06, over) } }, rest(hand, 0.02)] : [rest(hand, Math.max(0.06, over))]),
    ],
  },
});
const wait = (seconds) => ({ wait: seconds });
const waitFor = (what, timeout) => ({ waitFor: what, timeout });
const L = 'hand-left';
const R = 'hand-right';

const shots = [
  {
    id: '01-cold-open',
    title: 'Cold open: the first DROP in your room',
    timing: '0:00-0:08 (about 10 s of capture; trim to the riser and the landing)',
    device: 'metaQuest3',
    setup: ['reset', 'enter', 'unmute', 'music', 'wait:14'],
    steps: [press('Drop', R, 0.1), waitFor('dropLanded', 20), wait(5)],
    expect: 'dropLanded',
  },
  {
    id: '02-start',
    title: 'Tap to start: the music begins on the bar, the crowd starts bobbing',
    timing: '0:08-0:25',
    device: 'metaQuest3',
    setup: ['reset', 'enter', 'unmute'],
    steps: [wait(3), press('Start Pad', R), waitFor('playing', 10), wait(8)],
    expect: 'playing',
  },
  {
    id: '03-stems',
    title: 'Stem pads: bass out, drums out, everything back, every change on the bar',
    timing: '0:25-0:50',
    device: 'metaQuest3',
    setup: ['reset', 'enter', 'unmute', 'music', 'wait:6'],
    steps: [press('Pad A Bass', L), wait(4), press('Pad A Drums', L), wait(4), press('Pad A Bass', L), wait(2), press('Pad A Drums', L), wait(4)],
    expect: 'stemsBack',
  },
  {
    id: '04-mix',
    title: 'Crate pick, deck B, crossfader B end: a four-bar fade with the bass swap',
    timing: '0:50-1:15',
    device: 'metaQuest3',
    setup: ['reset', 'enter', 'unmute', 'music', 'wait:6'],
    steps: [press('Load Mirrorball B', R), waitFor('mirrorballOnB', 15), wait(1), press('Play B', R), wait(4), press('Xf End B', R), waitFor('faded', 30), wait(2)],
    expect: 'mixed',
  },
  {
    id: '05-full-build',
    title: 'The full build: filter slide, ECHO hold, loop, then DROP and the tier up',
    timing: '1:15-1:40',
    device: 'metaQuest3',
    setup: ['reset', 'enter', 'unmute', 'music', 'wait:10'],
    steps: [
      { slide: { name: 'Filter A', hand: L, dx: -0.015 } },
      wait(3),
      press('Filter A', L, 0.14, 0.15, true),
      press('Mode A Loop', L, 0.14, 0.15, true),
      press('Pad A Bass', L),
      wait(5),
      press('Pad A Bass', L),
      hold('Fx Echo', L, 2.5, 0.05),
      press('Drop', R, 0.1),
      waitFor('dropLanded', 20),
      wait(8),
    ],
    expect: 'build',
  },
  {
    id: '06-genre-tour',
    title: 'Genre tour on bar cuts: Concrete (techno) then Rainy Tape (lo-fi) over Mirrorball',
    timing: '1:40-1:55',
    device: 'metaQuest3',
    setup: ['reset', 'enter', 'unmute', 'onair-mirrorball-b', 'wait:4'],
    steps: [
      press('Load Concrete A', L),
      waitFor('concreteOnA', 15),
      press('Play A', L),
      wait(2),
      press('Xf End A', R),
      waitFor('crossfaderA', 30),
      press('Play B', R),
      wait(2),
      press('Load Rainy Tape B', R),
      waitFor('rainyOnB', 15),
      press('Play B', R),
      wait(2),
      press('Xf End B', R),
      waitFor('faded', 30),
      wait(3),
    ],
    expect: 'tour',
  },
  {
    id: '07-come-back',
    title: "Come back tomorrow: tonight's request toast, then Finish Set and the card with 'Your best'",
    timing: '1:55-2:05 (the toast arrives about 8 bars after the first drop)',
    device: 'metaQuest3',
    setup: ['reset', 'seed-best', 'enter', 'unmute', 'music', 'wait:8'],
    steps: [press('Drop', R, 0.1), waitFor('requestShown', 60), wait(6), press('Set Finish', R), waitFor('cardUp', 15), wait(6)],
    expect: 'cardUp',
  },
  {
    id: '08-accessibility',
    title: 'One hand only, playable without sound (3 s muted), reduced flash',
    timing: '2:05-2:15',
    device: 'metaQuest3',
    setup: ['reset', 'enter', 'unmute', 'music', 'wait:8'],
    steps: [
      press('Pad A Bass', R),
      wait(3),
      { mute: true },
      press('Set Flash', R),
      press('Pad A Chords', R),
      wait(3),
      { mute: false },
      press('Drop', R, 0.16),
      waitFor('dropLanded', 20),
      wait(4),
    ],
    expect: 'accessibility',
  },
  {
    id: '08b-glasses',
    title: 'Meta VR Glasses view: ray + pinch from a far hand presses a pad and DROP (the black mask is the 74 x 68 degree view)',
    timing: '2:15-2:22',
    device: 'metaVRGlasses',
    setup: ['reset', 'enter', 'unmute', 'music', 'wait:8', 'glasses-pose'],
    steps: [
      { ray: { name: 'Pad A Bass', hand: 'hand-right' } },
      wait(1.2),
      { pinch: { hand: 'hand-right' } },
      wait(3),
      { ray: { name: 'Drop', hand: 'hand-right' } },
      wait(1.2),
      { pinch: { hand: 'hand-right' } },
      waitFor('dropLanded', 20),
      wait(4),
    ],
    expect: 'glasses',
  },
];
for (const s of shots) fs.writeFileSync(path.join(dir, `${s.id}.json`), JSON.stringify(s, null, 2) + '\n', 'utf8');
console.log(`wrote ${shots.length} shots to ${dir}`);
