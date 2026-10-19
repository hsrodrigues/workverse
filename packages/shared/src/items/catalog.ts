import { PALETTES } from './palettes';
import { EVENT_ITEMS } from './eventItems';
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

  it({ id: 'mouth.lips', name: 'Batom', description: 'Sorriso com batom, na cor que você escolher.', drawer: 'mouth.lips', category: 'face', slot: 'mouth', palette: 'lip', defaultColor: 'red', thumb: 'face', tags: ['maquiagem', 'feminino', 'feliz'] }),
  it({ id: 'mouth.lips_bold', name: 'Batom marcante', description: 'Lábios cheios com batom e brilho.', drawer: 'mouth.lips', category: 'face', slot: 'mouth', palette: 'lip', defaultColor: 'crimson', params: { bold: true }, thumb: 'face', tags: ['maquiagem', 'feminino'] }),
  it({ id: 'acc.blush', name: 'Blush', description: 'Bochechas coradas.', drawer: 'acc.blush', category: 'accessories', slot: 'cheeks', palette: 'lip', colors: ['pink', 'coral', 'rose', 'nude', 'red'], defaultColor: 'pink', thumb: 'face', tags: ['maquiagem', 'feminino'] }),
  it({ id: 'acc.freckles', name: 'Sardas', description: 'Sardinhas no nariz e nas bochechas.', drawer: 'acc.freckles', category: 'accessories', slot: 'freckles', thumb: 'face', tags: ['maquiagem', 'unissex'] }),
  it({ id: 'acc.eyeshadow', name: 'Sombra', description: 'Sombra colorida nas pálpebras.', drawer: 'acc.eyeshadow', category: 'accessories', slot: 'lids', palette: 'shadow', defaultColor: 'lilac', thumb: 'face', tags: ['maquiagem', 'feminino'] }),
  // ---- tops ----------------------------------------------------------
  top('top.tee', 'Camiseta', 'Camiseta de manga curta.', 'top.tee', ['casual']),
  top('top.tank', 'Regata', 'Camiseta sem mangas.', 'top.tee', ['casual'], { params: { variant: 'tank' } }),
  top('top.striped', 'Camiseta listrada', 'Camiseta com listras horizontais.', 'top.tee', ['casual'], { params: { variant: 'striped' } }),
  top('top.wv', 'Camiseta WorkVerse', 'Uniforme oficial da casa, com o logo no peito.', 'top.tee', ['uniform', 'casual'], { params: { variant: 'logo' }, rarity: 'uncommon', defaultColor: 'navy' }),
  top('top.shirt', 'Camisa social', 'Camisa de manga longa com colarinho.', 'top.shirt', ['corporate'], { defaultColor: 'off-white' }),
  top('top.polo', 'Polo', 'Polo com gola e dois botões.', 'top.polo', ['casual', 'corporate']),
  top('top.hoodie', 'Moletom', 'Moletom com capuz, cordões e bolso canguru.', 'top.hoodie', ['casual']),
  top('top.sweater', 'Suéter', 'Suéter de tricô com gola alta.', 'top.sweater', ['casual'], { rarity: 'uncommon' }),

  // more tops: shirts, knits, prints and team wear (the variants share the tee/shirt/polo/hoodie/sweater drawers)
  top('top.plaid', 'Camisa xadrez', 'Camisa de flanela xadrez, com colarinho e botões.', 'top.shirt', ['casual'], { params: { pattern: 'plaid' }, defaultColor: 'red' }),
  top('top.turtleneck', 'Blusa de gola alta', 'Malha fina com gola alta dobrada.', 'top.sweater', ['casual', 'corporate'], { params: { variant: 'turtle' }, defaultColor: 'wine' }),
  top('top.longsleeve', 'Camiseta manga longa', 'Malha básica de manga comprida.', 'top.tee', ['casual'], { params: { variant: 'long' } }),
  top('top.vneck', 'Camiseta gola V', 'Camiseta de manga curta com decote em V.', 'top.tee', ['casual'], { params: { variant: 'vneck' }, defaultColor: 'teal' }),
  top('top.henley', 'Henley', 'Malha de manga longa com três botões no peito.', 'top.tee', ['casual'], { params: { variant: 'henley' }, defaultColor: 'olive' }),
  top('top.print_bolt', 'Camiseta raio', 'Camiseta estampada com um raio amarelo.', 'top.tee', ['casual', 'estampada'], { params: { print: 'bolt' }, defaultColor: 'navy' }),
  top('top.print_heart', 'Camiseta coração', 'Camiseta estampada com um coração pixelado.', 'top.tee', ['casual', 'estampada'], { params: { print: 'heart' }, defaultColor: 'off-white' }),
  top('top.baseball', 'Camisa raglan', 'Camisa de manga longa com mangas em contraste.', 'top.tee', ['casual', 'esporte'], { params: { variant: 'raglan' }, defaultColor: 'red' }),
  top('top.jersey', 'Camisa de time', 'Camisa esportiva com gola V e o número 10.', 'top.tee', ['esporte', 'uniform'], { params: { variant: 'jersey' }, defaultColor: 'yellow', rarity: 'epic', unlock: 'event:aniversario' }),
  top('top.sweatshirt', 'Moletom sem capuz', 'Moletom de gola redonda, punhos e barra de ribana.', 'top.sweater', ['casual'], { params: { variant: 'sweat' }, defaultColor: 'gray' }),
  top('top.rugby', 'Camisa rugby', 'Polo de manga longa com listras largas e gola branca.', 'top.polo', ['casual', 'esporte'], { params: { variant: 'rugby' }, defaultColor: 'navy' }),
  top('top.hoodie_zip', 'Moletom com zíper', 'Moletom com capuz, zíper na frente e bolsos.', 'top.hoodie', ['casual'], { params: { zip: true }, defaultColor: 'slate' }),

  // feminine tops (bodice kit: straps, strapless, off-shoulder, halter, crop...)
  top('top.crop', 'Cropped', 'Blusa curta de mangas curtas, deixa a barriga à mostra.', 'fem.top', ['casual', 'feminino'], { params: { variant: 'crop' }, defaultColor: 'rose' }),
  top('top.cami', 'Regata de alcinha', 'Top de alças finas com decote em U.', 'fem.top', ['casual', 'feminino'], { params: { variant: 'cami' }, defaultColor: 'sky' }),
  top('top.ruffle', 'Blusa de babado', 'Blusa de mangas bufantes com babados no decote e na barra.', 'fem.top', ['casual', 'feminino'], { params: { variant: 'ruffle' }, defaultColor: 'off-white' }),
  top('top.bowblouse', 'Camisa com laço', 'Camisa de manga longa com laço grande na gola.', 'fem.top', ['corporate', 'feminino'], { params: { variant: 'bowblouse' }, defaultColor: 'rose', rarity: 'uncommon' }),
  top('top.body', 'Body manga longa', 'Body justo de decote redondo e fundo.', 'fem.top', ['casual', 'feminino'], { params: { variant: 'body' }, defaultColor: 'charcoal' }),
  top('top.offshoulder', 'Ciganinha', 'Blusa ombro a ombro com babado e mangas curtas.', 'fem.top', ['casual', 'feminino'], { params: { variant: 'offshoulder' }, defaultColor: 'coral' }),
  top('top.tube', 'Tomara que caia', 'Top sem alças com borda reta.', 'fem.top', ['casual', 'feminino'], { params: { variant: 'tube' }, defaultColor: 'violet' }),
  top('top.shortknit', 'Suéter curto', 'Suéter de tricô curto, de mangas compridas.', 'fem.top', ['casual', 'feminino'], { params: { variant: 'shortknit' }, defaultColor: 'sand' }),
  top('top.babytee', 'Baby look', 'Camiseta justinha com uma estrelinha estampada.', 'fem.top', ['casual', 'feminino'], { params: { variant: 'babytee' }, defaultColor: 'rose' }),
  top('top.sport', 'Top esportivo', 'Top de treino com alças largas e faixa na barra.', 'fem.top', ['esporte', 'feminino'], { params: { variant: 'sport' }, defaultColor: 'magenta' }),
  top('top.halter', 'Frente única', 'Blusa com alças que se cruzam atrás do pescoço.', 'fem.top', ['casual', 'feminino'], { params: { variant: 'halter' }, defaultColor: 'teal' }),

  // dresses: one-piece garments take the top slot and cover the bottom (the saved bottom just is not drawn)
  top('dress.short', 'Vestido curto', 'Vestido curtinho de alças finas. Peça inteira: cobre a parte de baixo.', 'fem.dress', ['vestido', 'casual', 'feminino'], { params: { variant: 'short' }, covers: ['bottom'], thumb: 'full', defaultColor: 'coral' }),
  top('dress.midi', 'Vestido midi', 'Vestido midi com decote em V, mangas curtas e cinto dourado. Peça inteira.', 'fem.dress', ['vestido', 'casual', 'corporate', 'feminino'], { params: { variant: 'midi' }, covers: ['bottom'], thumb: 'full', defaultColor: 'teal' }),
  top('dress.long', 'Vestido longo', 'Vestido longo e fluido de alças largas. Peça inteira.', 'fem.dress', ['vestido', 'festa', 'feminino'], { params: { variant: 'long' }, covers: ['bottom'], thumb: 'full', defaultColor: 'wine', rarity: 'uncommon' }),
  top('dress.floral', 'Vestido florido', 'Vestido midi estampado de florzinhas. Peça inteira.', 'fem.dress', ['vestido', 'casual', 'feminino'], { params: { variant: 'floral' }, covers: ['bottom'], thumb: 'full', defaultColor: 'sky' }),
  top('dress.party', 'Vestido de festa', 'Vestido tomara que caia com brilhos e saia rodada. Peça inteira.', 'fem.dress', ['vestido', 'festa', 'feminino'], { params: { variant: 'party' }, covers: ['bottom'], thumb: 'full', defaultColor: 'violet', rarity: 'uncommon' }),
  top('dress.formal', 'Vestido social', 'Vestido chemise de gola e botões, com cinto. Peça inteira.', 'fem.dress', ['vestido', 'corporate', 'feminino'], { params: { variant: 'formal' }, covers: ['bottom'], thumb: 'full', defaultColor: 'navy' }),
  top('dress.sheath', 'Vestido tubinho', 'Tubinho justo até o joelho. Peça inteira.', 'fem.dress', ['vestido', 'corporate', 'feminino'], { params: { variant: 'sheath' }, covers: ['bottom'], thumb: 'full', defaultColor: 'charcoal' }),
  top('dress.strap', 'Vestido de alças', 'Vestido de alças largas com laço sob o busto. Peça inteira.', 'fem.dress', ['vestido', 'casual', 'feminino'], { params: { variant: 'strap' }, covers: ['bottom'], thumb: 'full', defaultColor: 'rose' }),

  // ---- outer layer (over the top) ----------------------------------------------------
  outer('outer.blazer', 'Blazer', 'Blazer com lapelas sobre a camisa.', 'outer.blazer', ['corporate'], { rarity: 'uncommon' }),
  outer('outer.bomber', 'Jaqueta bomber', 'Jaqueta fechada com punhos e barra de elástico.', 'outer.bomber', ['casual'], { defaultColor: 'olive', rarity: 'uncommon' }),
  outer('outer.cardigan', 'Cardigã', 'Casaco de tricô aberto na frente.', 'outer.cardigan', ['casual', 'corporate'], { defaultColor: 'sand' }),
  outer('outer.vest', 'Colete corporativo', 'Colete sem mangas sobre a camisa.', 'outer.vest', ['corporate', 'uniform'], { defaultColor: 'navy' }),
  outer('outer.apron', 'Avental de barista', 'Avental com bolso, para quem cuida do café.', 'outer.apron', ['uniform'], { defaultColor: 'brown', rarity: 'uncommon' }),

  // more outer layers
  outer('outer.denim', 'Jaqueta jeans', 'Jaqueta jeans com bolsos no peito e costuras claras.', 'outer.denim', ['casual'], { defaultColor: 'denim' }),
  outer('outer.leather', 'Jaqueta de couro', 'Jaqueta motoqueira com zíper atravessado e lapelas largas.', 'outer.leather', ['casual'], { defaultColor: 'charcoal', rarity: 'epic', unlock: 'achievement:night-owl' }),
  outer('outer.parka', 'Parka', 'Parka comprida com capuz de pelo, para os dias de frio.', 'outer.parka', ['casual'], { defaultColor: 'olive', rarity: 'rare', unlock: 'achievement:team-player' }),
  outer('outer.blazer_double', 'Blazer trespassado', 'Blazer de duas fileiras de botões e lapelas em pico.', 'outer.blazer_double', ['corporate'], { defaultColor: 'navy', rarity: 'uncommon' }),
  outer('outer.raincoat', 'Capa de chuva', 'Capa impermeável com capuz e botões de pressão.', 'outer.raincoat', ['casual'], { defaultColor: 'yellow' }),
  outer('outer.labcoat', 'Jaleco', 'Jaleco branco comprido com três bolsos.', 'outer.labcoat', ['uniform'], { defaultColor: 'off-white' }),
  outer('outer.puffer', 'Jaqueta acolchoada', 'Jaqueta de gomos, fofa e quentinha.', 'outer.puffer', ['casual'], { defaultColor: 'blue', rarity: 'uncommon' }),

  // feminine outer layers
  outer('outer.blazer_fit', 'Blazer ajustado', 'Blazer de cintura marcada e barra evasê, com lapelas e botões dourados.', 'outer.blazer_fit', ['corporate', 'feminino'], { defaultColor: 'wine', rarity: 'uncommon' }),
  outer('outer.kimono', 'Quimono', 'Quimono longo e aberto, de mangas largas e faixa na cintura.', 'outer.kimono', ['casual', 'feminino'], { defaultColor: 'violet', rarity: 'uncommon' }),
  outer('outer.capelet', 'Capa curta', 'Capa curta sobre os ombros, com gola, botões e barra recortada.', 'outer.capelet', ['casual', 'feminino'], { defaultColor: 'sand', rarity: 'uncommon' }),
  outer('outer.crop_jacket', 'Jaqueta cropped', 'Jaqueta curta de zíper dourado e gola de pontas.', 'outer.crop_jacket', ['casual', 'feminino'], { defaultColor: 'rose' }),

  // ---- bottoms ----------------------------------------------------------------
  bottom('bottom.pants', 'Calça', 'Calça reta casual.', 'bottom.pants', ['casual']),
  bottom('bottom.jeans', 'Calça jeans', 'Jeans com costuras aparentes.', 'bottom.pants', ['casual'], { params: { variant: 'jeans' }, defaultColor: 'denim' }),
  bottom('bottom.cargo', 'Calça cargo', 'Calça com bolsos laterais.', 'bottom.pants', ['casual'], { params: { variant: 'cargo' }, defaultColor: 'khaki' }),
  bottom('bottom.dress', 'Calça social', 'Calça de alfaiataria com vinco.', 'bottom.pants', ['corporate'], { params: { variant: 'dress' } }),
  bottom('bottom.shorts', 'Bermuda', 'Bermuda na altura do joelho.', 'bottom.shorts', ['casual']),
  bottom('bottom.skirt', 'Saia', 'Saia evasê com pregas.', 'bottom.skirt', ['casual'], { defaultColor: 'wine' }),
  bottom('bottom.pencil', 'Saia lápis', 'Saia justa de escritório.', 'bottom.skirt', ['corporate'], { params: { variant: 'pencil' }, defaultColor: 'charcoal' }),

  // more bottoms
  bottom('bottom.leggings', 'Legging', 'Legging justa, de cós alto.', 'bottom.leggings', ['casual', 'esporte'], { defaultColor: 'charcoal' }),
  bottom('bottom.joggers', 'Calça de moletom', 'Jogger com cordão na cintura e punhos nos tornozelos.', 'bottom.joggers', ['casual'], { defaultColor: 'gray' }),
  bottom('bottom.track', 'Calça esportiva', 'Calça de treino com listra lateral.', 'bottom.joggers', ['casual', 'esporte'], { params: { variant: 'track' }, defaultColor: 'navy' }),
  bottom('bottom.shorts_denim', 'Bermuda jeans', 'Bermuda jeans com barra dobrada.', 'bottom.shorts_kit', ['casual'], { params: { variant: 'denim' }, defaultColor: 'light-denim' }),
  bottom('bottom.shorts_cargo', 'Bermuda cargo', 'Bermuda larga com bolsos nas pernas.', 'bottom.shorts_kit', ['casual'], { params: { variant: 'cargo' }, defaultColor: 'khaki' }),
  bottom('bottom.pleated', 'Saia plissada', 'Saia curta de pregas, xadrez.', 'bottom.skirt_kit', ['casual'], { params: { variant: 'pleated' }, defaultColor: 'navy' }),
  bottom('bottom.mini', 'Minissaia', 'Saia bem curta, levemente evasê.', 'bottom.skirt_kit', ['casual'], { params: { variant: 'mini' }, defaultColor: 'rose' }),
  bottom('bottom.midi', 'Saia midi', 'Saia fluida até abaixo do joelho.', 'bottom.skirt_kit', ['casual', 'corporate'], { params: { variant: 'midi' }, defaultColor: 'forest' }),

  // feminine bottoms
  bottom('bottom.circle', 'Saia rodada', 'Saia bem rodada até o joelho.', 'fem.bottom', ['casual', 'feminino'], { params: { variant: 'circle' }, defaultColor: 'coral' }),
  bottom('bottom.skirt_denim', 'Saia jeans', 'Saia jeans curta com botões na frente.', 'fem.bottom', ['casual', 'feminino'], { params: { variant: 'denim' }, defaultColor: 'denim' }),
  bottom('bottom.pinafore', 'Jardineira', 'Jardineira de saia curta, com peitilho e alças. Vai por cima da blusa.', 'fem.bottom', ['casual', 'feminino'], { params: { variant: 'pinafore' }, defaultColor: 'light-denim' }),
  bottom('bottom.shorts_hw', 'Short cintura alta', 'Short curtinho de cintura alta com botão.', 'fem.bottom', ['casual', 'feminino'], { params: { variant: 'shorts_hw' }, defaultColor: 'light-denim' }),
  bottom('bottom.skinny', 'Calça skinny', 'Calça justa nas pernas, de costuras claras.', 'fem.bottom', ['casual', 'feminino'], { params: { variant: 'skinny' }, defaultColor: 'denim' }),
  bottom('bottom.wide', 'Calça pantalona', 'Calça de perna larga e vinco marcado.', 'fem.bottom', ['casual', 'corporate', 'feminino'], { params: { variant: 'wide' }, defaultColor: 'sand' }),

  // ---- shoes ------------------------------------------------------------------
  shoes('shoes.sneakers', 'Tênis', 'Tênis casual com solado branco.', 'shoes.sneakers', ['casual']),
  shoes('shoes.runner', 'Tênis de corrida', 'Tênis leve com faixa contrastante.', 'shoes.sneakers', ['casual'], { params: { variant: 'runner' }, defaultColor: 'blue' }),
  shoes('shoes.hightop', 'Tênis cano alto', 'Cano alto com ponteira.', 'shoes.sneakers', ['casual'], { params: { variant: 'high' } }),
  shoes('shoes.dress', 'Sapato social', 'Sapato de couro lustroso.', 'shoes.dress', ['corporate']),
  shoes('shoes.loafer', 'Mocassim', 'Mocassim baixo com detalhe lateral.', 'shoes.dress', ['corporate'], { params: { variant: 'loafer' }, defaultColor: 'brown' }),
  shoes('shoes.boots', 'Bota', 'Bota de cano médio.', 'shoes.boots', ['casual'], { defaultColor: 'brown' }),


  // more shoes
  shoes('shoes.sandals', 'Sandália', 'Sandália de tiras com sola de couro.', 'shoes.open', ['casual'], { defaultColor: 'tan' }),
  shoes('shoes.flipflops', 'Chinelo', 'Chinelo de dedo, para o fim de semana.', 'shoes.open', ['casual'], { params: { variant: 'flip' }, defaultColor: 'blue' }),
  shoes('shoes.heels', 'Salto alto', 'Scarpin de salto fino e bico fino.', 'shoes.open', ['corporate'], { params: { variant: 'heel' }, defaultColor: 'burgundy', rarity: 'uncommon' }),
  shoes('shoes.chelsea', 'Botina chelsea', 'Botina de cano baixo com elástico na lateral.', 'shoes.boot_kit', ['casual', 'corporate'], { params: { variant: 'chelsea' }, defaultColor: 'brown' }),
  shoes('shoes.combat', 'Coturno', 'Bota de cadarço com sola grossa.', 'shoes.boot_kit', ['casual'], { params: { variant: 'combat' }, defaultColor: 'black', rarity: 'uncommon' }),
  shoes('shoes.rain', 'Galocha', 'Bota de borracha brilhante, à prova d\'água.', 'shoes.boot_kit', ['casual'], { params: { variant: 'rain' }, defaultColor: 'yellow' }),
  shoes('shoes.slipon', 'Slip-on', 'Tênis de lona sem cadarço, com sola listrada.', 'shoes.flat_kit', ['casual'], { params: { variant: 'slipon' }, defaultColor: 'navy' }),
  shoes('shoes.colorblock', 'Tênis colorido', 'Tênis retrô com painéis em cores contrastantes.', 'shoes.flat_kit', ['casual'], { params: { variant: 'block' }, defaultColor: 'white' }),

  // feminine shoes
  shoes('shoes.blockheel', 'Salto bloco', 'Scarpin de salto grosso e bico arredondado.', 'shoes.pump_kit', ['casual', 'corporate', 'feminino'], { params: { variant: 'block' }, defaultColor: 'tan' }),
  shoes('shoes.ballet', 'Sapatilha', 'Sapatilha baixa com lacinho no bico.', 'shoes.pump_kit', ['casual', 'feminino'], { params: { variant: 'ballet' }, defaultColor: 'pink' }),
  shoes('shoes.maryjane', 'Boneca', 'Sapato boneca de tira no tornozelo e fivela.', 'shoes.pump_kit', ['casual', 'feminino'], { params: { variant: 'mary' }, defaultColor: 'red' }),
  shoes('shoes.platform', 'Plataforma', 'Sapato de plataforma alta com salto bloco.', 'shoes.pump_kit', ['casual', 'feminino'], { params: { variant: 'platform' }, defaultColor: 'black', rarity: 'uncommon' }),
  shoes('shoes.sandalheel', 'Sandália de salto', 'Sandália de tiras finas e salto bloco.', 'shoes.sandal_heel', ['casual', 'feminino'], { defaultColor: 'tan' }),
  shoes('shoes.ankleheel', 'Bota cano curto com salto', 'Botina de salto bloco com zíper lateral.', 'shoes.boot_heel', ['casual', 'feminino'], { params: { variant: 'ankle' }, defaultColor: 'brown' }),
  shoes('shoes.kneeboot', 'Bota cano alto', 'Bota de cano alto até o joelho, de salto.', 'shoes.boot_heel', ['casual', 'feminino'], { params: { variant: 'knee' }, defaultColor: 'black', rarity: 'uncommon' }),
  shoes('shoes.sneakerfem', 'Tênis plataforma', 'Tênis branco de sola alta e lacinho rosa.', 'shoes.sneaker_fem', ['casual', 'feminino'], { defaultColor: 'white' }),

  // ---- accessories: eyewear -----------------------------------------------------------
  acc('acc.glasses', 'Óculos de grau', 'eyewear', 'Armação fina com lentes claras.', 'acc.glasses', ['grau'], { palette: 'frame', defaultColor: 'black', thumb: 'face' }),
  acc('acc.glasses_round', 'Óculos redondos', 'eyewear', 'Armação redonda, estilo retrô.', 'acc.glasses', ['grau'], { palette: 'frame', defaultColor: 'tortoise', params: { variant: 'round' }, thumb: 'face' }),
  acc('acc.sunglasses', 'Óculos escuros', 'eyewear', 'Lentes escuras.', 'acc.sunglasses', ['sol'], { palette: 'frame', defaultColor: 'ink', thumb: 'face' }),
  acc('acc.ar', 'Óculos AR', 'eyewear', 'Óculos de realidade aumentada com brilho nas hastes.', 'acc.ar', ['tech'], { palette: 'gadget', defaultColor: 'blue', rarity: 'rare', thumb: 'face' }),
  acc('acc.glasses_square', 'Óculos quadrados', 'eyewear', 'Armação grossa e quadrada.', 'acc.eyewear_kit', ['grau'], { palette: 'frame', defaultColor: 'tortoise', params: { shape: 'square' }, thumb: 'face' }),
  acc('acc.aviator', 'Óculos aviador', 'eyewear', 'Lentes em gota com armação fina.', 'acc.eyewear_kit', ['sol'], { palette: 'frame', defaultColor: 'gold', params: { shape: 'aviator' }, rarity: 'uncommon', thumb: 'face' }),
  acc('acc.cateye', 'Óculos gatinho', 'eyewear', 'Armação com as pontas erguidas.', 'acc.eyewear_kit', ['grau'], { palette: 'frame', defaultColor: 'red', params: { shape: 'cat' }, thumb: 'face' }),
  acc('acc.shades_round', 'Óculos redondos escuros', 'eyewear', 'Lentes redondas escuras, estilo retrô.', 'acc.eyewear_kit', ['sol'], { palette: 'frame', defaultColor: 'gold', params: { shape: 'roundsun' }, thumb: 'face' }),
  // ---- accessories: head ------------------------------------------------------------
  acc('acc.cap', 'Boné', 'head', 'Boné de aba curva.', 'acc.cap', ['casual'], { palette: 'hat', defaultColor: 'brick', thumb: 'head' }),
  acc('acc.beanie', 'Gorro', 'head', 'Gorro de lã com pompom.', 'acc.beanie', ['casual'], { palette: 'hat', defaultColor: 'blue', thumb: 'head' }),
  acc('acc.fedora', 'Chapéu', 'head', 'Chapéu de aba curta com fita.', 'acc.fedora', ['corporate'], { palette: 'hat', defaultColor: 'brown', rarity: 'uncommon', thumb: 'head' }),
  acc('acc.bucket', 'Chapéu bucket', 'head', 'Chapéu de aba caída.', 'acc.bucket', ['casual'], { palette: 'hat', defaultColor: 'sand', rarity: 'uncommon', thumb: 'head' }),
  acc('acc.straw', 'Chapéu de palha', 'head', 'Chapéu de palha trançada de aba larga.', 'acc.hat_kit', ['casual', 'verão'], { palette: 'hat', defaultColor: 'sand', params: { shape: 'straw' }, thumb: 'head' }),
  acc('acc.beret', 'Boina', 'head', 'Boina de lã levemente inclinada.', 'acc.hat_kit', ['casual'], { palette: 'hat', defaultColor: 'brick', params: { shape: 'beret' }, thumb: 'head' }),
  acc('acc.snapback', 'Boné aba reta', 'head', 'Boné de aba reta e plana.', 'acc.snapback', ['casual'], { palette: 'hat', defaultColor: 'black', thumb: 'head' }),
  acc('acc.headband', 'Faixa de cabelo', 'head', 'Faixa larga que deixa o cabelo à mostra.', 'acc.hat_kit', ['casual', 'esporte'], { palette: 'hat', defaultColor: 'pink', params: { shape: 'headband', openTop: true }, thumb: 'head' }),
  acc('acc.hairbow', 'Laço de cabelo', 'head', 'Laço grande preso no alto da cabeça.', 'acc.hat_kit', ['casual'], { palette: 'hat', defaultColor: 'pink', params: { shape: 'bow', openTop: true }, thumb: 'head' }),
  // ---- accessories: ears ------------------------------------------------------------
  acc('acc.headphones', 'Fones', 'ears', 'Fones de ouvido grandes.', 'acc.headphones', ['tech'], { palette: 'gadget', defaultColor: 'red', excludes: ['head'], thumb: 'head' }),
  acc('acc.headset', 'Headset com microfone', 'ears', 'Headset de reunião com microfone.', 'acc.headset', ['tech', 'corporate'], { palette: 'gadget', defaultColor: 'blue', excludes: ['head'], thumb: 'head' }),
  acc('acc.hoops', 'Argolas', 'ears', 'Brincos de argola.', 'acc.ear_kit', ['joia'], { palette: 'frame', defaultColor: 'gold', params: { shape: 'hoop' }, thumb: 'head' }),
  acc('acc.earbuds', 'Fones sem fio', 'ears', 'Fones intra-auriculares sem fio.', 'acc.ear_kit', ['tech'], { palette: 'gadget', defaultColor: 'white', params: { shape: 'buds' }, thumb: 'head' }),
  // ---- accessories: neck ---------------------------------------------------------------
  acc('acc.scarf', 'Cachecol', 'neck', 'Cachecol de lã enrolado no pescoço.', 'acc.neck_kit', ['casual', 'inverno'], { palette: 'cloth', defaultColor: 'red', params: { shape: 'scarf' }, thumb: 'torso' }),
  acc('acc.tie', 'Gravata', 'neck', 'Gravata clássica com nó.', 'acc.neck_kit', ['corporate'], { palette: 'cloth', defaultColor: 'wine', params: { shape: 'tie' }, thumb: 'torso' }),
  acc('acc.bowtie', 'Gravata borboleta', 'neck', 'Gravata borboleta, para os dias de gala.', 'acc.neck_kit', ['corporate'], { palette: 'cloth', defaultColor: 'wine', params: { shape: 'bow' }, thumb: 'torso' }),
  acc('acc.necklace', 'Colar', 'neck', 'Colar fino com um pingente.', 'acc.neck_kit', ['joia'], { palette: 'frame', defaultColor: 'gold', params: { shape: 'necklace' }, thumb: 'torso' }),
  // ---- accessories: back / wrist ---------------------------------------------------------
  acc('acc.backpack', 'Mochila', 'back', 'Mochila de alças duplas.', 'acc.backpack', ['casual'], { palette: 'bag', defaultColor: 'navy', thumb: 'back' }),
  acc('acc.watch', 'Relógio', 'wrist', 'Relógio de pulso clássico.', 'acc.watch', ['corporate'], { palette: 'strap', defaultColor: 'brown', thumb: 'wrist' }),
  acc('acc.smartwatch', 'Smartwatch', 'wrist', 'Relógio inteligente com tela acesa.', 'acc.watch', ['tech'], { palette: 'strap', defaultColor: 'black', params: { variant: 'smart' }, rarity: 'uncommon', thumb: 'wrist' }),
  acc('acc.bracelet', 'Pulseira', 'wrist', 'Pulseira de contas coloridas.', 'acc.wrist_kit', ['casual'], { palette: 'strap', defaultColor: 'red', params: { shape: 'beads' }, thumb: 'wrist' }),
  acc('acc.wristband', 'Munhequeira', 'wrist', 'Faixa de tecido para o pulso, de quem treina.', 'acc.wrist_kit', ['esporte'], { palette: 'strap', defaultColor: 'white', params: { shape: 'sweat' }, thumb: 'wrist' }),
  acc('acc.crossbody', 'Bolsa transversal', 'back', 'Bolsa pequena com alça cruzada no peito.', 'acc.bag_kit', ['casual'], { palette: 'bag', defaultColor: 'brown', thumb: 'torso' }),
  // feminine accessories
  acc('acc.pearl_ear', 'Brincos de pérola', 'ears', 'Brincos de pérola clássicos.', 'acc.ear_kit', ['joia', 'feminino'], { params: { shape: 'pearl' }, thumb: 'head' }),
  acc('acc.hoops_big', 'Argolas grandes', 'ears', 'Argolas grandes e marcantes.', 'acc.ear_kit', ['joia', 'feminino'], { palette: 'frame', defaultColor: 'gold', params: { shape: 'hoopbig' }, thumb: 'head' }),
  acc('acc.drops', 'Brincos de pingente', 'ears', 'Brincos com pingente de pedra vermelha.', 'acc.ear_kit', ['joia', 'feminino'], { palette: 'frame', defaultColor: 'gold', params: { shape: 'drop' }, rarity: 'uncommon', thumb: 'head' }),
  acc('acc.pearls', 'Colar de pérolas', 'neck', 'Fio de pérolas no pescoço.', 'acc.neck_kit', ['joia', 'feminino'], { params: { shape: 'pearls' }, rarity: 'uncommon', thumb: 'torso' }),
  acc('acc.pendant', 'Colar com pingente', 'neck', 'Corrente longa com uma pedra vermelha.', 'acc.neck_kit', ['joia', 'feminino'], { palette: 'frame', defaultColor: 'gold', params: { shape: 'pendant' }, thumb: 'torso' }),
  acc('acc.choker', 'Gargantilha', 'neck', 'Gargantilha justa com um coraçãozinho.', 'acc.neck_kit', ['joia', 'feminino'], { palette: 'strap', defaultColor: 'black', params: { shape: 'choker' }, thumb: 'torso' }),
  acc('acc.silkscarf', 'Lenço de seda', 'neck', 'Lenço de bolinhas amarrado no pescoço.', 'acc.neck_kit', ['feminino'], { palette: 'cloth', defaultColor: 'red', params: { shape: 'silk' }, thumb: 'torso' }),
  acc('acc.tiara', 'Tiara', 'head', 'Tiara delicada com pedrinhas.', 'acc.hat_kit', ['joia', 'feminino'], { palette: 'frame', defaultColor: 'gold', params: { shape: 'tiara', openTop: true }, rarity: 'uncommon', thumb: 'head' }),
  acc('acc.flowerclip', 'Presilha de flor', 'head', 'Presilha de flor no cabelo.', 'acc.hat_kit', ['feminino'], { palette: 'hat', defaultColor: 'pink', params: { shape: 'clip', openTop: true }, thumb: 'head' }),
  acc('acc.pamela', 'Pamela', 'head', 'Chapéu pamela de aba larga com laço de fita.', 'acc.hat_kit', ['verão', 'feminino'], { palette: 'hat', defaultColor: 'sand', params: { shape: 'pamela' }, rarity: 'uncommon', thumb: 'head' }),
  acc('acc.scrunchie', 'Xuxinha', 'wrist', 'Xuxinha de tecido no pulso.', 'acc.wrist_kit', ['casual', 'feminino'], { palette: 'cloth', defaultColor: 'rose', params: { shape: 'scrunchie' }, thumb: 'wrist' }),
  acc('acc.bangles', 'Pulseiras douradas', 'wrist', 'Várias pulseirinhas finas empilhadas.', 'acc.wrist_kit', ['joia', 'feminino'], { palette: 'frame', defaultColor: 'gold', params: { shape: 'bangles' }, thumb: 'wrist' }),
  acc('acc.oversized', 'Óculos oversized', 'eyewear', 'Óculos escuros enormes, estilo diva.', 'acc.eyewear_kit', ['sol', 'feminino'], { palette: 'frame', defaultColor: 'tortoise', params: { shape: 'oversized' }, rarity: 'uncommon', thumb: 'face' }),
  acc('acc.heartshades', 'Óculos de coração', 'eyewear', 'Óculos de lentes em formato de coração.', 'acc.eyewear_kit', ['sol', 'feminino', 'fofo'], { palette: 'frame', defaultColor: 'pink', params: { shape: 'heart' }, rarity: 'uncommon', thumb: 'face' }),
  acc('acc.handbag', 'Bolsa de mão', 'back', 'Bolsa de mão com fecho dourado, pendurada na mão.', 'acc.handbag', ['feminino'], {
    palette: 'bag',
    defaultColor: 'red',
    thumb: 'hand',
    poses: { idle: 'full', walk: 'full', sit: 'full', wave: 'hidden' },
    notes: 'Ao acenar o braço sobe e a bolsa fica oculta (não há sprite).',
  }),
  acc('acc.clutch', 'Clutch', 'back', 'Clutch de festa segurada rente ao corpo.', 'acc.handbag', ['feminino', 'festa'], {
    palette: 'bag',
    defaultColor: 'black',
    params: { shape: 'clutch' },
    thumb: 'hand',
    poses: { idle: 'full', walk: 'full', sit: 'full', wave: 'hidden' },
    notes: 'Ao acenar o braço sobe e a clutch fica oculta (não há sprite).',
  }),
  // ---- special items ---------------------------------------------------------------
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
    rarity: 'rare',
    thumb: 'head',
    notes: 'Liberado enquanto o evento de Natal estiver ativo.',
  }),

  // ---- special items: wearables and fantasy ----------------------------------------------
  special('sp.scepter', 'Cetro real', 'hand', 'Cetro dourado com uma joia vermelha, para quem manda no pedaço.', 'sp.hand_kit', ['fantasia', 'desbloqueável'], {
    unlock: 'staff',
    rarity: 'legendary',
    params: { shape: 'scepter' },
    thumb: 'hand',
    poses: { idle: 'full', walk: 'adapted', sit: 'full', wave: 'hidden' },
    notes: 'Ao andar, o braço segue erguido com o cetro. Ao acenar o cetro fica oculto (não há sprite).',
  }),
  special('sp.trophy', 'Troféu', 'hand', 'Troféu dourado de campeão.', 'sp.hand_kit', ['comemorativo', 'desbloqueável'], {
    unlock: 'achievement:champion',
    rarity: 'epic',
    params: { shape: 'trophy' },
    thumb: 'hand',
    poses: { idle: 'full', walk: 'adapted', sit: 'full', wave: 'hidden' },
    notes: 'Ao andar, o braço segue erguido com o troféu. Ao acenar o troféu fica oculto (não há sprite).',
  }),
  special('sp.cat_ears', 'Orelhas de gato', 'head', 'Tiara com orelhinhas de gato.', 'sp.head_kit', ['fantasia', 'fofo'], { palette: 'hat', colors: ['black', 'white', 'pink', 'gray', 'brown', 'sand'], defaultColor: 'black', params: { shape: 'cat', openTop: true }, rarity: 'uncommon', thumb: 'head' }),
  special('sp.horns', 'Chifrinhos', 'head', 'Tiara com chifres de diabinho.', 'sp.head_kit', ['fantasia'], { palette: 'hat', colors: ['brick', 'black', 'blue', 'green'], defaultColor: 'brick', params: { shape: 'horns', openTop: true }, rarity: 'uncommon', thumb: 'head' }),
  special('sp.hardhat', 'Capacete de obra', 'head', 'Capacete de segurança com faixa refletiva.', 'sp.head_kit', ['uniform', 'trabalho'], { palette: 'hat', colors: ['yellow', 'white', 'green', 'brick', 'blue'], defaultColor: 'yellow', params: { shape: 'hardhat' }, thumb: 'head' }),
  special('sp.halo', 'Auréola', 'head', 'Aro dourado que flutua sobre a cabeça.', 'sp.head_kit', ['fantasia', 'desbloqueável'], {
    unlock: 'achievement:team-player',
    rarity: 'rare',
    params: { shape: 'halo', openTop: true },
    thumb: 'head',
  }),
  special('sp.crown', 'Coroa dourada', 'head', 'Coroa de ouro com gemas, reservada à equipe.', 'sp.head_kit', ['fantasia', 'desbloqueável'], {
    unlock: 'staff',
    rarity: 'legendary',
    params: { shape: 'crown', openTop: true },
    thumb: 'head',
  }),
  special('sp.gamer_headset', 'Headset gamer', 'ears', 'Headset com orelhas de luz RGB e microfone.', 'sp.gamer_headset', ['tech', 'desbloqueável'], {
    palette: 'gadget',
    colors: ['purple', 'blue', 'red', 'green', 'pink', 'orange'],
    defaultColor: 'purple',
    excludes: ['head'],
    unlock: 'achievement:night-owl',
    rarity: 'rare',
    thumb: 'head',
  }),
  special('sp.cape', 'Capa', 'back', 'Capa longa presa nos ombros por um broche.', 'sp.back_kit', ['fantasia'], { palette: 'cloth', defaultColor: 'red', params: { shape: 'cape' }, rarity: 'rare', thumb: 'back' }),
  special('sp.wings', 'Asas de anjo', 'back', 'Asas de penas, abertas nas costas.', 'sp.back_kit', ['fantasia', 'comemorativo', 'desbloqueável'], {
    palette: 'hat',
    colors: ['white', 'black', 'pink', 'blue'],
    defaultColor: 'white',
    params: { shape: 'wings' },
    unlock: 'event:aniversario',
    rarity: 'epic',
    thumb: 'back',
  }),
  special('sp.cat_tail', 'Cauda de gato', 'back', 'Cauda felpuda que balança atrás de você.', 'sp.back_kit', ['fantasia', 'fofo'], { palette: 'hat', colors: ['black', 'white', 'brown', 'gray', 'sand', 'pink'], defaultColor: 'black', params: { shape: 'tail' }, rarity: 'uncommon', thumb: 'back' }),
  special('sp.aura', 'Aura radiante', 'aura', 'Anel de luz e faíscas ao redor dos pés.', 'sp.aura', ['fantasia', 'desbloqueável'], {
    palette: 'gadget',
    colors: ['purple', 'blue', 'green', 'orange', 'pink', 'red'],
    defaultColor: 'purple',
    unlock: 'achievement:top-collaborator',
    rarity: 'legendary',
    thumb: 'full',
  }),
  ...EVENT_ITEMS,

  // ---- WorkVerse staff set (black and gold; every piece is `staff`-locked and legendary) ----------------------------------------
  top('staff.shirt', 'Camisa da equipe', 'Camisa preta de gola dourada e botões de ouro, do uniforme da equipe WorkVerse.', 'top.shirt', ['staff', 'corporate', 'uniform', 'desbloqueável'], {
    params: { variant: 'staff' },
    colors: ['charcoal', 'navy', 'wine'],
    defaultColor: 'charcoal',
    unlock: 'staff',
    rarity: 'legendary',
  }),
  outer('staff.jacket', 'Blazer da equipe', 'Blazer preto com lapelas debruadas em ouro, dragonas e punhos dourados.', 'staff.jacket', ['staff', 'corporate', 'uniform', 'desbloqueável'], {
    colors: ['charcoal', 'navy', 'wine'],
    defaultColor: 'charcoal',
    unlock: 'staff',
    rarity: 'legendary',
  }),
  bottom('staff.trousers', 'Calça da equipe', 'Calça de alfaiataria preta com listras douradas na lateral.', 'staff.trousers', ['staff', 'corporate', 'uniform', 'desbloqueável'], {
    colors: ['charcoal', 'navy', 'wine'],
    defaultColor: 'charcoal',
    unlock: 'staff',
    rarity: 'legendary',
  }),
  shoes('staff.shoes', 'Sapatos da equipe', 'Sapatos sociais lustrosos com bico e fivela dourados.', 'staff.shoes', ['staff', 'corporate', 'desbloqueável'], {
    colors: ['black', 'navy', 'burgundy'],
    defaultColor: 'black',
    unlock: 'staff',
    rarity: 'legendary',
  }),
  acc('staff.tie', 'Gravata dourada', 'neck', 'Gravata de seda dourada da equipe.', 'acc.neck_kit', ['staff', 'corporate', 'desbloqueável'], {
    palette: 'frame',
    colors: ['gold'],
    defaultColor: 'gold',
    params: { shape: 'tie' },
    views: ['front', 'front34'],
    unlock: 'staff',
    rarity: 'legendary',
    thumb: 'torso',
    notes: 'Só tem arte de frente; de costas não aparece nada.',
  }),
  acc('staff.watch', 'Relógio dourado', 'wrist', 'Relógio de pulso todo dourado.', 'acc.watch', ['staff', 'corporate', 'desbloqueável'], {
    palette: 'frame',
    colors: ['gold'],
    defaultColor: 'gold',
    unlock: 'staff',
    rarity: 'legendary',
    thumb: 'wrist',
  }),
  acc('staff.glasses', 'Óculos da equipe', 'eyewear', 'Óculos escuros redondos com armação de ouro.', 'acc.eyewear_kit', ['staff', 'desbloqueável'], {
    palette: 'frame',
    colors: ['gold'],
    defaultColor: 'gold',
    params: { shape: 'roundsun' },
    unlock: 'staff',
    rarity: 'legendary',
    thumb: 'face',
  }),
  special('staff.hat', 'Cartola da equipe', 'head', 'Cartola preta com faixa e estrela douradas.', 'sp.head_kit', ['staff', 'desbloqueável'], {
    palette: 'hat',
    colors: ['black', 'navy'],
    defaultColor: 'black',
    params: { shape: 'tophat' },
    unlock: 'staff',
    rarity: 'legendary',
    thumb: 'head',
  }),
  special('staff.cape', 'Capa da equipe', 'back', 'Capa longa com bordas e estrela dourada nas costas.', 'sp.back_kit', ['staff', 'desbloqueável'], {
    palette: 'cloth',
    colors: ['charcoal', 'navy', 'wine'],
    defaultColor: 'charcoal',
    params: { shape: 'cape', gold: true },
    unlock: 'staff',
    rarity: 'legendary',
    thumb: 'back',
  }),
  special('staff.aura', 'Aura dourada', 'aura', 'Anéis e faíscas de ouro ao redor dos pés.', 'sp.aura', ['staff', 'desbloqueável'], {
    palette: 'frame',
    colors: ['gold'],
    defaultColor: 'gold',
    unlock: 'staff',
    rarity: 'legendary',
    thumb: 'full',
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
