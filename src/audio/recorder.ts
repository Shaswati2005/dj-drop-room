import * as Tone from 'tone';

const MIMES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'];

/** Records the master output (after the limiter, so it is what the speakers
 * play) to an audio file with MediaRecorder. The stream destination hangs off
 * the master bus all the time; only the recorder itself starts and stops. */
export class Recorder {
  recording = false;
  /** the last finished take, kept so it can be saved after the XR session ends */
  blob: Blob | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private readonly destination: MediaStreamAudioDestinationNode;
  private readonly mime: string;
  /** seconds in the last take */
  lastSeconds = 0;
  /** bumped whenever a take finishes, for UI that shows "ready" */
  takes = 0;

  constructor(private readonly context: Tone.BaseContext, source: Tone.ToneAudioNode) {
    this.destination = context.createMediaStreamDestination();
    Tone.connect(source, this.destination);
    this.mime = typeof MediaRecorder === 'undefined' ? '' : (MIMES.find((m) => MediaRecorder.isTypeSupported(m)) ?? '');
  }

  get supported(): boolean {
    return typeof MediaRecorder !== 'undefined';
  }

  /** File extension that matches the recorded container. */
  get extension(): string {
    return this.mime.includes('ogg') ? 'ogg' : this.mime.includes('mp4') ? 'm4a' : 'webm';
  }

  /** Seconds recorded so far in this take. */
  get seconds(): number {
    return this.recording ? (performance.now() - this.startedAt) / 1000 : this.lastSeconds;
  }

  start(): boolean {
    if (this.recording || !this.supported) return false;
    this.chunks = [];
    this.recorder = new MediaRecorder(this.destination.stream, this.mime ? { mimeType: this.mime } : undefined);
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(250);
    this.startedAt = performance.now();
    this.recording = true;
    return true;
  }

  /** Stop and resolve with the finished file (also kept in `blob`). */
  stop(): Promise<Blob | null> {
    const recorder = this.recorder;
    if (!this.recording || recorder == null) return Promise.resolve(this.blob);
    return new Promise((resolve) => {
      recorder.onstop = () => {
        this.lastSeconds = (performance.now() - this.startedAt) / 1000;
        this.blob = new Blob(this.chunks, { type: recorder.mimeType || this.mime || 'audio/webm' });
        this.chunks = [];
        this.recording = false;
        this.recorder = null;
        this.takes++;
        resolve(this.blob);
      };
      recorder.stop();
    });
  }

  toggle(): Promise<Blob | null> | null {
    if (this.recording) return this.stop();
    this.start();
    return null;
  }

  dispose(): void {
    if (this.recording) void this.stop();
    this.destination.disconnect();
  }
}
