/** The move log (PLAN-DJ-UPGRADE day 9): every performance action the engine
 * is asked to do, stamped with the audio-clock time since the set started.
 * Replaying the log through the engine plays the same set. Pure data and
 * maths, no audio imports, so it runs in plain Node tests. */

/** [time in centiseconds since set start, one-letter op, ...integer/string args] */
export type Move = [number, string, ...(number | string)[]];

/** Ops whose value changes continuously while a hand drags: samples inside
 * one bucket collapse into one move so a long drag stays small. */
const CONTINUOUS = new Set(['k', 'f', 'X', 't']);
/** Continuous samples closer together than this (centiseconds) are merged. */
export const BUCKET_CS = 6;
/** Cap, so a runaway log cannot make an unusable link. */
export const MAX_MOVES = 4000;

export class MoveLog {
  readonly moves: Move[] = [];
  /** audio time (s) the set started at, or -1 before it has */
  start = -1;
  private bucketStart = 0;

  begin(audioTime: number): void {
    this.start = audioTime;
    this.moves.length = 0;
  }

  record(audioTime: number, op: string, ...args: (number | string)[]): void {
    if (this.start < 0 || this.moves.length >= MAX_MOVES) return;
    const t = Math.max(0, Math.round((audioTime - this.start) * 100));
    const prev = this.moves[this.moves.length - 1];
    if (CONTINUOUS.has(op) && prev != null && prev[1] === op && t - this.bucketStart < BUCKET_CS && sameTarget(prev, args)) {
      prev[prev.length - 1] = args[args.length - 1];
      return;
    }
    this.bucketStart = t;
    this.moves.push([t, op, ...args]);
  }
}

/** Same control (all args but the value) as the previous move. */
function sameTarget(prev: Move, args: (number | string)[]): boolean {
  if (prev.length - 2 !== args.length) return false;
  for (let i = 0; i < args.length - 1; i++) if (prev[2 + i] !== args[i]) return false;
  return true;
}

const VERSION = 1;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  writer.write(bytes as BufferSource).catch(() => {}); // a bad input errors on the read side below
  writer.close().catch(() => {});
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

/** Moves → URL-safe text. "z" prefix = deflate-compressed JSON; "j" = plain
 * JSON (a browser without CompressionStream). */
export async function encodeMoves(moves: readonly Move[]): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify([VERSION, moves]));
  if (typeof CompressionStream === 'undefined') return 'j' + toBase64Url(json);
  return 'z' + toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

/** The inverse of encodeMoves. Throws on anything that is not a valid log. */
export async function decodeMoves(text: string): Promise<Move[]> {
  const bytes = fromBase64Url(text.slice(1));
  let json: Uint8Array;
  if (text[0] === 'z') json = await pipe(bytes, new DecompressionStream('deflate-raw'));
  else if (text[0] === 'j') json = bytes;
  else throw new Error('Not a DJ Drop Room set');
  const [version, moves] = JSON.parse(new TextDecoder().decode(json)) as [number, unknown];
  if (version !== VERSION || !Array.isArray(moves) || moves.length > MAX_MOVES) throw new Error('Unsupported set');
  for (const m of moves) {
    if (!Array.isArray(m) || typeof m[0] !== 'number' || typeof m[1] !== 'string' || m[1].length !== 1) throw new Error('Bad move');
  }
  return moves as Move[];
}

/** Pull the log out of a URL hash such as "#set=z..."; null when absent. */
export function setFromHash(hash: string): string | null {
  const match = /(?:^#|&)set=([A-Za-z0-9_-]+)/.exec(hash);
  return match ? match[1] : null;
}
