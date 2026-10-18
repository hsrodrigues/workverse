import fs from 'node:fs/promises';
import type { BlankKind, ConnectorCapabilities, ExportFormat, PointerMode, ShowMode } from '@workverse/shared';
import { AdapterError, type AdapterStatus, type PresentationAdapter } from '../../src/adapter';

/** In-memory stand-in for PowerPoint: same rules as the COM adapter, no process involved. */
export class FakeAdapter implements PresentationAdapter {
  readonly capabilities: ConnectorCapabilities = { adapter: 'fake', openDialog: true, notes: true, goto: true, export: true, pointer: true, blank: true, windowMode: true };
  app = true;
  deck: { name: string; slides: number } | null = null;
  show: { state: 'running' | 'black' | 'white' | 'ended'; mode: ShowMode; pointer: PointerMode } | null = null;
  index = 1;
  dialogResult: { name: string; slides: number } | null = { name: 'demo.pptx', slides: 5 };
  calls: string[] = [];
  failExportAt = 0;
  /** Pixel width used by the last exportSlide. */
  lastWidth = 0;

  async status(): Promise<AdapterStatus> {
    if (!this.app) return { app: false, presentation: null, show: null, index: 0, title: '', notes: '' };
    return {
      app: true,
      presentation: this.deck,
      show: this.show ? { state: this.show.state, mode: this.show.mode, pointer: this.show.pointer } : null,
      index: this.deck ? this.index : 0,
      title: this.deck ? `Titulo ${this.index}` : '',
      notes: this.deck ? `Notas ${this.index}` : '',
    };
  }
  private needShow() {
    if (!this.app) throw new AdapterError('no_powerpoint', 'PowerPoint fechado');
    if (!this.show) throw new AdapterError('no_show', 'Sem apresentação em andamento');
    return this.show;
  }
  async openWithDialog() {
    this.calls.push('open');
    if (!this.dialogResult) return false;
    this.deck = this.dialogResult;
    this.index = 1;
    return true;
  }
  async start(mode: ShowMode, from?: number) {
    this.calls.push(`start:${mode}:${from ?? ''}`);
    if (!this.app) throw new AdapterError('no_powerpoint', 'PowerPoint fechado');
    if (!this.deck) throw new AdapterError('no_presentation', 'Sem apresentação');
    this.show = { state: 'running', mode, pointer: 'arrow' };
    this.index = from ?? 1;
  }
  async next() {
    this.calls.push('next');
    const s = this.needShow();
    if (this.index >= this.deck!.slides) {
      s.state = 'ended';
      this.show = null;
    } else this.index++;
  }
  async previous() {
    this.calls.push('previous');
    this.needShow();
    this.index = Math.max(1, this.index - 1);
  }
  async goto(index: number) {
    this.calls.push(`goto:${index}`);
    this.needShow();
    if (index > this.deck!.slides) throw new AdapterError('bad_request', 'fora do intervalo');
    this.index = index;
  }
  async first() {
    this.calls.push('first');
    this.needShow();
    this.index = 1;
  }
  async last() {
    this.calls.push('last');
    this.needShow();
    this.index = this.deck!.slides;
  }
  async blank(kind: BlankKind) {
    this.calls.push(`blank:${kind}`);
    const s = this.needShow();
    s.state = s.state === kind ? 'running' : kind;
  }
  async pointer(mode: PointerMode) {
    this.calls.push(`pointer:${mode}`);
    this.needShow().pointer = mode;
  }
  async end() {
    this.calls.push('end');
    this.show = null;
  }
  async exportSlide(index: number, width: number, format: ExportFormat, outPath: string) {
    this.calls.push(`export:${index}:${width}:${format}`);
    this.lastWidth = width;
    if (this.failExportAt === index) throw new AdapterError('internal', 'falhou');
    // Smallest valid-looking payloads: the connector only checks that the file exists and is not empty.
    await fs.writeFile(outPath, format === 'png' ? Buffer.from('89504e470d0a1a0a', 'hex') : Buffer.from('ffd8ffe0', 'hex'));
  }
  async dispose() {
    this.calls.push('dispose');
  }
}
