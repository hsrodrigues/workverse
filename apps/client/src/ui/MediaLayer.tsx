import { useEffect, useMemo, useRef, type MutableRefObject, type ReactNode } from 'react';
import { MediaProvider, useMedia } from '../media';
import { mediaIndicators, screenFeed, type MediaIndicator } from '../media/indicators';
import { isStageRoomDef, useWorld } from '../worldStore';
import { setStageDevName } from '../stage/stageApi';
import type { WorldScene } from '../game/WorldScene';

/** Mounts the call (LiveKit) for the room the player is in, and mirrors its state for the game and the HUD. */
export function MediaLayer({ sceneRef, devName, children }: { sceneRef: MutableRefObject<WorldScene | null>; devName?: string; children: ReactNode }) {
  const world = useWorld();
  const roomId = world.room?.id ?? null;
  const kind = isStageRoomDef(world.room) ? 'stage' : 'room';
  useEffect(() => {
    setStageDevName(devName);
  }, [devName]);
  return (
    <MediaProvider roomId={roomId} kind={kind} devName={devName} getTilePosition={(id) => sceneRef.current?.getTilePosition(id)}>
      <Bridge />
      {children}
    </MediaProvider>
  );
}

/** Publishes indicators for the Phaser layer, tells the media client who has the floor, and feeds the in-game screen. */
function Bridge() {
  const { client, state } = useMedia();
  const world = useWorld();

  useEffect(() => {
    const next = new Map<string, MediaIndicator>();
    for (const p of state.participants) {
      next.set(p.identity, {
        micPublished: p.micPublished,
        micOn: p.micOn,
        camPublished: p.camPublished,
        camOn: p.camOn,
        screenOn: p.screenOn,
        speaking: p.speaking,
      });
    }
    mediaIndicators.set(next);
  }, [state.participants]);
  useEffect(() => () => mediaIndicators.clear(), []);

  // Speaker, people with the floor and (open stage) everybody: audible in the whole room whatever the proximity mode.
  const voices = useMemo(() => {
    if (!world.stage) return [];
    if (world.stage.open) return world.roster.map((p) => p.id);
    return [...(world.stage.speakerId ? [world.stage.speakerId] : []), ...world.stage.voices];
  }, [world.stage, world.roster]);
  useEffect(() => {
    client.setStageVoices(voices);
  }, [client, voices]);

  // A hidden <video> with the speaker's screen share: the in-game screen samples it for a live thumbnail.
  const speaker = world.stage?.speakerId ? state.participants.find((p) => p.identity === world.stage!.speakerId) : undefined;
  const sharing = !!speaker?.screenOn;
  const video = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (!sharing || !speaker) {
      screenFeed.video = null;
      return;
    }
    const el = document.createElement('video');
    el.muted = true;
    el.playsInline = true;
    el.autoplay = true;
    video.current = el;
    const detach = client.attachVideo(speaker.identity, 'screen', el);
    void el.play().catch(() => undefined);
    screenFeed.video = el;
    screenFeed.label = `${speaker.name} compartilha a tela`;
    return () => {
      detach();
      el.srcObject = null;
      if (screenFeed.video === el) screenFeed.video = null;
    };
  }, [client, sharing, speaker?.identity, speaker?.screenTrackSid]);
  return null;
}
