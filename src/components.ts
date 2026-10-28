import { defineComponents } from '@iwsdk/core';
import { ConsoleRoot, Fader, JogWheel, Knob, LightRig, MusicState, PerfPad, PushButton } from './console-components.js';

export default defineComponents([PerfPad, PushButton, Knob, Fader, JogWheel, ConsoleRoot, LightRig, MusicState]);
