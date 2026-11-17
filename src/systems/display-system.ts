import { CanvasTexture, createSystem, MeshBasicMaterial, SRGBColorSpace } from '@iwsdk/core';
import type { Mesh } from '@iwsdk/core';
import { PEAKS_PER_BAR } from '../audio/deck.js';
import type { Deck, DeckId } from '../audio/deck.js';
import { liveEngine } from '../audio/live.js';
import { ConsoleRoot } from '../console-components.js';

const W = 512;
const H = 112;
const ZOOM_BARS = 4;
const PLAYHEAD_X = 170;
const CUE_COLORS = ['#FF3B3B', '#FF9A1F', '#FFE11F', '#3DFF6E'];
const DECK_COLORS: Record<DeckId, string> = { A: '#29D7FF', B: '#FF3DA8' };
const MODE_LABELS = { stems: 'STEMS', cues: 'HOT CUES', loop: 'LOOP' };
const MODE_INDEX = { stems: 0, cues: 1, loop: 2 };

interface Screen {
  deck: DeckId;
  ctx: CanvasRenderingContext2D;
  texture: CanvasTexture;
  /** whole-track overview, drawn once per track */
  overview: HTMLCanvasElement;
  overviewTrack: string;
  /** header text, rebuilt only when what it shows changes */
  name: string;
  bpm: number;
  bpmText: string;
  modeKey: number;
  modeText: string;
}

/**
 * The deck screens, like a DJ media player's: track name, BPM and pad mode on top; a
 * zoomed waveform scrolling past a fixed playhead (beat ticks, loop region,
 * hot cues); and a whole-track overview with the playhead underneath.
 */
export class DisplaySystem extends createSystem({
  console: { required: [ConsoleRoot] },
}) {
  private screens!: Screen[];
  private sinceDraw = 0;

  init(): void {
    this.screens = [];
  }

  private attach(root: { getObjectByName(name: string): unknown }): void {
    for (const deck of ['A', 'B'] as const) {
      const mesh = root.getObjectByName(`DisplayScreen${deck}`) as Mesh | undefined;
      if (mesh == null) return;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      mesh.material = new MeshBasicMaterial({ map: texture, toneMapped: false });
      const overview = document.createElement('canvas');
      overview.width = W;
      overview.height = 26;
      this.screens.push({ deck, ctx: canvas.getContext('2d')!, texture, overview, overviewTrack: '', name: '', bpm: -1, bpmText: '', modeKey: -1, modeText: '' });
    }
  }

  update(delta: number): void {
    if (this.screens.length === 0) {
      for (const entity of this.queries.console.entities) if (entity.object3D != null) this.attach(entity.object3D);
      if (this.screens.length === 0) return;
    }
    // 30 fps is plenty for a scrolling waveform and saves texture uploads
    this.sinceDraw += delta;
    if (this.sinceDraw < 1 / 30) return;
    this.sinceDraw = 0;
    const engine = liveEngine();
    for (const screen of this.screens) this.draw(screen, engine.decks[screen.deck], engine.state[screen.deck]);
  }

  private draw(screen: Screen, deck: Deck, view: ReturnType<typeof liveEngine>['state']['A']): void {
    const { ctx } = screen;
    const color = DECK_COLORS[screen.deck];
    ctx.fillStyle = '#04070C';
    ctx.fillRect(0, 0, W, H);
    if (deck.status !== 'ready' || deck.track == null) {
      ctx.fillStyle = '#4A5568';
      ctx.font = 'bold 22px sans-serif';
      ctx.fillText(deck.status === 'loading' ? 'LOADING…' : 'NO TRACK', 12, 64);
      screen.texture.needsUpdate = true;
      return;
    }
    if (screen.overviewTrack !== deck.track.id) this.drawOverview(screen, deck, color);

    // header: name, BPM, pad mode
    const bpmShown = Math.round(view.bpm * 10) / 10;
    if (bpmShown !== screen.bpm) {
      screen.bpm = bpmShown;
      screen.bpmText = `${bpmShown.toFixed(1)} BPM`;
    }
    const modeKey = MODE_INDEX[view.padMode] * 100 + view.loopBars;
    if (modeKey !== screen.modeKey) {
      screen.modeKey = modeKey;
      screen.modeText = MODE_LABELS[view.padMode] + (view.loopBars ? ` ${view.loopBars}` : '');
    }
    ctx.font = 'bold 18px sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(screen.name, 8, 19);
    ctx.fillStyle = color;
    ctx.textAlign = 'right';
    ctx.fillText(screen.bpmText, W - 8, 19);
    ctx.fillStyle = view.padMode === 'loop' ? '#3DFF6E' : view.padMode === 'cues' ? '#FF9A1F' : '#C9D1DC';
    ctx.textAlign = 'center';
    ctx.fillText(screen.modeText, W / 2 + 40, 19);
    ctx.textAlign = 'left';

    // zoomed waveform around the playhead
    const bar = deck.barSeconds;
    const pxPerSec = W / (ZOOM_BARS * bar);
    const pos = view.position;
    const top = 26;
    const mid = 54;
    const region = deck.region;
    if (view.loopBars > 0 || view.roll >= 0) {
      ctx.fillStyle = 'rgba(61,255,110,0.18)';
      const x0 = PLAYHEAD_X + (region.start - pos) * pxPerSec;
      ctx.fillRect(x0, top, (region.end - region.start) * pxPerSec, 56);
    }
    ctx.fillStyle = '#1C2533';
    const beat = bar / 4;
    for (let b = Math.ceil((pos - PLAYHEAD_X / pxPerSec) / beat); ; b++) {
      const x = PLAYHEAD_X + (b * beat - pos) * pxPerSec;
      if (x > W) break;
      ctx.fillStyle = b % 4 === 0 ? '#3A4A60' : '#1C2533';
      ctx.fillRect(x, top, b % 4 === 0 ? 2 : 1, 56);
    }
    ctx.fillStyle = color;
    const slice = bar / PEAKS_PER_BAR;
    for (let x = 0; x < W; x += 4) {
      const i = Math.floor((pos + (x - PLAYHEAD_X) / pxPerSec) / slice);
      if (i < 0 || i >= deck.peaks.length) continue;
      const h = Math.max(1, deck.peaks[i] * 26);
      ctx.fillRect(x, mid - h, 3, h * 2);
    }
    for (let c = 0; c < view.hotCues.length; c++) {
      if (view.hotCues[c] < 0) continue;
      const x = PLAYHEAD_X + (view.hotCues[c] - pos) * pxPerSec;
      if (x < -4 || x > W + 4) continue;
      ctx.fillStyle = CUE_COLORS[c];
      ctx.fillRect(x - 1, top, 3, 56);
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(PLAYHEAD_X - 1, top - 2, 2, 60);

    // overview with playhead and cue markers
    ctx.drawImage(screen.overview, 0, 86);
    const total = deck.duration || 1;
    for (let c = 0; c < view.hotCues.length; c++) {
      if (view.hotCues[c] < 0) continue;
      ctx.fillStyle = CUE_COLORS[c];
      ctx.fillRect((view.hotCues[c] / total) * W - 1, 84, 3, 4);
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect((pos / total) * W - 1, 84, 2, 28);
    screen.texture.needsUpdate = true;
  }

  private drawOverview(screen: Screen, deck: Deck, color: string): void {
    const ctx = screen.overview.getContext('2d')!;
    ctx.fillStyle = '#0A1018';
    ctx.fillRect(0, 0, W, 26);
    const n = deck.peaks.length;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.75;
    for (let x = 0; x < W; x++) {
      let peak = 0;
      for (let i = Math.floor((x / W) * n); i < Math.floor(((x + 1) / W) * n); i++) peak = Math.max(peak, deck.peaks[i]);
      const h = Math.max(1, peak * 12);
      ctx.fillRect(x, 13 - h, 1, h * 2);
    }
    ctx.globalAlpha = 1;
    screen.overviewTrack = deck.track!.id;
    screen.name = deck.track!.name.toUpperCase();
  }
}
