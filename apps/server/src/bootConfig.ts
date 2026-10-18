import { isValidOriginPattern } from './origins';
import { parseRegistrationMode, type RegistrationMode } from './registration';
import { resolveMediaConfig } from './media';

export interface BootConfig {
  production: boolean;
  port: number;
  host: string;
  allowedOrigins: string[];
  publicUrl: string;
  allowDevLogin: boolean;
  /** Numero de proxies confiaveis a frente (0 = nenhum). */
  trustProxy: number;
  registration: RegistrationMode;
  mediaEnabled: boolean;
  metricsEnabled: boolean;
  usingPostgres: boolean;
  errors: string[];
  warnings: string[];
}

const truthy = (v: string | undefined) => ['1', 'true', 'yes', 'on'].includes((v ?? '').trim().toLowerCase());
const isLocalHost = (h: string) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]';

/**
 * Le e valida o ambiente. Em producao qualquer configuracao insegura vira ERRO (o servidor aborta com mensagem em
 * portugues); o que apenas desliga um recurso vira AVISO. Funcao pura para ser testada.
 */
export function resolveBootConfig(env: NodeJS.ProcessEnv): BootConfig {
  const errors: string[] = [];
  const warnings: string[] = [];
  const production = env.NODE_ENV === 'production';
  const allowDevLogin = truthy(env.ALLOW_DEV_LOGIN);
  const port = Number(env.PORT ?? (production ? 8080 : 3001));
  const host = env.HOST?.trim() || '0.0.0.0';
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push(`PORT invalida: "${env.PORT}". Use um numero de 1 a 65535.`);

  // ---- origens ---------------------------------------------------------------------------------------
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
  let publicUrl = (env.PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  if (publicUrl) {
    try {
      const u = new URL(publicUrl);
      if (u.pathname !== '/' && u.pathname !== '') throw new Error('com caminho');
      publicUrl = u.origin;
      if (production && u.protocol !== 'https:' && !isLocalHost(u.hostname)) {
        errors.push(`PUBLIC_URL (${publicUrl}) precisa ser https:// em producao (o cookie de sessao e Secure e a camera/microfone exigem HTTPS).`);
      }
      if (!allowedOrigins.includes(publicUrl)) allowedOrigins.push(publicUrl);
    } catch {
      errors.push(`PUBLIC_URL invalida: "${env.PUBLIC_URL}". Exemplo: https://escritorio.seudominio.com (sem barra no final nem caminho).`);
      publicUrl = '';
    }
  }
  for (const o of allowedOrigins) {
    if (!isValidOriginPattern(o)) errors.push(`ALLOWED_ORIGINS contem um valor invalido: "${o}". Use origens como https://escritorio.seudominio.com ou https://*.trycloudflare.com.`);
  }

  // ---- proxy ---------------------------------------------------------------------------------------------
  let trustProxy = production ? 1 : 0;
  const tp = (env.TRUST_PROXY ?? '').trim().toLowerCase();
  if (tp !== '') {
    if (tp === 'true') trustProxy = 1;
    else if (tp === 'false') trustProxy = 0;
    else if (/^\d{1,2}$/.test(tp)) trustProxy = Number(tp);
    else errors.push(`TRUST_PROXY invalido: "${env.TRUST_PROXY}". Use 0 (sem proxy) ou o numero de proxies a frente (1 para Cloudflare Tunnel, Railway, Render ou Caddy).`);
  }

  // ---- registro ----------------------------------------------------------------------------------------
  const reg = parseRegistrationMode(env.REGISTRATION_MODE, production);
  let registration: RegistrationMode = 'open';
  if (reg === 'invalid') errors.push(`REGISTRATION_MODE invalido: "${env.REGISTRATION_MODE}". Use open, invite ou closed.`);
  else registration = reg;

  // ---- banco -----------------------------------------------------------------------------------------------
  const usingPostgres = Boolean(env.DATABASE_URL?.trim());

  // ---- midia -----------------------------------------------------------------------------------------------
  const media = resolveMediaConfig(env, production);
  let metricsEnabled = !production || Boolean(env.METRICS_TOKEN?.trim());

  if (production) {
    if (allowDevLogin) {
      errors.push('ALLOW_DEV_LOGIN esta ligado. Esse atalho entra no mundo sem senha e NUNCA pode ser usado em producao. Remova ALLOW_DEV_LOGIN do ambiente.');
    }
    if (allowedOrigins.length === 0) {
      errors.push('Faltou ALLOWED_ORIGINS (ou PUBLIC_URL). Informe o endereco publico do site, por exemplo PUBLIC_URL=https://escritorio.seudominio.com.');
    }
    if (!usingPostgres) {
      if (truthy(env.ALLOW_JSON_STORE) || env.ALLOW_JSON_STORE === '1') {
        warnings.push('Sem DATABASE_URL: contas e sessoes ficam em arquivo JSON (ALLOW_JSON_STORE=1). Em plataformas de nuvem o disco costuma ser efemero e tudo some a cada deploy. Use PostgreSQL (Neon/Supabase) para valer.');
      } else {
        errors.push('Faltou DATABASE_URL (PostgreSQL). Para testar com o arquivo JSON local, defina ALLOW_JSON_STORE=1 (cuidado: discos de plataforma sao efemeros e os dados somem).');
      }
    }
    if (!media.enabled) {
      warnings.push('LiveKit nao configurado (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET): audio, video e tela ficam DESLIGADOS. O resto funciona.');
    } else {
      const u = media.url.toLowerCase();
      if (/^ws:\/\//.test(u) || /^http:\/\//.test(u)) {
        const hostPart = u.replace(/^[a-z]+:\/\//, '').split(/[/:]/)[0]!;
        if (isLocalHost(hostPart)) warnings.push('LiveKit aponta para localhost (ws://): so serve para teste local. Para publicar use o LiveKit Cloud (wss://seu-projeto.livekit.cloud).');
        else errors.push(`A URL do LiveKit (${media.url}) nao e segura. O navegador bloqueia ws:// em pagina https; use wss:// (PUBLIC_LIVEKIT_URL).`);
      } else if (!/^(wss|https):\/\//.test(u)) {
        errors.push(`LIVEKIT_URL/PUBLIC_LIVEKIT_URL invalida: "${media.url}". Use wss://seu-projeto.livekit.cloud.`);
      }
    }
    if (!metricsEnabled) warnings.push('METRICS_TOKEN ausente: o endpoint /metrics fica DESABILITADO (o /health continua funcionando).');
    if (trustProxy === 0) warnings.push('TRUST_PROXY=0: os limites de taxa verao o IP do proxy/tunel, nao o da pessoa. Use TRUST_PROXY=1 atras de Cloudflare/Caddy/Railway/Render.');
    if (host === '0.0.0.0' && trustProxy > 0 && env.TRUST_PROXY_PUBLIC_OK !== '1') {
      warnings.push('Escutando em 0.0.0.0 com TRUST_PROXY ativo: se a porta ficar acessivel direto da internet (sem proxy), alguem pode forjar o IP. Com tunel/Caddy no mesmo PC use HOST=127.0.0.1; em Railway/Render ignore este aviso.');
    }
    if (registration === 'open') warnings.push('REGISTRATION_MODE=open: qualquer pessoa com o link pode criar conta. Prefira invite.');
  }

  return {
    production, port, host, allowedOrigins, publicUrl, allowDevLogin, trustProxy, registration,
    mediaEnabled: media.enabled, metricsEnabled, usingPostgres, errors, warnings,
  };
}
