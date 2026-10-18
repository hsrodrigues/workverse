import { useState, type FormEvent } from 'react';
import { MAX_NAME_LENGTH, MAX_PASSWORD_LENGTH, MIN_NAME_LENGTH, MIN_PASSWORD_LENGTH, NAME_PATTERN } from '@workverse/shared';
import './auth.css';

type Mode = 'login' | 'register';

interface Props {
  busy: boolean;
  error: string;
  onLogin(email: string, password: string): void;
  onRegister(email: string, password: string, displayName: string, inviteToken?: string): void;
  /** REGISTRATION_MODE do servidor: invite mostra o campo de convite; closed esconde "Criar conta". */
  registration?: 'open' | 'invite' | 'closed';
  /** Convite vindo do link (/invite/CODIGO). */
  inviteFromUrl?: string;
  /** Called when switching tabs so the parent can clear a stale error. */
  onModeChange?(): void;
}

/** Same normalisation the server applies before validating a display name. */
function cleanName(raw: string): string {
  return raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function Login({ busy, error, onLogin, onRegister, onModeChange, registration = 'open', inviteFromUrl = '' }: Props) {
  const closed = registration === 'closed';
  const needsInvite = registration === 'invite';
  const [mode, setMode] = useState<Mode>(inviteFromUrl && !closed ? 'register' : 'login');
  const [invite, setInvite] = useState(inviteFromUrl);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);

  const register = mode === 'register' && !closed;
  const cleaned = cleanName(name);
  const nameOk = cleaned.length >= MIN_NAME_LENGTH && cleaned.length <= MAX_NAME_LENGTH && NAME_PATTERN.test(cleaned);
  const pwLen = [...password].length;
  const pwLongEnough = pwLen >= MIN_PASSWORD_LENGTH;
  const pwNotTooLong = pwLen <= MAX_PASSWORD_LENGTH;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const inviteOk = !needsInvite || invite.trim().length >= 16;
  const valid = register ? emailOk && pwLongEnough && pwNotTooLong && nameOk && inviteOk : email.trim() !== '' && password !== '';

  const switchMode = (m: Mode) => {
    if (m === mode) return;
    setMode(m);
    setTouched(false);
    onModeChange?.();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (busy || !valid) return;
    if (register) onRegister(email.trim(), password, cleaned, invite.trim() || undefined);
    else onLogin(email.trim(), password);
  };

  return (
    <div className="login">
      <div className="login-tiles" aria-hidden />
      <form className="win login-card" onSubmit={submit} noValidate>
        <div className="win-title">Bem-vindo</div>
        <div className="win-body">
          <h1 className="logo">
            Work<span>Verse</span>
          </h1>
          <p className="tagline">O escritório virtual em pixel art. Entre, ande pela sala e converse com o time.</p>

          <div className="auth-tabs" role="tablist" aria-label="Acesso" style={closed ? { display: 'none' } : undefined}>
            <button type="button" role="tab" aria-selected={!register} className={`tab${!register ? ' on' : ''}`} onClick={() => switchMode('login')}>
              Entrar
            </button>
            {!closed && (
              <button type="button" role="tab" aria-selected={register} className={`tab${register ? ' on' : ''}`} onClick={() => switchMode('register')}>
                Criar conta
              </button>
            )}
          </div>

          <label className="field">
            <span>E-mail</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              autoFocus
              value={email}
              maxLength={254}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@empresa.com"
              spellCheck={false}
              required
            />
          </label>

          {register && (
            <label className="field">
              <span>Nome de exibição</span>
              <input
                name="displayName"
                autoComplete="nickname"
                value={name}
                maxLength={MAX_NAME_LENGTH * 2}
                onChange={(e) => setName(e.target.value)}
                placeholder="ex.: Ana"
                spellCheck={false}
                aria-describedby="name-rules"
                required
              />
              <small id="name-rules" className={`rule${name === '' ? '' : nameOk ? ' ok' : ' bad'}`}>
                {nameOk ? '✓' : '•'} {MIN_NAME_LENGTH} a {MAX_NAME_LENGTH} letras, números, espaço, _ ou -
              </small>
            </label>
          )}

          {register && (needsInvite || invite !== '') && (
            <label className="field">
              <span>Código de convite</span>
              <input
                name="invite"
                value={invite}
                maxLength={64}
                onChange={(e) => setInvite(e.target.value)}
                placeholder="cole o código ou o final do link"
                spellCheck={false}
                autoComplete="off"
                required={needsInvite}
              />
              <small className={`rule${invite === '' ? '' : inviteOk ? ' ok' : ' bad'}`}>
                {inviteOk && invite !== '' ? '✓' : '•'} O convite vem de quem administra o escritório
              </small>
            </label>
          )}

          <label className="field">
            <span>Senha</span>
            <input
              type="password"
              name="password"
              autoComplete={register ? 'new-password' : 'current-password'}
              value={password}
              maxLength={MAX_PASSWORD_LENGTH + 32}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby={register ? 'pw-rules' : undefined}
              required
            />
            {register && (
              <small id="pw-rules" className={`rule${password === '' ? '' : pwLongEnough && pwNotTooLong ? ' ok' : ' bad'}`}>
                {pwLongEnough && pwNotTooLong ? '✓' : '•'} Mínimo de {MIN_PASSWORD_LENGTH} caracteres ({pwLen}/{MIN_PASSWORD_LENGTH})
                {!pwNotTooLong && ` — máximo ${MAX_PASSWORD_LENGTH}`}
              </small>
            )}
          </label>

          {touched && !valid && !error && (
            <p className="form-error" role="alert">
              {register ? 'Confira os campos acima.' : 'Informe e-mail e senha.'}
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <button className="btn btn-primary" disabled={busy} aria-busy={busy}>
            {busy ? (register ? 'Criando conta…' : 'Entrando…') : register ? 'Criar conta' : 'Entrar'}
          </button>
          <p className="hint">
            {register
              ? 'Depois de criar a conta você escolhe o visual do seu avatar. Ainda não há recuperação de senha: guarde-a em um gerenciador.'
              : closed
                ? 'Peça a quem administra para criar sua conta.'
                : needsInvite
                  ? 'Ainda não tem conta? Use o link de convite que você recebeu.'
                  : 'Ainda não tem conta? Use a aba "Criar conta".'}
          </p>
        </div>
      </form>
    </div>
  );
}
