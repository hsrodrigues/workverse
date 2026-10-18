import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { POWERPOINT_CONNECTOR_PORT } from '@workverse/shared';
import { PowerPointAdapter } from './powershell';
import { startConnector } from './server';
import { parseOrigins } from './security';

const DEFAULT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

function parseArgs(argv: string[]) {
  const out = { port: Number(process.env.CONNECTOR_PORT) || POWERPOINT_CONNECTOR_PORT, origins: [] as string[], help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') out.port = Number(argv[++i]);
    else if (a.startsWith('--port=')) out.port = Number(a.slice(7));
    else if (a === '--origin') out.origins.push(argv[++i] ?? '');
    else if (a.startsWith('--origin=')) out.origins.push(a.slice(9));
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      [
        'WorkVerse PowerPoint Connector',
        '',
        'Uso: npm run powerpoint:connector -- [--port 47831] [--origin https://seu-workverse.exemplo]',
        '',
        '  --port     porta local (padrão 47831; ou CONNECTOR_PORT)',
        '  --origin   endereço do WorkVerse autorizado a controlar o PowerPoint (repetível; ou CONNECTOR_ORIGINS, separado por vírgula)',
        '             sempre vale também http://localhost:5173',
      ].join('\n'),
    );
    return;
  }
  if (process.platform !== 'win32') {
    console.error('Este conector só funciona no Windows com o Microsoft PowerPoint instalado.');
    process.exit(1);
  }
  if (!Number.isInteger(args.port) || args.port < 1024 || args.port > 65535) {
    console.error('Porta inválida (use um número entre 1024 e 65535).');
    process.exit(1);
  }
  const origins = parseOrigins([...DEFAULT_ORIGINS, process.env.CONNECTOR_ORIGINS, ...args.origins]);
  const exportRoot = path.join(os.tmpdir(), `workverse-connector-${randomBytes(6).toString('hex')}`);
  const adapter = new PowerPointAdapter(exportRoot);

  let connector;
  try {
    connector = await startConnector({
      adapter,
      origins,
      port: args.port,
      exportRoot,
      log: (line) => {
        console.log(`${new Date().toLocaleTimeString('pt-BR')}  ${line}`);
        if (line.includes('trocado')) show();
      },
    });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    console.error(code === 'EADDRINUSE' ? `A porta ${args.port} já está em uso. O conector já está aberto? Feche-o ou use --port.` : `Não foi possível iniciar o conector: ${(e as Error).message}`);
    await adapter.dispose();
    process.exit(1);
  }
  adapter.warmUp();

  const show = () => {
    const code = connector.pairCode();
    console.log('');
    console.log('  ==========================================');
    console.log('   WorkVerse PowerPoint Connector');
    console.log('  ==========================================');
    console.log(`   Código de pareamento:  ${code.slice(0, 3)} ${code.slice(3)}`);
    console.log('  ==========================================');
    console.log(`   Escutando só neste computador: http://127.0.0.1:${connector.port}`);
    console.log(`   Origens autorizadas: ${origins.join(', ')}`);
    console.log('');
    console.log('   No WorkVerse: palco > PowerPoint > "Conectar" e digite o código acima.');
    console.log('   Para sair, feche esta janela ou pressione Ctrl+C.');
    console.log('');
  };
  show();

  const stop = async () => {
    console.log('\nEncerrando o conector...');
    await connector.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}

void main();
