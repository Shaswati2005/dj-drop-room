import { defineAssets } from '@iwsdk/core';
import {
  createConsoleFrame,
  createPlayButton,
  createStartPad,
  createStemPad,
} from './scene-assets/console.scene-asset.js';

export default defineAssets({
  'console-frame': createConsoleFrame(),
  'pad-drums': createStemPad('drums'),
  'pad-bass': createStemPad('bass'),
  'pad-chords': createStemPad('chords'),
  'pad-melody': createStemPad('melody'),
  'play-button': createPlayButton(),
  'start-pad': createStartPad(),
});
