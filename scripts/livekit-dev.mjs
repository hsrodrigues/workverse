// Inicia o livekit-server em modo dev (chaves devkey/secret, porta 7880). Sai com aviso se o binario nao existe.
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exe = resolve(root, 'tools/livekit', process.platform === 'win32' ? 'livekit-server.exe' : 'livekit-server');
if (!existsSync(exe)) {
  console.log('[livekit] binario ausente (rode "npm run livekit:setup"); o jogo segue sem midia.');
  process.exit(0);
}
const child = spawn(exe, ['--dev'], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill());
