/**
 * Cargos e setores. SETOR = a equipe (team) da organizacao: nome + cor de uma paleta fixa. CARGO = texto curto por pessoa e
 * por organizacao (campo `title` do vinculo). So quem administra (staff da plataforma, admin/dono da org) define; a pessoa
 * comum nao muda o proprio cargo. Tudo aqui e puro (sem I/O): o servidor valida com estas funcoes e o cliente so as usa para
 * desenhar. Tambem guarda o contrato do diretorio da recepcao (`dir_search` / `dir_result`).
 */
import type { AvatarConfig } from './avatar';
import type { TeamView } from './rbac';
import type { StaffLevel } from './staff';

export const MAX_TITLE_LENGTH = 32;
export const MIN_DEPT_NAME = 2;
export const MAX_DEPT_NAME = 24;
/** Resultados por busca no diretorio. */
export const DIR_MAX_RESULTS = 20;
export const MAX_DIR_QUERY = 32;

export interface DeptColor {
  id: string;
  name: string;
  /** Cor de fundo da etiqueta (#rrggbb). */
  color: string;
}

/** Paleta fixa de cores de setor (todas legiveis com texto escuro ou claro, ver `badgeTextColor`). */
export const DEPT_PALETTE: readonly DeptColor[] = [
  { id: 'azul', name: 'Azul', color: '#6c8cff' },
  { id: 'verde', name: 'Verde', color: '#3fb67a' },
  { id: 'laranja', name: 'Laranja', color: '#f0883e' },
  { id: 'rosa', name: 'Rosa', color: '#e8608f' },
  { id: 'roxo', name: 'Roxo', color: '#9b72e0' },
  { id: 'turquesa', name: 'Turquesa', color: '#2fb8c4' },
  { id: 'amarelo', name: 'Amarelo', color: '#e6c52e' },
  { id: 'vermelho', name: 'Vermelho', color: '#d9534f' },
  { id: 'cinza', name: 'Cinza', color: '#7d879c' },
  { id: 'marrom', name: 'Marrom', color: '#a87a54' },
];
export const DEFAULT_DEPT_COLOR = DEPT_PALETTE[0]!.color;
export const isDeptColor = (v: unknown): v is string => typeof v === 'string' && DEPT_PALETTE.some((c) => c.color === v.toLowerCase());
/** Cor para desenhar: a propria quando valida (inclusive cores antigas de equipes), senao a padrao. */
export const safeDeptColor = (v: unknown): string => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : DEFAULT_DEPT_COLOR);

/** Escuro ou claro, conforme a luminancia do fundo (contraste do texto da etiqueta). */
export function badgeTextColor(bg: string): '#1d1a24' | '#ffffff' {
  const hex = safeDeptColor(bg).slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return lum > 0.3 ? '#1d1a24' : '#ffffff';
}

/** Controle, zero-width e sobrescrita bidi: nunca permitidos em texto de outras pessoas (chat, cargo, setor). */
export function isForbiddenChar(code: number): boolean {
  return (
    code < 32 ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x061c ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    code === 0xfeff
  );
}

/** Letras, numeros, espaco e uma pontuacao curta de cargo (`Dev. Sênior / Backend`, `Analista (Jr)`). Sem emoji. */
const LABEL_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} .,_&'()/+\-ºª]*$/u;

/**
 * Normaliza um texto curto (cargo ou nome de setor). Devolve `null` quando e invalido (nao e texto, tem caractere proibido,
 * passa de `max`, abaixo de `min` ou fora do padrao) e `''` para vazio quando `min` e 0. Nunca "conserta" em silencio um
 * caractere de controle: quem manda texto com ele recebe erro.
 */
export function cleanLabel(raw: unknown, max: number, min = 0): string | null {
  if (typeof raw !== 'string' || raw.length > max * 4) return null;
  for (const ch of raw) if (isForbiddenChar(ch.codePointAt(0)!)) return null;
  const s = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (s.length > max) return null;
  if (s.length === 0) return min === 0 ? '' : null;
  if (s.length < min) return null;
  if (!LABEL_PATTERN.test(s)) return null;
  return s;
}

export const cleanTitle = (raw: unknown): string | null => cleanLabel(raw, MAX_TITLE_LENGTH);
export const cleanDeptName = (raw: unknown): string | null => cleanLabel(raw, MAX_DEPT_NAME, MIN_DEPT_NAME);

/** Comparacao de busca: sem acento, sem caixa. */
export const foldText = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** A equipe padrao ("Geral") significa "sem setor": nao ganha etiqueta nem botao no diretorio. */
export const isGeneralDept = (team: { id: string; name: string } | null | undefined): boolean =>
  !team || team.id === 'default-geral' || foldText(team.name) === 'geral';

/** Texto da etiqueta sobre o avatar: `TI · Dev Sênior`, ou so um dos dois, ou '' quando nao ha nada. */
export function badgeLabel(dept: string | undefined, title: string | undefined, maxChars = 30): string {
  const text = dept && title ? `${dept} · ${title}` : (title ?? dept ?? '');
  return fitText(text, maxChars);
}

/** Setor abreviado para a pilula minuscula sobre o avatar: ate `max` caracteres (`Financeiro` -> `Financ.`). */
export function deptShort(dept: string | undefined, max = 7): string {
  if (!dept) return '';
  const chars = [...dept.trim()];
  if (chars.length <= max) return chars.join('');
  return `${chars.slice(0, max - 1).join('')}.`;
}

/** Corta com reticencias para caber em `max` caracteres. */
export function fitText(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, Math.max(1, max - 1)).join('').trimEnd()}…`;
}

/** Tamanho (pixels de tela, pares) da etiqueta de cargo para um texto de `tw x th` pixels. */
export function tagBox(tw: number, th: number): { w: number; h: number } {
  return { w: Math.ceil(tw / 2) * 2 + 10, h: Math.ceil(th / 2) * 2 + 4 };
}

/** O que descreve a pessoa no mundo (copiado em PlayerView e na mensagem `profile`). */
export interface ProfileTag {
  title?: string;
  dept?: string;
  deptColor?: string;
}

// ---- diretorio da recepcao ------------------------------------------------------------------------------

export interface DirEntry {
  /** Nome de exibicao (o mesmo usado em mensagens privadas e convites). */
  name: string;
  title?: string;
  dept?: string;
  deptColor?: string;
  /** "Sobre mim" curto (opcional; so membros da organizacao veem). */
  about?: string;
  online: boolean;
  /** Aparencia (a mesma que todo mundo ve na sala): a foto do cracha e a cabeca dela. */
  avatar?: AvatarConfig;
  /** Selo de staff: so de quem esta em servico (o servidor decide). */
  staff?: StaffLevel;
  /** Sala em que esta (so quando online e acessivel a quem pergunta). */
  roomId?: string;
  roomName?: string;
  /** Online, mas em sala que quem pergunta nao pode ver/entrar: a UI diz "em uma sala privada". */
  roomHidden?: boolean;
  you?: boolean;
}

export interface DirResult {
  /** Setores da organizacao (sem o "Geral"). */
  depts: TeamView[];
  dept: string | null;
  q: string;
  results: DirEntry[];
  /** Havia mais pessoas do que `DIR_MAX_RESULTS`. */
  truncated: boolean;
}
