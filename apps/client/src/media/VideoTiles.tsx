import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { useMedia } from './MediaContext';
import type { MediaParticipant, VideoSource } from './MediaClient';

export function Video({ p, source, className }: { p: MediaParticipant; source: VideoSource; className?: string }) {
  const { client } = useMedia();
  const ref = useRef<HTMLVideoElement>(null);
  const sid = source === 'camera' ? p.camTrackSid : p.screenTrackSid;
  const on = source === 'camera' ? p.camOn : p.screenOn;
  useEffect(() => {
    const el = ref.current;
    if (!el || !on || !sid) return;
    return client.attachVideo(p.identity, source, el);
  }, [client, p.identity, source, sid, on]);
  // Remote videos are muted on purpose: audio plays through the managed <audio> elements.
  return (
    <video
      ref={ref}
      className={`${className ?? ''} ${p.isLocal && source === 'camera' ? 'mirror' : ''}`}
      autoPlay
      playsInline
      muted
      data-testid={`video-${source}-${p.identity}`}
    />
  );
}

function Tile({ p }: { p: MediaParticipant }) {
  return (
    <figure className={`wvm-tile ${p.speaking ? 'speaking' : ''}`} data-testid={`tile-${p.identity}`} data-speaking={p.speaking}>
      {p.camOn ? <Video p={p} source="camera" className="wvm-video" /> : <div className="wvm-avatar" aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</div>}
      <figcaption className="wvm-name">
        <span className="wvm-label">{p.isLocal ? `${p.name} (você)` : p.name}</span>
        <span className={`wvm-flag ${p.micOn ? '' : 'off'}`} title={p.micOn ? 'Microfone ligado' : 'Microfone desligado'} data-testid={`mic-${p.identity}`} data-on={p.micOn}>
          <Icon name="mic" off={!p.micOn} size={14} />
        </span>
        <span className={`wvm-flag ${p.camOn ? '' : 'off'}`} title={p.camOn ? 'Câmera ligada' : 'Câmera desligada'} data-testid={`cam-${p.identity}`} data-on={p.camOn}>
          <Icon name="cam" off={!p.camOn} size={14} />
        </span>
      </figcaption>
    </figure>
  );
}

export interface VideoTilesProps {
  /** Only people who are transmitting something (plus you): for crowded rooms such as the auditorium. */
  onlyActive?: boolean;
  /** Show the big view of a screen share. Turn off when another panel already shows it. */
  showScreen?: boolean;
  /** Identity whose screen share is already shown elsewhere (the speaker in the presentation panel). */
  skipScreenOf?: string | null;
}

/** Grid of participants (own tile included) plus a large view of the active screen share. */
export function VideoTiles({ onlyActive = false, showScreen = true, skipScreenOf = null }: VideoTilesProps = {}) {
  const { state } = useMedia();
  const [picked, setPicked] = useState<string | null>(null);
  if (state.status === 'idle' || state.status === 'unavailable') return null;

  const sharers = showScreen ? state.participants.filter((p) => p.screenOn && p.identity !== skipScreenOf) : [];
  const tiles = onlyActive ? state.participants.filter((p) => p.isLocal || p.camOn || p.micOn || p.screenOn) : state.participants;
  const big = sharers.find((p) => p.identity === picked) ?? sharers[0];
  return (
    <div className="wvm-tiles" data-testid="video-tiles">
      {big && (
        <div className="wvm-stage" data-testid="screen-stage">
          <Video p={big} source="screen" className="wvm-screen" />
          <div className="wvm-stage-name">
            <Icon name="screen" size={14} /> {big.isLocal ? 'Você está compartilhando a tela' : `${big.name} está compartilhando a tela`}
          </div>
          {sharers.length > 1 && (
            <div className="wvm-stage-pick">
              {sharers.map((s) => (
                <button key={s.identity} type="button" className={s.identity === big.identity ? 'on' : ''} onClick={() => setPicked(s.identity)}>
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="wvm-grid">
        {tiles.map((p) => (
          <Tile key={p.identity} p={p} />
        ))}
      </div>
    </div>
  );
}
