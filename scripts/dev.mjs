// npm run dev: servidor + cliente, e o livekit-server somente se o binario foi instalado (npm run livekit:setup).
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exe = resolve(root, 'tools/livekit', process.platform === 'win32' ? 'livekit-server.exe' : 'livekit-server');
const names = ['server', 'client'];
const colors = ['blue', 'green'];
// WV_NO_WATCH=1 (usado pelo iniciar.bat): servidor estavel, sem reiniciar a cada arquivo editado.
const serverCmd = process.env.WV_NO_WATCH === '1' ? 'npm run start -w @workverse/server' : 'npm run dev -w @workverse/server';
const cmds = [serverCmd, 'npm run dev -w @workverse/client'];
if (existsSync(exe)) {
  names.push('livekit');
  colors.push('magenta');
  cmds.push('node scripts/livekit-dev.mjs');
} else {
  console.log('[dev] livekit-server nao instalado: o jogo roda sem midia (npm run livekit:setup para habilitar).');
}
const bin = resolve(root, 'node_modules/.bin', process.platform === 'win32' ? 'concurrently.cmd' : 'concurrently');
// Com shell:true o Node junta os argumentos sem aspas (no Windows, cada palavra virava um comando).
// Por isso montamos a linha de comando inteira, com aspas nos argumentos que tem espaco.
const q = (a) => (/\s/.test(a) ? `"${a}"` : a);
const line = [bin, '-n', names.join(','), '-c', colors.join(','), ...cmds].map(q).join(' ');
const child = spawn(line, { cwd: root, stdio: 'inherit', shell: true });
child.on('exit', (code) => process.exit(code ?? 0));
