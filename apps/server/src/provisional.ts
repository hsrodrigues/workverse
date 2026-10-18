import { randomInt } from 'node:crypto';
import { checkPassword } from './auth';

/** Sem 0/O, 1/l/I: a senha provisoria e lida e digitada por uma pessoa. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/**
 * Senha provisoria forte (16 caracteres de um alfabeto de 56, ~93 bits) em grupos de 4: `Xk7m-Qp2d-Wr9t-Hn4v`.
 * Gerada com `crypto.randomInt` (sem vies). Mostrada UMA vez a quem cria a conta; o servidor guarda so o hash.
 */
export function generateProvisionalPassword(): string {
  for (;;) {
    const groups: string[] = [];
    for (let g = 0; g < 4; g++) {
      let part = '';
      for (let i = 0; i < 4; i++) part += ALPHABET[randomInt(ALPHABET.length)];
      groups.push(part);
    }
    const pw = groups.join('-');
    if (checkPassword(pw) === null) return pw;
  }
}
