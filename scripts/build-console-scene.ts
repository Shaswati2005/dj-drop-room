// Regenerates the console's child nodes in the scene from console-layout.ts so
// the controls always sit on the body's slots and wells.
// Run: npx vite-node scripts/build-console-scene.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { BODY, CRATE_LAYOUT, DECK, SETTINGS_LAYOUT, deckX, MIXER, PRESS_HEIGHT, STRIP_X } from '../src/scene-assets/console-layout.js';
import { CRATE_ORDER } from '../src/audio/tracks/catalog.js';

const SCENE = 'public/scenes/droproom.iwsdk.scene.json';
const SURFACE = BODY.top + 0.0016; // on the faceplates
const STEMS = ['drums', 'bass', 'chords', 'melody'];
const poke = { PokeInteractable: {}, RayInteractable: {} };
const r = (v: number) => Math.round(v * 10000) / 10000;

type Node = { id: string; name?: string; content?: object; transform?: object; components?: object; children?: Node[] };
const node = (id: string, asset: string, x: number, y: number, z: number, components?: object): Node => ({
  id,
  // 'pad-a-bass' → 'Pad A Bass': what the editor shows and tests target
  name: id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '),
  content: { type: 'asset', asset },
  transform: { position: [r(x), r(y), r(z)] },
  ...(components ? { components } : {}),
});
const button = (deck: 'A' | 'B', action: string, index = 0) => ({ PushButton: { action, deck, index, lit: false, armed: false }, ...poke });
// pinch to slide along one local axis, nothing else
const slider = (x: number, y: number, z: number, axis: 'x' | 'z', a: number, b: number) => ({
  OneHandGrabbable: {
    rotate: false,
    translate: true,
    translateMin: [axis === 'x' ? r(Math.min(a, b)) : r(x), r(y), axis === 'z' ? r(Math.min(a, b)) : r(z)],
    translateMax: [axis === 'x' ? r(Math.max(a, b)) : r(x), r(y), axis === 'z' ? r(Math.max(a, b)) : r(z)],
  },
});
// pinch and twist about the knob's own axis
const twist = (limit: number) => ({ OneHandGrabbable: { rotate: true, translate: false, rotateMin: [0, -limit, 0], rotateMax: [0, limit, 0] } });

/** Tempo fader: DJ-player convention, toward the player = faster. */
function tempoFader(id: 'A' | 'B'): Node {
  const x = deckX(DECK.tempo.x, id);
  const slow = DECK.tempo.z - DECK.tempo.length * 0.45;
  const fast = DECK.tempo.z + DECK.tempo.length * 0.45;
  return node(`tempo-${id.toLowerCase()}`, 'tempo-fader-cap', x, SURFACE, DECK.tempo.z, {
    Fader: { deck: id, control: 'tempo', from: r(slow), to: r(fast), value: 0 },
    ...slider(x, SURFACE, DECK.tempo.z, 'z', slow, fast),
  });
}

function deck(id: 'A' | 'B'): Node[] {
  const d = id.toLowerCase();
  const x = (v: number) => deckX(v, id);
  const nodes: Node[] = [
    node(`jog-${d}`, `jog-wheel-${d}`, x(DECK.jog.x), SURFACE, DECK.jog.z, { JogWheel: { deck: id }, ...twist(1000) }),
    tempoFader(id),
    node(`sync-${d}`, 'sync-button', x(DECK.sync[0]), BODY.top + PRESS_HEIGHT.small, DECK.sync[1], button(id, 'sync')),
    node(`cue-${d}`, 'cue-button', x(DECK.cue[0]), BODY.top + PRESS_HEIGHT.round, DECK.cue[1], button(id, 'cue')),
    node(`play-${d}`, 'play-button', x(DECK.play[0]), BODY.top + PRESS_HEIGHT.round, DECK.play[1], button(id, 'play')),
  ];
  ['stems', 'cues', 'loop'].forEach((mode, i) => {
    const [mx, mz] = DECK.modes[i];
    nodes.push(node(`mode-${d}-${mode}`, 'mode-button', x(mx), BODY.top + PRESS_HEIGHT.small, mz, button(id, 'mode', i)));
  });
  DECK.pads.zs.forEach((pz, row) =>
    DECK.pads.xs.forEach((px, col) => {
      // the top row is named for its STEMS-mode job; tests target those names
      const name = row === 0 ? `pad-${d}-${STEMS[col]}` : `pad-${d}-${row * 4 + col + 1}`;
      const components = { PerfPad: { deck: id, slot: row * 4 + col }, ...poke };
      nodes.push(node(name, 'performance-pad', x(px), BODY.top + PRESS_HEIGHT.pad, pz, components));
    }),
  );
  return nodes;
}

function mixer(): Node[] {
  const nodes: Node[] = [];
  for (const id of ['A', 'B'] as const) {
    const sx = id === 'A' ? -STRIP_X : STRIP_X;
    const d = id.toLowerCase();
    for (const k of MIXER.knobs) {
      const control = k.name === 'hi' ? 'high' : k.name;
      nodes.push(node(`${k.name}-${d}`, k.large ? 'knob-large' : 'knob-small', sx, SURFACE, k.z, { Knob: { deck: id, control }, ...poke }));
    }
    // channel faders: down (toward the player) is silent, up is full
    const down = MIXER.fader.z + MIXER.fader.length * 0.45;
    const up = MIXER.fader.z - MIXER.fader.length * 0.45;
    nodes.push(node(`fader-${d}`, 'channel-fader-cap', sx, SURFACE, up, { Fader: { deck: id, control: 'channel', from: r(down), to: r(up), value: 1 }, ...slider(sx, SURFACE, up, 'z', down, up) }));
  }
  const half = MIXER.crossfader.length * 0.45;
  nodes.push(node('crossfader', 'crossfader-cap', 0, SURFACE, MIXER.crossfader.z, { Fader: { deck: 'A', control: 'crossfader', from: r(-half), to: r(half), value: 0 }, ...slider(0, SURFACE, MIXER.crossfader.z, 'x', -half, half) }));
  nodes.push(node('xf-end-a', 'crossfade-end-a', MIXER.ends[0], BODY.top + PRESS_HEIGHT.round, MIXER.crossfader.z, button('A', 'fade')));
  nodes.push(node('xf-end-b', 'crossfade-end-b', MIXER.ends[1], BODY.top + PRESS_HEIGHT.round, MIXER.crossfader.z, button('B', 'fade')));
  nodes.push(node('fx-echo', 'fx-button', MIXER.fx[0][0], BODY.top + PRESS_HEIGHT.small, MIXER.fx[0][1], button('A', 'echo')));
  nodes.push(node('fx-space', 'fx-button', MIXER.fx[1][0], BODY.top + PRESS_HEIGHT.small, MIXER.fx[1][1], button('A', 'space')));
  nodes.push(node('drop', 'drop-button', MIXER.drop[0], BODY.top + PRESS_HEIGHT.drop, MIXER.drop[1], button('A', 'drop')));
  // hovers over DROP until the music starts, then hides
  nodes.push(node('start-pad', 'start-pad', MIXER.drop[0], BODY.top + 0.04, MIXER.drop[1], { PushButton: { action: 'start', deck: 'A', lit: true, armed: false }, ...poke }));
  return nodes;
}

/** Crate shelf: a load button per deck for each track, plus REC and SHARE. */
function crate(): Node[] {
  const nodes: Node[] = [];
  const L = CRATE_LAYOUT;
  const y = BODY.top + PRESS_HEIGHT.small;
  CRATE_ORDER.forEach((track, i) => {
    nodes.push(node(`load-${track}-a`, 'load-button-a', L.slotXs[i], y, L.buttonZA, button('A', 'load', i)));
    nodes.push(node(`load-${track}-b`, 'load-button-b', L.slotXs[i], y, L.buttonZB, button('B', 'load', i)));
  });
  nodes.push(node('rec', 'rec-button', L.rec[0], y, L.rec[1], button('A', 'rec')));
  // CLUB toggle: centre of the mixer, between the beat-FX buttons and the crossfader
  nodes.push(node('club', 'club-button', 0, y, 0.09, button('A', 'club')));
  nodes.push(node('share', 'share-button', L.share[0], y, L.share[1], button('A', 'share')));
  return nodes;
}

/** Settings tab (day 12): HELP, volume, room dimmer, reduced flash, FINISH SET. */
function settings(): Node[] {
  const y = BODY.top + PRESS_HEIGHT.small;
  const asset: Record<string, [string, string]> = {
    help: ['setting-help', 'help'],
    'vol-down': ['setting-vol', 'volDown'],
    'vol-up': ['setting-vol', 'volUp'],
    'dim-down': ['setting-dim', 'dimDown'],
    'dim-up': ['setting-dim', 'dimUp'],
    flash: ['setting-flash', 'flash'],
    finish: ['setting-finish', 'finish'],
  };
  return SETTINGS_LAYOUT.buttons.map((b) => node(`set-${b.id}`, asset[b.id][0], b.x, y, SETTINGS_LAYOUT.buttonZ, button('A', asset[b.id][1])));
}

const scene = JSON.parse(readFileSync(SCENE, 'utf8'));
const consoleNode = scene.nodes.find((n: Node) => n.id === 'console');
consoleNode.children = [...deck('A'), ...deck('B'), ...mixer(), ...crate(), ...settings()];
writeFileSync(SCENE, JSON.stringify(scene, null, 2) + '\n');
console.log(`console: ${consoleNode.children.length} controls`);
