# Demo video shot scripts

One JSON per shot of the demo video, adapted to what exists at the Day 12 content freeze (no Pro mode, no separate ROLL pads: loops live in the LOOP pad mode; no left-handed mirror). The video is captured in IWSDK's emulator (IWER), in its synthetic `sunlit_living_room`, with the real in-app audio.

## Before you record

1. `npx @iwsdk/cli dev status` reports `browserCommandReady: true`; the environment is `sunlit_living_room` (`iwsdk.config.json`, `dev.emulator.environment`).
2. Unmute the tab (the driver does it in each shot's setup; by hand: `npx @iwsdk/cli browser set-muted --input-json '{"muted":false}'`).
3. Record the managed Chromium window with OBS (1920x1080, 60 fps, tab audio). Crop to the canvas so the unsupported-flag banner is not in frame. Run headed for the shoot (`npx @iwsdk/cli dev restart --ai-mode agent --allow-browser-automation` is headless; tell the developer before changing the window mode).
4. Start OBS recording, then run the shot command. Every shot's setup rebuilds its own starting state, so shots can be retaken in any order. Retakes are identical.

## Run commands

```bash
node scripts/video/build-shots.mjs                 # rebuild the JSON from the definitions (only after editing build-shots.mjs)
node scripts/video/run-shot.mjs 01 --dry           # plan one shot: every xr run-sequence with dryRun:true
node scripts/video/run-shot.mjs all --dry          # plan all nine
node scripts/video/run-shot.mjs 01                 # take: setup, the sequence, then PASS/FAIL on what the shot needs
node scripts/video/run-shot.mjs 03 --no-setup      # take again without rebuilding the starting state
```

Each `{ "seq": ... }` step in a shot JSON is exactly an `xr run-sequence` input, so it also runs by hand:
`npx @iwsdk/cli xr run-sequence --input-json '<the seq object>' --timeout 90000`. The motion is the run-sequence default: one smooth minimum-jerk arc per move, the head turns to each target first, the other hand rests by the hip, and sliders are pinch-grabs. `wait`, `waitFor`, `mute`, `slide`, `ray` and `pinch` steps are driver steps (they read engine state or slide a knob or aim a hand ray, which one run-sequence cannot).

## Shots

| Shot | Video time | Setup (done by the driver) | What the hands do | Needs (checked) |
|---|---|---|---|---|
| `01-cold-open` | 0:00-0:08 | fresh page, XR entered, hand mode, unmuted, Warm Start playing 14 s | right index presses DROP; riser, room dims, beams, crowd | a drop has landed (`drops >= 1`, not still dropping) |
| `02-start` | 0:08-0:25 | fresh page, nothing playing | right index presses the Start pad; music begins on the bar | `running` and deck A playing |
| `03-stems` | 0:25-0:50 | music running 6 s | left hand: A bass out, A drums out, bass back, drums back | all four stems on again, 4+ moves logged |
| `04-mix` | 0:50-1:15 | music running 6 s | right hand: crate Load Mirrorball B, PLAY B, crossfader B end (4-bar fade) | B plays Mirrorball, crossfader at B |
| `05-full-build` | 1:15-1:40 | music running 10 s | left hand slides FILTER A, taps it back, LOOP mode + 2-bar loop; right hand holds ECHO 2.5 s, presses DROP | a drop landed and the room is dimmed |
| `06-genre-tour` | 1:40-1:55 | Mirrorball on air from deck B | crate: Concrete onto A, PLAY A, A end; then Rainy Tape onto B, PLAY B, B end | Rainy Tape on air on B, crossfader at B |
| `07-come-back` | 1:55-2:05 | a stored best set is seeded (peak 55, 20 s on fire), music running 8 s | DROP, wait for the nightly request toast (about 8 bars after the first drop), then the settings tab FINISH SET | the summary card is up, request toast was shown |
| `08-accessibility` | 2:05-2:15 | music running 8 s | one hand only (right): pad, then 3 s with the tab muted (the show alone carries the beat), reduced flash on, DROP | reduced flash is on and a drop landed |
| `08b-glasses` | 2:15-2:22 | device switched to `metaVRGlasses` (config edit, restored after), head pitched 35 degrees, hands clear | a far hand's ray at the A bass pad and pinch, then at DROP and pinch (the black mask is the glasses' view) | a drop landed |
| end card | 2:22-2:30 | not captured in the app | title card made in the edit: URL, "Built with Immersive Web SDK, hands only, Meta Quest and Meta VR Glasses browser, captured in IWSDK's Immersive Web Emulator (IWER)" | |

Notes for the edit:
- Shot 01 is also the Devpost thumbnail GIF (first 8 s).
- Shot 04 shows the crate: the head turns to the shelf behind the decks before the pokes.
- Shot 08b switches `dev.emulator.device` to `metaVRGlasses`, which restarts Vite in place and reloads the page; the driver restores `metaQuest3` when it exits, even on failure. `gazeTracking` stays off in `iwsdk.config.json` (it breaks fader pinch-grab). Without that feature the app does not act on the glasses' gaze source, so the shot uses the far hand's ray (`xr look-at` on the hand) and the pinch is `xr select` on the same hand; the capture is the same view and the same ray + pinch path Meta VR Glasses fall back to.
- Captions are about music, the room and the crowd; there is no score on screen.
