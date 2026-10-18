import { useCallback, useEffect, useRef, useState } from 'react';
import type { PresentationStatus } from '@workverse/shared';
import {
  ConnectorClient,
  ConnectorError,
  normalizeConnectorUrl,
  pairWithConnector,
  saveToken,
  saveUrl,
  savedToken,
  savedUrl,
} from './connectorClient';

export type Phase = 'off' | 'connecting' | 'on';

export interface PowerPointConnection {
  phase: Phase;
  /** Last status read from the connector. */
  status: PresentationStatus | null;
  /** The connector stopped answering (closed?); polling keeps trying. */
  offline: boolean;
  error: string;
  url: string;
  client: ConnectorClient | null;
  connect(code: string, url?: string): Promise<boolean>;
  disconnect(): void;
  /** Runs a command in order with the others and applies the status it returns. */
  run(fn: (c: ConnectorClient) => Promise<PresentationStatus | void>): Promise<boolean>;
  /** Milliseconds since the last command this panel sent (the sync with the deck waits for it to settle). */
  sinceLastCommand(): number;
  clearError(): void;
}

export function usePowerPoint(): PowerPointConnection {
  const [phase, setPhase] = useState<Phase>(() => (savedToken() ? 'connecting' : 'off'));
  const [status, setStatus] = useState<PresentationStatus | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState('');
  const [url, setUrl] = useState(savedUrl);
  const clientRef = useRef<ConnectorClient | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const lastCmd = useRef(0);

  const drop = useCallback((message: string) => {
    saveToken(null);
    clientRef.current = null;
    setStatus(null);
    setOffline(false);
    setPhase('off');
    setError(message);
  }, []);

  // Restore a saved session (same browser tab only).
  useEffect(() => {
    const token = savedToken();
    if (!token || clientRef.current) return;
    const c = new ConnectorClient(savedUrl(), token);
    c.status().then(
      (s) => {
        clientRef.current = c;
        setStatus(s);
        setPhase('on');
      },
      (e) => {
        if (e instanceof ConnectorError && e.code === 'unauthorized') drop('A sessão com o conector expirou. Pareie de novo com o código.');
        else drop(e instanceof ConnectorError ? e.message : 'Não foi possível falar com o conector.');
      },
    );
  }, [drop]);

  // Poll the status while connected (fast while a show runs).
  useEffect(() => {
    if (phase !== 'on') return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const c = clientRef.current;
      if (!c || stopped) return;
      let delay = 1000;
      try {
        const s = await c.status();
        if (stopped) return;
        setStatus(s);
        setOffline(false);
        if (!s.show) delay = 1500;
      } catch (e) {
        if (stopped) return;
        if (e instanceof ConnectorError && e.code === 'unauthorized') return drop('A sessão com o conector expirou. Pareie de novo com o código.');
        setOffline(true);
        delay = 3000;
      }
      if (document.hidden) delay = Math.max(delay, 3000);
      timer = setTimeout(() => void tick(), delay);
    };
    timer = setTimeout(() => void tick(), 1000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [phase, drop]);

  const connect = useCallback(async (code: string, rawUrl?: string) => {
    setError('');
    const base = normalizeConnectorUrl(rawUrl ?? savedUrl());
    if (!base) {
      setError('Endereço do conector inválido. Use 127.0.0.1 ou localhost.');
      return false;
    }
    if (code.replace(/\D/g, '').length !== 6) {
      setError('Digite o código de 6 dígitos mostrado na janela do conector.');
      return false;
    }
    setPhase('connecting');
    try {
      const token = await pairWithConnector(base, code);
      const c = new ConnectorClient(base, token);
      const s = await c.status();
      saveToken(token);
      saveUrl(base);
      setUrl(base);
      clientRef.current = c;
      setStatus(s);
      setOffline(false);
      setPhase('on');
      return true;
    } catch (e) {
      setPhase('off');
      setError(e instanceof ConnectorError ? e.message : 'Não foi possível conectar.');
      return false;
    }
  }, []);

  const disconnect = useCallback(() => {
    saveToken(null);
    clientRef.current = null;
    setStatus(null);
    setOffline(false);
    setError('');
    setPhase('off');
  }, []);

  const run = useCallback(
    (fn: (c: ConnectorClient) => Promise<PresentationStatus | void>) => {
      const c = clientRef.current;
      if (!c) return Promise.resolve(false);
      lastCmd.current = Date.now();
      const job = queue.current.then(async () => {
        try {
          const s = await fn(c);
          if (s) setStatus(s);
          setOffline(false);
          return true;
        } catch (e) {
          if (e instanceof ConnectorError && e.code === 'unauthorized') drop('A sessão com o conector expirou. Pareie de novo com o código.');
          else setError(e instanceof ConnectorError ? e.message : 'Falha ao falar com o conector.');
          return false;
        } finally {
          lastCmd.current = Date.now();
        }
      });
      queue.current = job;
      return job;
    },
    [drop],
  );

  return {
    phase,
    status,
    offline,
    error,
    url,
    client: clientRef.current,
    connect,
    disconnect,
    run,
    sinceLastCommand: () => Date.now() - lastCmd.current,
    clearError: () => setError(''),
  };
}
