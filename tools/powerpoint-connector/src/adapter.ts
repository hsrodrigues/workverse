import type { BlankKind, ConnectorCapabilities, ConnectorErrorCode, ExportFormat, PointerMode, PresentationStatus, ShowMode } from '@workverse/shared';

/** Status as the adapter sees it; the connector adds the thumbnails part. */
export type AdapterStatus = Omit<PresentationStatus, 'thumbs' | 'capabilities'>;

export class AdapterError extends Error {
  constructor(
    readonly code: ConnectorErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * What the connector needs from a presentation program. The PowerPoint adapter drives COM through a persistent
 * PowerShell worker. Another adapter (Keynote, Google Slides, a generic "send keys" one) only has to implement this:
 * next/previous can be plain keystrokes, and the capabilities tell the interface which buttons make sense.
 *
 * Adapters never receive paths or text from the web: the file is chosen by the person at the PC (openWithDialog)
 * and export paths are created by the connector itself.
 */
export interface PresentationAdapter {
  readonly capabilities: ConnectorCapabilities;
  status(): Promise<AdapterStatus>;
  /** Shows the native "Open" dialog on the speaker's PC and opens what was chosen. false = the person cancelled. */
  openWithDialog(): Promise<boolean>;
  start(mode: ShowMode, from?: number): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  goto(index: number): Promise<void>;
  first(): Promise<void>;
  last(): Promise<void>;
  /** Toggles a black or white screen. */
  blank(kind: BlankKind): Promise<void>;
  pointer(mode: PointerMode): Promise<void>;
  end(): Promise<void>;
  /** Writes slide `index` (1-based) as an image of `width` px to `outPath` (chosen by the connector). */
  exportSlide(index: number, width: number, format: ExportFormat, outPath: string): Promise<void>;
  dispose(): Promise<void>;
}
