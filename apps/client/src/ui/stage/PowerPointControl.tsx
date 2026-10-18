import { useCallback, useEffect, useRef, useState } from 'react';
import { STAGE_LIMITS, type PointerMode } from '@workverse/shared';
import { net } from '../../net';
import { useStageMode } from '../../stage/stageUi';
import { QUALITY_PRESETS, sendSlidesToStage, type QualityKey, type SendProgress } from '../../stage/powerpoint/sendSlides';
import { pptKeys } from '../../stage/powerpoint/keysStore';
import { usePowerPoint } from '../../stage/powerpoint/usePowerPoint';
import './powerpoint.css';

type Way = 'screen' | 'slides';
const WAY_KEY = 'wv.ppt.way';
const QUALITY_KEY = 'wv.ppt.quality';

const readStore = (k: string) => {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeStore = (k: string, v: string) => {
  try {
    sessionStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

const POINTERS: Array<{ id: PointerMode; label: string }> = [
  { id: 'arrow', label: 'Normal' },
  { id: 'laser', label: 'Laser' },
  { id: 'pen', label: 'Caneta' },
  { id: 'hidden', label: 'Ocultar' },
  { id: 'erase', label: 'Apagar traços' },
];

export interface PowerPointControlProps {
  /** Slides of the deck on the WorkVerse stage. */
  deckSlides: number;
  /** Slide shown in the speaker panel (0-based). */
  shown: number;
  live: boolean;
  /** Moves the WorkVerse deck to a slide (0-based): selects it and, when live, tells the audience. */
  goTo: (index: number) => void;
}

/**
 * Controls Microsoft PowerPoint from inside WorkVerse through the local connector (see docs/powerpoint.md).
 * Way "screen": the speaker shares the presentation window and drives it from here.
 * Way "slides": the slides are exported as images and navigation is synchronised through the WorkVerse stage.
 */
export function PowerPointControl({ deckSlides, shown, live, goTo }: PowerPointControlProps) {
  const pp = usePowerPoint();
  const stageMode = useStageMode();
  const { status, phase } = pp;
  const [open, setOpen] = useState(() => phase !== 'off');
  const [way, setWay] = useState<Way>(() => (readStore(WAY_KEY) === 'slides' ? 'slides' : 'screen'));
  const [quality, setQuality] = useState<QualityKey>(() => {
    const q = readStore(QUALITY_KEY);
    return q === 'high' || q === 'light' ? q : 'balanced';
  });
  const [code, setCode] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [urlInput, setUrlInput] = useState(pp.url);
  const [gotoText, setGotoText] = useState('');
  const [startMode, setStartMode] = useState<'window' | 'fullscreen'>('window');
  const [sending, setSending] = useState<SendProgress | null>(null);
  const [sendMsg, setSendMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const thumbVersion = useRef(-1);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const pres = status?.presentation ?? null;
  const show = status?.show ?? null;
  const total = pres?.slides ?? 0;
  const pptIndex = status?.index ?? 0;
  const connected = phase === 'on';
  const panelOpen = stageMode !== 'closed';

  useEffect(() => {
    if (phase !== 'off') setOpen(true);
  }, [phase]);

  // ---- timer: runs while a show is in progress ---------------------------------------------------------------
  const showing = !!show;
  useEffect(() => {
    if (showing) setStartedAt((t) => t ?? Date.now());
    else setStartedAt(null);
  }, [showing]);
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  // ---- thumbnails (served by the connector, fetched with the token) -------------------------------------------
  const thumbsReady = status?.thumbs.ready ?? 0;
  const thumbsJob = status?.thumbs.version ?? 0;
  useEffect(() => {
    const client = pp.client;
    if (!connected || !client || thumbsReady < 1) return;
    let cancelled = false;
    const fresh = thumbVersion.current !== thumbsJob;
    thumbVersion.current = thumbsJob;
    setThumbs((prev) => {
      if (fresh) prev.forEach((u) => URL.revokeObjectURL(u));
      return fresh ? [] : prev;
    });
    void (async () => {
      const have = fresh ? 0 : thumbs.length;
      for (let i = have + 1; i <= thumbsReady; i++) {
        try {
          const url = URL.createObjectURL(await client.image(i, 'thumb'));
          if (cancelled) return URL.revokeObjectURL(url);
          setThumbs((prev) => (prev.length === i - 1 ? [...prev, url] : prev));
        } catch {
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, thumbsReady, thumbsJob, pp.client]);
  useEffect(
    () => () => {
      setThumbs((prev) => {
        prev.forEach((u) => URL.revokeObjectURL(u));
        return [];
      });
    },
    [],
  );

  // ---- navigation ----------------------------------------------------------------------------------------------
  const note = (text: string) => setSendMsg({ text, bad: true });

  const step = useCallback(
    (delta: 1 | -1) => {
      if (way === 'slides') {
        const target = shown + delta;
        if (target < 0 || target >= deckSlides) return;
        goTo(target);
        if (show) void pp.run((c) => c.goto(target + 1));
        return;
      }
      if (!show) return note('Inicie a apresentação para navegar.');
      void pp.run((c) => (delta === 1 ? c.next() : c.prev()));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [way, shown, deckSlides, goTo, show, pp.run],
  );

  const jump = useCallback(
    (index1: number) => {
      if (index1 < 1 || (total && index1 > total)) return;
      if (way === 'slides' && index1 <= deckSlides) {
        goTo(index1 - 1);
        if (show) void pp.run((c) => c.goto(index1));
        return;
      }
      if (show) void pp.run((c) => c.goto(index1));
      else void pp.run((c) => c.start(startMode, index1));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [way, deckSlides, goTo, show, total, startMode, pp.run],
  );

  // Way "slides": a slide changed by hand inside PowerPoint (or by a clicker) follows into the WorkVerse deck.
  useEffect(() => {
    if (way !== 'slides' || !show || !deckSlides || pptIndex < 1 || pptIndex > deckSlides) return;
    if (pptIndex - 1 === shown || pp.sinceLastCommand() < 1500) return;
    goTo(pptIndex - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pptIndex]);

  // ---- keyboard: arrows, PageUp/PageDown (USB clickers), space, Home/End, B, Esc ------------------------------
  const controlling = connected && !!pres && panelOpen;
  useEffect(() => {
    pptKeys.set(controlling);
    return () => pptKeys.set(false);
  }, [controlling]);
  useEffect(() => {
    if (!controlling) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      const onButton = tag === 'BUTTON';
      let handled = true;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case 'n':
        case 'N':
          step(1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
        case 'p':
        case 'P':
          step(-1);
          break;
        case ' ':
        case 'Enter':
          if (onButton) handled = false;
          else step(1);
          break;
        case 'Home':
          jump(1);
          break;
        case 'End':
          if (total) jump(total);
          break;
        case 'b':
        case 'B':
        case '.':
          if (show) void pp.run((c) => c.blank('black'));
          break;
        case 'w':
        case 'W':
        case ',':
          if (show) void pp.run((c) => c.blank('white'));
          break;
        case 'Escape':
          if (show) void pp.run((c) => c.end());
          else handled = false;
          break;
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [controlling, step, jump, show, total, pp.run]);

  // ---- way "slides": send ---------------------------------------------------------------------------------------
  const send = async () => {
    const client = pp.client;
    if (!client || !pres) return;
    setSendMsg(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setSending({ phase: 'export', done: 0, total: pres.slides, message: 'Preparando…' });
    try {
      // Replacing the deck first frees the room's image budget; a live presentation is resumed afterwards.
      if (deckSlides > 0) net.send({ t: 'deck_clear' });
      const deck = await sendSlidesToStage({
        client,
        slideCount: pres.slides,
        title: pres.name.replace(/\.[^.]+$/, ''),
        quality,
        signal: ctrl.signal,
        onProgress: setSending,
      });
      net.send({ t: 'deck_set', deck });
      const from = Math.max(0, Math.min(deck.slides.length - 1, (pptIndex || 1) - 1));
      if (live || show) net.send({ t: 'present_start', index: from });
      setSendMsg({ text: `${deck.slides.length} slides enviados. A plateia já os vê${live || show ? ' ao vivo' : ': clique em "Iniciar slides" para transmitir'}.`, bad: false });
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError';
      setSendMsg({ text: aborted ? 'Envio cancelado.' : e instanceof Error ? e.message : 'Não foi possível enviar os slides.', bad: !aborted });
    } finally {
      abortRef.current = null;
      setSending(null);
    }
  };
  useEffect(() => () => abortRef.current?.abort(), []);

  // ---- render ----------------------------------------------------------------------------------------------------
  const stateText = !connected
    ? phase === 'connecting'
      ? 'conectando…'
      : 'desconectado'
    : pp.offline
      ? 'conector não responde'
      : !status?.app
        ? 'PowerPoint fechado'
        : !pres
          ? 'sem apresentação aberta'
          : show
            ? show.state === 'black'
              ? 'tela preta'
              : show.state === 'white'
                ? 'tela branca'
                : 'apresentando'
            : 'pronta para iniciar';

  const onConnect = async () => {
    const base = urlInput.trim();
    if (await pp.connect(code, base || undefined)) setCode('');
  };

  return (
    <section className="ppt" data-testid="ppt-control" aria-label="Controle do PowerPoint">
      <button type="button" className="ppt-head" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="ppt-toggle">
        <span className={`ppt-dot ${connected && !pp.offline ? 'on' : ''}`} aria-hidden />
        <strong>PowerPoint</strong>
        <span className="ppt-state" data-testid="ppt-state">
          {stateText}
        </span>
        <span className="ppt-caret">{open ? '▾' : '▸'}</span>
      </button>

      {open && !connected && (
        <div className="ppt-body" data-testid="ppt-connect-box">
          <p className="ppt-help">
            Controle seu PowerPoint sem sair do WorkVerse. Para isso, inicie o <b>Conector do PowerPoint</b> neste computador: dê dois cliques em <code>Conector-PowerPoint.bat</code> (ou rode <code>npm run powerpoint:connector</code>). Ele mostra um código de 6 dígitos.
          </p>
          <form
            className="ppt-pair"
            onSubmit={(e) => {
              e.preventDefault();
              void onConnect();
            }}
          >
            <input
              className="ppt-code"
              data-testid="ppt-code"
              inputMode="numeric"
              autoComplete="off"
              maxLength={7}
              placeholder="000 000"
              aria-label="Código de pareamento"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
            />
            <button type="submit" className="stage-btn primary" data-testid="ppt-connect" disabled={phase === 'connecting' || code.replace(/\D/g, '').length !== 6}>
              {phase === 'connecting' ? 'Conectando…' : 'Conectar ao PowerPoint'}
            </button>
          </form>
          <button type="button" className="ppt-link" onClick={() => setAdvanced((v) => !v)}>
            {advanced ? 'Ocultar opções' : 'Opções avançadas'}
          </button>
          {advanced && (
            <label className="ppt-adv">
              Endereço do conector
              <input value={urlInput} onChange={(e) => setUrlInput(e.target.value)} data-testid="ppt-url" spellCheck={false} />
            </label>
          )}
          {pp.error && (
            <p className="ppt-msg bad" role="alert" data-testid="ppt-error">
              {pp.error}
            </p>
          )}
          <p className="ppt-help small">Só funciona no Windows com o PowerPoint instalado. O código fica salvo apenas nesta aba.</p>
        </div>
      )}

      {open && connected && (
        <div className="ppt-body" data-testid="ppt-panel">
          <div className="ppt-ways" role="radiogroup" aria-label="Como apresentar">
            <button type="button" role="radio" aria-checked={way === 'screen'} className={`ppt-way ${way === 'screen' ? 'on' : ''}`} data-testid="ppt-way-screen" onClick={() => (setWay('screen'), writeStore(WAY_KEY, 'screen'))}>
              <b>Compartilhar tela</b>
              <small>Mostra a janela do PowerPoint; você controla daqui.</small>
            </button>
            <button type="button" role="radio" aria-checked={way === 'slides'} className={`ppt-way ${way === 'slides' ? 'on' : ''}`} data-testid="ppt-way-slides" onClick={() => (setWay('slides'), writeStore(WAY_KEY, 'slides'))}>
              <b>Enviar slides ao WorkVerse</b>
              <small>A plateia vê os slides, sem compartilhar tela.</small>
            </button>
          </div>

          <div className="ppt-row">
            <button type="button" className="stage-btn" data-testid="ppt-open" onClick={() => void pp.run(async (c) => (await c.open()).status)}>
              Abrir apresentação…
            </button>
            {!show ? (
              <>
                <button type="button" className="stage-btn primary" data-testid="ppt-start" disabled={!pres} onClick={() => void pp.run((c) => c.start(startMode, way === 'slides' && shown > 0 ? shown + 1 : undefined))}>
                  ▶ Iniciar
                </button>
                <select className="ppt-select" aria-label="Modo de exibição" data-testid="ppt-start-mode" value={startMode} onChange={(e) => setStartMode(e.target.value as 'window' | 'fullscreen')}>
                  <option value="window">Em janela (para compartilhar)</option>
                  <option value="fullscreen">Tela cheia</option>
                </select>
              </>
            ) : (
              <button type="button" className="stage-btn danger" data-testid="ppt-end" onClick={() => void pp.run((c) => c.end())}>
                ■ Encerrar
              </button>
            )}
            <span className="stage-spacer" />
            <span className="ppt-timer" data-testid="ppt-timer" title="Tempo de apresentação">
              ⏱ {clock(startedAt ? now - startedAt : 0)}
            </span>
          </div>

          {pres && (
            <p className="ppt-file" data-testid="ppt-file">
              {pres.name} · {pres.slides} {pres.slides === 1 ? 'slide' : 'slides'}
              {show?.mode && ` · ${show.mode === 'window' ? 'em janela' : 'tela cheia'}`}
            </p>
          )}

          <div className="ppt-nav">
            <button type="button" className="ppt-big" data-testid="ppt-prev" disabled={!pres || (way === 'slides' ? shown <= 0 : !show)} onClick={() => step(-1)} title="Anterior (← ou PageUp)">
              ◀ Anterior
            </button>
            <span className="ppt-counter" data-testid="ppt-counter">
              {pres ? `Slide ${pptIndex || '–'} / ${pres.slides}` : 'Sem apresentação'}
            </span>
            <button type="button" className="ppt-big next" data-testid="ppt-next" disabled={!pres || (way === 'slides' ? shown >= deckSlides - 1 : !show)} onClick={() => step(1)} title="Próximo (→, espaço ou PageDown)">
              Próximo ▶
            </button>
          </div>

          <div className="ppt-row">
            <form
              className="ppt-goto"
              onSubmit={(e) => {
                e.preventDefault();
                const n = parseInt(gotoText, 10);
                if (Number.isFinite(n)) jump(n);
                setGotoText('');
                // Give the keyboard back to the shortcuts (arrows, PageUp/PageDown...).
                (document.activeElement as HTMLElement | null)?.blur();
              }}
            >
              <input type="number" min={1} max={total || undefined} placeholder="Ir ao slide" aria-label="Ir ao slide" data-testid="ppt-goto-input" value={gotoText} onChange={(e) => setGotoText(e.target.value)} disabled={!pres} />
              <button type="submit" className="stage-btn small" data-testid="ppt-goto" disabled={!pres || !gotoText}>
                Ir
              </button>
            </form>
            <button type="button" className="stage-btn small" disabled={!pres} onClick={() => jump(1)} title="Primeiro (Home)">
              ⏮
            </button>
            <button type="button" className="stage-btn small" disabled={!pres} onClick={() => jump(total)} title="Último (End)">
              ⏭
            </button>
            <button type="button" className={`stage-btn small ${show?.state === 'black' ? 'on' : ''}`} data-testid="ppt-black" disabled={!show} onClick={() => void pp.run((c) => c.blank('black'))} title="Tela preta (B)">
              ⬛ Preta
            </button>
            <button type="button" className={`stage-btn small ${show?.state === 'white' ? 'on' : ''}`} data-testid="ppt-white" disabled={!show} onClick={() => void pp.run((c) => c.blank('white'))} title="Tela branca (W)">
              ⬜ Branca
            </button>
            <select className="ppt-select" aria-label="Ponteiro" data-testid="ppt-pointer" disabled={!show} value={show?.pointer ?? 'arrow'} onChange={(e) => {
                const mode = e.target.value as PointerMode; // read now: the controlled select is re-rendered before the command runs
                void pp.run((c) => c.pointer(mode));
              }}>
              {POINTERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id === 'erase' ? p.label : `Ponteiro: ${p.label}`}
                </option>
              ))}
            </select>
          </div>

          {(pp.error || sendMsg) && (
            <p className={`ppt-msg ${pp.error || sendMsg?.bad ? 'bad' : ''}`} role="status" data-testid="ppt-msg">
              {pp.error || sendMsg?.text}{' '}
              <button type="button" className="ppt-link" onClick={() => (pp.clearError(), setSendMsg(null))}>
                ok
              </button>
            </p>
          )}

          {pres && (
            <div className="ppt-notes" data-testid="ppt-notes">
              <h4>
                Notas do orador <small>(só você vê)</small>
              </h4>
              {status?.title && <p className="ppt-slide-title">{status.title}</p>}
              <p className="ppt-notes-text">{status?.notes || 'Este slide não tem notas.'}</p>
            </div>
          )}

          {pres && (
            <ol className="ppt-thumbs" data-testid="ppt-thumbs">
              {Array.from({ length: pres.slides }, (_, i) => (
                <li key={i} className={`ppt-thumb ${i + 1 === pptIndex ? 'cur' : ''}`}>
                  <button type="button" data-testid={`ppt-thumb-${i + 1}`} title={`Slide ${i + 1}`} onClick={() => jump(i + 1)}>
                    {thumbs[i] ? <img src={thumbs[i]} alt={`Miniatura do slide ${i + 1}`} draggable={false} /> : <span className="ppt-thumb-empty" />}
                    <em>{i + 1}</em>
                  </button>
                </li>
              ))}
            </ol>
          )}
          {pres && (
            <button type="button" className="ppt-link" onClick={() => void pp.run(async (c) => void (await c.refreshThumbs()))}>
              Atualizar miniaturas
            </button>
          )}

          {way === 'slides' && (
            <div className="ppt-send" data-testid="ppt-send-box">
              <div className="ppt-row">
                <button type="button" className="stage-btn primary" data-testid="ppt-send" disabled={!pres || !!sending} onClick={() => void send()}>
                  {deckSlides > 0 ? 'Reenviar slides ao WorkVerse' : 'Enviar slides ao WorkVerse'}
                </button>
                <select
                  className="ppt-select"
                  aria-label="Qualidade das imagens"
                  data-testid="ppt-quality"
                  value={quality}
                  disabled={!!sending}
                  onChange={(e) => {
                    setQuality(e.target.value as QualityKey);
                    writeStore(QUALITY_KEY, e.target.value);
                  }}
                >
                  {(Object.keys(QUALITY_PRESETS) as QualityKey[]).map((k) => (
                    <option key={k} value={k}>
                      Qualidade {QUALITY_PRESETS[k].label}
                    </option>
                  ))}
                </select>
                {sending && (
                  <button type="button" className="stage-btn small" onClick={() => abortRef.current?.abort()}>
                    Cancelar
                  </button>
                )}
              </div>
              {sending && (
                <div className="ppt-progress" data-testid="ppt-send-progress">
                  <progress max={sending.total} value={sending.done} />
                  <span>{sending.message}</span>
                </div>
              )}
              <p className="ppt-help small">
                Limite do palco: {STAGE_LIMITS.maxSlides} slides. Substitui os slides atuais do palco. Animações do PowerPoint não aparecem para a plateia (cada slide vira uma imagem).
              </p>
            </div>
          )}
          {way === 'screen' && (
            <p className="ppt-help small">
              Compartilhe a janela do PowerPoint pelo botão de tela na barra de baixo (use o início <b>em janela</b>: fica mais fácil escolher a janela certa). Animações funcionam normalmente.
            </p>
          )}

          <div className="ppt-foot">
            <span>Atalhos: ← → PageUp/PageDown espaço Home End · B tela preta · Esc encerra</span>
            <button type="button" className="ppt-link" data-testid="ppt-disconnect" onClick={pp.disconnect}>
              Desconectar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
