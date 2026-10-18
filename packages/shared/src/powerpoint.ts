/**
 * Protocol between the WorkVerse client and the local "WorkVerse PowerPoint Connector" (runs on the speaker's PC).
 * Types only plus a few constants, so the connector, the client and the tests agree on one definition.
 */

export const POWERPOINT_CONNECTOR_PORT = 47831;
export const POWERPOINT_PAIR_CODE_LENGTH = 6;

export type ShowMode = 'fullscreen' | 'window';
export type BlankKind = 'black' | 'white';
export type PointerMode = 'arrow' | 'pen' | 'laser' | 'hidden' | 'erase';
/** running = normal; black/white = blanked screen; paused; ended = the show is over (last slide passed). */
export type ShowState = 'running' | 'black' | 'white' | 'paused' | 'ended';

export interface PresentationStatus {
  /** PowerPoint is running. */
  app: boolean;
  /** A presentation is open (name only, never a full path). */
  presentation: { name: string; slides: number } | null;
  /** A slide show is in progress (null when there is none). */
  show: { state: ShowState; mode: ShowMode | null; pointer: PointerMode | null } | null;
  /** Current slide, 1-based (the show's, or the selected one while editing). 0 when unknown. */
  index: number;
  title: string;
  /** Speaker notes of the current slide (plain text). */
  notes: string;
  /** Slide thumbnails exported by the connector. */
  thumbs: { ready: number; total: number; version: number };
  /** What this connector can do; other adapters (keystrokes, Keynote...) may offer less. */
  capabilities: ConnectorCapabilities;
}

export interface ConnectorCapabilities {
  adapter: string;
  openDialog: boolean;
  notes: boolean;
  goto: boolean;
  export: boolean;
  pointer: boolean;
  blank: boolean;
  windowMode: boolean;
}

export type ExportFormat = 'png' | 'jpeg';

export interface ExportProgress {
  state: 'idle' | 'running' | 'done' | 'error';
  /** Slides already available through GET /v1/slides/:n/full. */
  ready: number;
  total: number;
  width: number;
  format: ExportFormat;
  /** Increments with every export job; lets the client discard stale progress. */
  job: number;
  error?: string;
}

export const CONNECTOR_ERROR_CODES = [
  'unauthorized',
  'forbidden_origin',
  'forbidden_host',
  'rate_limited',
  'bad_request',
  'not_found',
  'payload_too_large',
  'unsupported_media_type',
  'no_powerpoint',
  'no_presentation',
  'no_show',
  'protected_view',
  'busy',
  'unsupported',
  'cancelled',
  'timeout',
  'internal',
] as const;
export type ConnectorErrorCode = (typeof CONNECTOR_ERROR_CODES)[number];

export interface ConnectorErrorBody {
  error: { code: ConnectorErrorCode; message: string; retryAfterSeconds?: number };
}

export const POWERPOINT_EXPORT_LIMITS = { minWidth: 160, maxWidth: 3000, thumbWidth: 320 } as const;
