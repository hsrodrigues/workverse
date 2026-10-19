import { net } from '../../net';
import { furnishStore, useFurnish } from './furnishStore';
import './furnish.css';

/** "Fulano convidou você para a sala X" with an "Entrar" button. The server decides again when you try to enter. */
export function InviteBanner() {
  const { invites } = useFurnish();
  if (invites.length === 0) return null;
  return (
    <div className="fz-invites" role="region" aria-label="Convites para reunião">
      {invites.map((i) => (
        <div key={i.key} className="fz-invite-card" data-testid="meeting-invite">
          <span>
            <b>{i.from}</b> convidou você para <b>{i.roomName}</b>
          </span>
          <button
            type="button"
            className="mini gold"
            onClick={() => {
              net.send({ t: 'join', roomId: i.roomId });
              furnishStore.dismissInvite(i.key);
            }}
            data-testid="meeting-invite-join"
          >
            Entrar
          </button>
          <button type="button" className="mini" onClick={() => furnishStore.dismissInvite(i.key)} aria-label="Dispensar">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
