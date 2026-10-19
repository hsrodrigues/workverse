import type { AvatarConfig } from './avatar';
import type { Dir8 } from './geometry';

/**
 * Atendente NPC da recepcao. Nao e um jogador: nao existe no servidor (nao conta em populacao, presenca nem listas), e so o
 * cliente a desenha, sentada na cadeira atras do balcao da sala `reception` (ver RECEPTION em rooms.ts). O que ela faz de
 * verdade (buscar colegas) e uma mensagem comum, `dir_search`, validada pelo servidor.
 */
export const RECEPTIONIST = {
  roomId: 'reception',
  name: 'Atendente',
  /** Tile da cadeira atras do balcao (a cadeira e a do layout original da recepcao). */
  x: 10,
  y: 2,
  /** Olha para o balcao (+y, para a camera). */
  dir: 1 as Dir8,
  avatar: {
    v: 2,
    skin: 'peach',
    eyes: { id: 'eyes.lashes', color: 'ink' },
    brows: { id: 'brows.soft' },
    mouth: { id: 'mouth.smile' },
    hair: { id: 'hair.low_bun', color: 'dark-brown' },
    top: { id: 'top.shirt', color: 'white' },
    outer: { id: 'outer.blazer', color: 'navy' },
    bottom: { id: 'bottom.pencil', color: 'slate' },
    shoes: { id: 'shoes.heels', color: 'black' },
    accessories: [{ id: 'acc.headset', color: 'blue' }],
    special: [],
  } satisfies AvatarConfig as AvatarConfig,
} as const;

/** Falas da atendente (pt-BR). */
export const RECEPTIONIST_LINES = {
  greet: 'Olá! Em qual setor você procura alguém?',
  askName: 'Certo! Quer digitar o nome? Posso listar todos do setor também.',
  searching: 'Já vejo isso para você…',
  none: 'Não encontrei ninguém com esse nome nesse setor.',
  noneAny: 'Não encontrei ninguém com esse nome.',
  found: (n: number, truncated: boolean) => (n === 1 ? 'Encontrei uma pessoa:' : truncated ? `Encontrei bastante gente, mostro as ${n} primeiras:` : `Encontrei ${n} pessoas:`),
  slow: 'Calma, estou atendendo bem rápido! Tente de novo em instantes.',
  denied: 'Desculpe, esse serviço não está disponível para visitantes.',
} as const;

/** Fala da atendente conforme o ponto da conversa (pura: testada). */
export function receptionistSay(o: { picked: boolean; busy: boolean; count: number; truncated: boolean; deptChosen: boolean; notice: string | null }): string {
  if (o.notice) return o.notice;
  if (!o.picked) return RECEPTIONIST_LINES.greet;
  if (o.busy) return RECEPTIONIST_LINES.searching;
  if (o.count > 0) return RECEPTIONIST_LINES.found(o.count, o.truncated);
  return o.deptChosen ? RECEPTIONIST_LINES.none : RECEPTIONIST_LINES.noneAny;
}
