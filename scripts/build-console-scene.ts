// Regenerates the console's child nodes in the scene from console-layout.ts so
// the controls always sit on the body's slots and wells.
// Run: npx vite-node scripts/build-console-scene.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { BODY, DECK, deckX, MIXER, PRESS_HEIGHT, STRIP_X } from '../src/scene-assets/console-layout.js';

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
const button = (deck: 'A' | 'B', action: string) => ({ PushButton: { action, deck, lit: false, armed: false }, ...poke });

function deck(id: 'A' | 'B'): Node[] {
  const d = id.toLowerCase();
  const x = (v: number) => deckX(v, id);
  const nodes: Node[] = [
    node(`jog-${d}`, `jog-wheel-${d}`, x(DECK.jog.x), SURFACE, DECK.jog.z, { JogWheel: { deck: id } }),
    node(`tempo-${d}`, 'tempo-fader-cap', x(DECK.tempo.x), SURFACE, DECK.tempo.z),
    node(`sync-${d}`, 'sync-button', x(DECK.sync[0]), BODY.top + PRESS_HEIGHT.small, DECK.sync[1], button(id, 'sync')),
    node(`cue-${d}`, 'cue-button', x(DECK.cue[0]), BODY.top + PRESS_HEIGHT.round, DECK.cue[1], button(id, 'cue')),
    node(`play-${d}`, 'play-button', x(DECK.play[0]), BODY.top + PRESS_HEIGHT.round, DECK.play[1], button(id, 'play')),
  ];
  DECK.modes.forEach(([mx, mz], i) => nodes.push(node(`mode-${d}-${i}`, 'mode-button', x(mx), BODY.top + PRESS_HEIGHT.small, mz)));
  DECK.pads.zs.forEach((pz, row) =>
    DECK.pads.xs.forEach((px, col) => {
      const stem = row === 0 ? STEMS[col] : null;
      const components = stem ? { StemPad: { deck: id, stem, active: true, armed: false }, ...poke } : undefined;
      nodes.push(node(stem ? `pad-${d}-${stem}` : `pad-${d}-${row}${col}`, 'performance-pad', x(px), BODY.top + PRESS_HEIGHT.pad, pz, components));
    }),
  );
  return nodes;
}

function mixer(): Node[] {
  const nodes: Node[] = [];
  for (const id of ['A', 'B'] as const) {
    const sx = id === 'A' ? -STRIP_X : STRIP_X;
    const d = id.toLowerCase();
    for (const k of MIXER.knobs) nodes.push(node(`${k.name}-${d}`, k.large ? 'knob-large' : 'knob-small', sx, SURFACE, k.z));
    // channel faders start fully up (away from the player)
    nodes.push(node(`fader-${d}`, 'channel-fader-cap', sx, SURFACE, MIXER.fader.z - MIXER.fader.length * 0.45));
  }
  nodes.push(node('crossfader', 'crossfader-cap', 0, SURFACE, MIXER.crossfader.z));
  nodes.push(node('xf-end-a', 'crossfade-end-a', MIXER.ends[0], BODY.top + PRESS_HEIGHT.round, MIXER.crossfader.z));
  nodes.push(node('xf-end-b', 'crossfade-end-b', MIXER.ends[1], BODY.top + PRESS_HEIGHT.round, MIXER.crossfader.z));
  nodes.push(node('fx-echo', 'fx-button', MIXER.fx[0][0], BODY.top + PRESS_HEIGHT.small, MIXER.fx[0][1]));
  nodes.push(node('fx-space', 'fx-button', MIXER.fx[1][0], BODY.top + PRESS_HEIGHT.small, MIXER.fx[1][1]));
  nodes.push(node('drop', 'drop-button', MIXER.drop[0], BODY.top + PRESS_HEIGHT.drop, MIXER.drop[1]));
  // hovers over DROP until the music starts, then hides
  nodes.push(node('start-pad', 'start-pad', MIXER.drop[0], BODY.top + 0.04, MIXER.drop[1], { PushButton: { action: 'start', deck: 'A', lit: true, armed: false }, ...poke }));
  return nodes;
}

const scene = JSON.parse(readFileSync(SCENE, 'utf8'));
const consoleNode = scene.nodes.find((n: Node) => n.id === 'console');
consoleNode.children = [...deck('A'), ...deck('B'), ...mixer()];
writeFileSync(SCENE, JSON.stringify(scene, null, 2) + '\n');
console.log(`console: ${consoleNode.children.length} controls`);
