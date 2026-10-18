import { useState } from 'react';
import { Icon } from './icons';
import { useMedia } from './MediaContext';
import { PROXIMITY_MODES, type ProximityMode } from './proximity';
import type { PermissionState } from './MediaClient';
import { Window } from '../ui/Window';

const MODE_LABEL: Record<ProximityMode, string> = {
  room: 'Sala inteira',
  proximity: 'Por proximidade',
  off: 'Desligado',
};

const permText = (p: PermissionState) =>
  p === 'denied' ? 'bloqueado' : p === 'unavailable' ? 'indisponível' : p === 'granted' ? 'liberado' : 'pergunta ao ativar';

/** Mic / camera / screen buttons, speaking indicator, device and proximity settings, and permission warnings. */
export function MediaBar({ panelPlacement = 'above' }: { /** Where the settings panel opens relative to the buttons. */ panelPlacement?: 'above' | 'below' }) {
  const { client, state } = useMedia();
  const [open, setOpen] = useState(false);
  const me = state.participants.find((p) => p.isLocal);
  const off = state.status === 'idle' || state.status === 'unavailable';
  const connected = state.status === 'connected';
  const micBlocked = state.micPermission === 'denied' || state.micPermission === 'unavailable';
  const camBlocked = state.camPermission === 'denied' || state.camPermission === 'unavailable';
  // Auditorium: the server only lets the speaker publish; an audience member given the floor gets the microphone.
  const noMic = connected && state.rights === 'none';
  const noVideo = connected && state.rights !== 'all';
  const restricted = 'Só quem está no palco transmite aqui. Levante a mão para pedir a palavra.';
  const label = (on: boolean, what: string, blocked: boolean) =>
    blocked ? `${what}: indisponível (veja o aviso)` : on ? `Desligar ${what.toLowerCase()}` : `Ligar ${what.toLowerCase()}`;

  return (
    <div className="wvm-bar" role="region" aria-label="Áudio e vídeo" data-testid="media-bar" data-status={state.status}>
      {state.status === 'unavailable' && (
        <div className="wvm-banner wvm-warn" role="status" data-testid="media-unavailable">
          {state.statusMessage ?? 'Mídia indisponível.'}
        </div>
      )}
      {(state.status === 'connecting' || state.status === 'reconnecting') && (
        <div className="wvm-banner" role="status">{state.status === 'connecting' ? 'Conectando à chamada...' : 'Reconectando à chamada...'}</div>
      )}
      {state.status === 'error' && <div className="wvm-banner wvm-warn" role="status">{state.statusMessage}</div>}
      {state.audioBlocked && connected && (
        <button type="button" className="wvm-banner wvm-action" data-testid="enable-audio" onClick={() => void client.enableAudio()}>
          <Icon name="speaker" /> Ativar áudio
        </button>
      )}
      {state.notice && (
        <div className="wvm-banner wvm-warn" role="alert" data-testid="media-notice">
          <span>{state.notice}</span>
          <button type="button" className="wvm-x" aria-label="Fechar aviso" onClick={() => client.dismissNotice()}>×</button>
        </div>
      )}

      <div className="wvm-buttons">
        <button
          type="button"
          className={`wvm-btn ${state.micOn ? 'on' : ''} ${micBlocked ? 'blocked' : ''} ${me?.speaking ? 'speaking' : ''}`}
          data-testid="toggle-mic"
          aria-pressed={state.micOn}
          title={noMic ? restricted : label(state.micOn, 'Microfone', micBlocked)}
          disabled={off || noMic}
          onClick={() => void client.toggleMic()}
        >
          <Icon name="mic" off={!state.micOn} />
        </button>
        <button
          type="button"
          className={`wvm-btn ${state.camOn ? 'on' : ''} ${camBlocked ? 'blocked' : ''}`}
          data-testid="toggle-cam"
          aria-pressed={state.camOn}
          title={noVideo ? restricted : label(state.camOn, 'Câmera', camBlocked)}
          disabled={off || noVideo}
          onClick={() => void client.toggleCam()}
        >
          <Icon name="cam" off={!state.camOn} />
        </button>
        <button
          type="button"
          className={`wvm-btn ${state.screenOn ? 'on' : ''}`}
          data-testid="toggle-screen"
          aria-pressed={state.screenOn}
          title={noVideo ? restricted : state.screenOn ? 'Parar compartilhamento de tela' : 'Compartilhar tela'}
          disabled={off || noVideo || state.screenPermission === 'unavailable'}
          onClick={() => void client.toggleScreenShare()}
        >
          <Icon name="screen" />
        </button>
        <button
          type="button"
          className={`wvm-btn ${open ? 'on' : ''}`}
          data-testid="media-settings"
          aria-expanded={open}
          title="Configurações de áudio e vídeo"
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name="gear" />
        </button>
      </div>

      {open && (
        <Window id="media-settings" className={`win wvm-panel ${panelPlacement}`} bodyClassName="wvm-panel-body" title="Áudio e vídeo" onClose={() => setOpen(false)} role="dialog" aria-label="Configurações de áudio e vídeo">
          <label className="wvm-field">
            Áudio das outras pessoas
            <select data-testid="proximity-mode" value={state.mode} onChange={(e) => client.setMode(e.target.value as ProximityMode)}>
              {PROXIMITY_MODES.map((m) => (
                <option key={m} value={m}>{MODE_LABEL[m]}</option>
              ))}
            </select>
          </label>
          {state.mode === 'proximity' && (
            <label className="wvm-field">
              Alcance: {state.proximity.zeroTiles} tiles (volume cheio até {state.proximity.fullTiles})
              <input
                type="range"
                min={4}
                max={20}
                step={1}
                value={state.proximity.zeroTiles}
                onChange={(e) => client.setProximityParams({ zeroTiles: Number(e.target.value) })}
              />
            </label>
          )}
          <label className="wvm-field">
            Microfone ({permText(state.micPermission)})
            <select
              value={state.selected.audioInput ?? ''}
              disabled={state.devices.audioInputs.length === 0}
              onChange={(e) => void client.setInputDevices({ audioInput: e.target.value })}
            >
              {state.devices.audioInputs.length === 0 && <option value="">Ative o microfone para listar</option>}
              {state.devices.audioInputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
              ))}
            </select>
          </label>
          <label className="wvm-field">
            Câmera ({permText(state.camPermission)})
            <select
              value={state.selected.videoInput ?? ''}
              disabled={state.devices.videoInputs.length === 0}
              onChange={(e) => void client.setInputDevices({ videoInput: e.target.value })}
            >
              {state.devices.videoInputs.length === 0 && <option value="">Ative a câmera para listar</option>}
              {state.devices.videoInputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
              ))}
            </select>
          </label>
          {state.devices.audioOutputs.length > 0 && (
            <label className="wvm-field">
              Saída de áudio
              <select value={state.selected.audioOutput ?? ''} onChange={(e) => void client.setInputDevices({ audioOutput: e.target.value })}>
                {state.devices.audioOutputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                ))}
              </select>
            </label>
          )}
          {(state.micPermission === 'denied' || state.camPermission === 'denied') && (
            <p className="wvm-hint">
              O acesso foi bloqueado no navegador. Clique no cadeado ao lado do endereço, libere microfone/câmera e tente de novo. Você continua ouvindo,
              vendo os outros e usando o chat.
            </p>
          )}
        </Window>
      )}
    </div>
  );
}
