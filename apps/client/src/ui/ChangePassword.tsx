import { useState, type FormEvent } from 'react';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@workverse/shared';
import { api, describeError } from '../api';
import './auth.css';

interface Props {
  /** Troca obrigatoria (senha provisoria): tela cheia, sem cancelar; so da para sair da conta. */
  forced?: boolean;
  onDone(): void;
  onCancel?(): void;
  onLogout?(): void;
}

/** Troca de senha: tela depois do login quando a conta tem senha provisoria, e "Alterar senha" no menu do usuario. */
export function ChangePassword({ forced = false, onDone, onCancel, onLogout }: Props) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);
  const [saved, setSaved] = useState(false);

  const len = [...next].length;
  const longEnough = len >= MIN_PASSWORD_LENGTH;
  const notTooLong = len <= MAX_PASSWORD_LENGTH;
  const matches = next !== '' && next === again;
  const different = next !== current;
  const valid = current !== '' && longEnough && notTooLong && matches && different;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (busy || !valid) return;
    setBusy(true);
    setError('');
    try {
      await api.changePassword(current, next);
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
      return;
    }
    setBusy(false);
    if (forced) onDone();
    else setSaved(true);
  };

  const card = (
    <form className="win login-card" onSubmit={(e) => void submit(e)} noValidate aria-labelledby="pw-title">
      <div className="win-title" id="pw-title">
        <span>{forced ? 'Crie sua senha' : 'Alterar senha'}</span>
        {!forced && onCancel && (
          <button type="button" className="x" onClick={onCancel} aria-label="Fechar">
            ×
          </button>
        )}
      </div>
      <div className="win-body">
        {saved ? (
          <>
            <p className="hint" role="status" data-testid="password-saved">
              Senha alterada. Suas outras sessões foram encerradas.
            </p>
            <button type="button" className="btn btn-primary" onClick={onDone} autoFocus>
              Fechar
            </button>
          </>
        ) : (
          <>
            {forced && (
              <p className="tagline" data-testid="password-forced">
                Sua conta foi criada por quem administra o escritório com uma senha provisória. Escolha agora a sua senha para continuar.
              </p>
            )}

            <label className="field">
              <span>{forced ? 'Senha provisória' : 'Senha atual'}</span>
              <input
                type="password"
                name="current"
                autoComplete="current-password"
                autoFocus
                value={current}
                maxLength={MAX_PASSWORD_LENGTH + 32}
                onChange={(e) => setCurrent(e.target.value)}
                required
              />
            </label>

            <label className="field">
              <span>Nova senha</span>
              <input
                type="password"
                name="new"
                autoComplete="new-password"
                value={next}
                maxLength={MAX_PASSWORD_LENGTH + 32}
                onChange={(e) => setNext(e.target.value)}
                aria-describedby="pw-new-rules"
                required
              />
              <small id="pw-new-rules" className={`rule${next === '' ? '' : longEnough && notTooLong && different ? ' ok' : ' bad'}`}>
                {longEnough && notTooLong && different ? '✓' : '•'} Mínimo de {MIN_PASSWORD_LENGTH} caracteres ({len}/{MIN_PASSWORD_LENGTH}); diferente da atual
              </small>
            </label>

            <label className="field">
              <span>Repita a nova senha</span>
              <input
                type="password"
                name="again"
                autoComplete="new-password"
                value={again}
                maxLength={MAX_PASSWORD_LENGTH + 32}
                onChange={(e) => setAgain(e.target.value)}
                aria-describedby="pw-again-rules"
                required
              />
              <small id="pw-again-rules" className={`rule${again === '' ? '' : matches ? ' ok' : ' bad'}`}>
                {matches ? '✓' : '•'} As duas senhas precisam ser iguais
              </small>
            </label>

            {touched && !valid && !error && (
              <p className="form-error" role="alert">
                Confira os campos acima.
              </p>
            )}
            {error && (
              <p className="form-error" role="alert" data-testid="password-error">
                {error}
              </p>
            )}

            <button className="btn btn-primary" disabled={busy} aria-busy={busy} data-testid="password-submit">
              {busy ? 'Salvando…' : forced ? 'Salvar e entrar' : 'Alterar senha'}
            </button>
            {forced && onLogout && (
              <p className="hint">
                <button type="button" className="linklike" onClick={onLogout}>
                  Sair da conta
                </button>
              </p>
            )}
            {!forced && <p className="hint">Ao alterar, as suas outras sessões (outros navegadores) serão encerradas.</p>}
          </>
        )}
      </div>
    </form>
  );

  return forced ? (
    <div className="login">
      <div className="login-tiles" aria-hidden />
      {card}
    </div>
  ) : (
    card
  );
}
