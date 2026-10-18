/**
 * Lista de origens permitidas com suporte a curinga de subdominio (ex.: https://*.trycloudflare.com).
 *
 * O resto do servidor usa `allowedOrigins.includes(origin)`; esta lista sobrescreve `includes` para aceitar
 * curingas sem mexer em cada rota. O `*` casa exatamente UM rotulo de DNS (letras, numeros, hifen).
 */
const ORIGIN_SHAPE = /^https?:\/\/(\*\.)?[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i;

export function isValidOriginPattern(p: string): boolean {
  if (!ORIGIN_SHAPE.test(p)) return false;
  if (p.includes('*')) {
    // curinga so em https e com dominio de pelo menos dois rotulos depois dele (nada de https://*.com)
    const host = p.replace(/^https:\/\/\*\./i, '');
    return /^https:\/\/\*\./i.test(p) && host.split(':')[0]!.split('.').length >= 2;
  }
  return true;
}

function patternToRegExp(p: string): RegExp {
  const escaped = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('*', '[a-z0-9-]+');
  return new RegExp(`^${escaped}$`, 'i');
}

export class OriginList extends Array<string> {
  private matchers: RegExp[] = [];

  static from_(patterns: string[]): OriginList {
    const list = new OriginList();
    for (const p of patterns) list.push(p);
    list.matchers = patterns.filter((p) => p.includes('*')).map(patternToRegExp);
    return list;
  }

  override includes(origin: string): boolean {
    if (typeof origin !== 'string' || origin.length > 300) return false;
    for (const p of this) if (p === origin) return true;
    return this.matchers.some((re) => re.test(origin));
  }

  // Evita que map/filter/slice tentem construir uma OriginList com argumentos numericos.
  static override get [Symbol.species](): ArrayConstructor {
    return Array;
  }
}

export function makeOriginList(patterns: string[]): string[] {
  return OriginList.from_(patterns);
}
