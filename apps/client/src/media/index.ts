export { MediaClient } from './MediaClient';
export type {
  DeviceInfo,
  DeviceLists,
  InputDevices,
  MediaClientOptions,
  MediaKind,
  PublishRights,
  MediaParticipant,
  MediaSnapshot,
  MediaStatus,
  PermissionState,
  VideoSource,
} from './MediaClient';
export { MediaProvider, useMedia, type MediaProviderProps } from './MediaContext';
export { MediaBar } from './MediaBar';
export { Video, VideoTiles, type VideoTilesProps } from './VideoTiles';
export {
  DEFAULT_PROXIMITY,
  PROXIMITY_MODES,
  distanceTiles,
  volumeFor,
  volumeForDistance,
  type ProximityMode,
  type ProximityParams,
  type TilePosition,
  type TilePositionProvider,
} from './proximity';
import './media.css';
