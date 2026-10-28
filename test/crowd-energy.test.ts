import { describe, expect, it } from 'vitest';
import type { DeckView, EngineState } from '../src/audio/engine';
import { CrowdEnergy } from '../src/show/crowd-energy';

const deck = (over: Partial<DeckView> = {}): DeckView =>
  ({ playing: true, section: 'intro', stems: [1, 1, 1, 1], kills: [false, false, false], fader: 1, loopBars: 0, ...over }) as DeckView;

function state(over: Partial<EngineState> = {}): EngineState {
  return { running: true, master: 'A', bpm: 120, heard: 0, drops: 0, dropAt: 0, crossfader: -1, echo: false, space: false, A: deck(), B: deck({ playing: false }), ...over } as EngineState;
}

/** Run the model for `seconds` of steady state, 60 frames a second. */
function settle(crowd: CrowdEnergy, s: EngineState, seconds: number): number {
  const start = s.heard;
  for (let t = 0; t < seconds; t += 1 / 60) {
    s.heard = start + t;
    crowd.update(s, 1 / 60);
  }
  return crowd.energy;
}

describe('crowd energy', () => {
  it('follows the section the crowd hears: a drop beats an intro', () => {
    const intro = settle(new CrowdEnergy(), state(), 15);
    const drop = settle(new CrowdEnergy(), state({ A: deck({ section: 'drop' }) }), 15);
    expect(drop).toBeGreaterThan(intro + 0.4);
  });

  it('glides instead of jumping', () => {
    const crowd = new CrowdEnergy();
    settle(crowd, state(), 15);
    const before = crowd.energy;
    const s = state({ A: deck({ section: 'drop' }), heard: 15 });
    crowd.update(s, 1 / 60);
    expect(crowd.energy - before).toBeLessThan(0.01);
  });

  it('drops when stems are muted', () => {
    const full = settle(new CrowdEnergy(), state({ A: deck({ section: 'drop' }) }), 15);
    const thin = settle(new CrowdEnergy(), state({ A: deck({ section: 'drop', stems: [1, 0, 0, 0] }) }), 15);
    expect(thin).toBeLessThan(full - 0.2);
  });

  it('a fresh drop gives a boost that fades', () => {
    const crowd = new CrowdEnergy();
    const s = state({ A: deck({ section: 'build' }), drops: 1, dropAt: 0 });
    settle(crowd, s, 1);
    const early = crowd.target;
    settle(crowd, s, 20); // 8 bars at 120 BPM = 16 s
    expect(early).toBeGreaterThan(crowd.target + 0.15);
  });

  it('two basslines at once is mud', () => {
    const clean = settle(new CrowdEnergy(), state({ crossfader: 0, A: deck({ section: 'drop' }), B: deck({ section: 'drop', stems: [1, 0, 1, 1] }) }), 15);
    const mud = settle(new CrowdEnergy(), state({ crossfader: 0, A: deck({ section: 'drop' }), B: deck({ section: 'drop' }) }), 15);
    expect(mud).toBeLessThan(clean - 0.05);
  });

  it('gets bored after 32 bars with nothing changed, and wakes on a change', () => {
    const crowd = new CrowdEnergy();
    const s = state({ A: deck({ section: 'drop' }) });
    settle(crowd, s, 10);
    const fresh = crowd.target;
    settle(crowd, s, 60); // 32 bars at 120 BPM = 64 s
    expect(crowd.target).toBeLessThan(fresh - 0.1);
    s.echo = true;
    settle(crowd, s, 0.1);
    expect(crowd.target).toBeCloseTo(fresh, 5);
  });
});
