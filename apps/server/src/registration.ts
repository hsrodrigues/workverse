/**
 * Quem pode criar conta:
 *  - closed: PADRAO. Nao existe cadastro publico: so a staff cria contas (painel de staff ou CLI
 *            npm run account:create -w @workverse/server -- email nome [senha]);
 *  - invite: opcional, so com codigo/link de convite valido de uma organizacao;
 *  - open:   opcional, qualquer pessoa (so para testes).
 */
export type RegistrationMode = 'open' | 'invite' | 'closed';
export const REGISTRATION_MODES: readonly RegistrationMode[] = ['open', 'invite', 'closed'];

export function parseRegistrationMode(raw: string | undefined, production: boolean): RegistrationMode | 'invalid' {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '') return 'closed';
  return (REGISTRATION_MODES as readonly string[]).includes(v) ? (v as RegistrationMode) : 'invalid';
}

export type RegistrationGate = { ok: true } | { ok: false; status: number; code: string; message: string };

/**
 * Decide se este cadastro pode prosseguir (a validade do convite em si continua sendo checada por OrgService).
 */
export function registrationGate(
  mode: RegistrationMode,
  input: { inviteToken: string | null },
): RegistrationGate {
  if (mode === 'open') return { ok: true };
  if (mode === 'closed') {
    return { ok: false, status: 403, code: 'registration_closed', message: 'O cadastro está fechado. Peça a quem administra para criar sua conta.' };
  }
  if (!input.inviteToken) {
    return { ok: false, status: 403, code: 'invite_required', message: 'Para criar uma conta você precisa de um convite. Peça um link de convite a quem administra.' };
  }
  return { ok: true };
}
