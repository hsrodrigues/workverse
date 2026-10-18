import { PALETTES } from './palettes';
import type { ItemCategory, ItemDef, ItemSlot, PaletteId, Pose, PoseMode, ThumbFocus } from './types';

/**
 * The item library. Adding an item is one entry here plus one drawing function registered on the client
 * under the same `drawer` key (`apps/client/src/game/avatar/`). Ids are stable and never reused.
 * Gaps (poses/views without art) are declared in `poses`/`views`/`notes` of each item.
 */
const FULL: Record<Pose, PoseMode> = { idle: 'full', walk: 'full', sit: 'full', wave: 'full' };

type Input = Omit<ItemDef, 'rarity' | 'unlock' | 'availability' | 'poses' | 'tags'> &
  Partial<Pick<ItemDef, 'rarity' | 'unlock' | 'availability' | 'poses' | 'tags'>>;

const it = (d: Input): ItemDef => ({
  rarity: 'common',
  unlock: 'free',
  availability: 'available',
  poses: FULL,
  tags: [],
  ...d,
});

const hair = (id: string, name: string, description: string, drawer: string, tags: string[], more: Partial<ItemDef> = {}): ItemDef =>
  it({ id, name, description, drawer, tags, category: 'hair', slot: 'hair', palette: 'hair', defaultColor: 'dark-brown', thumb: 'head', ...more });

const top = (id: string, name: string, description: string, drawer: string, tags: string[], more: Partial<ItemDef> = {}): ItemDef =>
  it({ id, name, description, drawer, tags, category: 'clothes', slot: 'top', palette: 'cloth', defaultColor: 'blue', thumb: 'torso', ...more });

const outer = (id: string, name: string, description: string, drawer: string, tags: string[], more: Partial<ItemDef> = {}): ItemDef =>
  it({ id, name, description, drawer, tags, category: 'clothes', slot: 'outer', palette: 'cloth', defaultColor: 'charcoal', thumb: 'torso', ...more });

const bottom = (id: string, name: string, description: string, drawer: string, tags: string[], more: Partial<ItemDef> = {}): ItemDef =>
  it({ id, name, description, drawer, tags, category: 'clothes', slot: 'bottom', palette: 'cloth', defaultColor: 'slate', thumb: 'legs', ...more });

const shoes = (id: string, name: string, description: string, drawer: string, tags: string[], more: Partial<ItemDef> = {}): ItemDef =>
  it({ id, name, description, drawer, tags, category: 'shoes', slot: 'shoes', palette: 'shoe', defaultColor: 'black', thumb: 'feet', ...more });

const acc = (
  id: string,
  name: string,
  slot: ItemSlot,
  description: string,
  drawer: string,
  tags: string[],
  more: Partial<ItemDef> = {},
): ItemDef => it({ id, name, slot, description, drawer, tags, category: 'accessories', ...more });

const special = (
  id: string,
  name: string,
  slot: ItemSlot,
  description: string,
  drawer: string,
  tags: string[],
  more: Partial<ItemDef> = {},
): ItemDef => it({ id, name, slot, description, drawer, tags, category: 'special', ...more });

export const ITEMS: readonly ItemDef[] = [
  // ---- hair ---------------------------------------------------------------
  hair('hair.bald', 'Careca', 'Sem cabelo.', 'hair.none', ['curto', 'unissex'], { palette: undefined, defaultColor: undefined }),
  hair('hair.buzz', 'Raspado', 'Cabelo bem rente à cabeça.', 'hair.buzz', ['curto', 'masculino']),
  hair('hair.short', 'Curto', 'Corte curto com franja repartida.', 'hair.short', ['curto', 'masculino']),
  hair('hair.spiky', 'Espetado', 'Mechas curtas em pé.', 'hair.spiky', ['curto', 'espetado', 'masculino']),
  hair('hair.pompadour', 'Topete', 'Volume alto penteado para o lado.', 'hair.pompadour', ['curto', 'masculino']),
  hair('hair.bun', 'Coque', 'Cabelo preso num coque no alto.', 'hair.bun', ['médio', 'feminino']),
  hair('hair.ponytail', 'Rabo de cavalo', 'Cabelo preso atrás num rabo.', 'hair.ponytail', ['médio', 'feminino']),
  hair('hair.bob', 'Chanel', 'Corte reto na altura do queixo.', 'hair.bob', ['médio', 'feminino']),
  hair('hair.medium', 'Médio', 'Na altura dos ombros, com pontas leves.', 'hair.medium', ['médio', 'feminino']),
  hair('hair.long', 'Longo', 'Cabelo comprido, solto nas costas.', 'hair.long', ['comprido', 'feminino']),
  hair('hair.curly', 'Cacheado', 'Cachos médios cheios de volume.', 'hair.curly', ['cacheado', 'médio', 'unissex']),
  hair('hair.afro', 'Black power', 'Volume redondo e cacheado.', 'hair.afro', ['cacheado', 'unissex']),

  // ---- more hairstyles (mostly feminine; open to everybody) ------------------------------------------------
  hair('hair.long_bangs', 'Longo liso com franja', 'Cabelo comprido e liso com franja reta.', 'hair.long_bangs', ['comprido', 'feminino']),
  hair('hair.wavy', 'Longo ondulado', 'Ondas soltas até as costas.', 'hair.wavy', ['comprido', 'feminino']),
  hair('hair.volume', 'Crespo volumoso', 'Cachos crespos em volume redondo.', 'hair.volume', ['cacheado', 'feminino']),
  hair('hair.braids', 'Tranças longas', 'Duas tranças longas caindo pela frente.', 'hair.braids', ['comprido', 'feminino']),
  hair('hair.pigtails', 'Maria-chiquinhas', 'Dois rabinhos nas laterais da cabeça.', 'hair.pigtails', ['médio', 'feminino']),
  hair('hair.high_pony', 'Rabo de cavalo alto', 'Rabo preso no alto da cabeça.', 'hair.high_pony', ['médio', 'feminino']),
  hair('hair.messy_bun', 'Coque alto bagunçado', 'Coque no alto com fios soltos.', 'hair.messy_bun', ['médio', 'feminino']),
  hair('hair.low_bun', 'Coque baixo', 'Coque na nuca, com risca ao meio.', 'hair.low_bun', ['médio', 'feminino']),
  hair('hair.bob_asym', 'Chanel assimétrico', 'Chanel com um lado mais longo.', 'hair.bob_asym', ['médio', 'feminino']),
  hair('hair.pixie', 'Pixie', 'Curtinho, repicado e leve.', 'hair.pixie', ['curto', 'feminino']),
  hair('hair.half_up', 'Meio-preso com laço', 'Cabelo comprido, preso em cima com um laço.', 'hair.half_up', ['comprido', 'feminino']),
  hair('hair.sidelocks', 'Topete com mechas laterais', 'Topete alto com mechas caindo nas laterais.', 'hair.sidelocks', ['curto', 'unissex']),

  // ---- face ---------------------------------------------------------------
  it({ id: 'eyes.dots', name: 'Pontinhos', description: 'Olhos simples, o estilo clássico.', drawer: 'eyes.dots', category: 'face', slot: 'eyes', palette: 'eye', defaultColor: 'ink', thumb: 'face', tags: ['simples'] }),
  it({ id: 'eyes.round', name: 'Redondos', description: 'Olhos grandes com íris colorida.', drawer: 'eyes.round', category: 'face', slot: 'eyes', palette: 'eye', defaultColor: 'brown', thumb: 'face', tags: ['expressivo'] }),
  it({ id: 'eyes.narrow', name: 'Amendoados', description: 'Olhos mais finos e alongados.', drawer: 'eyes.narrow', category: 'face', slot: 'eyes', palette: 'eye', defaultColor: 'ink', thumb: 'face', tags: ['simples'] }),
  it({ id: 'eyes.happy', name: 'Sorridentes', description: 'Olhos fechados em arco, de quem sorri.', drawer: 'eyes.happy', category: 'face', slot: 'eyes', palette: 'eye', defaultColor: 'ink', thumb: 'face', tags: ['expressivo'] }),
  it({ id: 'eyes.lashes', name: 'Cílios', description: 'Olhos redondos com cílios marcados.', drawer: 'eyes.lashes', category: 'face', slot: 'eyes', palette: 'eye', defaultColor: 'ink', thumb: 'face', tags: ['expressivo'] }),

  it({ id: 'brows.none', name: 'Sem sobrancelhas', description: 'Rosto limpo, sem sobrancelhas desenhadas.', drawer: 'brows.none', category: 'face', slot: 'brows', thumb: 'face', tags: ['simples'] }),
  it({ id: 'brows.soft', name: 'Suaves', description: 'Traço fino e reto.', drawer: 'brows.soft', category: 'face', slot: 'brows', palette: 'brow', defaultColor: 'dark-brown', thumb: 'face', tags: ['suave'] }),
  it({ id: 'brows.thick', name: 'Grossas', description: 'Sobrancelhas marcadas.', drawer: 'brows.thick', category: 'face', slot: 'brows', palette: 'brow', defaultColor: 'dark-brown', thumb: 'face', tags: ['marcante'] }),
  it({ id: 'brows.arched', name: 'Arqueadas', description: 'Arco elegante, levemente erguido.', drawer: 'brows.arched', category: 'face', slot: 'brows', palette: 'brow', defaultColor: 'dark-brown', thumb: 'face', tags: ['suave'] }),
  it({ id: 'brows.stern', name: 'Sérias', description: 'Inclinadas para dentro, olhar concentrado.', drawer: 'brows.stern', category: 'face', slot: 'brows', palette: 'brow', defaultColor: 'dark-brown', thumb: 'face', tags: ['marcante'] }),

  it({ id: 'mouth.smile', name: 'Sorriso', description: 'Sorriso discreto.', drawer: 'mouth.smile', category: 'face', slot: 'mouth', thumb: 'face', tags: ['feliz'] }),
  it({ id: 'mouth.neutral', name: 'Neutra', description: 'Boca reta, expressão tranquila.', drawer: 'mouth.neutral', category: 'face', slot: 'mouth', thumb: 'face', tags: ['calmo'] }),
  it({ id: 'mouth.grin', name: 'Sorrisão', description: 'Sorriso largo com dentes.', drawer: 'mouth.grin', category: 'face', slot: 'mouth', thumb: 'face', tags: ['feliz'] }),
  it({ id: 'mouth.laugh', name: 'Gargalhada', description: 'Boca aberta de rir.', drawer: 'mouth.laugh', category: 'face', slot: 'mouth', thumb: 'face', tags: ['feliz'] }),
  it({ id: 'mouth.smirk', name: 'Sorriso de canto', description: 'Um lado da boca mais erguido.', drawer: 'mouth.smirk', category: 'face', slot: 'mouth', thumb: 'face', tags: ['calmo'] }),
  it({ id: 'mouth.surprised', name: 'Surpresa', description: 'Boca em "o".', drawer: 'mouth.surprised', category: 'face', slot: 'mouth', thumb: 'face', tags: ['calmo'] }),

  it({ id: 'facial.stubble', name: 'Barba por fazer', description: 'Sombra de barba.', drawer: 'facial.stubble', category: 'face', slot: 'facialHair', palette: 'brow', defaultColor: 'dark-brown', thumb: 'face', tags: ['barba'] }),
  it({ id: 'facial.mustache', name: 'Bigode', description: 'Bigode cheio.', drawer: 'facial.mustache', category: 'face', slot: 'facialHair', palette: 'brow', defaultColor: 'dark-brown', thumb: 'face', tags: ['bigode'] }),
  it({ id: 'facial.goatee', name: 'Cavanhaque', description: 'Bigode com barbicha no queixo.', drawer: 'facial.goatee', category: 'face', slot: 'facialHair', palette: 'brow', defaultColor: 'dark-brown', thumb: 'face', tags: ['bigode', 'barba'] }),
  it({ id: 'facial.beard', name: 'Barba cheia', description: 'Barba cobrindo o queixo e o maxilar.', drawer: 'facial.beard', category: 'face', slot: 'facialHair', palette: 'brow', defaultColor: 'dark-brown', thumb: 'face', tags: ['barba'] }),

  // ---- tops ---------------------------------------------------------------
  top('top.tee', 'Camiseta', 'Camiseta de manga curta.', 'top.tee', ['casual']),
  top('top.tank', 'Regata', 'Camiseta sem mangas.', 'top.tee', ['casual'], { params: { variant: 'tank' } }),
  top('top.striped', 'Camiseta listrada', 'Camiseta com listras horizontais.', 'top.tee', ['casual'], { params: { variant: 'striped' } }),
  top('top.wv', 'Camiseta WorkVerse', 'Uniforme oficial da casa, com o logo no peito.', 'top.tee', ['uniform', 'casual'], { params: { variant: 'logo' }, rarity: 'uncommon', defaultColor: 'navy' }),
  top('top.shirt', 'Camisa social', 'Camisa de manga longa com colarinho.', 'top.shirt', ['corporate'], { defaultColor: 'off-white' }),
  top('top.polo', 'Polo', 'Polo com gola e dois botões.', 'top.polo', ['casual', 'corporate']),
  top('top.hoodie', 'Moletom', 'Moletom com capuz, cordões e bolso canguru.', 'top.hoodie', ['casual']),
  top('top.sweater', 'Suéter', 'Suéter de tricô com gola alta.', 'top.sweater', ['casual'], { rarity: 'uncommon' }),

  // ---- outer layer (over the top) ----------------------------------------------------
  outer('outer.blazer', 'Blazer', 'Blazer com lapelas sobre a camisa.', 'outer.blazer', ['corporate'], { rarity: 'uncommon' }),
  outer('outer.bomber', 'Jaqueta bomber', 'Jaqueta fechada com punhos e barra de elástico.', 'outer.bomber', ['casual'], { defaultColor: 'olive', rarity: 'uncommon' }),
  outer('outer.cardigan', 'Cardigã', 'Casaco de tricô aberto na frente.', 'outer.cardigan', ['casual', 'corporate'], { defaultColor: 'sand' }),
  outer('outer.vest', 'Colete corporativo', 'Colete sem mangas sobre a camisa.', 'outer.vest', ['corporate', 'uniform'], { defaultColor: 'navy' }),
  outer('outer.apron', 'Avental de barista', 'Avental com bolso, para quem cuida do café.', 'outer.apron', ['uniform'], { defaultColor: 'brown', rarity: 'uncommon' }),

  // ---- bottoms ----------------------------------------------------------------
  bottom('bottom.pants', 'Calça', 'Calça reta casual.', 'bottom.pants', ['casual']),
  bottom('bottom.jeans', 'Calça jeans', 'Jeans com costuras aparentes.', 'bottom.pants', ['casual'], { params: { variant: 'jeans' }, defaultColor: 'denim' }),
  bottom('bottom.cargo', 'Calça cargo', 'Calça com bolsos laterais.', 'bottom.pants', ['casual'], { params: { variant: 'cargo' }, defaultColor: 'khaki' }),
  bottom('bottom.dress', 'Calça social', 'Calça de alfaiataria com vinco.', 'bottom.pants', ['corporate'], { params: { variant: 'dress' } }),
  bottom('bottom.shorts', 'Bermuda', 'Bermuda na altura do joelho.', 'bottom.shorts', ['casual']),
  bottom('bottom.skirt', 'Saia', 'Saia evasê com pregas.', 'bottom.skirt', ['casual'], { defaultColor: 'wine' }),
  bottom('bottom.pencil', 'Saia lápis', 'Saia justa de escritório.', 'bottom.skirt', ['corporate'], { params: { variant: 'pencil' }, defaultColor: 'charcoal' }),

  // ---- shoes ------------------------------------------------------------------
  shoes('shoes.sneakers', 'Tênis', 'Tênis casual com solado branco.', 'shoes.sneakers', ['casual']),
  shoes('shoes.runner', 'Tênis de corrida', 'Tênis leve com faixa contrastante.', 'shoes.sneakers', ['casual'], { params: { variant: 'runner' }, defaultColor: 'blue' }),
  shoes('shoes.hightop', 'Tênis cano alto', 'Cano alto com ponteira.', 'shoes.sneakers', ['casual'], { params: { variant: 'high' } }),
  shoes('shoes.dress', 'Sapato social', 'Sapato de couro lustroso.', 'shoes.dress', ['corporate']),
  shoes('shoes.loafer', 'Mocassim', 'Mocassim baixo com detalhe lateral.', 'shoes.dress', ['corporate'], { params: { variant: 'loafer' }, defaultColor: 'brown' }),
  shoes('shoes.boots', 'Bota', 'Bota de cano médio.', 'shoes.boots', ['casual'], { defaultColor: 'brown' }),

  // ---- accessories: eyewear -----------------------------------------------------------
  acc('acc.glasses', 'Óculos de grau', 'eyewear', 'Armação fina com lentes claras.', 'acc.glasses', ['grau'], { palette: 'frame', defaultColor: 'black', thumb: 'face' }),
  acc('acc.glasses_round', 'Óculos redondos', 'eyewear', 'Armação redonda, estilo retrô.', 'acc.glasses', ['grau'], { palette: 'frame', defaultColor: 'tortoise', params: { variant: 'round' }, thumb: 'face' }),
  acc('acc.sunglasses', 'Óculos escuros', 'eyewear', 'Lentes escuras.', 'acc.sunglasses', ['sol'], { palette: 'frame', defaultColor: 'ink', thumb: 'face' }),
  acc('acc.ar', 'Óculos AR', 'eyewear', 'Óculos de realidade aumentada com brilho nas hastes.', 'acc.ar', ['tech'], { palette: 'gadget', defaultColor: 'blue', rarity: 'rare', thumb: 'face' }),
  // ---- accessories: head ------------------------------------------------------------
  acc('acc.cap', 'Boné', 'head', 'Boné de aba curva.', 'acc.cap', ['casual'], { palette: 'hat', defaultColor: 'brick', thumb: 'head' }),
  acc('acc.beanie', 'Gorro', 'head', 'Gorro de lã com pompom.', 'acc.beanie', ['casual'], { palette: 'hat', defaultColor: 'blue', thumb: 'head' }),
  acc('acc.fedora', 'Chapéu', 'head', 'Chapéu de aba curta com fita.', 'acc.fedora', ['corporate'], { palette: 'hat', defaultColor: 'brown', rarity: 'uncommon', thumb: 'head' }),
  acc('acc.bucket', 'Chapéu bucket', 'head', 'Chapéu de aba caída.', 'acc.bucket', ['casual'], { palette: 'hat', defaultColor: 'sand', rarity: 'uncommon', thumb: 'head' }),
  // ---- accessories: ears ------------------------------------------------------------
  acc('acc.headphones', 'Fones', 'ears', 'Fones de ouvido grandes.', 'acc.headphones', ['tech'], { palette: 'gadget', defaultColor: 'red', excludes: ['head'], thumb: 'head' }),
  acc('acc.headset', 'Headset com microfone', 'ears', 'Headset de reunião com microfone.', 'acc.headset', ['tech', 'corporate'], { palette: 'gadget', defaultColor: 'blue', excludes: ['head'], thumb: 'head' }),
  // ---- accessories: back / wrist ---------------------------------------------------------
  acc('acc.backpack', 'Mochila', 'back', 'Mochila de alças duplas.', 'acc.backpack', ['casual'], { palette: 'bag', defaultColor: 'navy', thumb: 'back' }),
  acc('acc.watch', 'Relógio', 'wrist', 'Relógio de pulso clássico.', 'acc.watch', ['corporate'], { palette: 'strap', defaultColor: 'brown', thumb: 'wrist' }),
  acc('acc.smartwatch', 'Smartwatch', 'wrist', 'Relógio inteligente com tela acesa.', 'acc.watch', ['tech'], { palette: 'strap', defaultColor: 'black', params: { variant: 'smart' }, rarity: 'uncommon', thumb: 'wrist' }),

  // ---- special items ------------------------------------------------------------------
  special('sp.notebook', 'Notebook', 'hand', 'Notebook: carregado fechado em pé; aberto no colo ao sentar.', 'sp.notebook', ['tech', 'trabalho'], {
    palette: 'device',
    defaultColor: 'silver',
    thumb: 'hand',
    poses: { idle: 'full', walk: 'hidden', sit: 'full', wave: 'hidden' },
    notes: 'Sem sprite para andar e acenar: fica oculto nessas poses.',
  }),
  special('sp.tablet', 'Tablet', 'hand', 'Tablet segurado na frente do corpo.', 'sp.tablet', ['tech', 'trabalho'], {
    palette: 'device',
    defaultColor: 'black',
    thumb: 'hand',
    poses: { idle: 'full', walk: 'hidden', sit: 'full', wave: 'hidden' },
    notes: 'Sem sprite para andar e acenar: fica oculto nessas poses.',
  }),
  special('sp.mug', 'Caneca de café', 'hand', 'Caneca fumegante segurada com a mão.', 'sp.mug', ['café'], {
    palette: 'ceramic',
    defaultColor: 'white',
    thumb: 'hand',
    poses: { idle: 'full', walk: 'adapted', sit: 'full', wave: 'hidden' },
    notes: 'Ao andar, o braço segue erguido com a caneca. Ao acenar a caneca fica oculta (não há sprite).',
  }),
  special('sp.mug_gold', 'Caneca dourada', 'hand', 'Caneca dourada de quem é fã de café.', 'sp.mug', ['café', 'desbloqueável'], {
    unlock: 'achievement:coffee-lover',
    rarity: 'epic',
    params: { gold: true },
    thumb: 'hand',
    poses: { idle: 'full', walk: 'adapted', sit: 'full', wave: 'hidden' },
    notes: 'Mesmo desenho da caneca, cores fixas douradas.',
  }),
  special('sp.badge', 'Crachá corporativo', 'badge', 'Crachá no cordão, sobre o peito.', 'sp.badge', ['corporate', 'trabalho'], { palette: 'lanyard', defaultColor: 'blue', thumb: 'torso' }),
  special('sp.badge_staff', 'Crachá da equipe', 'badge', 'Crachá dourado reservado à equipe WorkVerse.', 'sp.badge', ['corporate', 'desbloqueável'], {
    unlock: 'staff',
    rarity: 'legendary',
    params: { staff: true },
    thumb: 'torso',
  }),
  special('sp.party_hat', 'Chapéu de aniversário', 'head', 'Cone de festa, para comemorar o aniversário da casa.', 'sp.party_hat', ['comemorativo', 'sazonal', 'desbloqueável'], {
    palette: 'hat',
    colors: ['pink', 'blue', 'yellow', 'green'],
    defaultColor: 'pink',
    unlock: 'event:aniversario',
    rarity: 'rare',
    thumb: 'head',
  }),
  special('sp.santa_hat', 'Gorro de Natal', 'head', 'Gorro vermelho com pompom, no clima de fim de ano.', 'sp.santa_hat', ['sazonal', 'desbloqueável'], {
    unlock: 'event:natal',
    availability: 'upcoming',
    rarity: 'rare',
    thumb: 'head',
    notes: 'Previsto para o evento de fim de ano; ainda não pode ser equipado.',
  }),
];

// ---------------------------------------------------------------------------
// Lookups

export const ITEMS_BY_ID: ReadonlyMap<string, ItemDef> = new Map(ITEMS.map((i) => [i.id, i]));

export const getItem = (id: string): ItemDef | undefined => ITEMS_BY_ID.get(id);

export const itemsInCategory = (category: ItemCategory): ItemDef[] => ITEMS.filter((i) => i.category === category);
export const itemsInSlot = (slot: ItemSlot): ItemDef[] => ITEMS.filter((i) => i.slot === slot);

/** Colors an item allows (palette order). Empty when the item has fixed colors. */
export function itemColors(item: ItemDef) {
  if (!item.palette) return [];
  const all = PALETTES[item.palette].colors;
  return item.colors ? all.filter((c) => item.colors!.includes(c.id)) : all;
}

export function defaultColorOf(item: ItemDef): string | undefined {
  if (!item.palette) return undefined;
  return item.defaultColor ?? itemColors(item)[0]?.id;
}

export const poseMode = (item: ItemDef, pose: Pose): PoseMode => item.poses[pose];

export const thumbFocusOf = (item: ItemDef): ThumbFocus => item.thumb ?? 'full';

export type { PaletteId };
