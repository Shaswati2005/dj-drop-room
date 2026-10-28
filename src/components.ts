import { defineComponents } from '@iwsdk/core';
import { ConsoleRoot, Fader, JogWheel, Knob, MusicState, PerfPad, PushButton } from './console-components.js';

export default defineComponents([PerfPad, PushButton, Knob, Fader, JogWheel, ConsoleRoot, MusicState]);
