import fs from 'node:fs/promises';
import path from 'node:path';
import { POWERPOINT_EXPORT_LIMITS, type ExportFormat, type ExportProgress } from '@workverse/shared';
import type { PresentationAdapter } from './adapter';

type Track = 'thumb' | 'full';

interface TrackState {
  job: number;
  key: string;
  ready: number;
  total: number;
  width: number;
  format: ExportFormat;
  state: ExportProgress['state'];
  error?: string;
  /** Files by 1-based slide index. */
  files: Map<number, string>;
  failedKeys: Set<string>;
}

const emptyTrack = (format: ExportFormat, width: number): TrackState => ({
  job: 0,
  key: '',
  ready: 0,
  total: 0,
  width,
  format,
  state: 'idle',
  files: new Map(),
  failedKeys: new Set(),
});

/**
 * Renders slides to image files inside a private folder the connector owns. File names are built here from
 * integers only: the web never supplies a path, and only these files can be read back.
 */
export class ExportManager {
  private readonly tracks: Record<Track, TrackState> = {
    thumb: emptyTrack('jpeg', POWERPOINT_EXPORT_LIMITS.thumbWidth),
    full: emptyTrack('png', 1600),
  };
  private lock: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly adapter: PresentationAdapter,
    readonly root: string,
    private readonly log: (msg: string) => void = () => undefined,
  ) {}

  private async serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  private ext(t: TrackState) {
    return t.format === 'jpeg' ? 'jpg' : 'png';
  }

  private fileFor(track: Track, t: TrackState, index: number) {
    return path.join(this.root, `${track}-${t.job}-${String(index).padStart(3, '0')}.${this.ext(t)}`);
  }

  /** Thumbnails follow the open presentation by themselves (called whenever the status is read). */
  ensureThumbs(key: string, total: number) {
    const t = this.tracks.thumb;
    if (!key || total < 1) return;
    if (t.key === key && (t.state === 'running' || t.state === 'done')) return;
    if (t.failedKeys.has(key)) return;
    this.startTrack('thumb', key, total, POWERPOINT_EXPORT_LIMITS.thumbWidth, 'jpeg');
  }

  refreshThumbs(key: string, total: number) {
    this.tracks.thumb.failedKeys.delete(key);
    this.startTrack('thumb', key, total, POWERPOINT_EXPORT_LIMITS.thumbWidth, 'jpeg');
  }

  startFull(key: string, total: number, width: number, format: ExportFormat): ExportProgress {
    const w = Math.max(POWERPOINT_EXPORT_LIMITS.minWidth, Math.min(POWERPOINT_EXPORT_LIMITS.maxWidth, Math.round(width)));
    this.startTrack('full', key, total, w, format);
    return this.progress();
  }

  private startTrack(track: Track, key: string, total: number, width: number, format: ExportFormat) {
    const prev = this.tracks[track];
    const old = [...prev.files.values()];
    const next: TrackState = { ...emptyTrack(format, width), job: prev.job + 1, key, total, state: 'running', failedKeys: prev.failedKeys };
    this.tracks[track] = next;
    void Promise.all(old.map((f) => fs.rm(f, { force: true }))).catch(() => undefined);
    void this.runJob(track, next);
  }

  private async runJob(track: Track, t: TrackState) {
    for (let i = 1; i <= t.total; i++) {
      if (this.tracks[track] !== t) return; // replaced by a newer job
      const file = this.fileFor(track, t, i);
      try {
        await this.serial(async () => {
          if (this.tracks[track] !== t) return;
          await this.adapter.exportSlide(i, t.width, t.format, file);
        });
        if (this.tracks[track] !== t) {
          void fs.rm(file, { force: true });
          return;
        }
        const st = await fs.stat(file);
        if (st.size <= 0) throw new Error('empty');
        t.files.set(i, file);
        t.ready = i;
      } catch (e) {
        t.state = 'error';
        t.error = e instanceof Error && e.message && e.message !== 'empty' ? e.message : `Não foi possível exportar o slide ${i}.`;
        t.failedKeys.add(t.key);
        this.log(`export ${track} falhou no slide ${i}`);
        return;
      }
    }
    if (this.tracks[track] === t) t.state = 'done';
  }

  progress(): ExportProgress {
    const t = this.tracks.full;
    return { state: t.state, ready: t.ready, total: t.total, width: t.width, format: t.format, job: t.job, ...(t.error ? { error: t.error } : {}) };
  }

  thumbsInfo() {
    const t = this.tracks.thumb;
    return { ready: t.ready, total: t.total, version: t.job };
  }

  async read(track: Track, index: number): Promise<{ bytes: Buffer; mime: string } | null> {
    const t = this.tracks[track];
    const file = t.files.get(index);
    if (!file) return null;
    try {
      return { bytes: await fs.readFile(file), mime: t.format === 'jpeg' ? 'image/jpeg' : 'image/png' };
    } catch {
      return null;
    }
  }

  async cleanup() {
    for (const t of Object.values(this.tracks)) t.job++;
    await fs.rm(this.root, { recursive: true, force: true }).catch(() => undefined);
  }
}
