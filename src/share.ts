import { liveEngine } from './audio/live.js';
import { decodeMoves, encodeMoves, setFromHash } from './audio/move-log.js';

/** The browser-side half of REC and SHARE: the recording is kept as a Blob
 * and offered (Web Share, else a download) now if the page can, otherwise from
 * a "Save recording" button that stays on the page after the XR session ends.
 * The set link is the move log, compressed, in the URL hash. */

let presenting: () => boolean = () => false;
/** Tell this module when an XR session is open (the DOM is hidden then and a
 * share/download would need a user gesture that a hand poke is not). */
export function setPresentingProbe(probe: () => boolean): void {
  presenting = probe;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

/** The last thing SHARE/REC told the player, for the shelf's status screen. */
export const notice = { text: '', at: -1e9 };

function status(text: string): void {
  notice.text = text;
  notice.at = performance.now();
  const el = $('set-status');
  if (el != null) el.textContent = text;
}

/** The link that replays the set performed so far. */
export async function buildSetUrl(): Promise<string> {
  const code = await encodeMoves(liveEngine().log.moves);
  return `${location.origin}${location.pathname}#set=${code}`;
}

/** SHARE: build the link, show it on the page and try to copy it. */
export async function shareSet(): Promise<string> {
  const url = await buildSetUrl();
  const box = $<HTMLInputElement>('set-link');
  if (box != null) {
    box.value = url;
    box.hidden = false;
  }
  (window as unknown as { __lastSetUrl: string }).__lastSetUrl = url;
  let copied = false;
  try {
    await navigator.clipboard.writeText(url);
    copied = true;
  } catch {
    // no clipboard permission without a page gesture (e.g. inside XR)
  }
  status(copied ? 'Set link copied' : 'Set link ready: use Copy set link');
  return url;
}

/** Share the finished take as a file, or download it. Needs a user gesture. */
export async function saveRecording(): Promise<'shared' | 'downloaded' | 'none'> {
  const recorder = liveEngine().recorder;
  const blob = recorder.blob;
  if (blob == null) return 'none';
  const name = `dj-drop-room-set.${recorder.extension}`;
  const file = new File([blob], name, { type: blob.type });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'My DJ Drop Room set' });
      status('Recording shared');
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'none';
      // fall through to a download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  status('Recording downloaded');
  return 'downloaded';
}

/** A take just finished: offer it now when the page can, else leave the
 * button. The Blob stays on the recorder either way. */
export async function offerRecording(): Promise<void> {
  const blob = liveEngine().recorder.blob;
  if (blob == null) return;
  status(`Recording ready (${Math.round(blob.size / 1024)} KB)`);
  refreshTools();
  if (!presenting() && navigator.userActivation?.isActive) await saveRecording();
}

function refreshTools(): void {
  const engine = liveEngine();
  const save = $<HTMLButtonElement>('save-recording');
  const tools = $('set-tools');
  if (tools != null) tools.hidden = !engine.state.running && engine.recorder.blob == null;
  if (save != null) {
    const blob = engine.recorder.blob;
    save.hidden = blob == null;
    if (blob != null) save.textContent = `Save recording (${Math.floor(engine.recorder.lastSeconds)} s)`;
  }
}

export function installSetTools(): void {
  $('save-recording')?.addEventListener('click', () => void saveRecording());
  $('copy-set-link')?.addEventListener('click', () => void shareSet());
  setInterval(refreshTools, 500);
}

/** A set link was opened: queue its moves, to play from the Start press.
 * Returns how many moves it holds (0 when there is none or it is invalid). */
export async function queueSharedSet(): Promise<number> {
  const code = setFromHash(location.hash);
  if (code == null) return 0;
  try {
    const moves = await decodeMoves(code);
    liveEngine().queueReplay(moves);
    return moves.length;
  } catch {
    status('That set link could not be read');
    return 0;
  }
}
