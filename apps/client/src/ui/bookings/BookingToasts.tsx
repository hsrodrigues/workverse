import { Icon } from '../../media/icons';
import { bookingStore, useBookings } from './bookingStore';

/** Avisos de reserva (confirmada, fila, promovida, comeca/termina em 5 min, liberada, recusada): balao no topo, sem tirar o foco. */
export function BookingToasts() {
  const s = useBookings();
  if (s.toasts.length === 0) return null;
  return (
    <div className="bk-toasts" role="region" aria-label="Avisos de reservas" aria-live="polite" data-testid="bk-toasts">
      {s.toasts.map((t) => (
        <div key={t.key} className={`bk-toast k-${t.kind}`} role="status" data-testid={`bk-toast-${t.kind}`}>
          <span className="bk-toast-ico" aria-hidden="true">
            <Icon name="calendar" size={16} />
          </span>
          <span className="bk-toast-text">{t.text}</span>
          <button type="button" className="mini" onClick={() => { bookingStore.dismissToast(t.key); bookingStore.open({ roomId: t.roomId, tab: 'mine' }); }}>
            Ver
          </button>
          <button type="button" className="mini x" onClick={() => bookingStore.dismissToast(t.key)} aria-label="Fechar aviso">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
