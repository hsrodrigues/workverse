import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  BOOKING_MINUTE,
  BOOKING_PRESETS,
  BOOKING_TZ,
  LIMIT_LABELS,
  MAX_BOOKING_GUESTS,
  MAX_BOOKING_REASON,
  MAX_BOOKING_SLOTS,
  MAX_BOOKING_TITLE,
  BOOKING_LIMIT_BOUNDS,
  addDaysMs,
  dateInputOf,
  formatMinutes,
  isValidTimeZone,
  parseLocalInput,
  startOfDayMs,
  timeInputOf,
  type BookingBlock,
  type BookingLimits,
  type BookingMine,
  type BookingRoomInfo,
  type BookingWindow,
} from '@workverse/shared';
import { net } from '../../net';
import { useNetStatus } from '../../worldStore';
import { Icon } from '../../media/icons';
import { Window } from '../Window';
import './bookings.css';
import { bookingStore, canBookOf, canManageOf, useBookings, type BookingTab } from './bookingStore';
import {
  STATUS_LABEL,
  addDaysToDate,
  agendaWindow,
  blockLabel,
  browserTz,
  buildRequestSlots,
  dayColumns,
  firstWindowProblem,
  fmtClock,
  fmtDay,
  fmtWhen,
  freeIntervals,
  placeBlocks,
  presetsFor,
  queueText,
  suggestStartTime,
} from './bookingLogic';
import { fmtRange } from '@workverse/shared';

const HOUR_PX = 22;

/** Botao "Reservas" da barra inferior: so aparece para quem pode reservar (o servidor confere de novo). */
export function BookingsBarButton() {
  const s = useBookings();
  const [conn] = useNetStatus();
  if (!canBookOf(s)) return null;
  const pending = canManageOf(s) ? (s.data?.pending?.length ?? 0) : 0;
  return (
    <button type="button" className={`tool tool-bookings ${s.open ? 'on' : ''}`} onClick={() => bookingStore.toggle()} disabled={conn !== 'online'} title="Reservar a sala privada e outras salas" aria-pressed={s.open} data-testid="bookings-button">
      <span className="ico">
        <Icon name="calendar" />
      </span>{' '}
      Reservas{pending > 0 && <span className="badge" aria-label={`${pending} pedidos pendentes`}>{pending}</span>}
    </button>
  );
}

const TAB_LABEL: Record<BookingTab, string> = {
  agenda: 'Agenda',
  request: 'Solicitar sala',
  mine: 'Minhas reservas',
  queue: 'Fila da sala',
  pending: 'Pendentes',
  settings: 'Salas e limites',
};

export function BookingsPanel() {
  const s = useBookings();
  const manage = canManageOf(s);
  const tabs: BookingTab[] = ['agenda', 'request', 'mine', 'queue', ...(manage ? (['pending', 'settings'] as BookingTab[]) : [])];
  const data = s.data;
  const bookable = (data?.rooms ?? []).filter((r) => r.bookable);
  const room = (data?.rooms ?? []).find((r) => r.roomId === (s.roomId ?? data?.roomId));
  const tablist = useRef<HTMLDivElement>(null);
  const [prefill, setPrefill] = useState<{ date: string; time: string } | null>(null);

  useEffect(() => {
    if (s.open && !tabs.includes(s.tab)) bookingStore.setTab('agenda');
  }, [s.open, s.tab, manage]);

  if (!s.open) return null;

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.indexOf(s.tab);
    const next = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : null;
    if (!next) return;
    e.preventDefault();
    bookingStore.setTab(next);
    requestAnimationFrame(() => tablist.current?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus());
  };

  const mineLive = (data?.mine ?? []).filter((m) => m.status === 'pending' || m.status === 'confirmed' || m.status === 'queued').length;

  return (
    <Window id="bookings" className="win panel panel-bookings" title="Reservas de sala" onClose={() => bookingStore.close()} role="dialog" aria-label="Reservas de sala" data-testid="bookings-panel">
      <div className="bk">
        <div className="bk-top">
          <label className="bk-field bk-room">
            Sala
            <select value={s.roomId ?? data?.roomId ?? ''} onChange={(e) => bookingStore.setRoom(e.target.value)} aria-label="Sala" data-testid="bk-room">
              {(data?.rooms ?? []).map((r) => (
                <option key={r.roomId} value={r.roomId}>
                  {r.name}
                  {r.bookable ? '' : ' (não reservável)'}
                </option>
              ))}
            </select>
          </label>
          {room?.requiresApproval && (
            <span className="bk-chip warn" title="Os pedidos desta sala precisam da aprovação de um gestor.">
              Exige aprovação
            </span>
          )}
          <span className="bk-tz">
            Horários em <b>{s.tz === BOOKING_TZ ? 'Brasília' : s.tz.replace(/_/g, ' ')}</b>
          </span>
        </div>

        <div className="bk-tabs" role="tablist" aria-label="Seções de reservas" ref={tablist} onKeyDown={onTabKey}>
          {tabs.map((t) => (
            <button key={t} type="button" role="tab" id={`bk-tab-${t}`} data-tab={t} aria-selected={s.tab === t} aria-controls="bk-tabpanel" tabIndex={s.tab === t ? 0 : -1} className={s.tab === t ? 'on' : ''} onClick={() => bookingStore.setTab(t)} data-testid={`bk-tab-${t}`}>
              {TAB_LABEL[t]}
              {t === 'mine' && mineLive > 0 && <span className="bk-count">{mineLive}</span>}
              {t === 'pending' && (data?.pending?.length ?? 0) > 0 && <span className="bk-count">{data!.pending!.length}</span>}
              {t === 'queue' && (data?.queue?.length ?? 0) > 0 && <span className="bk-count">{data!.queue.length}</span>}
            </button>
          ))}
        </div>

        <div className="bk-body" role="tabpanel" id="bk-tabpanel" aria-labelledby={`bk-tab-${s.tab}`}>
          {!data && <p className="bk-empty">Carregando a agenda…</p>}
          {data && bookable.length === 0 && s.tab !== 'settings' && <p className="bk-empty">Nenhuma sala está aberta para reserva. {manage ? 'Ative uma em "Salas e limites".' : 'Peça a um administrador para ativar.'}</p>}
          {data && (bookable.length > 0 || s.tab === 'settings') && (
            <>
              {s.tab === 'agenda' && (
                <AgendaTab
                  room={room}
                  onPick={(date, time) => {
                    setPrefill({ date, time });
                    bookingStore.setTab('request');
                  }}
                />
              )}
              {s.tab === 'request' && <RequestTab room={room} bookable={bookable} prefill={prefill} />}
              {s.tab === 'mine' && <MineTab />}
              {s.tab === 'queue' && <QueueTab room={room} />}
              {s.tab === 'pending' && manage && <PendingTab />}
              {s.tab === 'settings' && manage && <SettingsTab />}
            </>
          )}
        </div>

        {s.notice && (
          <div className={`bk-notice ${s.notice.kind}`} role="status" aria-live="polite" data-testid="bk-notice">
            <span>{s.notice.text}</span>
            {s.notice.results && (
              <ul>
                {s.notice.results.map((r) => (
                  <li key={r.startAt} className={r.ok ? 'ok' : 'error'}>
                    <b>{fmtDay(r.startAt, s.tz)}</b>: {r.message}
                    {r.suggestion ? ` Próxima janela livre: ${fmtWhen(r.suggestion, s.tz)}.` : ''}
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="mini" onClick={() => bookingStore.clearNotice()} aria-label="Dispensar aviso">
              ×
            </button>
          </div>
        )}

        <div className="bk-foot">
          <label className="bk-tzpick">
            Fuso
            <select value={s.tz === BOOKING_TZ ? 'br' : s.tz === browserTz() ? 'local' : 'other'} onChange={(e) => bookingStore.setTz(e.target.value === 'br' ? BOOKING_TZ : browserTz())} aria-label="Fuso dos horários" data-testid="bk-tz">
              <option value="local">Meu navegador ({browserTz().replace(/_/g, ' ')})</option>
              <option value="br">Brasília (America/Sao_Paulo)</option>
              {s.tz !== BOOKING_TZ && s.tz !== browserTz() && <option value="other">{s.tz}</option>}
            </select>
          </label>
          <button type="button" className="mini" onClick={() => bookingStore.refresh()} disabled={s.busy}>
            {s.busy ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>
      </div>
    </Window>
  );
}

// ---- Agenda ------------------------------------------------------------------------------------------------

function Legend() {
  return (
    <ul className="bk-legend" aria-label="Legenda da agenda">
      <li>
        <i className="sw free" aria-hidden="true" /> Livre
      </li>
      <li>
        <i className="sw busy" aria-hidden="true" /> Ocupada
      </li>
      <li>
        <i className="sw pending" aria-hidden="true" /> Pendente (aguardando aprovação)
      </li>
      <li>
        <i className="sw mine" aria-hidden="true" /> Sua reserva
      </li>
    </ul>
  );
}

function AgendaTab({ room, onPick }: { room: BookingRoomInfo | undefined; onPick(date: string, time: string): void }) {
  const s = useBookings();
  const data = s.data!;
  const now = bookingStore.now();
  const cols = useMemo(() => dayColumns(s.anchor, s.view, now, s.tz), [s.anchor, s.view, s.tz, Math.floor(now / 60_000)]);
  const win = agendaWindow(s.anchor, s.view, s.tz);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: HOUR_PX * 7.5 });
  }, [s.view, room?.roomId]);
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const nowPct = (n: number, c: { start: number; end: number }) => ((n - c.start) / (c.end - c.start)) * 100;
  const title = s.view === 'day' ? `${fmtDay(cols[0]!.start, s.tz)}` : `${cols[0]!.label} a ${cols[cols.length - 1]!.label}`;

  return (
    <div className="bk-agenda" data-testid="bk-agenda">
      <div className="bk-toolbar">
        <div className="bk-nav" role="group" aria-label="Navegar na agenda">
          <button type="button" className="mini" onClick={() => bookingStore.shift(-1)} aria-label={s.view === 'day' ? 'Dia anterior' : 'Semana anterior'} data-testid="bk-prev">
            ◀
          </button>
          <button type="button" className="mini" onClick={() => bookingStore.today()} data-testid="bk-today">
            Hoje
          </button>
          <button type="button" className="mini" onClick={() => bookingStore.shift(1)} aria-label={s.view === 'day' ? 'Próximo dia' : 'Próxima semana'} data-testid="bk-next">
            ▶
          </button>
        </div>
        <strong className="bk-range" aria-live="polite">
          {title}
        </strong>
        <div className="bk-seg" role="group" aria-label="Visão">
          <button type="button" aria-pressed={s.view === 'day'} className={s.view === 'day' ? 'on' : ''} onClick={() => bookingStore.setView('day')} data-testid="bk-view-day">
            Dia
          </button>
          <button type="button" aria-pressed={s.view === 'week'} className={s.view === 'week' ? 'on' : ''} onClick={() => bookingStore.setView('week')} data-testid="bk-view-week">
            Semana
          </button>
        </div>
      </div>
      <Legend />
      {room && !room.bookable && <p className="bk-hint warn">Esta sala não está aberta para reserva.</p>}
      <div className="bk-grid-head" style={{ gridTemplateColumns: `38px repeat(${cols.length}, 1fr)` }}>
        <span />
        {cols.map((c) => (
          <span key={c.start} className={`bk-colhead ${c.today ? 'today' : ''}`}>
            {c.weekday} {c.label}
          </span>
        ))}
      </div>
      <div className="bk-scroll" ref={scroller} tabIndex={0} aria-label="Grade de horários" data-testid="bk-grid">
        <div className="bk-grid" style={{ gridTemplateColumns: `38px repeat(${cols.length}, 1fr)`, height: HOUR_PX * 24 }}>
          <div className="bk-hours" aria-hidden="true">
            {hours.map((h) => (
              <span key={h} style={{ top: h * HOUR_PX }}>
                {String(h).padStart(2, '0')}h
              </span>
            ))}
          </div>
          {cols.map((c) => {
            const placed = placeBlocks(data.blocks, c);
            const free = room?.bookable ? freeIntervals(data.blocks, c, now) : [];
            return (
              <div key={c.start} className="bk-col" data-testid={`bk-col-${dateInputOf(c.start, s.tz)}`}>
                {hours.map((h) => (
                  <i key={h} className="bk-hline" style={{ top: h * HOUR_PX }} aria-hidden="true" />
                ))}
                {free.map((f) => (
                  <button
                    key={f.startAt}
                    type="button"
                    className="bk-block free"
                    style={{ top: `${nowPct(Math.max(f.startAt, c.start), c)}%`, height: `${nowPct(Math.min(f.endAt, c.end), c) - nowPct(Math.max(f.startAt, c.start), c)}%` }}
                    onClick={() => onPick(dateInputOf(c.start, s.tz), timeInputOf(roundUp(f.startAt), s.tz))}
                    aria-label={`Livre de ${fmtClock(f.startAt, s.tz)} a ${fmtClock(f.endAt, s.tz)}, ${fmtDay(c.start, s.tz)}. Clique para reservar.`}
                    title="Livre: clique para reservar"
                  />
                ))}
                {placed.map((b) => (
                  <div
                    key={b.id}
                    role="note"
                    className={`bk-block ${b.state} ${b.mine ? 'mine' : ''}`}
                    style={{ top: `${b.top}%`, height: `${b.height}%` }}
                    aria-label={`${blockLabel(b)}, ${fmtRange(b.startAt, b.endAt, s.tz)}${b.mine ? ' (sua reserva)' : ''}`}
                    title={`${blockLabel(b)}\n${fmtRange(b.startAt, b.endAt, s.tz)}`}
                    data-testid={`bk-block-${b.state}`}
                  >
                    <b>{b.mine && b.title ? b.title : b.state === 'pending' ? 'Pendente' : 'Ocupada'}</b>
                    <small>
                      {fmtClock(b.startAt, s.tz)}–{fmtClock(b.endAt, s.tz)}
                      {b.ownerName ? ` · ${b.ownerName}` : ''}
                    </small>
                  </div>
                ))}
                {c.today && <i className="bk-now" style={{ top: `${nowPct(now, c)}%` }} aria-hidden="true" />}
              </div>
            );
          })}
        </div>
      </div>
      <p className="bk-foothint">Quem não tem acesso vê só "Ocupada". Dono, convidados e administradores veem os detalhes.</p>
    </div>
  );
}

const roundUp = (ms: number, grid = 5 * BOOKING_MINUTE) => Math.ceil(ms / grid) * grid;

// ---- Solicitar ----------------------------------------------------------------------------------------------

function GuestPicker({ guests, setGuests, max }: { guests: string[]; setGuests(g: string[]): void; max: number }) {
  const s = useBookings();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => (q.trim() ? bookingStore.searchPeople(q) : bookingStore.clearPeople()), 250);
    return () => clearTimeout(id);
  }, [q]);
  const add = (name: string) => {
    const n = name.trim();
    if (!n || guests.some((g) => g.toLowerCase() === n.toLowerCase()) || guests.length >= max) return;
    setGuests([...guests, n]);
    setQ('');
    bookingStore.clearPeople();
  };
  const hits = s.people.filter((p) => !guests.some((g) => g.toLowerCase() === p.name.toLowerCase())).slice(0, 6);
  return (
    <div className="bk-guests">
      <label className="bk-field">
        Convidados (opcional) — outros membros que também poderão entrar
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(hits[0]?.name ?? q);
            }
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Buscar pelo nome"
          maxLength={64}
          autoComplete="off"
          aria-label="Buscar convidado pelo nome"
          disabled={guests.length >= max}
          data-testid="bk-guest-search"
        />
      </label>
      {open && q.trim() && (
        <ul className="bk-suggest" role="listbox" aria-label="Pessoas encontradas">
          {hits.map((p) => (
            <li key={p.name} role="option" aria-selected={false}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(p.name)} data-testid={`bk-guest-${p.name}`}>
                {p.name}
                {p.dept ? <small> · {p.dept}</small> : null}
                {p.online ? <em> online</em> : null}
              </button>
            </li>
          ))}
          {hits.length === 0 && <li className="bk-empty">Ninguém encontrado com esse nome.</li>}
        </ul>
      )}
      {guests.length > 0 && (
        <ul className="bk-chips" aria-label="Convidados escolhidos">
          {guests.map((g) => (
            <li key={g}>
              {g}
              <button type="button" onClick={() => setGuests(guests.filter((x) => x !== g))} aria-label={`Remover ${g}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <small className="bk-hint">Até {max} convidado{max === 1 ? '' : 's'} nesta sala.</small>
    </div>
  );
}

function RequestTab({ room, bookable, prefill }: { room: BookingRoomInfo | undefined; bookable: BookingRoomInfo[]; prefill: { date: string; time: string } | null }) {
  const s = useBookings();
  const data = s.data!;
  const limits = data.limits;
  const now = bookingStore.now();
  const start = useMemo(() => suggestStartTime(now, s.tz), [s.tz]);
  const [roomId, setRoomId] = useState(room?.bookable ? room.roomId : (bookable[0]?.roomId ?? ''));
  const [date, setDate] = useState(prefill?.date ?? start.date);
  const [time, setTime] = useState(prefill?.time ?? start.time);
  const [minutes, setMinutes] = useState(60);
  const [preset, setPreset] = useState<string | null>('1h');
  const [extra, setExtra] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [guests, setGuests] = useState<string[]>([]);
  const [busyHint, setBusyHint] = useState(false);

  useEffect(() => {
    if (prefill) {
      setDate(prefill.date);
      setTime(prefill.time);
    }
  }, [prefill]);
  useEffect(() => {
    if (room?.bookable) setRoomId(room.roomId);
  }, [room?.roomId]);

  const target = bookable.find((r) => r.roomId === roomId);
  const built = buildRequestSlots({ date, time, minutes, extraDates: extra, tz: s.tz });
  const problem = built.error ?? firstWindowProblem(built.slots, now, limits);
  const maxGuests = Math.min(MAX_BOOKING_GUESTS, Math.max(0, (target?.capacity ?? 4) - 1));
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDaysToDate(date, i + 1, s.tz)), [date, s.tz]);
  const presets = presetsFor(limits);

  const pickPreset = (id: string, mins: number, startHour?: number) => {
    setPreset(id);
    setMinutes(mins);
    if (startHour !== undefined && time > `${String(startHour).padStart(2, '0')}:00`) setTime(`${String(startHour).padStart(2, '0')}:00`);
  };
  const toggleDay = (d: string) => setExtra((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : cur.length + 1 >= MAX_BOOKING_SLOTS ? cur : [...cur, d]));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (problem || !title.trim() || !target) return;
    setBusyHint(true);
    bookingStore.request(target.roomId, built.slots, title.trim(), guests.slice(0, maxGuests));
  };
  useEffect(() => {
    if (!s.busy) setBusyHint(false);
  }, [s.busy]);

  return (
    <form className="bk-form" onSubmit={submit} data-testid="bk-request">
      <label className="bk-field">
        Sala
        <select value={roomId} onChange={(e) => setRoomId(e.target.value)} aria-label="Sala a reservar" data-testid="bk-req-room">
          {bookable.map((r) => (
            <option key={r.roomId} value={r.roomId}>
              {r.name} (até {r.capacity} pessoas)
            </option>
          ))}
        </select>
      </label>
      {target?.requiresApproval && <p className="bk-hint warn">Esta sala exige aprovação de um gestor: seu pedido fica "pendente" até ser aprovado.</p>}

      <div className="bk-row">
        <label className="bk-field">
          Data
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required aria-label="Data" data-testid="bk-date" />
        </label>
        <label className="bk-field">
          Hora de início
          <input type="time" value={time} step={300} onChange={(e) => setTime(e.target.value)} required aria-label="Hora de início" data-testid="bk-time" />
        </label>
      </div>

      <fieldset className="bk-field bk-presets">
        <legend>Duração</legend>
        <div className="bk-presetrow" role="group" aria-label="Duração da reserva">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`bk-preset ${preset === p.id ? 'on' : ''}`}
              aria-pressed={preset === p.id}
              disabled={!p.allowed}
              title={p.allowed ? `${formatMinutes(p.minutes)}` : `Passa do limite de ${formatMinutes(limits.maxDurationMin)} por reserva`}
              onClick={() => pickPreset(p.id, p.minutes, p.startHour)}
              data-testid={`bk-preset-${p.id}`}
            >
              {p.label}
            </button>
          ))}
          <label className="bk-custom">
            Outra (min)
            <input
              type="number"
              min={15}
              max={limits.maxDurationMin}
              step={5}
              value={minutes}
              onChange={(e) => {
                setMinutes(Number(e.target.value));
                setPreset(null);
              }}
              aria-label="Duração em minutos"
              data-testid="bk-minutes"
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="bk-field bk-days">
        <legend>Repetir em outros dias (opcional, até {MAX_BOOKING_SLOTS} no total)</legend>
        <div className="bk-dayrow" role="group" aria-label="Outros dias">
          {days.map((d) => {
            const ms = parseLocalInput(d, '12:00', s.tz) ?? now;
            return (
              <button key={d} type="button" className={`bk-day ${extra.includes(d) ? 'on' : ''}`} aria-pressed={extra.includes(d)} onClick={() => toggleDay(d)} data-testid={`bk-day-${d}`}>
                <span>{fmtDay(ms, s.tz).split(',')[0]}</span>
                <b>{d.slice(8, 10)}/{d.slice(5, 7)}</b>
              </button>
            );
          })}
        </div>
      </fieldset>

      <label className="bk-field">
        Motivo / título
        <input value={title} maxLength={MAX_BOOKING_TITLE} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Conversa com cliente" required aria-label="Motivo da reserva" data-testid="bk-title" autoComplete="off" />
      </label>

      <GuestPicker guests={guests} setGuests={setGuests} max={maxGuests} />

      <div className="bk-summary" aria-live="polite" data-testid="bk-summary">
        {built.slots.length > 0 && !built.error ? (
          <ul>
            {built.slots.map((sl) => (
              <li key={sl.startAt}>{fmtRange(sl.startAt, sl.endAt, s.tz)}</li>
            ))}
          </ul>
        ) : null}
        {problem && <p className="bk-hint error">{problem}</p>}
        <p className="bk-limits">
          Limites: até {formatMinutes(limits.maxDurationMin)} por reserva, {limits.maxActivePerPerson} reserva{limits.maxActivePerPerson === 1 ? '' : 's'} ativa{limits.maxActivePerPerson === 1 ? '' : 's'}, {limits.maxAdvanceDays} dias de antecedência, {formatMinutes(limits.maxDailyMin)} por dia.
        </p>
      </div>
      <button className="btn btn-primary" disabled={!!problem || !title.trim() || !target || s.busy} data-testid="bk-submit">
        {busyHint ? 'Enviando…' : built.slots.length > 1 ? `Solicitar ${built.slots.length} dias` : 'Solicitar sala'}
      </button>
    </form>
  );
}

// ---- Minhas reservas ---------------------------------------------------------------------------------------

function GuestEditor({ booking, onDone }: { booking: BookingMine; onDone(): void }) {
  const [title, setTitle] = useState(booking.title);
  const [guests, setGuests] = useState(booking.guests);
  const s = useBookings();
  const cap = (s.data?.rooms.find((r) => r.roomId === booking.roomId)?.capacity ?? 4) - 1;
  return (
    <form
      className="bk-edit"
      onSubmit={(e) => {
        e.preventDefault();
        bookingStore.edit(booking.id, { title: title.trim(), guests });
        onDone();
      }}
    >
      <label className="bk-field">
        Motivo
        <input value={title} maxLength={MAX_BOOKING_TITLE} onChange={(e) => setTitle(e.target.value)} aria-label="Motivo" />
      </label>
      <GuestPicker guests={guests} setGuests={setGuests} max={Math.min(MAX_BOOKING_GUESTS, cap)} />
      <div className="bk-actions">
        <button className="btn btn-primary" disabled={!title.trim()}>
          Salvar
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Fechar
        </button>
      </div>
    </form>
  );
}

function MineCard({ b }: { b: BookingMine }) {
  const s = useBookings();
  const [editing, setEditing] = useState(false);
  const live = b.status === 'pending' || b.status === 'confirmed' || b.status === 'queued';
  return (
    <li className={`bk-card st-${b.status}`} data-testid={`bk-mine-${b.status}`}>
      <div className="bk-cardhead">
        <b>{b.title}</b>
        <span className={`bk-chip st-${b.status}`}>{b.active ? 'Em andamento' : STATUS_LABEL[b.status]}</span>
      </div>
      <div className="bk-cardmeta">
        {b.roomName} · {fmtRange(b.startAt, b.endAt, s.tz)} · {b.role === 'owner' ? 'Você reservou' : `Convidado por ${b.ownerName}`}
      </div>
      {b.guests.length > 0 && <div className="bk-cardmeta">Convidados: {b.guests.join(', ')}</div>}
      {b.status === 'queued' && (
        <p className="bk-queue" data-testid="bk-queue-text">
          {queueText(b.position, b.suggestion, s.tz)}
        </p>
      )}
      {b.reason && <p className="bk-hint">{b.reason}</p>}
      {live && b.role === 'owner' && b.status === 'confirmed' && !b.active && !b.checkedIn && <small className="bk-hint">Entre na sala nos primeiros {s.data?.limits.noShowMin ?? 15} minutos da reserva, senão ela é liberada.</small>}
      <div className="bk-actions">
        {b.active && (
          <button type="button" className="btn btn-primary" onClick={() => net.send({ t: 'join', roomId: b.roomId })} data-testid="bk-enter">
            Entrar na sala
          </button>
        )}
        {b.canExtend && (
          <button type="button" className="btn" onClick={() => bookingStore.act('booking_extend', b.id)} data-testid="bk-extend">
            Estender +30 min
          </button>
        )}
        {b.canEnd && (
          <button type="button" className="btn" onClick={() => bookingStore.act('booking_end', b.id)} data-testid="bk-end">
            Encerrar agora
          </button>
        )}
        {b.canEdit && (
          <button type="button" className="btn" onClick={() => setEditing(!editing)} aria-expanded={editing} data-testid="bk-edit">
            Editar / convidar
          </button>
        )}
        {b.canCancel && (
          <button type="button" className="btn danger" onClick={() => bookingStore.act('booking_cancel', b.id)} data-testid="bk-cancel">
            Cancelar
          </button>
        )}
      </div>
      {editing && <GuestEditor booking={b} onDone={() => setEditing(false)} />}
    </li>
  );
}

function MineTab() {
  const s = useBookings();
  const mine = s.data!.mine;
  const groups: Array<[string, BookingMine[]]> = [
    ['Em andamento', mine.filter((m) => m.active)],
    ['Próximas', mine.filter((m) => !m.active && (m.status === 'confirmed' || m.status === 'pending'))],
    ['Na fila', mine.filter((m) => m.status === 'queued')],
    ['Histórico recente', mine.filter((m) => m.status !== 'confirmed' && m.status !== 'pending' && m.status !== 'queued')],
  ];
  if (mine.length === 0) return <p className="bk-empty" data-testid="bk-mine-empty">Você ainda não tem reservas. Use "Solicitar sala" ou clique num horário livre da agenda.</p>;
  return (
    <div className="bk-mine" data-testid="bk-mine">
      {groups.map(([name, list]) =>
        list.length === 0 ? null : (
          <section key={name} aria-label={name}>
            <h3>{name}</h3>
            <ul className="bk-cards">
              {list.map((b) => (
                <MineCard key={b.id} b={b} />
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}

// ---- Fila ----------------------------------------------------------------------------------------------------

function QueueTab({ room }: { room: BookingRoomInfo | undefined }) {
  const s = useBookings();
  const queue = s.data!.queue;
  return (
    <div className="bk-queuetab" data-testid="bk-queue">
      <p className="bk-hint">
        Fila de {room?.name ?? 'sala'} no período mostrado na agenda ({fmtDay(s.data!.from, s.tz)} a {fmtDay(s.data!.to - 1, s.tz)}). Quem pediu primeiro sobe primeiro quando o horário libera.
      </p>
      {queue.length === 0 ? (
        <p className="bk-empty">Ninguém na fila neste período.</p>
      ) : (
        <ol className="bk-queuelist">
          {queue.map((q) => (
            <li key={q.id} className={q.mine ? 'mine' : ''} data-testid="bk-queue-entry">
              <b className="bk-pos">{q.position}º</b>
              <span>
                <b>{q.mine ? 'Você' : q.ownerName}</b>
                {q.title ? ` — ${q.title}` : ''}
                <small>{fmtRange(q.startAt, q.endAt, s.tz)}</small>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ---- Pendentes (administracao) ---------------------------------------------------------------------------------

function PendingTab() {
  const s = useBookings();
  const list = s.data!.pending ?? [];
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  if (list.length === 0) return <p className="bk-empty" data-testid="bk-pending-empty">Nenhum pedido aguardando aprovação.</p>;
  return (
    <ul className="bk-cards" data-testid="bk-pending">
      {list.map((p) => (
        <li key={p.id} className="bk-card st-pending" data-testid="bk-pending-item">
          <div className="bk-cardhead">
            <b>{p.title}</b>
            <span className="bk-chip st-pending">{p.roomName}</span>
          </div>
          <div className="bk-cardmeta">
            {p.ownerName} · {fmtRange(p.startAt, p.endAt, s.tz)}
          </div>
          {p.guests.length > 0 && <div className="bk-cardmeta">Convidados: {p.guests.join(', ')}</div>}
          {declining === p.id ? (
            <form
              className="bk-edit"
              onSubmit={(e) => {
                e.preventDefault();
                bookingStore.decide(p.id, false, reason.trim());
                setDeclining(null);
                setReason('');
              }}
            >
              <label className="bk-field">
                Motivo da recusa (a pessoa recebe)
                <input value={reason} maxLength={MAX_BOOKING_REASON} onChange={(e) => setReason(e.target.value)} autoFocus aria-label="Motivo da recusa" data-testid="bk-reason" />
              </label>
              <div className="bk-actions">
                <button className="btn danger" data-testid="bk-decline-confirm">
                  Recusar
                </button>
                <button type="button" className="btn" onClick={() => setDeclining(null)}>
                  Voltar
                </button>
              </div>
            </form>
          ) : (
            <div className="bk-actions">
              <button type="button" className="btn btn-primary" onClick={() => bookingStore.decide(p.id, true)} data-testid="bk-approve">
                Aprovar
              </button>
              <button type="button" className="btn danger" onClick={() => setDeclining(p.id)} data-testid="bk-decline">
                Recusar…
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

// ---- Salas e limites (administracao) -----------------------------------------------------------------------------

export function RoomBookingConfig({ roomId }: { roomId: string }) {
  const s = useBookings();
  const r = s.data?.rooms.find((x) => x.roomId === roomId);
  if (!r) return null;
  return (
    <div className="bk-roomcfg" data-testid={`bk-cfg-${roomId}`}>
      <label>
        <input type="checkbox" checked={r.bookable} onChange={(e) => bookingStore.setRoomConfig(roomId, e.target.checked, r.requiresApproval)} data-testid={`bk-cfg-bookable-${roomId}`} /> Pode ser reservada
      </label>
      <label className={r.bookable ? '' : 'off'}>
        <input type="checkbox" checked={r.requiresApproval} disabled={!r.bookable} onChange={(e) => bookingStore.setRoomConfig(roomId, true, e.target.checked)} data-testid={`bk-cfg-approval-${roomId}`} /> Exigir aprovação de gestor/admin
      </label>
    </div>
  );
}

function SettingsTab() {
  const s = useBookings();
  const data = s.data!;
  const [limits, setLimits] = useState<BookingLimits>(data.limits);
  useEffect(() => setLimits(data.limits), [data.limits]);
  const keys = Object.keys(BOOKING_LIMIT_BOUNDS) as Array<keyof BookingLimits>;
  const invalid = keys.some((k) => !Number.isInteger(limits[k]) || limits[k] < BOOKING_LIMIT_BOUNDS[k][0] || limits[k] > BOOKING_LIMIT_BOUNDS[k][1]);
  return (
    <div className="bk-settings" data-testid="bk-settings">
      <h3>Salas reserváveis</h3>
      <ul className="bk-cards">
        {data.rooms.map((r) => (
          <li key={r.roomId} className="bk-card">
            <b>{r.name}</b>
            <RoomBookingConfig roomId={r.roomId} />
          </li>
        ))}
      </ul>
      <h3>Limites da organização</h3>
      <form
        className="bk-limits-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) bookingStore.setLimits(limits);
        }}
      >
        {keys.map((k) => (
          <label key={k} className="bk-field">
            {LIMIT_LABELS[k]}
            <input type="number" min={BOOKING_LIMIT_BOUNDS[k][0]} max={BOOKING_LIMIT_BOUNDS[k][1]} value={Number.isFinite(limits[k]) ? limits[k] : ''} onChange={(e) => setLimits({ ...limits, [k]: e.target.value === '' ? Number.NaN : Number(e.target.value) })} data-testid={`bk-limit-${k}`} />
            <small>
              de {BOOKING_LIMIT_BOUNDS[k][0]} a {BOOKING_LIMIT_BOUNDS[k][1]}
            </small>
          </label>
        ))}
        <button className="btn btn-primary" disabled={invalid || s.busy} data-testid="bk-limits-save">
          Salvar limites
        </button>
      </form>
    </div>
  );
}

/** Evita avisos de importacao nao usada em builds estritos. */
void [BOOKING_PRESETS, addDaysMs, isValidTimeZone, startOfDayMs];
export type { BookingBlock, BookingWindow };
