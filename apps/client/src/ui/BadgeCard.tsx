import { useEffect, useRef } from 'react';
import { STAFF_LABELS, badgeTextColor, safeDeptColor, type AvatarConfig, type StaffLevel } from '@workverse/shared';
import { FH, FRAMES_IDLE, FW, drawAvatarFrame } from '../game/avatarRenderer';
import { createCanvas } from '../game/pixel';
import './badge.css';

/** Recorte da cabeça no quadro frontal (64x128, cabeça entre y 13 e 49): 40x40, ampliado por número inteiro (pixels nítidos). */
export const PHOTO = { x: 12, y: 10, w: 40, h: 40 } as const;
const NEUTRAL_BG = '#4a4566';

/** Desenha a foto do crachá: a cabeça do avatar (vista frontal) sobre a cor do setor. Pura em relação ao DOM, para os testes. */
export function paintBadgePhoto(canvas: HTMLCanvasElement, avatar: AvatarConfig, bg: string | undefined) {
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const scratch = createCanvas(FW, FH);
  drawAvatarFrame(scratch.ctx, 0, 0, avatar, 'front', FRAMES_IDLE.start);
  ctx.fillStyle = bg ? safeDeptColor(bg) : NEUTRAL_BG;
  ctx.fillRect(0, 0, PHOTO.w, PHOTO.h);
  // luz suave no canto, como foto de estúdio (1 pixel de borda mais clara no topo)
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fillRect(0, 0, PHOTO.w, 1);
  ctx.drawImage(scratch.canvas, PHOTO.x, PHOTO.y, PHOTO.w, PHOTO.h, 0, 0, PHOTO.w, PHOTO.h);
}

interface Props {
  name: string;
  avatar: AvatarConfig;
  title?: string;
  dept?: string;
  deptColor?: string;
  staff?: StaffLevel;
  /** Versão horizontal e menor (resultados da busca da recepção). */
  compact?: boolean;
  onClose?(): void;
}

/** Cartão de crachá em pixel art: cordão, faixa na cor do setor, foto (cabeça do avatar), nome, cargo e setor; selo STAFF quando for staff. */
export function BadgeCard({ name, avatar, title, dept, deptColor, staff, compact, onClose }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const color = dept ? safeDeptColor(deptColor) : undefined;
  const avatarKey = JSON.stringify(avatar);
  useEffect(() => {
    if (ref.current) paintBadgePhoto(ref.current, avatar, color);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarKey, color]);
  const stripe = color ?? '#8a8fa6';
  return (
    <div className={`bcard ${compact ? 'bcard-compact' : ''}`} style={{ ['--stripe' as string]: stripe, ['--stripe-ink' as string]: badgeTextColor(stripe) }} data-testid="badge-card" aria-label={`Crachá de ${name}`}>
      {!compact && (
        <div className="bcard-lanyard" aria-hidden="true">
          <i />
          <i />
          <b />
        </div>
      )}
      <div className="bcard-body">
        <div className="bcard-head">
          <span>WORKVERSE</span>
          <em aria-hidden="true" />
          {onClose && (
            <button type="button" className="bcard-x" onClick={onClose} aria-label="Fechar crachá">
              ×
            </button>
          )}
        </div>
        <div className="bcard-main">
          <canvas ref={ref} width={PHOTO.w} height={PHOTO.h} className="bcard-photo" role="img" aria-label={`Foto de ${name}`} data-testid="badge-photo" />
          <div className="bcard-info">
            <strong className="bcard-name" data-testid="badge-name">
              {name}
            </strong>
            {title && (
              <span className="bcard-title" data-testid="badge-title">
                {title}
              </span>
            )}
            {dept && (
              <span className="bcard-dept" data-testid="badge-dept">
                {dept}
              </span>
            )}
            {!title && !dept && <span className="bcard-none">Sem cargo definido</span>}
            {staff && (
              <span className="bcard-staff" title={STAFF_LABELS[staff]} data-testid="badge-staff">
                STAFF
              </span>
            )}
          </div>
        </div>
        <div className="bcard-foot" aria-hidden="true" />
      </div>
    </div>
  );
}
