import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { BlankKind, ConnectorCapabilities, ConnectorErrorCode, ExportFormat, PointerMode, ShowMode } from '@workverse/shared';
import { AdapterError, type AdapterStatus, type PresentationAdapter } from './adapter';

const here = path.dirname(fileURLToPath(import.meta.url));
const PS_DIR = path.resolve(here, '..', 'ps');
const MARK = '@@WV@@';

/** Messages for people (Portuguese). The worker only sends codes, never free text from COM. */
export const ERROR_MESSAGES: Record<string, string> = {
  no_powerpoint: 'O PowerPoint não está aberto neste computador. Use "Abrir apresentação…" para abri-lo com um arquivo.',
  no_presentation: 'Nenhuma apresentação aberta no PowerPoint. Use "Abrir apresentação…".',
  no_show: 'A apresentação não está em andamento. Clique em "Iniciar" primeiro.',
  protected_view: 'O PowerPoint abriu o arquivo em Modo Protegido. Abra-o no PowerPoint, clique em "Habilitar edição" e tente de novo.',
  busy: 'O PowerPoint está ocupado (talvez com uma janela de diálogo aberta). Feche a janela e tente de novo.',
  unsupported: 'Este recurso não é compatível com a sua versão do PowerPoint.',
  bad_request: 'Pedido inválido.',
  timeout: 'O PowerPoint não respondeu a tempo.',
  internal: 'Falha inesperada ao falar com o PowerPoint.',
};

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/** JSON on one line with every non-ASCII character escaped, so the console code page never matters. */
export function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

export interface PowerShellOptions {
  exportRoot: string;
  /** Executable; "powershell.exe" (Windows PowerShell 5.1, always present on Windows 10/11). */
  exe?: string;
  commandTimeoutMs?: number;
}

/** Persistent PowerShell process holding the COM worker: no 300 ms start-up per command. */
export class PowerShellWorker {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private buffer = '';
  private ready: Promise<void> | null = null;
  private disposed = false;

  constructor(private readonly opts: PowerShellOptions) {}

  private exe() {
    return this.opts.exe ?? 'powershell.exe';
  }

  private ensure(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      let proc: ChildProcessWithoutNullStreams;
      try {
        proc = spawn(this.exe(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(PS_DIR, 'worker.ps1'), '-ExportRoot', this.opts.exportRoot], {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (e) {
        reject(new AdapterError('unsupported', 'Este conector só funciona no Windows com o Microsoft PowerPoint instalado.'));
        return;
      }
      this.proc = proc;
      this.buffer = '';
      let settled = false;
      const startTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.reset();
          reject(new AdapterError('timeout', 'O componente do PowerShell demorou demais para iniciar.'));
        }
      }, 20_000);
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk: string) => {
        this.buffer += chunk;
        let nl: number;
        while ((nl = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, nl).replace(/\r$/, '');
          this.buffer = this.buffer.slice(nl + 1);
          if (!line.startsWith(MARK)) continue;
          let msg: { id: number; ok: boolean; data?: unknown; code?: string; message?: string };
          try {
            msg = JSON.parse(line.slice(MARK.length));
          } catch {
            continue;
          }
          if (msg.id === 0 && !settled) {
            settled = true;
            clearTimeout(startTimer);
            resolve();
            continue;
          }
          const p = this.pending.get(msg.id);
          if (!p) continue;
          this.pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.ok) p.resolve(msg.data);
          else {
            const code = (msg.code && msg.code in ERROR_MESSAGES ? msg.code : 'internal') as ConnectorErrorCode;
            p.reject(new AdapterError(code, ERROR_MESSAGES[code] ?? ERROR_MESSAGES.internal));
          }
        }
      });
      proc.stderr.resume();
      proc.on('error', () => {
        if (!settled) {
          settled = true;
          clearTimeout(startTimer);
          reject(new AdapterError('unsupported', 'Este conector só funciona no Windows com o Microsoft PowerPoint instalado.'));
        }
        this.reset();
      });
      proc.on('exit', () => {
        if (!settled) {
          settled = true;
          clearTimeout(startTimer);
          reject(new AdapterError('internal', 'O componente do PowerShell encerrou inesperadamente.'));
        }
        this.reset();
      });
    });
    this.ready.catch(() => undefined);
    return this.ready;
  }

  /** Drops the process and fails what was waiting; the next command starts a fresh one. */
  private reset() {
    const proc = this.proc;
    this.proc = null;
    this.ready = null;
    try {
      proc?.kill();
    } catch {
      /* already gone */
    }
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new AdapterError('internal', 'O componente do PowerShell foi reiniciado. Tente de novo.'));
      this.pending.delete(id);
    }
  }

  async call<T = unknown>(cmd: string, args: Record<string, unknown> = {}, timeoutMs = this.opts.commandTimeoutMs ?? 20_000): Promise<T> {
    if (this.disposed) throw new AdapterError('cancelled', 'Conector encerrado.');
    await this.ensure();
    const proc = this.proc;
    if (!proc) throw new AdapterError('internal', 'O componente do PowerShell não está disponível.');
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AdapterError('timeout', ERROR_MESSAGES.timeout));
        // A stuck COM call cannot be cancelled: start over with a clean process.
        this.reset();
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      proc.stdin.write(asciiJson({ id, cmd, args }) + '\n', (err) => {
        if (err) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(new AdapterError('internal', 'Falha ao enviar o comando ao PowerShell.'));
        }
      });
    });
  }

  dispose() {
    this.disposed = true;
    const proc = this.proc;
    this.reset();
    try {
      proc?.stdin.end();
    } catch {
      /* ignore */
    }
  }
}

/** Runs the native "Open" dialog in its own STA process (so status polling keeps working while it is open). */
export function runOpenDialog(exe = 'powershell.exe', timeoutMs = 10 * 60_000): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let out = '';
    // windowsHide must stay off here: it would hide the dialog itself (the console is hidden by -WindowStyle Hidden).
    const proc = spawn(exe, ['-NoProfile', '-NonInteractive', '-STA', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', path.join(PS_DIR, 'dialog.ps1')], {
      windowsHide: false,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const timer = setTimeout(() => {
      proc.kill();
      reject(new AdapterError('timeout', 'A janela de escolha de arquivo ficou aberta por muito tempo.'));
    }, timeoutMs);
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (c: string) => (out += c));
    proc.on('error', () => {
      clearTimeout(timer);
      reject(new AdapterError('unsupported', 'Este conector só funciona no Windows.'));
    });
    proc.on('exit', () => {
      clearTimeout(timer);
      const m = /PATH:([A-Za-z0-9+/=]+)/.exec(out);
      resolve(m ? Buffer.from(m[1], 'base64').toString('utf8') : null);
    });
  });
}

export class PowerPointAdapter implements PresentationAdapter {
  readonly capabilities: ConnectorCapabilities = {
    adapter: 'powerpoint-com',
    openDialog: true,
    notes: true,
    goto: true,
    export: true,
    pointer: true,
    blank: true,
    windowMode: true,
  };
  private readonly worker: PowerShellWorker;

  constructor(
    exportRoot: string,
    private readonly dialog: () => Promise<string | null> = () => runOpenDialog(),
  ) {
    this.worker = new PowerShellWorker({ exportRoot });
  }

  /** Starts the worker right away so the first click is already fast. */
  warmUp() {
    void this.worker.call('ping').catch(() => undefined);
  }

  status() {
    return this.worker.call<AdapterStatus>('status');
  }
  async openWithDialog() {
    const file = await this.dialog();
    if (!file) return false;
    await this.worker.call('open', { path: file }, 90_000);
    return true;
  }
  async start(mode: ShowMode, from?: number) {
    await this.worker.call('start', { mode, from }, 60_000);
  }
  async next() {
    await this.worker.call('next');
  }
  async previous() {
    await this.worker.call('previous');
  }
  async goto(index: number) {
    await this.worker.call('goto', { index });
  }
  async first() {
    await this.worker.call('first');
  }
  async last() {
    await this.worker.call('last');
  }
  async blank(kind: BlankKind) {
    await this.worker.call('blank', { kind });
  }
  async pointer(mode: PointerMode) {
    await this.worker.call('pointer', { mode });
  }
  async end() {
    await this.worker.call('end');
  }
  async exportSlide(index: number, width: number, format: ExportFormat, outPath: string) {
    await this.worker.call('export', { index, width, format, out: outPath }, 60_000);
  }
  async dispose() {
    this.worker.dispose();
  }
}
