import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { staffCan, type ClientMessage, type StaffAction, type StaffLevel } from '@workverse/shared';
import { net } from '../../net';
import { describeError } from '../../api';

/**
 * Infraestrutura do painel de staff: contexto (nivel, servico, permissoes), avisos de sucesso/erro, confirmacao
 * de acoes destrutivas e envio de comandos WebSocket com retorno. Esconder um botao nao e seguranca: o servidor
 * confere nivel, servico, alvo e taxa de cada acao.
 */

/** O servidor responde aos comandos com uma linha de sistema; estas listas separam recusa de sucesso. */
const NEGATIVE = /não|nao|inválid|encontrad|permite|lotada|sem acesso|outra organização|nada mudou|fora de/i;
const POSITIVE = /enviad|silenciad|expuls|mandad|concedid|revogad|trancad|fechad|reaberta|esvaziad|liberado|destrancad/i;

export type ToastKind = 'ok' | 'err';

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
}

export interface PanelCtx {
  level: StaffLevel;
  duty: boolean;
  online: boolean;
  selfId: string | null;
  /** Em servico + conectado + nivel suficiente. */
  can(action: StaffAction): boolean;
  notify(kind: ToastKind, text: string): void;
  confirm(opts: ConfirmOptions): Promise<boolean>;
  /** Envia um comando pelo WebSocket e mostra o retorno do servidor (mensagem de sistema ou erro) como aviso. */
  cmd(msg: ClientMessage, okText?: string): void;
  /** Roda uma chamada HTTP; erro vira aviso vermelho e devolve undefined. */
  run<T>(fn: () => Promise<T>, okText?: string): Promise<T | undefined>;
}

const Ctx = createContext<PanelCtx | null>(null);

export function usePanel(): PanelCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('usePanel fora do StaffPanelProvider');
  return c;
}

interface ProviderProps {
  level: StaffLevel;
  duty: boolean;
  online: boolean;
  selfId: string | null;
  children: ReactNode;
}

export function StaffPanelProvider({ level, duty, online, selfId, children }: ProviderProps) {
  const [toast, setToast] = useState<{ kind: ToastKind; text: string; key: number } | null>(null);
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve(v: boolean): void }) | null>(null);
  const awaiting = useRef<{ at: number; okText?: string } | null>(null);
  const keyRef = useRef(0);

  const notify = useCallback((kind: ToastKind, text: string) => setToast({ kind, text, key: ++keyRef.current }), []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast((t) => (t?.key === toast.key ? null : t)), toast.kind === 'err' ? 9000 : 5000);
    return () => clearTimeout(id);
  }, [toast]);

  // Retorno dos comandos WebSocket: o servidor responde com uma linha de sistema no chat ou com um erro.
  useEffect(
    () =>
      net.on((msg) => {
        const w = awaiting.current;
        if (!w || Date.now() - w.at > 3000) return;
        if (msg.t === 'chat' && msg.kind === 'system') {
          awaiting.current = null;
          // "Você entrou em: ..." etc. nao sao retorno de comando; so interessam as respostas rapidas.
          setToast({ kind: NEGATIVE.test(msg.text) && !POSITIVE.test(msg.text) ? 'err' : 'ok', text: msg.text, key: ++keyRef.current });
        } else if (msg.t === 'error') {
          awaiting.current = null;
          setToast({ kind: 'err', text: msg.message, key: ++keyRef.current });
        }
      }),
    [],
  );

  const cmd = useCallback(
    (msg: ClientMessage, okText?: string) => {
      awaiting.current = { at: Date.now(), okText };
      net.send(msg);
      setTimeout(() => {
        const w = awaiting.current;
        if (w && Date.now() - w.at >= 650) {
          awaiting.current = null;
          if (w.okText) setToast({ kind: 'ok', text: w.okText, key: ++keyRef.current });
        }
      }, 700);
    },
    [],
  );

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, okText?: string): Promise<T | undefined> => {
      try {
        const r = await fn();
        if (okText) notify('ok', okText);
        return r;
      } catch (err) {
        notify('err', describeError(err));
        return undefined;
      }
    },
    [notify],
  );

  const confirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => setDialog({ ...opts, resolve })), []);

  const value = useMemo<PanelCtx>(
    () => ({
      level,
      duty,
      online,
      selfId,
      can: (a) => duty && online && staffCan(level, a),
      notify,
      confirm,
      cmd,
      run,
    }),
    [level, duty, online, selfId, notify, confirm, cmd, run],
  );

  const answer = (v: boolean) => {
    dialog?.resolve(v);
    setDialog(null);
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="staff-toast-zone" aria-live="polite" aria-atomic="true">
        {toast && (
          <div key={toast.key} className={`staff-toast staff-toast-${toast.kind}`} role={toast.kind === 'err' ? 'alert' : 'status'} data-testid="staff-toast">
            <span className="staff-toast-ico" aria-hidden>
              {toast.kind === 'ok' ? '✓' : '!'}
            </span>
            <span>{toast.text}</span>
            <button type="button" className="staff-toast-x" onClick={() => setToast(null)} aria-label="Dispensar aviso">
              ×
            </button>
          </div>
        )}
      </div>
      {dialog && <ConfirmDialog opts={dialog} onAnswer={answer} />}
    </Ctx.Provider>
  );
}

function ConfirmDialog({ opts, onAnswer }: { opts: ConfirmOptions; onAnswer(v: boolean): void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  return (
    <div
      className="staff-confirm-back"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onAnswer(false);
        }
        if (e.key === 'Tab') {
          // Mantem o foco dentro do dialogo.
          const f = [...e.currentTarget.querySelectorAll<HTMLElement>('button')];
          const first = f[0];
          const last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <div className="staff-confirm" role="alertdialog" aria-modal="true" aria-labelledby="staff-confirm-title" aria-describedby="staff-confirm-msg" data-testid="staff-confirm">
        <h3 id="staff-confirm-title">{opts.title}</h3>
        <div id="staff-confirm-msg" className="staff-confirm-msg">
          {opts.message}
        </div>
        <div className="staff-confirm-actions">
          <button type="button" ref={cancel} className="mini" onClick={() => onAnswer(false)}>
            Cancelar
          </button>
          <button type="button" className={`mini ${opts.danger ? 'danger' : 'gold'}`} onClick={() => onAnswer(true)} data-testid="staff-confirm-ok">
            {opts.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- pequenos componentes ------------------------------------------------------------------------------------

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="sf-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Chip({ tone = 'neutral', children, title }: { tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'gold'; children: ReactNode; title?: string }) {
  return (
    <span className={`sf-chip sf-chip-${tone}`} title={title}>
      {children}
    </span>
  );
}

export const fmtDateTime = (ms: number | null | undefined) =>
  ms ? new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

export const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Copia para a area de transferencia (com plano B para paginas sem permissao da API). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Caixa que mostra a senha provisoria UMA vez, com botao de copiar. */
export function SecretBox({ title, password, onClose, note }: { title: string; password: string; onClose(): void; note?: string }) {
  const { notify } = usePanel();
  const [copied, setCopied] = useState(false);
  return (
    <div className="sf-secret" role="alertdialog" aria-labelledby="sf-secret-title" data-testid="staff-secret">
      <h4 id="sf-secret-title">{title}</h4>
      <p className="sf-secret-warn">Esta senha aparece só agora. Copie e envie à pessoa por um canal seguro; ela terá de trocá-la no primeiro acesso.</p>
      <div className="sf-secret-row">
        <code className="sf-secret-pw" data-testid="staff-secret-password" aria-label="Senha provisória">
          {password}
        </code>
        <button
          type="button"
          className={`mini ${copied ? 'gold' : ''}`}
          onClick={async () => {
            const ok = await copyText(password);
            setCopied(ok);
            notify(ok ? 'ok' : 'err', ok ? 'Senha copiada.' : 'Não foi possível copiar: selecione e copie manualmente.');
          }}
          data-testid="staff-secret-copy"
        >
          {copied ? 'Copiada' : 'Copiar'}
        </button>
      </div>
      {note && <p className="sf-secret-note">{note}</p>}
      <button type="button" className="mini" onClick={onClose} data-testid="staff-secret-close">
        Já copiei, fechar
      </button>
    </div>
  );
}
