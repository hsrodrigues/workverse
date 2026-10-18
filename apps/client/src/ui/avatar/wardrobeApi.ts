import type { AvatarClientMessage, AvatarIssue, AvatarServerMessage, AvatarV2, ServerMessage, WardrobeState } from '@workverse/shared';
import { net } from '../../net';

/** Error carrying the server's explanation (item unknown, color out of palette, incompatible, locked...). */
export class AvatarRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly issues?: AvatarIssue[],
  ) {
    super(message);
  }
}

let nextRid = 1;
const TIMEOUT_MS = 8000;

type Answer = Extract<AvatarServerMessage, { t: 'wardrobe' | 'avatar_result' }>;

type Req = AvatarClientMessage extends infer M ? (M extends { rid?: number } ? Omit<M, 'rid'> : never) : never;

function request(msg: Req): Promise<Answer> {
  const rid = nextRid++;
  return new Promise((resolve, reject) => {
    const off = net.on((m: ServerMessage) => {
      if ((m.t === 'wardrobe' || m.t === 'avatar_result') && m.rid === rid) {
        clearTimeout(timer);
        off();
        if (m.t === 'avatar_result' && !m.ok) reject(new AvatarRequestError(m.message, m.code, m.issues));
        else resolve(m);
      }
    });
    const timer = setTimeout(() => {
      off();
      reject(new AvatarRequestError('O servidor não respondeu. Verifique a conexão e tente de novo.', 'timeout'));
    }, TIMEOUT_MS);
    if (net.status !== 'online') {
      clearTimeout(timer);
      off();
      reject(new AvatarRequestError('Você está sem conexão no momento. Tente de novo em instantes.', 'offline'));
      return;
    }
    net.send({ ...(msg as object), rid } as AvatarClientMessage);
  });
}

export async function loadWardrobe(): Promise<WardrobeState> {
  const r = await request({ t: 'wardrobe_get' });
  if (r.t !== 'wardrobe') throw new AvatarRequestError('Resposta inesperada.', 'bad_answer');
  return r.state;
}

export async function saveLook(avatar: AvatarV2): Promise<AvatarV2> {
  const r = await request({ t: 'avatar_save', avatar });
  if (r.t !== 'avatar_result' || !r.ok) throw new AvatarRequestError('Resposta inesperada.', 'bad_answer');
  return r.avatar;
}

async function wardrobeCall(msg: Parameters<typeof request>[0]): Promise<WardrobeState> {
  const r = await request(msg);
  if (r.t !== 'wardrobe') throw new AvatarRequestError('Resposta inesperada.', 'bad_answer');
  return r.state;
}

export const saveOutfit = (name: string, avatar: AvatarV2, id?: string) => wardrobeCall({ t: 'outfit_save', name, avatar, ...(id ? { id } : {}) });
export const deleteOutfit = (id: string) => wardrobeCall({ t: 'outfit_delete', id });
export async function applyOutfit(id: string): Promise<AvatarV2> {
  const r = await request({ t: 'outfit_apply', id });
  if (r.t !== 'avatar_result' || !r.ok) throw new AvatarRequestError('Resposta inesperada.', 'bad_answer');
  return r.avatar;
}
