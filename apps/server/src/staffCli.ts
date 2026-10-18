import { resolve } from 'node:path';
import { STAFF_LEVELS, isStaffLevel } from '@workverse/shared';
import { PgAccountStore } from './db/pgAccountStore';
import { closePool, createPool, poolOptionsFromEnv } from './db/pool';
import { JsonFileAccountStore, emailKey, type AccountStore } from './store';

/**
 * Concede / revoga staff da plataforma direto no armazenamento (nunca por mensagem do cliente).
 *   npm run staff:grant  -w @workverse/server -- email@exemplo.com [helper|moderator|admin]   (padrao: admin)
 *   npm run staff:revoke -w @workverse/server -- email@exemplo.com
 *   npm run staff:list   -w @workverse/server
 * Reinicie o servidor depois: ele guarda as contas em memoria (o nivel passa a valer no proximo login).
 */
const [cmd, email, levelArg] = process.argv.slice(2);
const usage = () => {
  console.error(`Uso: staff:grant <email> [${STAFF_LEVELS.join('|')}] | staff:revoke <email> | staff:list`);
  process.exit(2);
};
if (cmd !== 'grant' && cmd !== 'revoke' && cmd !== 'list') usage();
if (cmd !== 'list' && !email) usage();

const poolOpts = poolOptionsFromEnv();
const pool = poolOpts ? createPool({ ...poolOpts, applicationName: 'workverse-staff' }) : null;
const store: AccountStore & { flush(): void | Promise<void> } = pool
  ? await PgAccountStore.open(pool)
  : new JsonFileAccountStore(resolve(process.env.DATA_DIR ?? './data', 'accounts.json'));

let code = 0;
try {
  const audit = (event: string, data: Record<string, unknown>) =>
    console.log(JSON.stringify({ event, at: Date.now(), by: `cli:${process.env.USERNAME ?? process.env.USER ?? 'unknown'}`, ...data }));
  if (cmd === 'list') {
    for (const a of store.listAccounts()) if (a.staff) console.log(`${a.staff.padEnd(10)} ${a.email}  (${a.displayName})`);
  } else {
    const account = store.getByEmail(emailKey(email!));
    if (!account) {
      console.error(`Conta nao encontrada: ${email}`);
      code = 1;
    } else if (cmd === 'grant') {
      const level = levelArg ?? 'admin';
      if (!isStaffLevel(level)) {
        console.error(`Nivel invalido: ${level}. Use ${STAFF_LEVELS.join(', ')}.`);
        code = 2;
      } else {
        account.staff = level;
        store.save(account);
        audit('staff.grant', { account: account.id, email: account.email, level });
      }
    } else {
      delete account.staff;
      store.save(account);
      audit('staff.revoke', { account: account.id, email: account.email });
      console.log('Se o e-mail estiver em BOOTSTRAP_STAFF_EMAILS, remova-o de la tambem (a lista concede de novo ao iniciar).');
    }
  }
  await store.flush();
} finally {
  if (pool) await closePool(pool).catch(() => undefined);
}
process.exit(code);
