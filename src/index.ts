import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { liveEngine, unlockAudio } from './audio/live.js';
import { installDebugApi } from './debug/debug-api.js';
import { ConsoleInputSystem } from './systems/console-input-system.js';
import { ConsolePlacementSystem } from './systems/console-placement-system.js';
import { MusicStateMirrorSystem } from './systems/music-state-mirror-system.js';
import { JogWheelSystem } from './systems/jog-wheel-system.js';
import { PadFeedbackSystem } from './systems/pad-feedback-system.js';

// Any user gesture may resume audio: page clicks and keys, and XR selects
// (a hand pinch), since a fingertip poke alone is not a browser gesture.
for (const type of ['pointerdown', 'keydown'] as const) document.addEventListener(type, unlockAudio);

// the opening tracks load while the page is still showing the Start button
void liveEngine().preload();

const startButton = document.getElementById('start-music') as HTMLButtonElement;
startButton.addEventListener('click', () => {
  unlockAudio();
  void liveEngine().start();
  startButton.hidden = true;
});

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then((world) => {
  world.registerSystem(ConsoleInputSystem);
  world.registerSystem(ConsolePlacementSystem);
  world.registerSystem(MusicStateMirrorSystem);
  world.registerSystem(PadFeedbackSystem);
  world.registerSystem(JogWheelSystem);
  world.renderer.xr.addEventListener('sessionstart', () => {
    world.renderer.xr.getSession()?.addEventListener('selectstart', unlockAudio);
  });
  installDebugApi();
});
