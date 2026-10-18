import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { net } from '../net';
import { WorldScene } from '../game/WorldScene';

/** Mounts the Phaser game once and asks the server to put us in a room when the scene is ready. */
export function GameView({ onScene }: { onScene(scene: WorldScene): void }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host.current,
      backgroundColor: '#1b1830',
      scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
      pixelArt: true,
      render: { antialias: false, roundPixels: true },
      disableContextMenu: true,
      scene: [WorldScene],
    });
    game.events.once('scene-ready', () => {
      onScene(game.scene.getScene('world') as WorldScene);
      net.send({ t: 'join', roomId: net.roomId });
    });
    return () => game.destroy(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="game-host" />;
}
