import { useEffect, useState, useSyncExternalStore } from 'react';
import { NOC_WINDOWS, seriesStats, type NocClimateView, type NocView, type NocWindow } from '@workverse/shared';
import { HBars, LineChart, Meter, Sparkline, TempGauge, type BarRow } from './NocCharts';
import { EVENT_ICON, WINDOW_LABEL, formatClock, formatInt, formatPercent, formatTemp, formatUptimeShort } from './nocLogic';
import { NOC_REFRESH_MS, nocStore } from './nocStore';
import { Window } from '../Window';
import './noc.css';

const useNoc = () => useSyncExternalStore(nocStore.subscribe, nocStore.get, nocStore.get);

/**
 * "NOC · Monitoramento": graficos reais da Sala da TI (pessoas online, ocupacao por sala, temperatura e ar-condicionado, midia,
 * servidor e linha do tempo de eventos). Abre ao usar a estacao de frente ao videowall; so a equipe de TI, donos/admins e staff
 * recebem dados (o servidor decide e valida de novo). Atualiza a cada 5 s; a janela (15 min, 1 h, 6 h) e escolhida aqui.
 */
export function NocPanel() {
  const noc = useNoc();
  const [, tick] = useState(0);

  useEffect(() => {
    if (!noc.open) return;
    const id = setInterval(() => nocStore.refresh(), NOC_REFRESH_MS);
    const clock = setInterval(() => tick((n) => n + 1), 1000);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') nocStore.close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearInterval(id);
      clearInterval(clock);
      window.removeEventListener('keydown', onKey);
    };
  }, [noc.open]);

  if (!noc.open) return null;
  const v = noc.view;
  const age = noc.receivedAt ? Math.max(0, Math.round((Date.now() - noc.receivedAt) / 1000)) : null;
  const stale = age !== null && age > NOC_REFRESH_MS / 1000 * 3;

  return (
    <Window id="noc" className="win panel panel-noc" title="NOC · Monitoramento" onClose={() => nocStore.close()} role="dialog" aria-label="NOC, monitoramento da Sala da TI" bodyClassName="noc-body">
      <div className="noc" data-testid="noc-panel">
        <div className="noc-bar-top">
          <div className="noc-windows" role="radiogroup" aria-label="Janela de tempo">
            {NOC_WINDOWS.map((w) => (
              <button key={w} type="button" role="radio" aria-checked={noc.windowMin === w} className={noc.windowMin === w ? 'on' : ''} onClick={() => nocStore.setWindow(w as NocWindow)} data-testid={`noc-window-${w}`}>
                {WINDOW_LABEL[w]}
              </button>
            ))}
          </div>
          <span className={`noc-live${stale ? ' stale' : ''}`} data-testid="noc-live" aria-live="off">
            <i aria-hidden="true" />
            {age === null ? 'conectando...' : stale ? `sem atualização há ${age} s` : `ao vivo · atualizado há ${age} s`}
          </span>
        </div>

        {noc.notice && (
          <p className="noc-notice" role="alert" data-testid="noc-notice">
            {noc.notice}
          </p>
        )}
        {!v && !noc.notice && (
          <p className="noc-empty" role="status">
            Carregando dados do servidor...
          </p>
        )}

        {v && (
          <div className="noc-grid-cards">
            <OnlineCard v={v} />
            <RoomsCard v={v} />
            <ClimateCard v={v} />
            <MediaCard v={v} />
            <ServerCard v={v} />
            <EventsCard v={v} />
          </div>
        )}
      </div>
    </Window>
  );
}

const windowText = (v: NocView) => `nos últimos ${WINDOW_LABEL[v.windowMin]}`;

function Card({ id, title, children, wide, status }: { id: string; title: string; children: React.ReactNode; wide?: boolean; status?: React.ReactNode }) {
  return (
    <section className={`noc-card${wide ? ' wide' : ''}`} aria-labelledby={`noc-${id}-h`} data-testid={`noc-card-${id}`}>
      <header>
        <h3 id={`noc-${id}-h`}>{title}</h3>
        {status}
      </header>
      {children}
    </section>
  );
}

function Big({ value, unit, note, tone }: { value: string; unit?: string; note?: string; tone?: 'alert' }) {
  return (
    <p className={`noc-big${tone ? ` ${tone}` : ''}`}>
      <strong>{value}</strong>
      {unit && <span className="unit">{unit}</span>}
      {note && <small>{note}</small>}
    </p>
  );
}

function OnlineCard({ v }: { v: NocView }) {
  const st = seriesStats(v.online.values);
  return (
    <Card id="online" title="Pessoas online" wide>
      <div className="noc-row">
        <Big value={formatInt(v.online.now)} unit={v.online.now === 1 ? 'pessoa' : 'pessoas'} note={`pico ${formatInt(v.online.peak)} ${windowText(v)}${st ? ` · média ${formatInt(st.avg)}` : ''}`} />
      </div>
      <LineChart
        testId="noc-chart-online"
        series={[{ key: 'online', label: 'Pessoas online', values: v.online.values, color: 'var(--noc-cyan)', area: true }]}
        stepMs={v.stepMs}
        floorZero
        minSpan={4}
        format={(n) => formatInt(n)}
        ariaLabel={`Pessoas online: agora ${v.online.now}, pico ${v.online.peak} ${windowText(v)}`}
      />
    </Card>
  );
}

function RoomsCard({ v }: { v: NocView }) {
  const active = v.rooms.filter((r) => r.count > 0);
  const empty = v.rooms.length - active.length;
  const rows: BarRow[] = active.slice(0, 12).map((r) => ({ id: r.id, label: r.name, value: r.count, note: `${r.count}/${r.capacity}`, alert: r.capacity > 0 && r.count / r.capacity >= 0.9 }));
  return (
    <Card id="rooms" title="Ocupação por sala">
      {rows.length > 0 ? (
        <HBars rows={rows} testId="noc-chart-rooms" ariaLabel={`Ocupação por sala: ${rows.map((r) => `${r.label} ${r.note}`).join(', ')}`} />
      ) : (
        <p className="noc-empty">Nenhuma sala com gente agora.</p>
      )}
      {empty > 0 && <p className="noc-foot">{empty === 1 ? '1 sala vazia' : `${empty} salas vazias`}</p>}
    </Card>
  );
}

function ClimateCard({ v }: { v: NocView }) {
  const it = v.climate.find((c) => c.it) ?? v.climate[0];
  const others = v.climate.filter((c) => c !== it);
  if (!it) {
    return (
      <Card id="climate" title="Temperatura e ar-condicionado">
        <p className="noc-empty">Nenhuma sala com ar-condicionado.</p>
      </Card>
    );
  }
  const text = `${it.name}: ${formatTemp(it.temp)}, ${it.on ? `ar ligado com meta de ${it.target} graus` : 'ar desligado'}${it.overheat ? ', alerta de superaquecimento' : ''}`;
  return (
    <Card id="climate" title={`Temperatura · ${it.name}`} wide status={it.overheat ? <span className="noc-badge alert">Superaquecimento</span> : <span className={`noc-badge ${it.on ? 'ok' : ''}`}>{it.on ? `Ar ligado · meta ${it.target} °C` : 'Ar desligado'}</span>}>
      <div className="noc-climate">
        <TempGauge temp={it.temp} target={it.target} on={it.on} text={text} />
        <LineChart
          testId="noc-chart-temp"
          series={[
            { key: 'temp', label: 'Temperatura', values: it.temps, color: it.overheat ? 'var(--noc-amber)' : 'var(--noc-cyan)', area: true },
            { key: 'target', label: 'Meta do ar', values: it.targets, color: 'var(--noc-amber)', step: true },
          ]}
          stepMs={v.stepMs}
          minSpan={6}
          height={160}
          format={(n) => `${n}°`}
          ariaLabel={`Temperatura da ${it.name}: agora ${formatTemp(it.temp)} ${windowText(v)}; linha tracejada âmbar é a meta do ar`}
        />
      </div>
      <ul className="noc-legend" aria-label="Legenda">
        <li>
          <i className="sw cyan" /> Temperatura
        </li>
        <li>
          <i className="sw amber" /> Meta do ar (quando ligado)
        </li>
      </ul>
      {others.length > 0 && <OtherRooms rooms={others} />}
    </Card>
  );
}

function OtherRooms({ rooms }: { rooms: NocClimateView[] }) {
  return (
    <ul className="noc-others" aria-label="Outras salas com ar-condicionado">
      {rooms.slice(0, 6).map((c) => (
        <li key={c.id}>
          <span className="name">{c.name}</span>
          <Sparkline values={c.temps} color={c.overheat ? 'var(--noc-amber)' : 'var(--noc-cyan)'} label={`${c.name}: ${formatTemp(c.temp)}`} height={24} />
          <b className={c.overheat ? 'alert' : ''}>{formatTemp(c.temp)}</b>
          <small>{c.on ? `ar ${c.target}°` : 'ar off'}</small>
        </li>
      ))}
    </ul>
  );
}

function MediaCard({ v }: { v: NocView }) {
  const m = v.media;
  if (!m) {
    return (
      <Card id="media" title="Mídia (áudio e vídeo)">
        <p className="noc-empty">Economia de mídia desligada: sem contagem de cota.</p>
      </Card>
    );
  }
  const tone = m.level === 'ok' ? 'ok' : m.level === 'warn70' ? 'warn' : 'alert';
  const levelText = m.level === 'ok' ? 'Cota em dia' : m.level === 'warn70' ? 'Cota acima de 70%' : m.level === 'warn90' ? 'Cota acima de 90%' : 'Cota esgotada';
  return (
    <Card id="media" title="Mídia (áudio e vídeo)" status={<span className={`noc-badge ${tone}`}>{levelText}</span>}>
      {m.minutes && (
        <>
          <Big value={formatInt(m.minutes.used)} unit="min no mês" note={`de ${formatInt(m.minutes.limit)} · ${formatPercent(m.minutes.percent)}`} />
          <Meter percent={m.minutes.percent} tone={tone} label={`Cota mensal de mídia: ${formatPercent(m.minutes.percent)} usada`} />
        </>
      )}
      <Big value={formatInt(m.connections.now)} unit={m.connections.now === 1 ? 'conexão ativa' : 'conexões ativas'} note="nas salas desta organização" />
      <Sparkline values={m.connections.values} color="var(--noc-cyan)" label={`Conexões de mídia ativas: agora ${m.connections.now}`} />
    </Card>
  );
}

function ServerCard({ v }: { v: NocView }) {
  const s = v.server;
  const d = s.detail;
  const loadPct = s.load * 100;
  return (
    <Card id="server" title="Servidor">
      <dl className="noc-kv">
        <div>
          <dt>No ar há</dt>
          <dd data-testid="noc-uptime">{formatUptimeShort(s.uptimeSec)}</dd>
        </div>
        <div>
          <dt>Carga do tick</dt>
          <dd>{formatPercent(Math.round(loadPct * 10) / 10)}</dd>
        </div>
        {d && (
          <>
            <div>
              <dt>Memória</dt>
              <dd>{formatInt(d.heapMb)} MB</dd>
            </div>
            <div>
              <dt>Tick</dt>
              <dd>
                {d.tickMs.toFixed(2).replace('.', ',')} ms <small>(máx {d.tickMaxMs.toFixed(1).replace('.', ',')})</small>
              </dd>
            </div>
            <div>
              <dt>Mensagens</dt>
              <dd>{d.msgsPerSec.toFixed(1).replace('.', ',')}/s</dd>
            </div>
          </>
        )}
      </dl>
      <Meter percent={loadPct} tone={loadPct > 80 ? 'alert' : loadPct > 50 ? 'warn' : 'ok'} label={`Carga relativa do servidor: ${formatPercent(loadPct)}`} />
      {d && (
        <div className="noc-sparks">
          <figure>
            <Sparkline values={d.heap} color="var(--noc-cyan)" label={`Memória do processo: ${formatInt(d.heapMb)} MB`} />
            <figcaption>memória</figcaption>
          </figure>
          <figure>
            <Sparkline values={d.msgs} color="var(--noc-cyan)" label={`Mensagens por segundo: ${d.msgsPerSec}`} />
            <figcaption>msgs/s</figcaption>
          </figure>
        </div>
      )}
    </Card>
  );
}

function EventsCard({ v }: { v: NocView }) {
  return (
    <Card id="events" title="Linha do tempo" wide>
      {v.events.length === 0 ? (
        <p className="noc-empty">Nenhum evento recente. Tudo calmo por aqui.</p>
      ) : (
        <ol className="noc-events" data-testid="noc-events">
          {v.events.slice(0, 12).map((e, i) => (
            <li key={`${e.at}-${i}`} className={e.level}>
              <time dateTime={new Date(e.at).toISOString()}>{formatClock(e.at)}</time>
              <span className="ic" aria-hidden="true">
                {EVENT_ICON[e.kind]}
              </span>
              <span>{e.text}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
