import { useEffect, useRef, useState } from 'react';
import type { AvatarV2 } from '@workverse/shared';
import { FH, FRAMES_IDLE, FRAMES_SIT, FRAMES_WALK, FRAMES_WAVE, FW, VIEWS, drawAvatarFrame, type View } from '../../game/avatarRenderer';
import { createCanvas } from '../../game/pixel';

type Anim = 'idle' | 'walk' | 'sit' | 'wave';
const ANIMS: { id: Anim; label: string }[] = [
  { id: 'idle', label: 'Parado' },
  { id: 'walk', label: 'Andar' },
  { id: 'sit', label: 'Sentar' },
  { id: 'wave', label: 'Acenar' },
];
const VIEW_LABEL: Record<View, string> = { front: 'frente', front34: 'frente de lado', back: 'costas', back34: 'costas de lado' };

function frameFor(anim: Anim, n: number): number {
  if (anim === 'idle') return FRAMES_IDLE.start;
  if (anim === 'sit') return FRAMES_SIT.start;
  if (anim === 'walk') return FRAMES_WALK.start + (n % FRAMES_WALK.count);
  return FRAMES_WAVE.start + [0, 1, 2, 1][n % 4];
}

/** Draws the avatar (animated when walking/waving) into a canvas; redraws whenever the look changes. */
function useAvatarCanvas(look: AvatarV2, anim: Anim, view: View) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const scratch = createCanvas(FW, FH);
    let n = 0;
    const draw = () => {
      scratch.ctx.clearRect(0, 0, FW, FH);
      drawAvatarFrame(scratch.ctx, 0, 0, look, view, frameFor(anim, n));
      ctx.clearRect(0, 0, FW, FH);
      ctx.drawImage(scratch.canvas, 0, 0);
      n++;
    };
    draw();
    if (anim === 'idle' || anim === 'sit') return;
    const id = setInterval(draw, anim === 'walk' ? 90 : 200);
    return () => clearInterval(id);
  }, [look, anim, view]);
  return ref;
}

interface Props {
  look: AvatarV2;
  /** The saved look, shown small next to the new one so the change is clear before confirming. */
  saved: AvatarV2;
  changed: boolean;
  onRandom(): void;
}

export function Preview({ look, saved, changed, onRandom }: Props) {
  const [anim, setAnim] = useState<Anim>('idle');
  const [view, setView] = useState<View>('front');
  const main = useAvatarCanvas(look, anim, view);
  const before = useAvatarCanvas(saved, 'idle', 'front');
  return (
    <div className="ae-preview">
      <div className="ae-stage">
        <canvas ref={main} width={FW} height={FH} className="ae-canvas" role="img" aria-label={`Pré-visualização do avatar, vista de ${VIEW_LABEL[view]}`} />
        <div className={`ae-before ${changed ? 'show' : ''}`} aria-hidden={!changed}>
          <canvas ref={before} width={FW} height={FH} className="ae-canvas-small" />
          <span>Salvo</span>
        </div>
      </div>
      <div className="ae-preview-controls">
        <div className="ae-filters" role="group" aria-label="Pose da pré-visualização">
          {ANIMS.map((a) => (
            <button key={a.id} type="button" className={`chip ${anim === a.id ? 'on' : ''}`} aria-pressed={anim === a.id} onClick={() => setAnim(a.id)}>
              {a.label}
            </button>
          ))}
        </div>
        <div className="ae-filters">
          <button type="button" className="chip" onClick={() => setView(VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length])}>
            Girar
          </button>
          <button type="button" className="chip" onClick={onRandom}>
            Aleatório
          </button>
        </div>
      </div>
    </div>
  );
}
