import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ChangeEvent } from 'react';
import { STAGE_LIMITS, type Deck } from '@workverse/shared';
import { net } from '../net';
import { useWorld } from '../worldStore';
import { Video, useMedia } from '../media';
import { Icon } from '../media/icons';
import { imagesVersion, primeSlideImage, slideImage, subscribeImages } from '../stage/images';
import { SLIDE_H, SLIDE_W, drawNotice, drawSlide, paintScaled, type SlideImageResolver } from '../stage/slideRender';
import { prepareImage, uploadSlideImage } from '../stage/stageApi';
import { stageUi, useStageMode } from '../stage/stageUi';
import { usePowerPointKeysActive } from '../stage/powerpoint/keysStore';
import { Window } from './Window';
import { PowerPointControl } from './stage/PowerPointControl';
import '../stage/stage.css';

const resolveServer: SlideImageResolver = (s) => (s.kind === 'image' ? slideImage(s) : null);

// ---------------------------------------------------------------------------
// Canvas that renders a slide at the size of its container

function SlideCanvas({
  deck,
  index,
  resolve,
  className,
  progress,
  notice,
}: {
  deck: Deck | null;
  index: number;
  resolve: SlideImageResolver;
  className?: string;
  progress?: boolean;
  notice?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const version = useSyncExternalStore(subscribeImages, imagesVersion);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(1, Math.round(el.clientWidth * Math.min(2, window.devicePixelRatio || 1))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || width <= 1) return;
    el.width = width;
    el.height = Math.round((width * SLIDE_H) / SLIDE_W);
    paintScaled(el, (ctx) => {
      if (deck && deck.slides.length > 0) drawSlide(ctx, deck, index, resolve, { progress });
      else drawNotice(ctx, notice ?? 'Sem slides');
    });
  }, [deck, index, resolve, width, progress, notice, version]);

  return <canvas ref={ref} className={className ?? 'stage-canvas'} role="img" aria-label={deck ? `Slide ${index + 1} de ${deck.slides.length}` : 'Sem apresentação'} />;
}

// ---------------------------------------------------------------------------
// Keyboard and keep-alive

function useSpeakerKeys(active: boolean, go: (delta: number) => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') go(1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, go]);
}

/** While on stage, tells the server the speaker is still around (only if the person touched mouse or keyboard recently). */
function useKeepAlive(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let last = Date.now();
    const touch = () => {
      last = Date.now();
    };
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const id = setInterval(() => {
      if (Date.now() - last < 150_000) net.send({ t: 'stage_alive' });
    }, 60_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      clearInterval(id);
    };
  }, [active]);
}

// ---------------------------------------------------------------------------
// Audience viewer (also used by the speaker's own view of the live slide)

function LiveViewer({ deck, index, speakerId, tv }: { deck: Deck | null; index: number; speakerId: string | null; tv: boolean }) {
  const { state } = useMedia();
  const speaker = state.participants.find((p) => p.identity === speakerId);
  const [view, setView] = useState<'slides' | 'screen'>('screen');
  const sharing = !!speaker?.screenOn;
  // Cameras in a small strip (speaker first), like a meeting: the shared screen keeps the big area.
  // The speaker always has a tile (initial when the camera is off), as in a meeting; others only while their camera is on.
  const cams = [...state.participants.filter((p) => p.camOn || p.identity === speakerId)].sort((a, b) => Number(b.identity === speakerId) - Number(a.identity === speakerId));
  const showScreen = sharing && view === 'screen';
  return (
    <div className="stage-viewer" data-testid="stage-viewer">
      <div className="stage-frame">
        {showScreen && speaker ? (
          <Video p={speaker} source="screen" className="stage-screen" />
        ) : (
          <SlideCanvas deck={deck} index={index} resolve={resolveServer} progress notice={speakerId ? 'Aguardando…' : tv ? 'TV livre' : 'Palco livre'} />
        )}
        {sharing && (
          <div className="stage-switch" role="group" aria-label="O que mostrar">
            <button type="button" className={showScreen ? '' : 'on'} data-testid="view-slides" onClick={() => setView('slides')}>
              Slides
            </button>
            <button type="button" className={showScreen ? 'on' : ''} data-testid="view-screen" onClick={() => setView('screen')}>
              Tela
            </button>
          </div>
        )}
        <button type="button" className="stage-full" aria-label="Tela cheia" title="Tela cheia" data-testid="stage-fullscreen" onClick={(e) => void (e.currentTarget.parentElement as HTMLElement).requestFullscreen?.().catch(() => undefined)}>
          ⛶
        </button>
      </div>
      {cams.length > 0 && (
        <div className="stage-cams" data-testid="stage-cams">
          {cams.map((p) => (
            <figure key={p.identity} className={`stage-cam ${p.speaking ? 'speaking' : ''}`} data-testid={p.identity === speakerId ? 'speaker-cam' : `cam-tile-${p.identity}`}>
              {p.camOn ? <Video p={p} source="camera" className="stage-cam-video" /> : <span className="stage-cam-initial" aria-hidden="true">{(p.name || '?').slice(0, 1).toUpperCase()}</span>}
              <figcaption>
                <span className={`stage-cam-mic ${p.micOn ? '' : 'off'}`} aria-label={p.micOn ? 'Microfone ligado' : 'Microfone desligado'}>
                  <Icon name="mic" off={!p.micOn} size={11} />
                </span>
                <span className="stage-cam-name">{p.isLocal ? 'Você' : p.name}</span>
                {p.identity === speakerId && <span className="stage-cam-role">{tv ? 'Apresentando' : 'Palestrante'}</span>}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      <div className="stage-viewer-foot">
        <span data-testid="slide-counter">{deck ? `Slide ${index + 1} / ${deck.slides.length}` : 'Sem slides'}</span>
        {speaker && (
          <span className="stage-speaking">
            {speaker.speaking ? '🔊' : speaker.micOn ? '🎙' : '🔇'} {speaker.name}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Speaker panel. The deck lives on the server (deck + current slide + live): this panel only shows it and sends
// changes, so closing and reopening it, F5 or coming back to the room never loses the slides.

function SpeakerPanel() {
  const world = useWorld();
  const { state: media } = useMedia();
  const stage = world.stage!;
  const tv = stage.mode === 'tv';
  const [selected, setSelected] = useState(world.slide.index);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const imageInput = useRef<HTMLInputElement>(null);

  const live = world.slide.live;
  const slides = world.deck?.slides ?? [];
  const n = slides.length;
  const deck = world.deck;
  const sel = Math.min(selected, Math.max(0, n - 1));
  const shown = live ? Math.min(world.slide.index, Math.max(0, n - 1)) : sel;
  const room = STAGE_LIMITS.maxSlides - n;
  const hasVideo = media.camOn || media.micOn || media.screenOn;

  // The server decides which slide is current (live, or the one left when the stage was released).
  useEffect(() => {
    setSelected(world.slide.index);
  }, [world.slide.index, live]);

  const step = useCallback(
    (delta: number) => {
      const target = shown + delta;
      if (target < 0 || target >= n) return;
      setSelected(target);
      if (live) net.send({ t: 'slide_goto', index: target });
    },
    [live, shown, n],
  );
  // While the PowerPoint panel drives the keyboard (clickers, arrows) the plain image-deck keys stay quiet.
  const pptKeys = usePowerPointKeysActive();
  useSpeakerKeys(!pptKeys, step);
  const goTo = useCallback(
    (target: number) => {
      if (target < 0 || target >= n) return;
      setSelected(target);
      if (live) net.send({ t: 'slide_goto', index: target });
    },
    [live, n],
  );
  useKeepAlive(true);

  const send = (list: typeof slides) => {
    if (list.length === 0) net.send({ t: 'deck_clear' });
    else net.send({ t: 'deck_set', deck: { title: world.deck?.title ?? '', slides: list } });
  };

  const addImages = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError('');
    const added: typeof slides = [];
    const list = Array.from(files).slice(0, Math.max(0, room));
    if (files.length > list.length) setError(`Limite de ${STAGE_LIMITS.maxSlides} slides.`);
    for (let i = 0; i < list.length; i++) {
      setBusy(`Enviando imagem ${i + 1} de ${list.length}…`);
      try {
        const blob = await prepareImage(list[i]);
        const up = await uploadSlideImage(blob);
        primeSlideImage(up.id, blob);
        added.push({ kind: 'image', imageId: up.id });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Não foi possível enviar a imagem.');
      }
    }
    setBusy('');
    if (added.length) {
      setSelected(n);
      send([...slides, ...added]);
    }
  };

  const move = (i: number, delta: -1 | 1) => {
    const j = i + delta;
    if (j < 0 || j >= n) return;
    const next = [...slides];
    [next[i], next[j]] = [next[j], next[i]];
    setSelected(j);
    send(next);
  };
  const remove = (i: number) => {
    setSelected(Math.max(0, Math.min(sel, n - 2)));
    send(slides.filter((_, k) => k !== i));
  };

  const voiceName = (id: string) => world.roster.find((p) => p.id === id)?.name ?? 'Participante';

  return (
    <div className="stage-editor" data-testid="speaker-panel">
      <aside className="stage-side">
        <button type="button" className="stage-btn" data-testid="add-image" disabled={room <= 0 || !!busy} onClick={() => imageInput.current?.click()}>
          + Imagens
        </button>
        <input
          ref={imageInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          data-testid="image-input"
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            void addImages(e.target.files);
            e.target.value = '';
          }}
        />
        <ol className="stage-thumbs">
          {slides.map((s, i) => (
            <li key={`${s.imageId}-${i}`} className={`stage-thumb ${i === shown ? 'sel' : ''} ${live && i === world.slide.index ? 'live' : ''}`} data-testid={`thumb-${i}`}>
              <button
                type="button"
                className="stage-thumb-main"
                title={`Slide ${i + 1}`}
                onClick={() => {
                  setSelected(i);
                  if (live) net.send({ t: 'slide_goto', index: i });
                }}
              >
                <span className="stage-thumb-n">{i + 1}</span>
                <SlideCanvas deck={deck} index={i} resolve={resolveServer} className="stage-thumb-canvas" />
              </button>
              <span className="stage-thumb-tools">
                <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Mover para cima" title="Mover para cima">
                  ↑
                </button>
                <button type="button" disabled={i === n - 1} onClick={() => move(i, 1)} aria-label="Mover para baixo" title="Mover para baixo">
                  ↓
                </button>
                <button type="button" onClick={() => remove(i)} aria-label="Remover slide" title="Remover slide">
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ol>
        <p className="stage-count">
          {n} / {STAGE_LIMITS.maxSlides} slides
        </p>
      </aside>

      <section className="stage-main">
        <div className="stage-frame">
          <SlideCanvas deck={deck} index={shown} resolve={resolveServer} progress notice="Adicione imagens (PNG, JPEG ou WebP)" />
        </div>
        <div className="stage-nav">
          <button type="button" className="stage-btn" data-testid="prev" disabled={shown <= 0} onClick={() => step(-1)} title="Slide anterior (←)">
            ◀ Anterior
          </button>
          <span className="stage-counter" data-testid="slide-counter">
            {n === 0 ? 'Sem slides' : live ? `Ao vivo: ${shown + 1} / ${n}` : `Slide ${shown + 1} / ${n}`}
          </span>
          <button type="button" className="stage-btn" data-testid="next" disabled={shown >= n - 1} onClick={() => step(1)} title="Próximo slide (→)">
            Próximo ▶
          </button>
          <span className="stage-spacer" />
          {!live ? (
            <button type="button" className="stage-btn primary" data-testid="start" disabled={!!busy || n === 0} onClick={() => net.send({ t: 'present_start', index: shown })}>
              ▶ Iniciar slides
            </button>
          ) : (
            <button type="button" className="stage-btn danger" data-testid="end" onClick={() => net.send({ t: 'present_end' })}>
              ■ Encerrar slides
            </button>
          )}
        </div>
        {(busy || error || world.stageNotice) && (
          <p className={`stage-msg ${error || world.stageNotice ? 'bad' : ''}`} role="status" data-testid="stage-msg">
            {busy || error || world.stageNotice}
          </p>
        )}
        <PowerPointControl deckSlides={n} shown={shown} live={live} goTo={goTo} />
        <p className="stage-tip">
          Para mostrar PowerPoint, Google Slides ou uma janela, use o botão de compartilhar tela na barra de baixo: {tv ? 'a sala vê sua tela no painel e na TV.' : 'a plateia vê sua tela no painel e no telão.'}
        </p>
      </section>

      <aside className="stage-people">
        {!tv && (
        <button
          type="button"
          className={`stage-btn ${stage.open ? 'on' : 'primary'}`}
          data-testid="toggle-open-stage"
          aria-pressed={stage.open}
          title={stage.open ? 'Volta a só você (e quem recebeu a palavra) transmitir' : 'Qualquer pessoa da sala poderá ligar microfone, câmera e tela'}
          onClick={() => net.send({ t: stage.open ? 'stage_close' : 'stage_open' })}
        >
          {stage.open ? '✖ Fechar palco' : '🔓 Liberar palco para todos'}
        </button>
        )}
        {!tv && stage.open && <p className="stage-tip">Palco aberto: todos podem ligar microfone, câmera e tela.</p>}
        {!tv && <h4>Pedidos de palavra ({stage.hands.length})</h4>}
        {!tv && stage.hands.length === 0 && <p className="stage-empty">Ninguém pediu a palavra.</p>}
        <ul className="stage-list" data-testid="hand-queue">
          {stage.hands.map((h) => (
            <li key={h.id}>
              <span>✋ {h.name}</span>
              <button type="button" className="stage-btn primary small" data-testid={`grant-${h.id}`} onClick={() => net.send({ t: 'voice_grant', id: h.id })}>
                Dar a palavra
              </button>
              <button type="button" className="stage-btn small" aria-label={`Dispensar ${h.name}`} title="Dispensar" onClick={() => net.send({ t: 'voice_revoke', id: h.id })}>
                ✕
              </button>
            </li>
          ))}
        </ul>
        {!tv && stage.voices.length > 0 && <h4>Com a palavra</h4>}
        <ul className="stage-list" data-testid="voice-list">
          {stage.voices.map((id) => (
            <li key={id}>
              <span>🎙 {voiceName(id)}</span>
              <button type="button" className="stage-btn danger small" data-testid={`revoke-${id}`} onClick={() => net.send({ t: 'voice_revoke', id })}>
                Retirar
              </button>
            </li>
          ))}
        </ul>
        <p className="stage-tip">{hasVideo ? 'Você está transmitindo.' : 'Use microfone, câmera e tela na barra de baixo para transmitir.'}</p>
        <button type="button" className="stage-btn danger" data-testid="release" onClick={() => net.send({ t: 'stage_release' })} title={tv ? 'Seus slides ficam guardados para quando você apresentar de novo' : 'Seus slides ficam guardados para quando você voltar ao palco'}>
          {tv ? 'Parar de apresentar' : 'Sair do palco'}
        </button>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The window

export function StagePanel() {
  const world = useWorld();
  const { state: media } = useMedia();
  const mode = useStageMode();
  const stage = world.stage;
  const tv = stage?.mode === 'tv';
  const youId = world.youId;
  const wasLive = useRef(false);
  const wasSpeaker = useRef(false);

  const isSpeaker = !!stage && stage.speakerId === youId;
  const hasVoice = !!stage && !!youId && stage.voices.includes(youId);
  const raised = !!stage && !!youId && stage.hands.some((h) => h.id === youId);
  const queuePos = stage && youId ? stage.hands.findIndex((h) => h.id === youId) + 1 : 0;

  // Opens by itself when a presentation starts or when you take the stage.
  useEffect(() => {
    if (world.slide.live && !wasLive.current && !isSpeaker) stageUi.set('open');
    wasLive.current = world.slide.live;
  }, [world.slide.live, isSpeaker]);
  useEffect(() => {
    if (isSpeaker && !wasSpeaker.current) stageUi.set('open');
    wasSpeaker.current = isSpeaker;
  }, [isSpeaker]);
  useEffect(() => {
    if (!stage) stageUi.set('closed');
  }, [stage]);

  // The speaker's panel stays mounted (hidden) when closed so the working copy of the slides is not lost.
  if (!stage || (mode === 'closed' && !isSpeaker)) return null;
  const wide = mode === 'wide';
  const sharingScreen = !!media.participants.find((p) => p.identity === stage.speakerId)?.screenOn;

  return (
    <Window id="stage" className={`stage-win ${isSpeaker ? 'speaker' : 'audience'} ${wide || sharingScreen ? 'wide' : ''} ${sharingScreen && !isSpeaker ? 'sharing' : ''}`} handle=".stage-head" role="dialog" aria-label={tv ? 'Apresentação da sala' : 'Apresentação'} data-testid="stage-panel" data-mode={tv ? 'tv' : 'stage'} hidden={mode === 'closed'}>
      <header className="stage-head">
        <strong>{tv ? 'Apresentação da sala' : 'Auditório'}</strong>
        <span className="stage-who" data-testid="stage-who">
          {stage.speakerName ? (isSpeaker ? (tv ? 'Você está apresentando' : 'Você está no palco') : tv ? `Apresentando: ${stage.speakerName}` : `No palco: ${stage.speakerName}`) : tv ? 'TV livre' : 'Palco livre'}
        </span>
        {world.slide.live && <span className="stage-live-dot">ao vivo</span>}
        <span className="stage-spacer" />
        {!isSpeaker && (
          <button type="button" className="stage-icon" aria-label={wide ? 'Reduzir' : 'Ampliar'} title={wide ? 'Reduzir' : 'Ampliar'} onClick={() => stageUi.set(wide ? 'open' : 'wide')}>
            {wide ? '⤡' : '⤢'}
          </button>
        )}
        <button type="button" className="stage-icon" aria-label="Fechar painel" title="Fechar (a apresentação continua)" onClick={() => stageUi.set('closed')}>
          ✕
        </button>
      </header>

      {isSpeaker ? (
        <SpeakerPanel />
      ) : (
        <div className="stage-audience">
          <LiveViewer deck={world.slide.live ? world.deck : null} index={world.slide.index} speakerId={stage.speakerId} tv={!!tv} />
          <div className="stage-actions">
            {!stage.speakerId && (
              <button type="button" className="stage-btn primary" data-testid="take-stage" onClick={() => net.send({ t: 'stage_take' })}>
                {tv ? '📺 Apresentar na TV' : '🎤 Assumir palco'}
              </button>
            )}
            {tv && stage.speakerId && (
              <button type="button" className="stage-btn small" data-testid="force-take" title="Só donos e administradores da organização conseguem" onClick={() => net.send({ t: 'stage_take', force: true })}>
                Assumir a TV (admin)
              </button>
            )}
            {!tv && stage.speakerId && !hasVoice && !stage.open && (
              <button type="button" className={`stage-btn ${raised ? 'on' : ''}`} data-testid="hand" aria-pressed={raised} onClick={() => net.send({ t: raised ? 'hand_lower' : 'hand_raise' })}>
                {raised ? `✋ Baixar a mão (${queuePos}º na fila)` : '✋ Levantar a mão'}
              </button>
            )}
            {!tv && stage.open && (
              <span className="stage-voice" data-testid="stage-open-banner">
                🔓 Palco aberto: use microfone, câmera ou tela na barra de baixo.
              </span>
            )}
            {!tv && hasVoice && !stage.open && (
              <span className="stage-voice" data-testid="has-voice">
                🎙 Você está com a palavra: ligue o microfone na barra.
              </span>
            )}
            {world.stageNotice && <span className="stage-msg bad">{world.stageNotice}</span>}
          </div>
        </div>
      )}
    </Window>
  );
}

/** Button for the bottom bar of the HUD (only rendered in an auditorium). */
export function StageBarButton() {
  const world = useWorld();
  const mode = useStageMode();
  const stage = world.stage;
  if (!stage) return null;
  const free = !stage.speakerId;
  const mine = stage.speakerId === world.youId;
  const tv = stage.mode === 'tv';
  return (
    <>
      {free && (
        <button type="button" className="tool tool-send" data-testid="bar-take-stage" onClick={() => net.send({ t: 'stage_take' })} title={tv ? 'Apresentar na TV da sala' : 'Assumir o palco do auditório'}>
          <span className="ico"><Icon name={tv ? 'tv' : 'mic'} /></span> {tv ? 'Apresentar na TV' : 'Assumir palco'}
        </button>
      )}
      <button
        type="button"
        className={`tool ${mode !== 'closed' ? 'tool-on' : ''}`}
        data-testid="bar-stage"
        onClick={() => stageUi.set(mode === 'closed' ? 'open' : 'closed')}
        title="Painel da apresentação"
      >
        <span className="ico"><Icon name="list" /></span> {mine ? (tv ? 'Minha TV' : 'Palco') : 'Apresentação'}
        {world.slide.live && <span className="badge live">●</span>}
      </button>
    </>
  );
}
