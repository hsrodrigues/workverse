import { useEffect, useState } from 'react';
import { MAX_PET_NAME, type PetAdminEntry } from '@workverse/shared';
import { net } from '../../net';
import { Chip, Field, usePanel } from './staffUi';

/**
 * Byte, o pet do escritorio: por organizacao, liga/desliga, renomeia e "leva ate mim" (staff_pet). Moderador ou mais; o servidor
 * valida nivel, servico e taxa e registra cada mudanca no log de auditoria. PET=off no ambiente desliga em todo o servidor.
 */
export function PetTab() {
  const p = usePanel();
  const [pets, setPets] = useState<PetAdminEntry[]>([]);

  useEffect(
    () =>
      net.on((m) => {
        if (m.t === 'staff_pet') setPets(m.pets);
      }),
    [],
  );
  useEffect(() => {
    if (!p.online) return;
    net.send({ t: 'staff_pet', op: 'list' });
    const id = setInterval(() => net.send({ t: 'staff_pet', op: 'list' }), 5000);
    return () => clearInterval(id);
  }, [p.online]);

  return (
    <div data-testid="staff-tab-pet-body">
      <div className="sf-card">
        <h3 className="sf-card-title">Byte, o pet do escritório</h3>
        <p className="sf-hint">
          Um gatinho-robô que passeia pelas salas abertas à organização. Não é jogador: não conta em população nem em listas. O estado fica só em memória (volta ao padrão se o servidor reiniciar). Ele
          não impede o plano gratuito de dormir; quem faz isso é o autoping do servidor (docs/deploy.md).
        </p>
      </div>
      {pets.map((e) => (
        <PetRow key={e.orgId} e={e} />
      ))}
      {pets.length === 0 && <p className="sf-empty">Carregando…</p>}
    </div>
  );
}

function PetRow({ e }: { e: PetAdminEntry }) {
  const p = usePanel();
  const [name, setName] = useState(e.name);
  useEffect(() => setName(e.name), [e.name]);
  const can = p.can('pet.control');
  const send = (op: 'on' | 'off' | 'bring') => p.cmd({ t: 'staff_pet', op, orgId: e.orgId });
  return (
    <div className="sf-card" data-testid={`staff-pet-${e.orgId}`}>
      <h4 className="sf-card-title">
        {e.orgName} {e.enabled ? <Chip tone="ok">Ligado</Chip> : <Chip>Desligado</Chip>} {e.roomName && e.enabled && <Chip>{e.roomName}</Chip>}
      </h4>
      <div className="sf-group">
        <button type="button" className="mini gold" disabled={!can || e.enabled} onClick={() => send('on')} data-testid={`staff-pet-on-${e.orgId}`}>
          Ligar
        </button>
        <button type="button" className="mini" disabled={!can || !e.enabled} onClick={() => send('off')} data-testid={`staff-pet-off-${e.orgId}`}>
          Desligar
        </button>
        <button type="button" className="mini" disabled={!can || !e.enabled} onClick={() => send('bring')} data-testid={`staff-pet-bring-${e.orgId}`}>
          Levar até mim
        </button>
      </div>
      <form
        className="sf-sub sf-inline"
        onSubmit={(ev) => {
          ev.preventDefault();
          p.cmd({ t: 'staff_pet', op: 'rename', orgId: e.orgId, name: name.trim() });
        }}
      >
        <Field label="Nome do pet">
          <input className="sf-input" value={name} maxLength={MAX_PET_NAME} onChange={(ev) => setName(ev.target.value)} data-testid={`staff-pet-name-${e.orgId}`} />
        </Field>
        <button className="mini gold" disabled={!can || !name.trim() || name.trim() === e.name} data-testid={`staff-pet-rename-${e.orgId}`}>
          Renomear
        </button>
      </form>
    </div>
  );
}
