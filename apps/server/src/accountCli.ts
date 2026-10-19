import { resolve } from 'node:path';
import { checkPassword, hashPassword, normalizeEmail } from './auth';
import { PgAccountStore } from './db/pgAccountStore';
import { closePool, createPool, poolOptionsFromEnv } from './db/pool';
import { DuplicateAccountError, JsonFileAccountStore, type AccountStore } from './store';
import { normalizeName } from './world';
import { generateProvisionalPassword } from './provisional';

/**
 * Cria uma conta direto no armazenamento (REGISTRATION_MODE=closed ou primeiro dono).
 *   npm run account:create -w @workverse/server -- email@exemplo.com "Nome" ["senha-com-10-ou-mais-caracteres"] [--trocar-senha]
 * Com --resetar redefine a senha de uma conta que ja existe (gera uma provisoria se nao informar senha).
 * Sem senha: gera uma senha provisoria forte, mostrada UMA vez, e a conta fica marcada para trocar a senha no primeiro
 * login (o mesmo que o painel de staff faz). Com senha informada ela e a definitiva, a menos que use --trocar-senha.
 * Com o armazenamento em arquivo JSON, PARE o servidor antes (ele guarda as contas em memoria e sobrescreveria o
 * arquivo); com PostgreSQL basta reiniciar para a conta entrar na organizacao padrao.
 * A senha tambem pode vir de ACCOUNT_PASSWORD (evita deixar a senha no historico do terminal).
 */
const argv = process.argv.slice(2);
const forceChange = argv.includes('--trocar-senha');
const reset = argv.includes('--resetar');
const [emailArg, nameArg, passArg] = argv.filter((a) => !a.startsWith('--'));
const generated = !passArg && !process.env.ACCOUNT_PASSWORD;
const password = passArg ?? process.env.ACCOUNT_PASSWORD ?? generateProvisionalPassword();
const email = normalizeEmail(emailArg);
const name = normalizeName(nameArg);
if (!email || !name || !password) {
  console.error('Uso: account:create <email> <nome> [senha] [--trocar-senha]   (sem senha, gera uma provisoria; ou use ACCOUNT_PASSWORD)');
  process.exit(2);
}
const problem = checkPassword(password);
if (problem) {
  console.error(problem === 'too_short' ? 'A senha precisa ter pelo menos 10 caracteres.' : 'A senha e longa demais (maximo 128).');
  process.exit(2);
}

const poolOpts = poolOptionsFromEnv();
const pool = poolOpts ? createPool({ ...poolOpts, applicationName: 'workverse-account' }) : null;
const store: AccountStore & { flush(): void | Promise<void> } = pool
  ? await PgAccountStore.open(pool)
  : new JsonFileAccountStore(resolve(process.env.DATA_DIR ?? './data', 'accounts.json'));

let code = 0;
try {
  const existing = store.getByEmail(email);
  if (reset) {
    // redefine a senha de uma conta que ja existe (conta esquecida/trancada); a pessoa troca no proximo login
    if (!existing) {
      console.error('Nao existe conta com esse e-mail.');
      process.exit(1);
    }
    existing.passwordHash = await hashPassword(password);
    existing.mustChangePassword = true;
    store.save(existing);
    await store.flush();
    console.log(`Senha de ${existing.email} redefinida. Reinicie o servidor se ele estiver ligado.`);
    if (generated) console.log(`Senha provisoria (anote agora, nao sera mostrada de novo): ${password}`);
    process.exit(0);
  }
  const account = store.create({ email, displayName: name, passwordHash: await hashPassword(password) });
  account.createdBy = `cli:${process.env.USERNAME ?? process.env.USER ?? 'unknown'}`;
  if (generated || forceChange) account.mustChangePassword = true;
  store.save(account);
  await store.flush();
  console.log(`Conta criada: ${account.email} (${account.displayName}). Reinicie o servidor para ela entrar na organizacao padrao.`);
  console.log('Para ser staff/admin, coloque o e-mail em BOOTSTRAP_STAFF_EMAILS (ex.: voce@x.com:admin).');
  if (generated) console.log(`Senha provisoria (anote agora, nao sera mostrada de novo): ${password}`);
  if (account.mustChangePassword) console.log('A pessoa precisara trocar a senha no primeiro login.');
  console.log('A primeira conta com senha vira DONA da organizacao padrao (ou a de BOOTSTRAP_OWNER_EMAIL).');
} catch (err) {
  if (err instanceof DuplicateAccountError) {
    console.error(err.field === 'email' ? 'Esse e-mail ja esta cadastrado.' : 'Esse nome ja esta em uso.');
    code = 1;
  } else throw err;
} finally {
  if (pool) await closePool(pool).catch(() => undefined);
}
process.exit(code);
