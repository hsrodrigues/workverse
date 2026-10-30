import type { Furniture, Portal, RoomDef } from './rooms';

/**
 * Salas do "Hall 2": o corredor secundario e as nove salas que saem dele (Treinamento, RH, Diretoria, Laboratorio, Refeitorio,
 * Jogos, Terraco, Biblioteca e Estudio). A recepcao tem poucas paredes livres, entao ela ganha UMA porta (oeste, y = 1) para o
 * corredor, e o corredor concentra as nove portas na parede norte (x = 2, 4, ... 18), cada uma com a chegada logo abaixo (x, 1).
 * Cada sala devolve ao corredor pela porta da parede oeste, no mesmo y do spawn.
 *
 * Este modulo nao importa nada de `rooms.ts` em tempo de execucao (so tipos): `rooms.ts` o chama passando os ajudantes de id.
 */
export interface RoomKit {
  rect: (w: number, h: number) => string[];
}

/** Ids estaveis POR SALA (`sala-prefixoN`): mexer numa sala nunca muda os ids das outras. */
const idMaker = (room: string) => {
  let n = 0;
  return (prefix: string) => `${room}-${prefix}${++n}`;
};

/** Ordem das portas da parede norte do Hall 2 (x = 2 + 2 * indice). */
export const HALL2_DOORS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'training', label: 'Sala de Treinamento' },
  { id: 'rh', label: 'RH / Atendimento' },
  { id: 'board', label: 'Diretoria' },
  { id: 'lab', label: 'Laboratório / Dev' },
  { id: 'cafeteria', label: 'Refeitório' },
  { id: 'games', label: 'Sala de Jogos' },
  { id: 'terrace', label: 'Terraço' },
  { id: 'library', label: 'Biblioteca / Silenciosa' },
  { id: 'studio', label: 'Estúdio / Podcast' },
];
const doorX = (id: string): number => 2 + 2 * HALL2_DOORS.findIndex((d) => d.id === id);

/** Porta de volta ao corredor: parede oeste da sala, chegando ao tile abaixo da porta da sala no Hall 2. */
const backToHall = (roomId: string, y: number): Portal => ({ x: 0, y, toRoom: 'hall2', toX: doorX(roomId), toY: 1, label: 'Corredor / Hall 2' });

export function buildExtraRooms(k: RoomKit): { hall2: RoomDef; rooms: RoomDef[] } {
  const { rect } = k;
  let fid = idMaker('hall2');
  /** Cadeiras em volta de uma mesa cujo canto superior esquerdo e (x, y) e que ocupa w x h tiles; todas olham para a mesa. */
  const chairsAround = (x: number, y: number, w: number, h: number): Furniture[] => {
    const out: Furniture[] = [];
    for (let i = 0; i < w; i++) {
      out.push({ id: fid('chair'), kind: 'chair', x: x + i, y: y - 1, dir: 1 });
      out.push({ id: fid('chair'), kind: 'chair', x: x + i, y: y + h, dir: 3 });
    }
    for (let j = 0; j < h; j++) {
      out.push({ id: fid('chair'), kind: 'chair', x: x - 1, y: y + j, dir: 0 });
      out.push({ id: fid('chair'), kind: 'chair', x: x + w, y: y + j, dir: 2 });
    }
    return out;
  };

  const hall2: RoomDef = {
    id: 'hall2',
    type: 'hall',
    access: 'org',
    name: 'Corredor / Hall 2',
    description: 'Corredor secundário: as portas do Treinamento, RH, Diretoria, Laboratório, Refeitório, Jogos, Terraço, Biblioteca e Estúdio.',
    tiles: rect(20, 7),
    spawn: { x: 1, y: 3, dir: 0 },
    maxPlayers: 30,
    portals: [
      { x: 0, y: 2, toRoom: 'reception', toX: 1, toY: 1, label: 'Recepção Central' },
    ],
    furniture: [
      // Tapetes-passadeira ao longo do corredor
      { id: fid('rug'), kind: 'rug', x: 2, y: 3, dir: 0 },
      { id: fid('rug'), kind: 'rug', x: 6, y: 3, dir: 0 },
      { id: fid('rug'), kind: 'rug', x: 10, y: 3, dir: 0 },
      { id: fid('rug'), kind: 'rug', x: 14, y: 3, dir: 0 },
      // Cantos e descanso
      { id: fid('plant'), kind: 'plant', x: 0, y: 0, dir: 0 },
      { id: fid('plant'), kind: 'plant', x: 19, y: 6, dir: 0 },
      { id: fid('plant'), kind: 'plant', x: 0, y: 6, dir: 0 },
      { id: fid('plant'), kind: 'plant', x: 19, y: 1, dir: 0 },
      { id: fid('pouf'), kind: 'pouf', x: 5, y: 5, dir: 1 },
      { id: fid('pouf'), kind: 'pouf', x: 6, y: 5, dir: 1 },
      { id: fid('pouf'), kind: 'pouf', x: 13, y: 5, dir: 1 },
      { id: fid('pouf'), kind: 'pouf', x: 14, y: 5, dir: 1 },
      { id: fid('lamp'), kind: 'lamp', x: 10, y: 6, dir: 0 },
      { id: fid('lamp'), kind: 'lamp', x: 17, y: 6, dir: 0 },
      { id: fid('cooler'), kind: 'cooler', x: 19, y: 0, dir: 1 },
      { id: fid('bin'), kind: 'bin', x: 3, y: 6, dir: 0 },
      // Parede norte (os tiles pares sao as portas): quadros e relogio nos tiles impares
      { id: fid('frame'), kind: 'frame', x: 3, y: 0, dir: 0 },
      { id: fid('frame'), kind: 'frame', x: 7, y: 0, dir: 0 },
      { id: fid('clock'), kind: 'clock', x: 11, y: 0, dir: 0 },
      { id: fid('frame'), kind: 'frame', x: 15, y: 0, dir: 0 },
      // Parede oeste: porta da recepcao em y = 2; ar-condicionado e termostato
      { id: fid('ac'), kind: 'ac_split', x: 0, y: 4, dir: 1 },
      { id: fid('thermo'), kind: 'thermostat', x: 0, y: 3, dir: 1 },
    ],
  };

  // ---- 1. Sala de Treinamento ------------------------------------------------------------------------
  /** Fileiras de carteiras (mesa 2x1 + duas cadeiras voltadas para o norte, onde fica a TV). */
  const studentRows = (ys: number[], xs: number[]): Furniture[] => {
    const out: Furniture[] = [];
    for (const y of ys) {
      for (const x of xs) {
        out.push({ id: fid('desk'), kind: 'desk', x, y, dir: 0 });
        out.push({ id: fid('chair'), kind: 'chair', x, y: y + 1, dir: 3 });
        out.push({ id: fid('chair'), kind: 'chair', x: x + 1, y: y + 1, dir: 3 });
      }
    }
    return out;
  };
  fid = idMaker('training');
  const training: RoomDef = {
    id: 'training',
    type: 'training',
    access: 'org',
    name: 'Sala de Treinamento',
    description: 'Carteiras em fileiras de frente para a TV, mesa do instrutor, quadro branco e ar-condicionado. Reservável.',
    tiles: rect(14, 10),
    spawn: { x: 1, y: 4, dir: 0 },
    maxPlayers: 20,
    portals: [backToHall('training', 4)],
    furniture: [
      { id: fid('rug'), kind: 'rug', x: 4, y: 2, dir: 0 },
      ...studentRows([4, 7], [2, 5, 8, 11]),
      // Area do instrutor: TV com suporte (apresentacao), mesa com computador e quadros brancos na parede norte
      { id: 'tvstand-training', kind: 'tv_stand', x: 5, y: 1, dir: 0 },
      { id: fid('desk'), kind: 'desk', x: 9, y: 2, dir: 0 },
      { id: fid('pc'), kind: 'computer', x: 9, y: 2, dir: 3 },
      { id: fid('chair'), kind: 'chair', x: 9, y: 1, dir: 1 },
      { id: fid('board'), kind: 'whiteboard', x: 1, y: 0, dir: 0 },
      { id: fid('board'), kind: 'whiteboard', x: 10, y: 0, dir: 0 },
      { id: fid('tv'), kind: 'tv', x: 5, y: 0, dir: 0 },
      { id: fid('clock'), kind: 'clock', x: 8, y: 0, dir: 0 },
      { id: fid('ac'), kind: 'ac_split', x: 12, y: 0, dir: 0 },
      { id: fid('cooler'), kind: 'cooler', x: 3, y: 0, dir: 1 },
      { id: fid('frame'), kind: 'frame', x: 0, y: 2, dir: 1 },
      { id: fid('thermo'), kind: 'thermostat', x: 0, y: 7, dir: 1 },
      { id: fid('shelf'), kind: 'bookshelf', x: 0, y: 8, dir: 1 },
      { id: fid('plant'), kind: 'plant', x: 0, y: 0, dir: 0 },
      { id: fid('plant'), kind: 'plant', x: 13, y: 9, dir: 0 },
      { id: fid('plant'), kind: 'plant', x: 13, y: 2, dir: 0 },
      { id: fid('bin'), kind: 'bin', x: 13, y: 8, dir: 0 },
    ],
  };

  // ---- 2. RH / Atendimento ---------------------------------------------------------------------------
  fid = idMaker('rh');
  const rh: RoomDef = {
    id: 'rh',
    type: 'hr',
    access: 'org',
    name: 'RH / Atendimento',
    description: 'Mesa de recepção de candidatos com duas cadeiras de entrevista, estante de pastas, quadro de avisos e cantinho de espera. Reservável.',
    tiles: rect(10, 8),
    spawn: { x: 1, y: 3, dir: 0 },
    maxPlayers: 8,
    portals: [backToHall('rh', 3)],
    furniture: [
      { id: fid('rug'), kind: 'rug', x: 4, y: 4, dir: 0 },
      // Balcao de atendimento: a pessoa do RH atras (de frente para o computador) e duas cadeiras de entrevista do outro lado
      { id: fid('desk'), kind: 'reception_desk', x: 5, y: 3, dir: 0 },
      { id: fid('pc'), kind: 'computer', x: 6, y: 3, dir: 3 },
      { id: fid('chair'), kind: 'chair', x: 6, y: 2, dir: 1 },
      { id: fid('chair'), kind: 'chair', x: 5, y: 4, dir: 3 },
      { id: fid('chair'), kind: 'chair', x: 7, y: 4, dir: 3 },
      // Cantinho de espera
      { id: fid('sofa'), kind: 'sofa', x: 0, y: 6, dir: 0 },
      { id: fid('ctable'), kind: 'coffee_table', x: 2, y: 6, dir: 1 },
      { id: fid('armchair'), kind: 'armchair', x: 3, y: 6, dir: 2 },
      { id: fid('lamp'), kind: 'lamp', x: 9, y: 4, dir: 0 },
      { id: fid('plant'), kind: 'plant', x: 9, y: 7, dir: 0 },
      { id: fid('plant'), kind: 'plant', x: 0, y: 0, dir: 0 },
      { id: fid('plant'), kind: 'plant', x: 9, y: 2, dir: 0 },
      { id: fid('bin'), kind: 'bin', x: 9, y: 6, dir: 0 },
      // Parede norte: estante de pastas, quadro de avisos, ar-condicionado e outra estante
      { id: fid('shelf'), kind: 'bookshelf', x: 1, y: 0, dir: 0 },
      { id: fid('notice'), kind: 'notice_board', x: 4, y: 0, dir: 0 },
      { id: fid('ac'), kind: 'ac_split', x: 6, y: 0, dir: 0 },
      // Parede oeste
      { id: fid('frame'), kind: 'frame', x: 0, y: 1, dir: 1 },
      { id: fid('thermo'), kind: 'thermostat', x: 0, y: 5, dir: 1 },
    ],
  };

  // ---- 3. Diretoria ----------------------------------------------------------------------------------
  fid = idMaker('board');
  const board: RoomDef = {
    id: 'board',
    type: 'board',
    // Acesso por convite (ou pela equipe "Diretoria", que passa mesmo trancada). NAO e reservavel: reservar ignora equipe e convite.
    access: 'invited',
    name: 'Diretoria',
    description: 'Mesa de reunião longa de madeira escura, poltronas, aparador com bebidas, TV, estante e tapete. Só com convite ou pela equipe da Diretoria.',
    tiles: rect(14, 10),
    spawn: { x: 1, y: 4, dir: 0 },
    maxPlayers: 16,
    portals: [backToHall('board', 4)],
    furniture: [
      { id: fid('rug'), kind: 'rug', x: 3, y: 4, dir: 0 },
      { id: fid('rug'), kind: 'rug', x: 6, y: 4, dir: 0 },
      // Mesa longa com 14 poltronas ergonomicas: cinco de cada lado maior e duas em cada cabeceira
      { id: fid('btable'), kind: 'board_table', x: 4, y: 4, dir: 0 },
      ...[4, 5, 6, 7, 8].flatMap((x) => [
        { id: fid('ergo'), kind: 'ergo_chair' as const, x, y: 3, dir: 1 },
        { id: fid('ergo'), kind: 'ergo_chair' as const, x, y: 6, dir: 3 },
      ]),
      { id: fid('ergo'), kind: 'ergo_chair', x: 3, y: 4, dir: 0 },
      { id: fid('ergo'), kind: 'ergo_chair', x: 3, y: 5, dir: 0 },
      { id: fid('ergo'), kind: 'ergo_chair', x: 9, y: 4, dir: 2 },
      { id: fid('ergo'), kind: 'ergo_chair', x: 9, y: 5, dir: 2 },
      // TV de apresentacao na cabeceira norte
      { id: 'tvstand-board', kind: 'tv_stand', x: 6, y: 1, dir: 0 },
      // Aparador com bebidas na parede norte
      { id: fid('side'), kind: 'sideboard', x: 10, y: 0, dir: 0 },
      // Cantinho de conversa no canto sudeste: duas poltronas em volta de uma mesa de centro
      { id: fid('ctable'), kind: 'coffee_table', x: 12, y: 8, dir: 0 },
      { id: fid('armchair'), kind: 'armchair', x: 12, y: 7, dir: 1 },
      { id: fid('armchair'), kind: 'armchair', x: 13, y: 7, dir: 1 },
      { id: fid('lamp'), kind: 'lamp', x: 11, y: 8, dir: 0 },
      { id: fid('lamp'), kind: 'lamp', x: 2, y: 8, dir: 0 },
      { id: fid('plant'), kind: 'plant', x: 13, y: 9, dir: 0 },
      { id: fid('plant'), kind: 'plant', x: 13, y: 2, dir: 0 },
      { id: fid('plant'), kind: 'plant', x: 0, y: 0, dir: 0 },
      { id: fid('bin'), kind: 'bin', x: 13, y: 3, dir: 0 },
      // Parede norte: ar-condicionado, quadro branco e relogio
      { id: fid('ac'), kind: 'ac_split', x: 1, y: 0, dir: 0 },
      { id: fid('board'), kind: 'whiteboard', x: 4, y: 0, dir: 0 },
      { id: fid('clock'), kind: 'clock', x: 9, y: 0, dir: 0 },
      // Parede oeste: estante e quadros
      { id: fid('shelf'), kind: 'bookshelf', x: 0, y: 8, dir: 1 },
      { id: fid('frame'), kind: 'frame', x: 0, y: 1, dir: 1 },
      { id: fid('frame'), kind: 'frame', x: 0, y: 6, dir: 1 },
      { id: fid('thermo'), kind: 'thermostat', x: 0, y: 2, dir: 1 },
    ],
  };

  // ---- 4. Laboratorio / Dev --------------------------------------------------------------------------
  fid = idMaker('lab');
  /** Bancada de PCs: mesa de comando (3 tiles, varios monitores) com uma poltrona ergonomica por tile, de frente para ela. */
  const benchRow = (x: number, y: number): Furniture[] => [
    { id: fid('cmd'), kind: 'command_desk', x, y, dir: 0 },
    ...[0, 1, 2].map((i): Furniture => ({ id: fid('ergo'), kind: 'ergo_chair', x: x + i, y: y + 1, dir: 3 })),
  ];
  const lab: RoomDef = {
    id: 'lab',
    type: 'lab',
    access: 'org',
    name: 'Laboratório / Dev',
    description: 'Bancadas com vários monitores, racks, impressoras 3D, bancada de hardware, quadro de arquitetura e café para a madrugada de deploy.',
    tiles: rect(14, 10),
    spawn: { x: 1, y: 4, dir: 0 },
    maxPlayers: 14,
    portals: [backToHall('lab', 4)],
    furniture: [
      ...benchRow(2, 3),
      ...benchRow(6, 3),
      ...benchRow(10, 3),
      ...benchRow(5, 7),
      ...benchRow(9, 7),
      // Bancada de hardware e racks pequenos na parede oeste
      { id: fid('bench'), kind: 'hardware_bench', x: 0, y: 0, dir: 1 },
      { id: fid('stool'), kind: 'stool', x: 1, y: 1, dir: 2 },
      { id: fid('rack'), kind: 'rack', x: 0, y: 6, dir: 0 },
      { id: fid('rack'), kind: 'rack', x: 0, y: 7, dir: 0 },
      { id: fid('rack'), kind: 'rack', x: 0, y: 8, dir: 0 },
      // Impressoras 3D
      { id: fid('p3d'), kind: 'printer3d', x: 2, y: 8, dir: 0 },
      { id: fid('p3d'), kind: 'printer3d', x: 3, y: 8, dir: 1 },
      { id: fid('p3d'), kind: 'printer3d', x: 13, y: 7, dir: 1 },
      // Cafe e agua na parede norte
      { id: fid('coffee'), kind: 'coffee', x: 11, y: 0, dir: 1 },
      { id: fid('cooler'), kind: 'cooler', x: 12, y: 0, dir: 1 },
      { id: fid('plant'), kind: 'plant', x: 13, y: 2, dir: 0 },
      { id: fid('plant'), kind: 'plant', x: 13, y: 9, dir: 0 },
      { id: fid('bin'), kind: 'bin', x: 13, y: 6, dir: 0 },
      { id: fid('lamp'), kind: 'lamp', x: 4, y: 9, dir: 0 },
      // Parede norte: ar-condicionado, quadro de arquitetura e relogio
      { id: fid('ac'), kind: 'ac_split', x: 2, y: 0, dir: 0 },
      { id: fid('arch'), kind: 'arch_board', x: 5, y: 0, dir: 0 },
      { id: fid('clock'), kind: 'clock', x: 9, y: 0, dir: 0 },
      // Parede oeste: termostato e quadro
      { id: fid('thermo'), kind: 'thermostat', x: 0, y: 5, dir: 1 },
      { id: fid('frame'), kind: 'frame', x: 0, y: 3, dir: 1 },
    ],
  };

  // ---- 5. Refeitorio ---------------------------------------------------------------------------------
  fid = idMaker('cafeteria');
  /** Mesa de almoco: duas mesas compridas lado a lado (4 tiles) com um banco de cada lado, todos voltados para a mesa. */
  const lunchTable = (x: number, y: number): Furniture[] => [
    { id: fid('lt'), kind: 'long_table', x, y, dir: 0 },
    { id: fid('lt'), kind: 'long_table', x: x + 2, y, dir: 0 },
    ...[0, 1, 2, 3].flatMap((i): Furniture[] => [
      { id: fid('bench'), kind: 'bench', x: x + i, y: y - 1, dir: 1 },
      { id: fid('bench'), kind: 'bench', x: x + i, y: y + 1, dir: 3 },
    ]),
  ];
  const cafeteria: RoomDef = {
    id: 'cafeteria',
    type: 'cafeteria',
    access: 'org',
    name: 'Refeitório',
    description: 'Mesas compridas com bancos, balcão de self-service, geladeiras, micro-ondas, máquinas de lanche e refrigerante.',
    tiles: rect(16, 10),
    spawn: { x: 1, y: 4, dir: 0 },
    maxPlayers: 30,
    portals: [backToHall('cafeteria', 4)],
    furniture: [
      ...lunchTable(3, 3),
      ...lunchTable(9, 3),
      ...lunchTable(3, 7),
      ...lunchTable(9, 7),
      // Parede norte, da esquerda para a direita: geladeira, self-service, cafe, ar, lanches, refrigerantes, micro-ondas, agua, geladeira
      { id: fid('plant'), kind: 'plant', x: 0, y: 0, dir: 0 },
      { id: fid('fridge'), kind: 'fridge', x: 1, y: 0, dir: 1 },
      { id: fid('buffet'), kind: 'buffet', x: 2, y: 0, dir: 0 },
      { id: fid('espresso'), kind: 'espresso', x: 6, y: 0, dir: 0 },
      { id: fid('ac'), kind: 'ac_split', x: 8, y: 0, dir: 0 },
      { id: fid('vend'), kind: 'snack_machine', x: 10, y: 0, dir: 1 },
      { id: fid('vend'), kind: 'soda_machine', x: 11, y: 0, dir: 1 },
      { id: fid('micro'), kind: 'microwave', x: 12, y: 0, dir: 1 },
      { id: fid('micro'), kind: 'microwave', x: 13, y: 0, dir: 1 },
      { id: fid('cooler'), kind: 'cooler', x: 14, y: 0, dir: 1 },
      { id: fid('plant'), kind: 'plant', x: 15, y: 0, dir: 0 },
      // Lixeiras (reciclavel e comum) junto das maquinas, plantas e um quadro
      { id: fid('bin'), kind: 'bin', x: 8, y: 1, dir: 0 },
      { id: fid('bin'), kind: 'bin', x: 14, y: 1, dir: 0 },
      { id: fid('bin'), kind: 'bin', x: 15, y: 9, dir: 0 },
      { id: fid('plant'), kind: 'plant', x: 15, y: 4, dir: 0 },
      { id: fid('plant'), kind: 'plant', x: 0, y: 9, dir: 0 },
      { id: fid('plant'), kind: 'plant', x: 7, y: 9, dir: 0 },
      // Parede oeste: termostato e quadros
      { id: fid('thermo'), kind: 'thermostat', x: 0, y: 5, dir: 1 },
      { id: fid('frame'), kind: 'frame', x: 0, y: 7, dir: 1 },
    ],
  };

  // ---- 6. Sala de Jogos ------------------------------------------------------------------------------
  fid = idMaker('games');
  const games: RoomDef = {
    id: 'games',
    type: 'games',
    access: 'org',
    name: 'Sala de Jogos',
    description: 'Pebolim, ping-pong, fliperamas, pufes, sofá e TV: clique nos jogos para jogar uma partida.',
    tiles: rect(14, 10),
    spawn: { x: 1, y: 4, dir: 0 },
    maxPlayers: 14,
    portals: [backToHall('games', 4)],
    furniture: [
      { id: fid('rug'), kind: 'rug', x: 6, y: 4, dir: 0 },
      { id: fid('pong'), kind: 'pingpong', x: 6, y: 4, dir: 0 },
      { id: fid('foos'), kind: 'foosball', x: 10, y: 6, dir: 0 },
      { id: fid('foos'), kind: 'foosball', x: 10, y: 3, dir: 0 },
      // Fliperamas encostados na parede norte
      { id: fid('arc'), kind: 'arcade', x: 9, y: 0, dir: 1 },
      { id: fid('arc'), kind: 'arcade', x: 10, y: 0, dir: 1 },
      { id: fid('arc'), kind: 'arcade', x: 11, y: 0, dir: 1 },
      { id: fid('arc'), kind: 'arcade', x: 12, y: 0, dir: 1 },
      // Canto de TV e descanso: sofa de frente para a mesa de centro, pufes em volta
      { id: fid('sofa'), kind: 'sofa', x: 0, y: 6, dir: 0 },
      { id: fid('ctable'), kind: 'coffee_table', x: 2, y: 6, dir: 1 },
      { id: fid('pouf'), kind: 'pouf', x: 3, y: 6, dir: 2 },
      { id: fid('pouf'), kind: 'pouf', x: 3, y: 7, dir: 2 },
      { id: fid('pouf'), kind: 'pouf', x: 2, y: 9, dir: 1 },
      { id: fid('pouf'), kind: 'pouf', x: 3, y: 9, dir: 1 },
      { id: fid('pouf'), kind: 'pouf', x: 12, y: 9, dir: 1 },
      { id: fid('pouf'), kind: 'pouf', x: 13, y: 9, dir: 1 },
      { id: fid('lamp'), kind: 'lamp', x: 5, y: 9, dir: 0 },
      { id: fid('plant'), kind: 'plant', x: 13, y: 2, dir: 0 },
      { id: fid('plant'), kind: 'plant', x: 0, y: 0, dir: 0 },
      { id: fid('bin'), kind: 'bin', x: 8, y: 9, dir: 0 },
      // Parede norte: ar-condicionado, TV grande e relogio; parede oeste: termostato e quadro
      { id: fid('ac'), kind: 'ac_split', x: 2, y: 0, dir: 0 },
      { id: fid('tv'), kind: 'tv', x: 5, y: 0, dir: 0 },
      { id: fid('clock'), kind: 'clock', x: 8, y: 0, dir: 0 },
      { id: fid('thermo'), kind: 'thermostat', x: 0, y: 5, dir: 1 },
      { id: fid('frame'), kind: 'frame', x: 0, y: 1, dir: 1 },
    ],
  };

  // ---- 7. Terraco ------------------------------------------------------------------------------------
  fid = idMaker('terrace');
  /** Mesa com guarda-sol e quatro cadeiras viradas para ela. */
  const patioSet = (x: number, y: number): Furniture[] => [
    { id: fid('parasol'), kind: 'parasol', x, y, dir: 0 },
    { id: fid('chair'), kind: 'chair', x: x - 1, y, dir: 0 },
    { id: fid('chair'), kind: 'chair', x: x + 1, y, dir: 2 },
    { id: fid('chair'), kind: 'chair', x, y: y - 1, dir: 1 },
    { id: fid('chair'), kind: 'chair', x, y: y + 1, dir: 3 },
  ];
  const TW = 16;
  const TH = 10;
  const terrace: RoomDef = {
    id: 'terrace',
    type: 'terrace',
    access: 'org',
    name: 'Terraço',
    description: 'Área aberta sem teto: deck, mesas com guarda-sol, bancos, mini-jardim e vista; à noite, o varal de luzinhas acende.',
    tiles: rect(TW, TH),
    spawn: { x: 1, y: 4, dir: 0 },
    maxPlayers: 24,
    portals: [backToHall('terrace', 4)],
    furniture: [
      // Guarda-corpo de vidro nas bordas sul e leste
      ...Array.from({ length: TW }, (_, x): Furniture => ({ id: fid('rail'), kind: 'railing', x, y: TH - 1, dir: 0 })),
      ...Array.from({ length: TH - 1 }, (_, y): Furniture => ({ id: fid('rail'), kind: 'railing', x: TW - 1, y, dir: 1 })),
      // Mesas externas com guarda-sol
      ...patioSet(5, 5),
      ...patioSet(9, 6),
      ...patioSet(12, 6),
      // Sofa de exterior de frente para a mesa de centro, com duas poltronas
      { id: fid('sofa'), kind: 'sofa', x: 13, y: 2, dir: 2 },
      { id: fid('ctable'), kind: 'coffee_table', x: 11, y: 2, dir: 1 },
      { id: fid('armchair'), kind: 'armchair', x: 11, y: 1, dir: 1 },
      { id: fid('armchair'), kind: 'armchair', x: 11, y: 4, dir: 3 },
      // Bancos de madeira sob as janelas, mini-jardins e plantas grandes
      { id: fid('bench'), kind: 'bench', x: 2, y: 1, dir: 1 },
      { id: fid('bench'), kind: 'bench', x: 3, y: 1, dir: 1 },
      { id: fid('bench'), kind: 'bench', x: 4, y: 1, dir: 1 },
      { id: fid('garden'), kind: 'garden_bed', x: 6, y: 1, dir: 0 },
      { id: fid('garden'), kind: 'garden_bed', x: 1, y: 6, dir: 1 },
      { id: fid('plant'), kind: 'plant', x: 0, y: 0, dir: 0 },
      { id: fid('plant'), kind: 'plant', x: 14, y: 0, dir: 0 },
      { id: fid('plant'), kind: 'plant', x: 14, y: 8, dir: 0 },
      { id: fid('plant'), kind: 'plant', x: 0, y: 8, dir: 0 },
      { id: fid('plant'), kind: 'plant', x: 9, y: 2, dir: 0 },
      { id: fid('lamp'), kind: 'lamp', x: 1, y: 2, dir: 0 },
      { id: fid('lamp'), kind: 'lamp', x: 3, y: 8, dir: 0 },
      { id: fid('bin'), kind: 'bin', x: 14, y: 5, dir: 0 },
      // Parede (fachada de tijolo): so um relogio, o resto fica livre para as janelas e a decoracao
      { id: fid('clock'), kind: 'clock', x: 10, y: 0, dir: 0 },
    ],
  };

  // ---- 8. Biblioteca / Silenciosa --------------------------------------------------------------------
  fid = idMaker('library');
  const library: RoomDef = {
    id: 'library',
    type: 'library',
    access: 'org',
    name: 'Biblioteca / Silenciosa',
    description: 'Silêncio: estantes altas, mesas de estudo, poltronas de leitura e luminárias. Microfone e câmera ficam desligados aqui.',
    tiles: rect(12, 10),
    spawn: { x: 1, y: 4, dir: 0 },
    maxPlayers: 16,
    portals: [backToHall('library', 4)],
    furniture: [
      { id: fid('rug'), kind: 'rug', x: 3, y: 7, dir: 0 },
      // Mesas de estudo, cada uma com oito cadeiras em volta
      { id: fid('table'), kind: 'table', x: 4, y: 3, dir: 0 },
      ...chairsAround(4, 3, 2, 2),
      { id: fid('table'), kind: 'table', x: 8, y: 6, dir: 0 },
      ...chairsAround(8, 6, 2, 2),
      // Cantinho de leitura: poltronas de frente para o tapete, luminarias de leitura
      { id: fid('armchair'), kind: 'armchair', x: 2, y: 7, dir: 0 },
      { id: fid('armchair'), kind: 'armchair', x: 2, y: 8, dir: 0 },
      { id: fid('armchair'), kind: 'armchair', x: 3, y: 6, dir: 1 },
      { id: fid('lamp'), kind: 'lamp', x: 2, y: 9, dir: 0 },
      { id: fid('lamp'), kind: 'lamp', x: 6, y: 8, dir: 0 },
      { id: fid('lamp'), kind: 'lamp', x: 10, y: 2, dir: 0 },
      { id: fid('plant'), kind: 'plant', x: 11, y: 9, dir: 0 },
      { id: fid('plant'), kind: 'plant', x: 0, y: 0, dir: 0 },
      { id: fid('plant'), kind: 'plant', x: 11, y: 4, dir: 0 },
      // Parede norte: estantes altas e ar-condicionado; parede oeste: mais estantes
      { id: fid('shelf'), kind: 'tall_shelf', x: 1, y: 0, dir: 0 },
      { id: fid('shelf'), kind: 'tall_shelf', x: 3, y: 0, dir: 0 },
      { id: fid('shelf'), kind: 'tall_shelf', x: 5, y: 0, dir: 0 },
      { id: fid('ac'), kind: 'ac_split', x: 8, y: 0, dir: 0 },
      { id: fid('shelf'), kind: 'tall_shelf', x: 0, y: 6, dir: 1 },
      { id: fid('shelf'), kind: 'tall_shelf', x: 0, y: 8, dir: 1 },
      { id: fid('clock'), kind: 'clock', x: 11, y: 0, dir: 0 },
      { id: fid('thermo'), kind: 'thermostat', x: 0, y: 3, dir: 1 },
      { id: fid('frame'), kind: 'frame', x: 0, y: 1, dir: 1 },
    ],
  };

  // ---- 9. Estudio / Podcast --------------------------------------------------------------------------
  fid = idMaker('studio');
  const studio: RoomDef = {
    id: 'studio',
    type: 'studio',
    access: 'org',
    name: 'Estúdio / Podcast',
    description: 'Mesa redonda com microfones, painéis acústicos, câmera em tripé, sofá de convidados e a luz de NO AR que acende quando alguém fala.',
    tiles: rect(10, 8),
    spawn: { x: 1, y: 3, dir: 0 },
    maxPlayers: 8,
    portals: [backToHall('studio', 3)],
    furniture: [
      { id: fid('rug'), kind: 'rug', x: 3, y: 3, dir: 0 },
      { id: fid('ptable'), kind: 'podcast_table', x: 4, y: 3, dir: 0 },
      { id: fid('ergo'), kind: 'ergo_chair', x: 4, y: 2, dir: 1 },
      { id: fid('ergo'), kind: 'ergo_chair', x: 5, y: 5, dir: 3 },
      { id: fid('ergo'), kind: 'ergo_chair', x: 3, y: 4, dir: 0 },
      { id: fid('ergo'), kind: 'ergo_chair', x: 6, y: 3, dir: 2 },
      // Camera em tripe virada para a mesa e sofa dos convidados com mesa de centro
      { id: fid('cam'), kind: 'camera_tripod', x: 8, y: 3, dir: 2 },
      { id: fid('sofa'), kind: 'sofa', x: 8, y: 6, dir: 2 },
      { id: fid('ctable'), kind: 'coffee_table', x: 6, y: 6, dir: 1 },
      { id: fid('lamp'), kind: 'lamp', x: 1, y: 6, dir: 0 },
      { id: fid('plant'), kind: 'plant', x: 0, y: 0, dir: 0 },
      { id: fid('plant'), kind: 'plant', x: 9, y: 7, dir: 0 },
      // Parede norte: painel, luz de NO AR sobre a mesa, painel e ar-condicionado
      { id: fid('foam'), kind: 'acoustic_panel', x: 1, y: 0, dir: 0 },
      { id: fid('onair'), kind: 'on_air', x: 4, y: 0, dir: 0 },
      { id: fid('foam'), kind: 'acoustic_panel', x: 6, y: 0, dir: 0 },
      { id: fid('ac'), kind: 'ac_split', x: 8, y: 0, dir: 0 },
      // Parede oeste: painel e termostato
      { id: fid('foam'), kind: 'acoustic_panel', x: 0, y: 5, dir: 1 },
      { id: fid('thermo'), kind: 'thermostat', x: 0, y: 2, dir: 1 },
    ],
  };

  const rooms = [training, rh, board, lab, cafeteria, games, terrace, library, studio];
  // as portas do corredor so existem para as salas que existem: a chegada em cada sala e o seu spawn (ao lado da porta oeste)
  for (const r of rooms) {
    const i = HALL2_DOORS.findIndex((d) => d.id === r.id);
    hall2.portals.push({ x: 2 + 2 * i, y: 0, toRoom: r.id, toX: r.spawn.x, toY: r.spawn.y, label: HALL2_DOORS[i]!.label });
  }
  return { hall2, rooms };
}
