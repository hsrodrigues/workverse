import { useState, type FormEvent } from 'react';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@workverse/shared';
import { api, describeError } from '../api';
import './auth.css';

interface ForgotProps {
  onBack(): void;
}

/** Passo 1: pede o e-mail. A resposta e sempre a mesma, exista a conta ou nao. */
export function ForgotPassword({ onBack }: ForgotProps) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!emailOk) {
      setError('Informe um e-mail válido.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await api.forgotPassword(email.trim());
      setSent(r.message);
    } catch (err) {
      setError(describeError(err));
    }
    setBusy(false);
  };

  return (
    <div className="login">
      <div className="login-tiles" aria-hidden />
      <form className="win login-card" onSubmit={(e) => void submit(e)} noValidate aria-labelledby="forgot-title">
        <div className="win-title" id="forgot-title">
          Esqueci minha senha
        </div>
        <div className="win-body">
          {sent ? (
            <>
              <p className="hint" role="status" data-testid="forgot-sent">
                {sent}
              </p>
              <p className="hint">Não chegou? Olhe a caixa de spam ou tente de novo em alguns minutos.</p>
              <button type="button" className="btn btn-primary" onClick={onBack} autoFocus>
                Voltar para entrar
              </button>
            </>
          ) : (
            <>
              <p className="tagline">Informe o e-mail da sua conta. Se ela existir, enviaremos um link para criar uma nova senha.</p>
              <label className="field">
                <span>E-mail</span>
                <input type="email" name="email" autoComplete="email" autoFocus value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com" spellCheck={false} required />
              </label>
              {error && (
                <p className="form-error" role="alert" data-testid="forgot-error">
                  {error}
                </p>
              )}
              <button className="btn btn-primary" disabled={busy} aria-busy={busy} data-testid="forgot-submit">
                {busy ? 'Enviando…' : 'Enviar link'}
              </button>
              <p className="hint">
                <button type="button" className="linklike" onClick={onBack}>
                  Voltar para entrar
                </button>
              </p>
            </>
          )}
        </div>
      </form>
    </div>
  );
}

interface ResetProps {
  token: string;
  onDone(): void;
  onRequestNew(): void;
}

/** Passo 2: nova senha, aberta pelo link `?reset=` do e-mail. */
export function ResetPassword({ token, onDone, onRequestNew }: ResetProps) {
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [done, setDone] = useState(false);

  const len = [...next].length;
  const longEnough = len >= MIN_PASSWORD_LENGTH;
  const notTooLong = len <= MAX_PASSWORD_LENGTH;
  const matches = next !== '' && next === again;
  const valid = longEnough && notTooLong && matches;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!valid) {
      setError('Confira os campos acima.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.resetPassword(token, next);
      setDone(true);
    } catch (err) {
      setError(describeError(err));
      const code = (err as { code?: string }).code;
      if (code === 'invalid_token' || code === 'reset_disabled') setInvalid(true);
    }
    setBusy(false);
  };

  return (
    <div className="login">
      <div className="login-tiles" aria-hidden />
      <form className="win login-card" onSubmit={(e) => void submit(e)} noValidate aria-labelledby="reset-title">
        <div className="win-title" id="reset-title">
          Nova senha
        </div>
        <div className="win-body">
          {done ? (
            <>
              <p className="hint" role="status" data-testid="reset-done">
                Senha redefinida. Todas as sessões foram encerradas: entre com a nova senha.
              </p>
              <button type="button" className="btn btn-primary" onClick={onDone} autoFocus>
                Ir para entrar
              </button>
            </>
          ) : invalid ? (
            <>
              <p className="form-error" role="alert" data-testid="reset-error">
                {error}
              </p>
              <button type="button" className="btn btn-primary" onClick={onRequestNew} autoFocus>
                Pedir novo link
              </button>
            </>
          ) : (
            <>
              <p className="tagline">Escolha a nova senha da sua conta.</p>
              <label className="field">
                <span>Nova senha</span>
                <input type="password" name="new" autoComplete="new-password" autoFocus value={next} maxLength={MAX_PASSWORD_LENGTH + 32} onChange={(e) => setNext(e.target.value)} aria-describedby="reset-rules" required />
                <small id="reset-rules" className={`rule${next === '' ? '' : longEnough && notTooLong ? ' ok' : ' bad'}`}>
                  {longEnough && notTooLong ? '✓' : '•'} Mínimo de {MIN_PASSWORD_LENGTH} caracteres ({len}/{MIN_PASSWORD_LENGTH})
                </small>
              </label>
              <label className="field">
                <span>Repita a nova senha</span>
                <input type="password" name="again" autoComplete="new-password" value={again} maxLength={MAX_PASSWORD_LENGTH + 32} onChange={(e) => setAgain(e.target.value)} aria-describedby="reset-match" required />
                <small id="reset-match" className={`rule${again === '' ? '' : matches ? ' ok' : ' bad'}`}>
                  {matches ? '✓' : '•'} As duas senhas precisam ser iguais
                </small>
              </label>
              {error && (
                <p className="form-error" role="alert" data-testid="reset-error">
                  {error}
                </p>
              )}
              <button className="btn btn-primary" disabled={busy} aria-busy={busy} data-testid="reset-submit">
                {busy ? 'Salvando…' : 'Redefinir senha'}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
