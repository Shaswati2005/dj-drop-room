// browser-run helper: ONE realistic set cycle, used by verify-day13 (audio budget) and soak.mjs.
// Per cycle: load the next track on the off-air deck, bring it in on the bar, play with stems /
// loop / roll / filter, hold ECHO and SPACE, DROP, A/B auto-fade, pause the old deck. Every third
// cycle also does Finish Set -> Play again. Counts live audio sources (started, not yet ended) and
// created audio nodes by patching the Web Audio prototypes once per page.
// Returns heap, GPU resource counts, live sources and per-cycle node creations.
export default async function run({ page, frame }) {
  const app = frame ?? page;
  const button = app.locator('#start-music');
  if (await button.isVisible()) await button.click();
  await app.waitForFunction(() => { const s = window.__dropRoom.state(); return s.A.playing || s.B.playing; }, null, { timeout: 15000 });
  const result = await app.evaluate(async () => {
      const d = window.__dropRoom;
      const en = d.engine();
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const until = async (pred, ms, what) => {
        const end = performance.now() + ms;
        while (!pred()) {
          if (performance.now() > end) throw new Error(`timeout waiting for ${what}`);
          await sleep(80);
        }
      };
      // ---- voice / node counters (installed once) ----
      if (!window.__voice) {
        const v = (window.__voice = { live: 0, peakLive: 0, started: 0, created: 0 });
        for (const ctor of [AudioBufferSourceNode, OscillatorNode, ConstantSourceNode]) {
          const start = ctor.prototype.start;
          ctor.prototype.start = function (...a) {
            v.live++;
            v.started++;
            if (v.live > v.peakLive) v.peakLive = v.live;
            this.addEventListener('ended', () => v.live--, { once: true });
            return start.apply(this, a);
          };
        }
        for (const name of Object.getOwnPropertyNames(BaseAudioContext.prototype)) {
          if (!/^create/.test(name)) continue;
          const orig = BaseAudioContext.prototype[name];
          BaseAudioContext.prototype[name] = function (...a) {
            v.created++;
            return orig.apply(this, a);
          };
        }
        window.__cycle = { idx: 0 };
      }
      const v = window.__voice;
      const cyc = window.__cycle;
      const ids = ['mirrorball', 'rainy-tape', 'airlock', 'sunrise', 'concrete', 'warm-start'];
      const t0 = performance.now();
      const created0 = v.created;
      const started0 = v.started;
      let s = d.state();
      const steps = [];
      // which deck is on air; if both play, pause the one the crossfader is away from
      let on = s.A.playing && !s.B.playing ? 'A' : s.B.playing && !s.A.playing ? 'B' : d.engine().crossfader <= 0 ? 'A' : 'B';
      if (!s[on].playing) on = 'A';
      let off = on === 'A' ? 'B' : 'A';
      if (s[off].playing) {
        en.togglePlay(off);
        await sleep(300);
      }
      en.setCrossfader(on === 'A' ? -1 : 1);
      // 1. load
      let id = ids[cyc.idx % ids.length];
      if (s[on].trackId === id) id = ids[(cyc.idx + 1) % ids.length];
      await until(() => en.update()[off].status !== 'loading', 15000, 'deck idle');
      const res = en.requestLoad(off, id);
      steps.push(`load ${id} on ${off}: ${res}`);
      await until(() => en.update()[off].status === 'ready' && en.update()[off].trackId === id, 20000, 'track ready');
      // 2. bring it in on the bar
      en.togglePlay(off);
      await until(() => en.update()[off].playing, 8000, `${off} playing`);
      // 3. performance on the on-air deck
      en.toggleStem(on, 'drums');
      await sleep(1200);
      en.toggleStem(on, 'drums');
      en.setPadMode(on, 'loop');
      en.pad(on, 1, true); // 2-bar loop on
      await sleep(1500);
      en.pad(on, 1, true); // off
      en.pad(on, 4, true); // roll held
      await sleep(600);
      en.pad(on, 4, false);
      en.setPadMode(on, 'stems');
      en.setKnob(on, 'filter', -0.6);
      await sleep(600);
      en.setKnob(on, 'filter', 0);
      // 4. FX holds
      en.holdEcho(true);
      await sleep(1500);
      en.holdEcho(false);
      en.holdSpace(true);
      await sleep(1500);
      en.holdSpace(false);
      // 5. DROP on the master deck
      const dropsBefore = en.update().drops;
      en.drop();
      await until(() => en.update().drops > dropsBefore, 12000, 'drop landed');
      // 6. fade across and retire the old deck
      en.fadeTo(off);
      await until(() => Math.abs(en.update().crossfader - (off === 'A' ? -1 : 1)) < 0.02, 30000, 'fade done');
      en.togglePlay(on);
      await sleep(400);
      steps.push('fade done');
      // 7. finish set -> play again
      let finished = false;
      if (cyc.idx % 3 === 2) {
        d.finishSet();
        await until(() => d.game().finished && d.game().summary != null, 4000, 'finish card');
        await sleep(3500);
        d.playAgain();
        await until(() => !d.game().finished && en.update().A.trackId === 'warm-start' && en.update().A.status === 'ready', 20000, 'play again');
        await until(() => en.update().A.playing, 10000, 'A playing after play again').catch(() => {});
        finished = true;
      }
      cyc.idx++;
      const r = d.world.renderer;
      const m = performance.memory;
      // every GPU resource must belong to something in the scene: count what the scene holds
      const geos = new Set();
      const texs = new Set();
      d.world.scene.traverse((o) => {
        if (o.geometry) geos.add(o.geometry.uuid);
        for (const mat of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) for (const k of Object.keys(mat)) if (mat[k]?.isTexture) texs.add(mat[k].uuid);
      });
      return {
        sceneGeometries: geos.size,
        sceneTextures: texs.size,
        cycle: cyc.idx,
        ms: Math.round(performance.now() - t0),
        steps,
        finished,
        heapMB: m ? +(m.usedJSHeapSize / 1e6).toFixed(1) : null,
        geometries: r.info.memory.geometries,
        textures: r.info.memory.textures,
        liveSources: v.live,
        peakLiveSources: v.peakLive,
        nodesCreatedThisCycle: v.created - created0,
        sourcesStartedThisCycle: v.started - started0,
      };
  });
  // heap after a forced GC (one browser run per cycle: every run costs the page ~1-2 MB of harness overhead)
  let gcHeapMB = null;
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.detach();
    gcHeapMB = await app.evaluate(() => +(performance.memory.usedJSHeapSize / 1e6).toFixed(1));
  } catch {}
  return JSON.stringify({ ...result, gcHeapMB });
}
