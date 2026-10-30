// Day 11 check, part 2 (npx @iwsdk/cli browser run scripts/verify-day11-show.mjs --timeout 105000 --raw):
// the crowd (instanced, 16-24 dancers, states follow a forced hype, miniature on
// the table in mixed reality and life-size round the booth in club mode, clear of
// the booth, speaker stacks and pillars), the lights (heads by hype tier, dim on
// the riser, burst and fast sweep on the drop, strobe-safe, reduced flash lowers
// the peak) and the draw-call budget. Leave XR first.
export default async function run({ page, frame }) {
  const app = frame ?? page;
  const out = [];
  const check = (label, ok, detail = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${label} ${detail}`);
  const wait = (ms) => app.waitForTimeout(ms);
  const e = (fn, arg) => app.evaluate(fn, arg);
  const crowd = () => e(() => window.__dropRoom.crowd());
  const lights = () => e(() => window.__dropRoom.lights());

  await app.waitForFunction(() => window.__dropRoom != null, null, { timeout: 30000 });
  const button = app.locator('#start-music');
  if (await button.isVisible()) await button.click();
  await app.waitForFunction(() => window.__dropRoom.state().A.playing, null, { timeout: 15000 });
  await e(() => window.__dropRoom.setClub(false));

  // ---- crowd in mixed reality: the miniature table crowd ----------------------
  await e(() => window.__dropRoom.forceHype(0.1));
  await wait(700);
  let c = await crowd();
  check('MR: the crowd stands on the table (context "table")', c.context === 'table', c.context);
  check('MR: 16 dancers out when cold', c.instances === 16 && c.capacity === 24, `${c.instances} of ${c.capacity}`);
  check('MR: cold = mostly idle (phones, slow sway)', c.counts[0] >= 12 && c.counts[3] === 0, JSON.stringify(c.counts));
  const calls = await e(() => {
    const scene = window.__dropRoom.world.scene;
    const crowdRoot = scene.getObjectByName('Crowd');
    let meshes = 0;
    crowdRoot.traverse((o) => {
      if (o.isMesh && o.visible) meshes++;
    });
    return meshes;
  });
  check('MR: the whole crowd (dancers + dance floor) is at most 2 draw calls', calls <= 2 && c.drawCalls <= 2, `${calls} meshes`);
  await e(() => window.__dropRoom.forceHype(0.42));
  await wait(500);
  c = await crowd();
  check('MR: warm = bobbing', c.counts[1] >= 8 && c.counts[3] === 0, JSON.stringify(c.counts));
  await e(() => window.__dropRoom.forceHype(0.65));
  await wait(500);
  c = await crowd();
  check('MR: hot = dancing, 20 dancers', c.instances === 20 && c.counts[2] >= 8, `${c.instances}: ${JSON.stringify(c.counts)}`);
  await e(() => window.__dropRoom.forceHype(0.95));
  await wait(500);
  c = await crowd();
  check('MR: on fire = hands up / jumping, all 24 dancers', c.instances === 24 && c.counts[3] >= 12 && c.tier === 3, `${c.instances}: ${JSON.stringify(c.counts)}`);

  // ---- lights: tiers --------------------------------------------------------
  // the first drop brings the rig in
  await e(() => window.__dropRoom.resetLightPeaks());
  await e(() => window.__dropRoom.forceHype(null));
  await e(() => window.__dropRoom.engine().drop());
  const riser = [];
  for (let i = 0; i < 40; i++) {
    const s = await e(() => window.__dropRoom.engine().update());
    const l = await lights();
    riser.push(l.dim);
    if (s.drops > 0 && !s.dropping) break;
    await wait(150);
  }
  check('the riser dims the beams (60 % by the top) and the last beat goes nearly dark', Math.min(...riser) < 0.4, `lowest dim ${Math.min(...riser).toFixed(2)}`);
  let burstSeen = 0;
  let sweepSeen = 1;
  for (let i = 0; i < 12; i++) {
    const l = await lights();
    burstSeen = Math.max(burstSeen, l.burst);
    sweepSeen = Math.max(sweepSeen, l.sweep);
    await wait(80);
  }
  const normal = await lights();
  check('the drop bursts the rig to full', normal.burstPeak > 0.9, `burst peak ${normal.burstPeak.toFixed(2)}`);
  check('...and sweeps fast for two bars', sweepSeen > 1.6, `sweep x${sweepSeen.toFixed(2)}`);
  check('strobe-safe: never more than 3 sharp rises in any second', normal.violations === 0, `${normal.sharpRises} sharp rises, ${normal.violations} violations`);
  const tiers = [];
  for (const [hype, want] of [[0.1, 4], [0.4, 4], [0.6, 6], [0.9, 8]]) {
    await e((v) => window.__dropRoom.forceHype(v), hype);
    await wait(350);
    tiers.push((await lights()).beamsOn === want);
  }
  check('beam count follows the hype tier: 4, 4, 6, 8', tiers.every(Boolean), JSON.stringify(tiers));
  const rig = await e(() => {
    const rigObject = window.__dropRoom.world.scene.getObjectByName('LightRig') ?? window.__dropRoom.world.scene.getObjectByName('Light Rig');
    let meshes = 0;
    rigObject.traverse((o) => {
      if (o.isMesh) meshes++;
    });
    return meshes;
  });
  check('the light rig is 8 draw calls (it was ~66)', rig <= 10, `${rig} meshes`);

  // reduced flash: the next drop's burst is a fraction of the first
  await e(() => window.__dropRoom.forceHype(null));
  await wait(6000);
  await e(() => {
    window.__dropRoom.setReducedFlash(true);
    window.__dropRoom.resetLightPeaks();
    window.__dropRoom.engine().drop();
  });
  for (let i = 0; i < 40; i++) {
    const s = await e(() => window.__dropRoom.engine().update());
    if (s.drops >= 2 && !s.dropping) break;
    await wait(150);
  }
  await wait(600);
  const reduced = await lights();
  await e(() => window.__dropRoom.setReducedFlash(false));
  check('reduced flash lowers the peak flash (burst <= 0.3 of full)', reduced.burstPeak > 0 && reduced.burstPeak <= 0.3 && reduced.burstPeak < normal.burstPeak * 0.5, `${reduced.burstPeak.toFixed(2)} vs ${normal.burstPeak.toFixed(2)}`);
  check('reduced flash lowers the brightest beam level too', reduced.peak < normal.peak - 0.1, `${reduced.peak.toFixed(2)} vs ${normal.peak.toFixed(2)}`);
  check('reduced flash stays strobe-safe', reduced.violations === 0, `${reduced.sharpRises} sharp rises`);

  // ---- draw calls in MR with the rig and the crowd ----------------------------
  await e(() => window.__dropRoom.forceHype(0.9));
  await wait(800);
  const mr = await e(() => window.__dropRoom.drawCalls());
  check('draw calls in MR with rig + crowd are within budget (<= 400; was ~448)', mr.calls <= 400, `${mr.calls} calls, ${mr.triangles} triangles`);

  // ---- crowd in club mode -----------------------------------------------------
  await e(() => window.__dropRoom.setClub(true));
  await e(() => window.__dropRoom.forceHype(0.1));
  await wait(1500);
  c = await crowd();
  check('club: the crowd is life-size round the booth (context "club")', c.context === 'club' && c.drawCalls === 1, `${c.context}, ${c.drawCalls} draw call`);
  check('club: cold crowd = 16 dancers, mostly idle', c.instances === 16 && c.counts[0] >= 12, `${c.instances}: ${JSON.stringify(c.counts)}`);
  const layout = await e(() => {
    const scene = window.__dropRoom.world.scene;
    const mesh = scene.getObjectByName('Dancers');
    const a = mesh.instanceMatrix.array;
    const spots = [];
    for (let i = 0; i < 24; i++) spots.push({ x: a[i * 16 + 12], z: a[i * 16 + 14], s: a[i * 16] });
    const worldScale = mesh.getWorldScale(mesh.position.clone()).x;
    return { spots, worldScale };
  });
  const STACK = { x: 2.7, z: -2.6 };
  const PILLARS = [-5.8, 5.8].flatMap((x) => [-6, -1.5, 3].map((z) => ({ x, z })));
  const stacksClear = layout.spots.every((p) => [-1, 1].every((side) => Math.hypot(p.x - side * STACK.x, p.z - STACK.z) > 1.3));
  const pillarsClear = layout.spots.every((p) => PILLARS.every((q) => Math.hypot(p.x - q.x, p.z - q.z) > 0.8));
  const boothClear = layout.spots.every((p) => !(Math.abs(p.x) < 1.1 && p.z > -0.9 && p.z < 1.9));
  let minGap = Infinity;
  for (let i = 0; i < 24; i++) for (let j = i + 1; j < 24; j++) minGap = Math.min(minGap, Math.hypot(layout.spots[i].x - layout.spots[j].x, layout.spots[i].z - layout.spots[j].z));
  const wallsClear = layout.spots.every((p) => Math.abs(p.x) < 6.2 && p.z > -7.7 && p.z < 5.6);
  check('club: no dancer inside the booth, the DJ strip, a speaker stack or a pillar', stacksClear && pillarsClear && boothClear, `stacks ${stacksClear}, pillars ${pillarsClear}, booth ${boothClear}`);
  check('club: dancers do not overlap each other (>= 0.9 m apart) or the walls', minGap >= 0.9 && wallsClear, `closest ${minGap.toFixed(2)} m`);
  const around = layout.spots.filter((p) => p.z > 0).length;
  check('club: they stand all round the booth (some behind it, some in front)', around >= 3 && layout.spots.filter((p) => p.z < 0).length >= 8, `${around} behind, ${24 - around} in front`);
  check('club: life-size (crowd root at scale 1)', Math.abs(layout.worldScale - 1) < 0.05, `scale ${layout.worldScale.toFixed(3)}`);
  await e(() => window.__dropRoom.forceHype(0.95));
  await wait(600);
  c = await crowd();
  check('club: forced hype lifts them: 24 dancers, hands up', c.instances === 24 && c.counts[3] >= 12, `${c.instances}: ${JSON.stringify(c.counts)}`);
  await wait(300);
  const clubStats = await e(() => window.__dropRoom.drawCalls());
  check('draw calls in club mode with music are within budget (<= 400; was ~402)', clubStats.calls <= 400, `${clubStats.calls} calls, ${clubStats.triangles} triangles`);
  check('triangles in club mode are within budget (<= 150k)', clubStats.triangles <= 150000, `${clubStats.triangles}`);

  await e(() => {
    window.__dropRoom.forceHype(null);
    window.__dropRoom.setClub(false);
  });
  return out.join('\n');
}
