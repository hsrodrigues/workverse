import { useState } from 'react';
import { VideoTiles, useMedia } from '../media';
import { isStageRoomDef, useWorld } from '../worldStore';
import { useStageMode } from '../stage/stageUi';
import { Window } from './Window';

/** Collapsible column of video tiles on the left of the HUD; never takes the whole screen. */
export function VideoDock() {
  const { state } = useMedia();
  const world = useWorld();
  const stageMode = useStageMode();
  const [open, setOpen] = useState(true);
  if (state.status === 'idle' || state.status === 'unavailable') return null;

  const inStage = isStageRoomDef(world.room);
  // In the auditorium the presentation panel already shows the screen share and the speaker, so list only who transmits.
  const active = state.participants.filter((p) => p.camOn || p.micOn || p.screenOn).length;
  const total = state.participants.length;
  if (inStage && active === 0 && stageMode !== 'closed') return null;
  return (
    <Window id="video-dock" className={`video-dock ${open ? 'open' : ''}`} handle=".video-dock-head" data-testid="video-dock">
      <button type="button" className="video-dock-head" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="video-dock-toggle">
        <span>Vídeo</span>
        <span className="video-dock-count">
          {active > 0 ? `${active} transmitindo · ` : ''}
          {total} na chamada
        </span>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="video-dock-body">
          <VideoTiles onlyActive={inStage} showScreen skipScreenOf={inStage && stageMode !== 'closed' ? world.stage?.speakerId : null} />
        </div>
      )}
    </Window>
  );
}
