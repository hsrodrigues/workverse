import { normalizeEmail } from './auth';
import { createMailer } from './mailer';

/**
 * Envia um e-mail de teste com o provedor configurado (MAIL_PROVIDER, RESEND_API_KEY / SMTP_URL, MAIL_FROM).
 *   npm run mail:test -w @workverse/server -- seu@email.com
 * Serve para conferir a configuracao antes de ligar "Esqueci minha senha" em producao. Nao mostra segredos.
 */
const to = normalizeEmail(process.argv.slice(2).find((a) => !a.startsWith('--')));
if (!to) {
  console.error('Uso: mail:test <seu@email.com>');
  process.exit(2);
}
// Mesmo em producao o teste usa o provedor real; o provedor "log" so vale fora dela.
const mailer = createMailer(process.env, process.env.NODE_ENV === 'production');
if (!mailer.enabled) {
  console.error(`Envio de e-mail desligado: ${mailer.reason}. Veja docs/password-reset.md.`);
  process.exit(1);
}
try {
  await mailer.send({
    to,
    subject: 'Teste de e-mail do WorkVerse',
    text: 'Se você recebeu esta mensagem, o envio de e-mail do WorkVerse está configurado corretamente.\n',
  });
  console.log(`OK: e-mail de teste enviado (provedor ${mailer.provider}) para ${to}.`);
  process.exit(0);
} catch (err) {
  console.error(`Falhou (provedor ${mailer.provider}): ${(err as Error).message}`);
  process.exit(1);
}
