import { useCallback, useEffect, useRef, useState } from 'react';
import { randomAvatar, type AccountView, type AvatarConfig, type ServerConfig } from '@workverse/shared';
import { net } from './net';
import { api, ApiError, describeError, setApiDevName } from './api';
import { worldStore } from './worldStore';
import { Login } from './ui/Login';
import { ChangePassword } from './ui/ChangePassword';
import { AvatarEditor } from './ui/AvatarEditor';
import { GameView } from './ui/GameView';
import { Hud } from './ui/Hud';
import { MediaLayer } from './ui/MediaLayer';
import type { WorldScene } from './game/WorldScene';

type Phase = 'boot' | 'login' | 'password' | 'editor' | 'world';

/** Codigo de convite vindo do link (/invite/CODIGO ou ?invite=CODIGO). */
function inviteFromUrl(): string {
  const m = /^\/invite\/([A-Za-z0-9_-]{16,64})\/?$/.exec(location.pathname);
  return m?.[1] ?? new URLSearchParams(location.search).get('invite') ?? '';
}

export function App() {
  const [phase, setPhase] = useState<Phase>('boot');
  const [avatar, setAvatar] = useState<AvatarConfig>(() => randomAvatar());
  const [editing, setEditing] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [registration, setRegistration] = useState<NonNullable<ServerConfig['registration']>>('closed');
  const sceneRef = useRef<WorldScene | null>(null);
  const booted = useRef(false);
  /** Name used for the name-only hello; set only when the server allows dev login (?name=). */
  const devName = useRef<string | undefined>(undefined);

  /** Opens the WebSocket for the current session (cookie) and moves to the editor or the world. */
  const enter = useCallback(async (opts: { forceEditor?: boolean; skipEditor?: boolean } = {}) => {
    setBusy(true);
    setError('');
    try {
      const session = await net.connect(devName.current);
      setAvatar(session.avatar);
      setPhase((session.isNew || opts.forceEditor) && !opts.skipEditor ? 'editor' : 'world');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível conectar.');
      setPhase('login');
    } finally {
      setBusy(false);
    }
  }, []);

  const resetToLogin = useCallback((message = '') => {
    net.disconnect();
    worldStore.reset();
    sceneRef.current = null;
    setEditing(false);
    setError(message);
    setPhase('login');
  }, []);

  // On load: read the server config and check for an existing session cookie.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      const config = await api.config().catch(() => ({ devLogin: false }) as ServerConfig);
      setRegistration(config.registration ?? 'closed');
      // Dev/testing shortcut: ?name=Ana opens straight into the world (only when the server allows it).
      const q = new URLSearchParams(location.search).get('name');
      if (config.devLogin && q) {
        devName.current = q;
        setApiDevName(q);
        await enter({ skipEditor: true });
        return;
      }
      try {
        const me = await api.me();
        // Conta criada pela staff com senha provisoria: a troca vem antes de qualquer outra coisa.
        if (me.mustChangePassword) {
          setPhase('password');
          return;
        }
      } catch (err) {
        setError(err instanceof ApiError && err.status === 401 ? '' : describeError(err));
        setPhase('login');
        return;
      }
      await enter();
    })();
  }, [enter]);

  // The server dropped our session (expired, logged out elsewhere): back to the login screen.
  useEffect(
    () =>
      net.onStatus(() => {
        if (net.status === 'unauthenticated') resetToLogin('Sua sessão expirou. Entre novamente.');
      }),
    [resetToLogin],
  );

  const authenticate = async (action: () => Promise<unknown>, isRegistration: boolean) => {
    setBusy(true);
    setError('');
    let account: AccountView | undefined;
    try {
      account = (await action()) as AccountView | undefined;
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
      return;
    }
    setBusy(false);
    if (account?.mustChangePassword) {
      setPhase('password');
      return;
    }
    await enter({ forceEditor: isRegistration });
  };

  const saveAvatar = (a: AvatarConfig) => {
    setAvatar(a);
    // The editor already saved it on the server (avatar_save); the room is told by the server.
    if (phase === 'editor') setPhase('world');
    setEditing(false);
  };

  const leave = () => {
    void api.logout().catch(() => undefined);
    resetToLogin();
  };

  if (phase === 'boot') return null;
  if (phase === 'login') {
    return (
      <Login
        busy={busy}
        error={error}
        onModeChange={() => setError('')}
        onLogin={(email, password) => void authenticate(() => api.login(email, password), false)}
        registration={registration}
        inviteFromUrl={inviteFromUrl()}
        onRegister={(email, password, name, invite) => void authenticate(() => api.register(email, password, name, invite), true)}
      />
    );
  }
  if (phase === 'password') {
    return <ChangePassword forced onDone={() => void enter({ forceEditor: true })} onLogout={leave} />;
  }
  if (phase === 'editor') {
    return <AvatarEditor initial={avatar} confirmLabel="Entrar no escritório" onConfirm={saveAvatar} />;
  }
  return (
    <>
      <GameView onScene={(s) => (sceneRef.current = s)} />
      <MediaLayer sceneRef={sceneRef} devName={devName.current}>
        <Hud
          onEditAvatar={() => setEditing(true)}
          onChangePassword={() => setChangingPassword(true)}
          onLeave={leave}
          onWalkNear={(id) => sceneRef.current?.walkNear(id)}
          onReconnect={() => void enter({ skipEditor: true })}
        />
      </MediaLayer>
      {changingPassword && (
        <div className="modal">
          <ChangePassword onDone={() => setChangingPassword(false)} onCancel={() => setChangingPassword(false)} />
        </div>
      )}
      {editing && (
        <div className="modal">
          <AvatarEditor initial={avatar} confirmLabel="Salvar" onConfirm={saveAvatar} onCancel={() => setEditing(false)} embedded />
        </div>
      )}
    </>
  );
}
