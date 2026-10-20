import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { COMMON_TIMEZONES, LANGUAGES, MAX_ABOUT_LENGTH, MAX_NAME_LENGTH, PRONOUN_OPTIONS, isBirthdayToday, type ProfilePrefs, type ProfileView } from '@workverse/shared';
import { clockIn } from '../../clientPrefs';
import { useWorld } from '../../worldStore';
import { BadgeCard } from '../BadgeCard';
import { Window } from '../Window';
import { Icon } from '../../media/icons';
import { DAYS, MONTHS, buildPatch, formFromProfile, isDirty, nameCooldownText, validateForm, type FormErrors, type ProfileForm } from './profileForm';
import { profileStore, useProfileState } from './profileStore';
import './profile.css';

interface Props {
  onEditAvatar(): void;
  onChangePassword(): void;
}

/** Botao da barra: abre/fecha "Meu perfil". */
export function ProfileBarButton() {
  const { open } = useProfileState();
  return (
    <button type="button" className="tool" onClick={() => profileStore.toggle()} title="Meu perfil" aria-label="Meu perfil" aria-pressed={open} data-testid="profile-button">
      <span className="ico">
        <Icon name="user" />
      </span>
    </button>
  );
}

function Check({ checked, onChange, children, hint, disabled, testid }: { checked: boolean; onChange(v: boolean): void; children: ReactNode; hint?: string; disabled?: boolean; testid?: string }) {
  return (
    <label className={`pf-check ${disabled ? 'off' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testid} />
      <span>
        {children}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

export function ProfilePanel({ onEditAvatar, onChangePassword }: Props) {
  const { open, profile, loading, saving, loadError } = useProfileState();

  // Carrega uma vez ao entrar no mundo: aplica as preferencias da conta (decoracao de eventos, economia de dados...).
  useEffect(() => {
    void profileStore.load();
  }, []);

  if (!open) return null;
  return (
    <Window id="profile" className="win panel panel-profile" title="Meu perfil" onClose={() => profileStore.close()} role="dialog" aria-label="Meu perfil" bodyClassName="pf-body">
      {profile ? (
        <ProfileEditor key={profile.displayName + profile.nameChangeAt} profile={profile} saving={saving} onEditAvatar={onEditAvatar} onChangePassword={onChangePassword} />
      ) : (
        <p className="pf-status" role="status">
          {loadError ? (
            <>
              {loadError}{' '}
              <button type="button" className="mini" onClick={() => void profileStore.load(true)}>
                Tentar de novo
              </button>
            </>
          ) : loading ? (
            'Carregando…'
          ) : null}
        </p>
      )}
    </Window>
  );
}

function ProfileEditor({ profile, saving, onEditAvatar, onChangePassword }: { profile: ProfileView; saving: boolean; onEditAvatar(): void; onChangePassword(): void }) {
  const world = useWorld();
  const ids = useId();
  const [form, setForm] = useState<ProfileForm>(() => formFromProfile(profile));
  const [serverError, setServerError] = useState<{ field: keyof FormErrors | null; message: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const me = world.roster.find((p) => p.id === world.youId);
  const errors = useMemo(() => validateForm(form, profile, now), [form, profile, now]);
  const dirty = isDirty(form, profile);
  const hasErrors = Object.keys(errors).length > 0;
  const cooldown = nameCooldownText(profile.nameChangeAt, now);
  const hasBirthday = form.bdayDay !== '' && form.bdayMonth !== '';

  const set = (patch: Partial<ProfileForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setSaved(false);
    setServerError(null);
  };
  const setPref = <K extends keyof ProfilePrefs>(k: K, v: ProfilePrefs[K]) => set({ prefs: { ...form.prefs, [k]: v } });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving || !dirty || hasErrors) return;
    const res = await profileStore.save(buildPatch(form, profile));
    if (res.ok) setSaved(true);
    else setServerError({ field: res.field, message: res.message });
  };

  const err = (field: keyof FormErrors) => (serverError?.field === field ? serverError.message : errors[field]);
  const generalError = serverError && !serverError.field ? serverError.message : '';

  // previa ao vivo: o cracha como ficara depois de salvar
  const previewName = form.displayName.trim() || profile.displayName;
  const bdayNow = hasBirthday && form.birthdayVisible && isBirthdayToday({ m: Number(form.bdayMonth), d: Number(form.bdayDay) }, now, form.prefs.tz);
  const pron = PRONOUN_OPTIONS.find((o) => o.id === form.pronouns)?.label;
  const tzList = (COMMON_TIMEZONES as readonly string[]).includes(form.prefs.tz) ? [...COMMON_TIMEZONES] : [form.prefs.tz, ...COMMON_TIMEZONES];

  return (
    <form className="pf" onSubmit={(e) => void submit(e)} noValidate data-testid="profile-form">
      <div className="pf-preview" aria-label="Prévia da sua ficha de crachá">
        {me ? (
          <BadgeCard compact name={previewName} avatar={me.avatar} title={profile.title} dept={profile.dept} deptColor={me.deptColor} staff={me.staff} about={form.about.trim()} pronouns={pron} birthday={bdayNow} />
        ) : null}
        <p className="pf-hint">Prévia da sua ficha. É assim que a equipe vai ver você depois de salvar.</p>
        <div className="pf-shortcuts">
          <button type="button" className="mini" onClick={onEditAvatar} data-testid="profile-edit-avatar">
            <Icon name="shirt" size={13} /> Editar visual do avatar
          </button>
          <button type="button" className="mini" onClick={onChangePassword} data-testid="profile-change-password">
            <Icon name="key" size={13} /> Alterar senha
          </button>
        </div>
      </div>

      <div className="pf-fields">
        <fieldset>
          <legend>Identidade</legend>
          <div className="pf-field">
            <label htmlFor={`${ids}-name`}>Nome de exibição</label>
            <input id={`${ids}-name`} value={form.displayName} maxLength={MAX_NAME_LENGTH + 4} onChange={(e) => set({ displayName: e.target.value })} autoComplete="nickname" aria-invalid={!!err('displayName')} aria-describedby={`${ids}-name-h`} data-testid="profile-name" />
            <small id={`${ids}-name-h`} className={err('displayName') ? 'pf-err' : ''} role={err('displayName') ? 'alert' : undefined} data-testid="profile-name-msg">
              {err('displayName') || (cooldown ? cooldown : `Pode ser trocado 1 vez a cada ${profile.nameCooldownHours} h. A mudança vale na hora para todos.`)}
            </small>
          </div>
          <div className="pf-field">
            <label htmlFor={`${ids}-about`}>Sobre mim (opcional)</label>
            <input id={`${ids}-about`} value={form.about} onChange={(e) => set({ about: e.target.value })} placeholder="Ex.: Café, código e gatos" aria-invalid={!!err('about')} aria-describedby={`${ids}-about-h`} data-testid="profile-about" />
            <small id={`${ids}-about-h`} className={err('about') ? 'pf-err' : ''} role={err('about') ? 'alert' : undefined}>
              {err('about') || `${[...form.about].length}/${MAX_ABOUT_LENGTH} · aparece na ficha e na lista de pessoas`}
            </small>
          </div>
          <div className="pf-field">
            <label htmlFor={`${ids}-pron`}>Pronomes (opcional)</label>
            <select id={`${ids}-pron`} value={form.pronouns} onChange={(e) => set({ pronouns: e.target.value as ProfileForm['pronouns'] })} data-testid="profile-pronouns">
              <option value="">Não informar</option>
              {PRONOUN_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <small>Aparecem só na ficha, para quem é da sua organização.</small>
          </div>
        </fieldset>

        <fieldset>
          <legend>Aniversário (opcional)</legend>
          <div className="pf-row">
            <div className="pf-field">
              <label htmlFor={`${ids}-bd`}>Dia</label>
              <select id={`${ids}-bd`} value={form.bdayDay} onChange={(e) => set({ bdayDay: e.target.value })} aria-invalid={!!err('birthday')} data-testid="profile-bday-day">
                <option value="">—</option>
                {DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="pf-field">
              <label htmlFor={`${ids}-bm`}>Mês</label>
              <select id={`${ids}-bm`} value={form.bdayMonth} onChange={(e) => set({ bdayMonth: e.target.value })} aria-invalid={!!err('birthday')} data-testid="profile-bday-month">
                <option value="">—</option>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            {hasBirthday && (
              <button type="button" className="mini" onClick={() => set({ bdayDay: '', bdayMonth: '', birthdayVisible: false, birthdayChat: false })}>
                Remover
              </button>
            )}
          </div>
          {err('birthday') && (
            <small className="pf-err" role="alert">
              {err('birthday')}
            </small>
          )}
          <Check checked={form.birthdayVisible && hasBirthday} disabled={!hasBirthday} onChange={(v) => set({ birthdayVisible: v })} hint="Sem o ano. Só no dia do aniversário." testid="profile-bday-visible">
            Mostrar um ícone de bolo na minha ficha no dia
          </Check>
          <Check checked={form.birthdayChat && hasBirthday} disabled={!hasBirthday} onChange={(v) => set({ birthdayChat: v })} hint="Uma mensagem do sistema na sala em que eu estiver, uma vez no dia." testid="profile-bday-chat">
            Permitir uma mensagem de parabéns no chat
          </Check>
        </fieldset>

        <fieldset>
          <legend>Preferências</legend>
          <div className="pf-row">
            <div className="pf-field">
              <label htmlFor={`${ids}-tz`}>Fuso horário</label>
              <select id={`${ids}-tz`} value={form.prefs.tz} onChange={(e) => setPref('tz', e.target.value)} data-testid="profile-tz">
                {tzList.map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
              <small>Agora aí: {clockIn(form.prefs.tz, now) || '—'}</small>
            </div>
            <div className="pf-field">
              <label htmlFor={`${ids}-lang`}>Idioma</label>
              <select id={`${ids}-lang`} value={form.prefs.lang} onChange={(e) => setPref('lang', e.target.value as ProfilePrefs['lang'])} disabled={LANGUAGES.length < 2}>
                {LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Check checked={form.prefs.sound} onChange={(v) => setPref('sound', v)} testid="profile-pref-sound">
            Sons de notificação
          </Check>
          <Check checked={form.prefs.mentions} onChange={(v) => setPref('mentions', v)}>
            Avisar quando mencionarem meu nome
          </Check>
          <Check checked={form.prefs.eventDecor} onChange={(v) => setPref('eventDecor', v)} hint="Enfeites das datas comemorativas no escritório." testid="profile-pref-decor">
            Decoração de eventos
          </Check>
          <Check checked={form.prefs.dataSaver} onChange={(v) => setPref('dataSaver', v)} hint="Câmera em resolução menor." testid="profile-pref-datasaver">
            Modo economia de dados (áudio e vídeo)
          </Check>
          <Check checked={form.prefs.showWorking} onChange={(v) => setPref('showWorking', v)} hint="Desligado, os colegas me veem parado em vez de trabalhando." testid="profile-pref-working">
            Mostrar que estou trabalhando
          </Check>
        </fieldset>

        <fieldset className="pf-readonly">
          <legend>Conta (somente leitura)</legend>
          <dl>
            <dt>E-mail</dt>
            <dd data-testid="profile-email">{profile.email}</dd>
            <dt>Cargo</dt>
            <dd>{profile.title ?? 'Não definido'}</dd>
            <dt>Setor</dt>
            <dd>{profile.dept ?? 'Não definido'}</dd>
          </dl>
          <small>E-mail, cargo, setor e nível de acesso são definidos pela staff ou pela administração da organização. Peça a elas para alterar.</small>
        </fieldset>

        <div className="pf-actions" role="group" aria-label="Ações do perfil">
          {generalError && (
            <p className="pf-err" role="alert">
              {generalError}
            </p>
          )}
          {saved && !dirty && (
            <p className="pf-ok" role="status" data-testid="profile-saved">
              Perfil salvo.
            </p>
          )}
          <button type="submit" className="btn btn-primary" disabled={!dirty || hasErrors || saving} data-testid="profile-save">
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!dirty || saving}
            onClick={() => {
              setForm(formFromProfile(profile));
              setServerError(null);
              setSaved(false);
            }}
            data-testid="profile-undo"
          >
            Desfazer
          </button>
          <button type="button" className="btn" onClick={() => profileStore.close()}>
            Fechar
          </button>
        </div>
      </div>
    </form>
  );
}
