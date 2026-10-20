import { emit } from '../bus';
import { Icon } from '../media/icons';

/** Zoom da camera: + / - e "ver tudo" (reenquadra a sala). Fica acima da barra inferior, no canto direito, e funciona no toque. */
export function ZoomControls() {
  return (
    <div className="zoom-controls" role="group" aria-label="Zoom do mapa" data-testid="zoom-controls">
      <button type="button" className="tool" onClick={() => emit('cameraZoom', 'in')} title="Aproximar" aria-label="Aproximar" data-testid="zoom-in">
        <Icon name="plus" />
      </button>
      <button type="button" className="tool" onClick={() => emit('cameraZoom', 'out')} title="Afastar" aria-label="Afastar" data-testid="zoom-out">
        <Icon name="minus" />
      </button>
      <button type="button" className="tool" onClick={() => emit('cameraZoom', 'fit')} title="Ver a sala toda" aria-label="Ver a sala toda" data-testid="zoom-fit">
        <Icon name="fit" />
      </button>
    </div>
  );
}
