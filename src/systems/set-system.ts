import { CanvasTexture, createSystem, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3 } from '@iwsdk/core';
import { liveEngine } from '../audio/live.js';
import { TRACKS } from '../audio/tracks/catalog.js';
import { ConsoleRoot } from '../console-components.js';
import { formatBest, isBetter, saveBest } from '../game/comeback.js';
import { game, showTip, showToast } from '../game/game-state.js';
import { applySettings } from '../game/set-flow.js';
import { crowdState } from '../show/crowd-state.js';
import { SETTINGS_LAYOUT } from '../scene-assets/console-layout.js';

const SCREEN = { w: 1120, h: 68 };
const TOAST = { w: 720, h: 96 };
const CARD = { w: 640, h: 400 };
/** A move's effect is the crowd energy gain over the next few seconds. */
const MOVE_WINDOW = 4;
/** Bars with no move before the idle tip. */
const IDLE_BARS = 16;
const MOVE_NAMES: Record<string, string> = {
  D: 'DROP',
  T: 'STEM PUNCH',
  e: 'A/B FADE',
  X: 'CROSSFADE',
  E: 'ECHO',
  S: 'SPACE',
  p: 'PLAY',
  d: 'PAD',
  L: 'TRACK LOAD',
  k: 'KNOB',
  x: 'KNOB',
  f: 'FADER',
  t: 'TEMPO',
  c: 'CUE',
  s: 'SYNC',
  m: 'PAD MODE',
};
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

interface Face {
  mesh: Mesh;
  ctx: CanvasRenderingContext2D;
  texture: CanvasTexture;
  key: string;
}

/**
 * Day 12: the set's rules and screens. Tracks the set (peak crowd energy,
 * time on fire, the move that lifted the crowd most), the nightly request
 * (toast after the first drop, celebration when done), the second-wave and
 * idle tips, the settings tab's label screen, and the Finish Set summary
 * card. The settings themselves live in `game.settings` and are applied in
 * `set-flow.ts`; nothing here blocks the console.
 */
export class SetSystem extends createSystem({
  console: { required: [ConsoleRoot] },
}) {
  private screen: Face | null = null;
  private toast!: Face;
  private card!: Face;
  private at!: Vector3;
  private pendingMove = { active: false, op: '', energy0: 0, since: 0, bar: 0 };
  private onHide = () => {};

  private makeFace(w: number, h: number, width: number, height: number, name: string): Face {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const mesh = new Mesh(new PlaneGeometry(width, height), new MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, toneMapped: false }));
    mesh.name = name;
    mesh.renderOrder = 997;
    mesh.visible = false;
    this.world.createTransformEntity(mesh, { persistent: true });
    return { mesh, ctx: canvas.getContext('2d')!, texture, key: '' };
  }

  init(): void {
    this.at = new Vector3();
    this.toast = this.makeFace(TOAST.w, TOAST.h, 0.36, 0.048, 'RequestToast');
    this.card = this.makeFace(CARD.w, CARD.h, 0.34, 0.2125, 'SummaryCard');
    applySettings();
    // a set that ends by closing the page still counts toward the best
    this.onHide = () => {
      const s = liveEngine().state;
      if (!s.running || game.finished || game.stats.peakHype <= 0) return;
      const set = { peakHype: Math.round(game.stats.peakHype), timeOnFire: Math.round(game.stats.timeOnFire), date: '' };
      if (isBetter(set, game.best)) {
        const d = new Date();
        const p = (n: number) => String(n).padStart(2, '0');
        saveBest({ ...set, date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` });
      }
    };
    window.addEventListener('pagehide', this.onHide);
    this.cleanupFuncs.push(() => window.removeEventListener('pagehide', this.onHide));
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.25);
    const engine = liveEngine();
    const s = engine.state;
    const root = this.consoleRoot();
    if (root != null) {
      if (this.screen == null) this.attachScreen(root);
      root.getWorldPosition(this.at);
      this.layoutFloaters(this.at.x, this.at.y, this.at.z);
    }
    this.drawScreen();
    this.drawToast();
    this.drawCard();
    if (!s.running || game.finished) return;
    this.track(dt, s);
  }

  // ---- the set ------------------------------------------------------------

  private track(dt: number, s: ReturnType<typeof liveEngine>['state']): void {
    const engine = liveEngine();
    const st = game.stats;
    const bars = (dt * s.bpm) / 240;
    st.bars += bars;
    const energy = crowdState.energy * 100;
    if (energy > st.peakHype) st.peakHype = energy;
    if (crowdState.tier === 3) st.timeOnFire += dt;

    // best move: the crowd's energy gain over the seconds after a move
    const moves = engine.log.moves;
    const pm = this.pendingMove;
    if (moves.length !== st.moves) {
      if (moves.length > st.moves && !pm.active) {
        pm.active = true;
        pm.op = String(moves[moves.length - 1][1]);
        pm.energy0 = crowdState.energy;
        pm.since = 0;
        pm.bar = Math.floor(st.bars);
      }
      st.moves = moves.length;
      st.lastMoveBar = st.bars;
    }
    if (pm.active) {
      pm.since += dt;
      if (pm.since >= MOVE_WINDOW) {
        pm.active = false;
        const gain = crowdState.energy - pm.energy0;
        if (gain > st.bestMoveGain && gain > 0.01) {
          st.bestMoveGain = gain;
          st.bestMove = `${MOVE_NAMES[pm.op] ?? 'MOVE'} at bar ${pm.bar}`;
        }
      }
    }

    // first drop: second-wave tip after 2 bars, the nightly request after 8
    if (s.drops >= 1 && st.firstDropBar < 0) st.firstDropBar = st.bars;
    if (st.firstDropBar >= 0) {
      const since = st.bars - st.firstDropBar;
      if (since >= 2 && !game.tipsShown.includes('filter')) showTip('filter', 'Filter A', 'DRAG FILTER LEFT BEFORE YOUR NEXT DROP', 7);
      if (since >= 8 && !game.requestShown) {
        game.requestShown = true;
        showToast(game.tracker.request.text, 9000);
      }
    }

    // the request: the heard deck's genre at the goal tier, for the goal's bars
    const view = s[s.master];
    const genre = TRACKS[view.trackId]?.genre ?? '';
    if (game.requestShown && game.tracker.update(bars, crowdState.tier, genre)) {
      showToast(`REQUEST DONE! ${game.tracker.request.goal.text}`, 8000);
      crowdState.jump = 1;
      engine.click(true);
    }

    // idle: nothing touched for 16 bars
    if (st.bars - st.lastMoveBar >= IDLE_BARS && (s.A.playing || s.B.playing)) {
      st.lastMoveBar = st.bars;
      showTip('idle', 'Pad A Chords', 'TRY A PAD: TAP A STEM OUT AND BACK', 7);
    }
  }

  // ---- screens ------------------------------------------------------------

  private consoleRoot() {
    for (const entity of this.queries.console.entities) if (entity.object3D != null) return entity.object3D;
    return null;
  }

  private attachScreen(root: { getObjectByName(name: string): unknown }): void {
    const mesh = root.getObjectByName('SettingsScreen') as Mesh | undefined;
    if (mesh == null) return;
    const canvas = document.createElement('canvas');
    canvas.width = SCREEN.w;
    canvas.height = SCREEN.h;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    mesh.material = new MeshBasicMaterial({ map: texture, toneMapped: false });
    this.screen = { mesh, ctx: canvas.getContext('2d')!, texture, key: '' };
  }

  /** Toast and card hover over the console and face the head. */
  private layoutFloaters(x: number, y: number, z: number): void {
    this.toast.mesh.position.set(x, y + 0.2, z);
    this.card.mesh.position.set(x, y + 0.42, z - 0.1);
    for (const f of [this.toast, this.card]) {
      this.world.camera.getWorldQuaternion(f.mesh.quaternion);
      if (f.mesh.parent != null) f.mesh.parent.worldToLocal(f.mesh.position);
    }
  }

  private drawScreen(): void {
    const face = this.screen;
    if (face == null) return;
    const set = game.settings;
    const key = `${set.volume}|${set.dim}|${set.reducedFlash}|${game.finished}`;
    if (key === face.key) return;
    face.key = key;
    const { ctx } = face;
    ctx.fillStyle = '#04070C';
    ctx.fillRect(0, 0, SCREEN.w, SCREEN.h);
    ctx.textAlign = 'center';
    const px = (x: number) => ((x + SETTINGS_LAYOUT.screen.width / 2) / SETTINGS_LAYOUT.screen.width) * SCREEN.w;
    const xs = Object.fromEntries(SETTINGS_LAYOUT.buttons.map((b) => [b.id, px(b.x)]));
    const label = (text: string, x: number, color: string) => {
      ctx.fillStyle = color;
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText(text, x, 28, 150);
    };
    const sign = (text: string, x: number, color: string) => {
      ctx.fillStyle = color;
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText(text, x, 60);
    };
    label('TIPS', xs.help, '#29D7FF');
    sign('?', xs.help, '#29D7FF');
    label(`VOL ${Math.round(set.volume * 100)}%`, (xs['vol-down'] + xs['vol-up']) / 2, '#3DFF6E');
    sign('-', xs['vol-down'], '#3DFF6E');
    sign('+', xs['vol-up'], '#3DFF6E');
    label(`DIM ${Math.round(set.dim * 100)}%`, (xs['dim-down'] + xs['dim-up']) / 2, '#FFB020');
    sign('-', xs['dim-down'], '#FFB020');
    sign('+', xs['dim-up'], '#FFB020');
    label(set.reducedFlash ? 'FLASH: LOW' : 'FLASH: FULL', xs.flash, '#FFFFFF');
    sign(set.reducedFlash ? 'ON' : 'OFF', xs.flash, '#9AA4B5');
    label(game.finished ? 'SET DONE' : 'FINISH SET', xs.finish, '#FF2D55');
    face.texture.needsUpdate = true;
  }

  private drawToast(): void {
    const face = this.toast;
    const on = performance.now() < game.toast.until;
    face.mesh.visible = on;
    if (!on || face.key === String(game.toast.id)) return;
    face.key = String(game.toast.id);
    const { ctx } = face;
    ctx.clearRect(0, 0, TOAST.w, TOAST.h);
    ctx.fillStyle = 'rgba(255, 201, 61, 0.95)';
    ctx.beginPath();
    ctx.roundRect(2, 2, TOAST.w - 4, TOAST.h - 4, 44);
    ctx.fill();
    ctx.fillStyle = '#1A1100';
    ctx.textAlign = 'center';
    const text = game.toast.text;
    ctx.font = `bold ${text.length > 42 ? 34 : 42}px sans-serif`;
    ctx.fillText(text, TOAST.w / 2, 62, TOAST.w - 50);
    face.texture.needsUpdate = true;
  }

  private drawCard(): void {
    const face = this.card;
    const summary = game.summary;
    face.mesh.visible = game.finished && summary != null;
    if (!game.finished || summary == null) {
      face.key = '';
      return;
    }
    const key = `${game.finishedSets}`;
    if (face.key === key) return;
    face.key = key;
    const { ctx } = face;
    ctx.clearRect(0, 0, CARD.w, CARD.h);
    ctx.fillStyle = 'rgba(8, 12, 20, 0.96)';
    ctx.beginPath();
    ctx.roundRect(2, 2, CARD.w - 4, CARD.h - 4, 36);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = summary.newBest ? '#FFC93D' : '#29D7FF';
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = summary.newBest ? '#FFC93D' : '#29D7FF';
    ctx.font = 'bold 54px sans-serif';
    ctx.fillText(summary.newBest ? 'NEW BEST SET!' : 'SET COMPLETE', CARD.w / 2, 70);
    const rows: [string, string][] = [
      ['PEAK CROWD ENERGY', `${summary.peakHype}%`],
      ['TIME ON FIRE', mmss(summary.timeOnFire)],
      ['BEST MOVE', summary.bestMove],
    ];
    let y = 135;
    for (const [name, value] of rows) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#7B8494';
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText(name, 40, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 34px sans-serif';
      ctx.fillText(value, CARD.w - 40, y + 2, 360);
      y += 56;
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#C9D1DC';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(summary.newBest && summary.previous != null ? `Previous: ${formatBest(summary.previous).replace('Your best: ', '')}` : formatBest(game.best), CARD.w / 2, 315, CARD.w - 60);
    ctx.fillStyle = '#3DFF6E';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText('POKE THE START PAD TO PLAY AGAIN', CARD.w / 2, 370, CARD.w - 40);
    face.texture.needsUpdate = true;
  }
}
