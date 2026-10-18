import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { MediaClient, type MediaClientOptions, type MediaKind, type MediaSnapshot } from './MediaClient';
import type { TilePositionProvider } from './proximity';

interface MediaContextValue {
  client: MediaClient;
  state: MediaSnapshot;
}

const Ctx = createContext<MediaContextValue | null>(null);

export interface MediaProviderProps {
  /** Current world room. `null`/`undefined` disconnects. Changing it moves the call to the new room. */
  roomId: string | null | undefined;
  /** Logical tile of a participant by identity (player id); used by the proximity audio mode. */
  getTilePosition?: TilePositionProvider;
  /** `stage` in an auditorium (token request label; the server decides the rights). */
  kind?: MediaKind;
  /** Dev only: name-only identification (server with ALLOW_DEV_LOGIN=1). */
  devName?: string;
  children: ReactNode;
}

export function MediaProvider({ roomId, kind = 'room', getTilePosition, devName, children }: MediaProviderProps) {
  const opts = useRef<MediaClientOptions>({ devName });
  const client = useMemo(() => new MediaClient(opts.current), []);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);

  // The latest provider is always read, without reconnecting when its identity changes.
  const latest = useRef(getTilePosition);
  latest.current = getTilePosition;
  useEffect(() => {
    client.setTilePositionProvider((id) => latest.current?.(id));
  }, [client]);

  useEffect(() => {
    if (!roomId) {
      void client.disconnect();
      return;
    }
    void client.connect(roomId, kind);
  }, [client, roomId, kind]);

  useEffect(() => () => void client.disconnect(), [client]);

  const value = useMemo(() => ({ client, state }), [client, state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** `{ client, state }`: `state` re-renders on changes; call actions on `client` (toggleMic, setMode...). */
export function useMedia(): MediaContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useMedia precisa estar dentro de <MediaProvider>.');
  return v;
}
