/** Enderecos IPv4: parse, mascara, CIDR. Funcoes puras. */

const OCT = /^(0|[1-9]\d{0,2})$/;

/** `a.b.c.d` -> inteiro de 32 bits sem sinal, ou null. Rejeita zeros a esquerda, espacos e octetos > 255. */
export function parseIp(s: unknown): number | null {
  if (typeof s !== 'string' || s.length > 15) return null;
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!OCT.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}
export const isIp = (s: unknown): boolean => parseIp(s) !== null;
export function ipStr(n: number): string {
  return `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
}

/** Mascara valida (bits 1 contiguos), em ponto-decimal ou `/24`. Devolve o numero de bits ou null. */
export function maskBits(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = /^\/(\d{1,2})$/.exec(s);
  if (m) {
    const b = Number(m[1]);
    return b <= 32 ? b : null;
  }
  const n = parseIp(s);
  if (n === null) return null;
  let bits = 0;
  let i = 31;
  while (i >= 0 && ((n >>> i) & 1) === 1) {
    bits++;
    i--;
  }
  // depois do primeiro 0 nao pode haver 1
  const rest = bits === 32 ? 0 : n & (0xffffffff >>> bits);
  return rest === 0 ? bits : null;
}
export const bitsToMask = (bits: number): string => ipStr(bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0);
/** Normaliza `/24` para `255.255.255.0`; null se invalida. */
export function normMask(s: unknown): string | null {
  const b = maskBits(s);
  return b === null ? null : bitsToMask(b);
}
const maskInt = (bits: number): number => (bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0);

export function networkOf(ip: string, mask: string): number | null {
  const a = parseIp(ip);
  const b = maskBits(mask);
  if (a === null || b === null) return null;
  return (a & maskInt(b)) >>> 0;
}
export function sameSubnet(ipA: string, ipB: string, mask: string): boolean {
  const a = networkOf(ipA, mask);
  const b = networkOf(ipB, mask);
  return a !== null && a === b;
}
export function inNet(ip: string, net: string, mask: string): boolean {
  const n = networkOf(net, mask);
  const i = networkOf(ip, mask);
  return n !== null && n === i;
}
/** Endereco de broadcast/rede (nao usaveis em redes com mais de 2 enderecos). */
export function isNetworkOrBroadcast(ip: string, mask: string): boolean {
  const bits = maskBits(mask);
  const a = parseIp(ip);
  if (bits === null || a === null || bits >= 31) return false;
  const net = (a & maskInt(bits)) >>> 0;
  const bc = (net | (~maskInt(bits) >>> 0)) >>> 0;
  return a === net || a === bc;
}

export function isPrivateIp(ip: string): boolean {
  const a = parseIp(ip);
  if (a === null) return false;
  const o1 = a >>> 24;
  const o2 = (a >>> 16) & 255;
  return o1 === 10 || o1 === 127 || (o1 === 172 && o2 >= 16 && o2 <= 31) || (o1 === 192 && o2 === 168) || (o1 === 169 && o2 === 254);
}

export interface Cidr {
  net: number;
  bits: number;
}
/** `any` -> {0,0}; `1.2.3.4` -> /32; `10.0.0.0/24` -> rede (host bits zerados). */
export function parseCidr(s: unknown): Cidr | null {
  if (typeof s !== 'string') return null;
  if (s === 'any') return { net: 0, bits: 0 };
  const [ip, len, ...extra] = s.split('/');
  if (extra.length > 0) return null;
  const a = parseIp(ip);
  if (a === null) return null;
  let bits = 32;
  if (len !== undefined) {
    if (!/^\d{1,2}$/.test(len)) return null;
    bits = Number(len);
    if (bits > 32) return null;
  }
  return { net: (a & maskInt(bits)) >>> 0, bits };
}
export function cidrHas(c: Cidr, ip: string): boolean {
  const a = parseIp(ip);
  return a !== null && ((a & maskInt(c.bits)) >>> 0) === c.net;
}
export const cidrStr = (c: Cidr): string => (c.bits === 0 ? 'any' : `${ipStr(c.net)}/${c.bits}`);

/** Nome seguro: sem controle, bidi, ZWSP, so letras/digitos/espaco/-_./ */
const SAFE_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u;
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/;
export function safeName(s: unknown, max = 32): string | null {
  if (typeof s !== 'string') return null;
  const t = s.normalize('NFC').trim().replace(/ {2,}/g, ' ');
  if (t.length < 1 || t.length > max || BAD_CHARS.test(t) || !SAFE_NAME.test(t)) return null;
  return t;
}
/** Dominio simulado: `exemplo.sim`, minusculo, rotulos [a-z0-9-]. */
export function safeDomain(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim().toLowerCase();
  if (t.length < 3 || t.length > 63 || !/^([a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?\.)+[a-z]{2,10}$/.test(t)) return null;
  return t;
}
