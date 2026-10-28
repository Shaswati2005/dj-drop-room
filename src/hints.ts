import type { PadMode } from './audio/engine.js';

/** What a beginner sees when a fingertip hovers over a control: a name and
 * one line on how to use it. */
export interface Hint {
  title: string;
  body: string;
}

const STEMS = ['DRUMS', 'BASS', 'CHORDS', 'MELODY'];
const LOOPS = ['1 BAR', '2 BARS', '4 BARS', '8 BARS'];
const ROLLS = ['1/4 BEAT', '1/2 BEAT', '1 BEAT', '2 BEATS'];

/** Hints for fixed controls, by entity name with the deck letter removed. */
const FIXED: Record<string, Hint> = {
  'Start Pad': { title: 'START', body: 'Tap to start the music' },
  Play: { title: 'PLAY / PAUSE', body: 'Starts in time with the other deck' },
  Cue: { title: 'CUE', body: 'Back to the start point and stop' },
  Sync: { title: 'SYNC', body: 'Match tempo and beat to the other deck' },
  'Mode Stems': { title: 'STEMS MODE', body: 'Pads mute or solo parts of the track' },
  'Mode Cues': { title: 'HOT CUES MODE', body: 'Pads save spots in the track to jump to' },
  'Mode Loop': { title: 'LOOP MODE', body: 'Pads repeat a bar or a beat' },
  Trim: { title: 'TRIM (GAIN)', body: 'Slide finger left/right · tap = centre' },
  Hi: { title: 'HIGH EQ', body: 'Hats and sparkle · slide to turn · tap = kill' },
  Mid: { title: 'MID EQ', body: 'Chords and vocals · slide to turn · tap = kill' },
  Low: { title: 'LOW EQ', body: 'Kick and bass · slide to turn · tap = kill' },
  Filter: { title: 'FILTER', body: 'Left = muffled, right = thin · tap = off' },
  Fader: { title: 'VOLUME', body: 'Pinch the cap and drag: away = louder' },
  Tempo: { title: 'TEMPO', body: 'Pinch and drag: speed ±8 % (SYNC is easier)' },
  Jog: { title: 'JOG WHEEL', body: 'Pinch and twist: nudge, or scrub when paused' },
  Crossfader: { title: 'CROSSFADER', body: 'Pinch and slide: left plays A, right plays B' },
  'Xf End': { title: 'AUTO FADE', body: 'Glide the crossfader to this side over 4 bars' },
  'Fx Echo': { title: 'ECHO', body: 'Echo on the whole mix · tap again to stop' },
  'Fx Space': { title: 'SPACE', body: 'Big reverb on the whole mix' },
  Drop: { title: 'DROP', body: 'Coming soon' },
};

/** The hint for a control entity name (e.g. "Hi A", "Pad B 6"); pads depend
 * on their deck's pad mode. */
export function hintFor(name: string, padMode: PadMode, padSlot: number): Hint | undefined {
  if (name.startsWith('Pad ')) {
    const i = padSlot % 4;
    const top = padSlot < 4;
    if (padMode === 'stems') {
      return top
        ? { title: STEMS[i], body: 'Tap to mute or unmute on the next bar' }
        : { title: `SOLO ${STEMS[i]}`, body: 'Hear only this part · tap again for all' };
    }
    if (padMode === 'cues') {
      return top
        ? { title: `HOT CUE ${i + 1}`, body: 'Empty: tap to save · lit: tap to jump' }
        : { title: `DELETE CUE ${i + 1}`, body: 'Clears the hot cue above' };
    }
    return top
      ? { title: `LOOP ${LOOPS[i]}`, body: 'Tap to loop · tap again to carry on' }
      : { title: `ROLL ${ROLLS[i]}`, body: 'Hold to stutter · let go to carry on' };
  }
  return FIXED[name] ?? FIXED[name.replace(/ [AB]$/, '')];
}
