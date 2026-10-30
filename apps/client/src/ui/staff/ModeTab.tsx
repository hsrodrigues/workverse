import { STAFF_LABELS, STAFF_MIN_LEVEL, staffCan, type StaffAction } from '@workverse/shared';
import { net } from '../../net';
import { useWorld } from '../../worldStore';
import { MEDIA_TEXT } from '@workverse/shared';
import { useMediaState } from '../../media/mediaState';
import { Chip, usePanel } from './staffUi';

const POWERS: [StaffAction, string][] = [
  ['list', 'Ver quem está online'],
  ['goto', 'Ir até / trazer pessoas (mesma organização)'],
  ['mute', 'Silenciar e liberar'],
  ['kick.room', 'Tirar da sala'],
  ['announce.room', 'Avisar uma sala'],
  ['dm', 'Mensagem privada de staff'],
  ['rooms.control', 'Trancar, fechar e esvaziar salas'],
  ['events.control', 'Ligar e desligar eventos (Halloween, Natal...)'],
  ['pet.control', 'Ligar, renomear e chamar o Byte (pet do escritório)'],
  ['kick.session', 'Expulsar da sessão'],
  ['announce.all', 'Aviso global e por organização'],
  ['accounts.create', 'Criar contas e redefinir senhas'],
  ['accounts.disable', 'Desativar / reativar contas'],
  ['ban', 'Banir contas (até 30 dias)'],
  ['audit.read', 'Ver e exportar o log de auditoria'],
  ['media.view', 'Ver o contador mensal de áudio e vídeo'],
  ['media.control', 'Ligar o modo economia de áudio e vídeo'],
  ['item.grant', 'Conceder / revogar itens'],
  ['staff.manage', 'Gerenciar a equipe de staff e banir permanentemente'],
];

export function ModeTab() {
  const w = useWorld();
  const p = usePanel();
  const s = w.staff;
  if (!s) return null;
  return (
    <div data-testid="staff-tab-mode">
      <div className="sf-card">
        <h3 className="sf-card-title">Seu modo</h3>
        <div className="sf-mode">
          <button
            type="button"
            className={`sf-switch ${s.duty ? 'on' : ''}`}
            role="switch"
            aria-checked={s.duty}
            disabled={!p.online}
            onClick={() => net.send({ t: 'staff_duty', on: !s.duty })}
            data-testid="staff-duty"
          >
            <span className="sf-switch-knob" aria-hidden />
            <span className="sf-switch-label">{s.duty ? 'Em serviço' : 'Fora de serviço'}</span>
          </button>
          <p className="sf-hint">Em serviço você usa os poderes de staff e o crachá dourado aparece sobre o seu avatar. Fora de serviço você é uma pessoa comum.</p>
        </div>
        <div className="sf-mode">
          <button
            type="button"
            className={`sf-switch ${s.invisible ? 'on' : ''}`}
            role="switch"
            aria-checked={s.invisible}
            disabled={!p.can('invis')}
            onClick={() => net.send({ t: 'staff_invis', on: !s.invisible })}
            data-testid="staff-invis"
          >
            <span className="sf-switch-knob" aria-hidden />
            <span className="sf-switch-label">{s.invisible ? 'Invisível' : 'Visível'}</span>
          </button>
          <p className="sf-hint">Invisível: some para os outros da sala e as mensagens públicas ficam desligadas (use aviso). Você continua contando na população.</p>
        </div>
        <div className="sf-mode">
          <span className={`sf-badge-demo ${s.duty ? 'on' : ''}`} aria-hidden>
            STAFF
          </span>
          <p className="sf-hint" data-testid="staff-badge-state">
            Crachá dourado: <b>{s.duty ? 'ativo' : 'desligado'}</b>. É o servidor que o coloca e o tira (liga e desliga junto com o serviço); não dá para forjar nem remover pelo editor de visual.
          </p>
        </div>
      </div>

      <MediaCard />

      <h3 className="sf-h">
        O que o seu nível permite <Chip tone="gold">{STAFF_LABELS[s.level]}</Chip>
      </h3>
      <ul className="sf-powers">
        {POWERS.map(([a, label]) => {
          const ok = staffCan(s.level, a);
          return (
            <li key={a} className={ok ? 'ok' : 'no'}>
              <span aria-hidden>{ok ? '✓' : '—'}</span> {label}
              {!ok && <small> (exige {STAFF_LABELS[STAFF_MIN_LEVEL[a]].toLowerCase()})</small>}
            </li>
          );
        })}
      </ul>
      <p className="sf-hint">
        Comandos de chat continuam valendo: /staff on|off, /invis, /online, /goto, /bring, /mute, /unmute, /kick, /kickroom, /aviso, /avisosala, /dar, /tirar.
      </p>
    </div>
  );
}

/** Contador estimado do mes (minutos de participante do LiveKit) e o interruptor do modo economia. */
function MediaCard() {
  const w = useWorld();
  const p = usePanel();
  const { usage } = useMediaState();
  const level = w.staff?.level;
  if (!usage || !staffCan(level, 'media.view')) return null;
  const tone = usage.level === 'exceeded' ? 'bad' : usage.level === 'ok' ? 'ok' : 'warn';
  return (
    <div className="sf-card" data-testid="staff-media">
      <h3 className="sf-card-title">Áudio e vídeo (LiveKit)</h3>
      <p data-testid="staff-media-counter">
        <b>{usage.usedMinutes.toLocaleString('pt-BR')} de {usage.limitMinutes.toLocaleString('pt-BR')} min ({usage.percent}%)</b> em {usage.month}{' '}
        <Chip tone={tone}>{usage.level === 'exceeded' ? 'cota atingida' : usage.level === 'ok' ? 'normal' : usage.level === 'warn90' ? 'acima de 90%' : 'acima de 70%'}</Chip>
      </p>
      <p className="sf-hint">{usage.activeSessions} pessoa(s) na chamada agora. {usage.webhook ? MEDIA_TEXT.webhookOn : MEDIA_TEXT.webhookOff}</p>
      <div className="sf-mode">
        <button
          type="button"
          className={`sf-switch ${usage.strict ? 'on' : ''}`}
          role="switch"
          aria-checked={usage.strict}
          disabled={!p.online || !staffCan(level, 'media.control')}
          onClick={() => net.send({ t: 'staff_media_economy', on: !usage.strict })}
          data-testid="staff-media-strict"
        >
          <span className="sf-switch-knob" aria-hidden />
          <span className="sf-switch-label">{usage.strict ? 'Modo economia ligado' : 'Modo economia desligado'}</span>
        </button>
        <p className="sf-hint">Ligado: câmera e tela só no palco e na TV; nas salas comuns só áudio, com qualidade mínima. Fica registrado na auditoria.</p>
      </div>
    </div>
  );
}
