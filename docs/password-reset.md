# Esqueci minha senha (redefinição por e-mail)

Recurso **opcional**. Sem provedor de e-mail configurado em produção ele fica desligado: a tela de login não mostra o
link e a staff continua redefinindo senhas pelo painel (Contas > Redefinir senha) ou por
`npm run account:create -w @workverse/server -- email nome --resetar`.

## Como funciona

1. Na tela de login, **Esqueci minha senha** pede o e-mail. O servidor sempre responde a mesma mensagem (e demora o
   mesmo tempo), exista a conta ou não.
2. Só se a conta existe, tem senha, está ativa e não está banida, é gerado um token aleatório de 32 bytes. No banco fica
   **apenas o SHA-256** do token. O link `PUBLIC_URL/?reset=<token>` vai por e-mail.
3. O link vale **30 minutos** e **uma vez**. Cada conta tem no máximo **3 links pendentes** (o mais novo derruba o mais
   antigo além do terceiro). Ao redefinir, todos os outros somem.
4. Na nova senha valem as regras normais (10 a 128 caracteres, sem senhas comuns). Ao concluir: a senha é trocada,
   `mustChangePassword` é limpo, **todas as sessões da conta são encerradas** (inclusive o WebSocket) e fica um registro
   na auditoria (`account.password_reset_email`), sem o token. A pessoa entra de novo com a senha nova.
5. O token é removido da barra de endereço assim que a página abre.

Limites (por IP e por e-mail): 5 pedidos em rajada por IP (+1 a cada 2 min) e 3 por e-mail (+1 a cada 10 min); 10 tentativas
de usar um token por IP em rajada. Origem/CSRF e limite de corpo (1 KB) valem como nas demais rotas.

## Variáveis

| Variável | Para quê |
|---|---|
| `MAIL_PROVIDER` | `resend`, `smtp`, `log` ou `off`. Padrão: `log` fora de produção, `off` em produção |
| `MAIL_FROM` | Remetente, ex.: `WorkVerse <no-reply@seudominio.com>` |
| `RESEND_API_KEY` | Chave da API do Resend |
| `SMTP_URL` | `smtps://usuario:senha@host:465` (TLS direto) ou `smtp://usuario:senha@host:587` (STARTTLS obrigatório). Caracteres especiais da senha em %XX |
| `PUBLIC_URL` | Base do link do e-mail (obrigatória em produção; já é exigida pelo servidor) |

O provedor `log` só existe em desenvolvimento: o e-mail inteiro (com o link) aparece no log do servidor. Em produção ele
é recusado, porque o link ficaria no log. Em produção o log nunca contém o token inteiro (só os 4 primeiros caracteres).

## O que você precisa configurar (Resend, o caminho mais simples)

1. Crie uma conta gratuita em resend.com e gere uma **API key**.
2. Verifique um domínio seu (registros DNS SPF/DKIM que o Resend mostra). Sem domínio verificado o Resend só entrega
   para o e-mail do próprio dono da conta (serve para testar, não para o time).
3. No Render/`.env.production`: `MAIL_PROVIDER=resend`, `RESEND_API_KEY=...`, `MAIL_FROM=WorkVerse <no-reply@seudominio.com>`.
4. Teste: `npm run mail:test -w @workverse/server -- seu@email.com` (usa as variáveis do ambiente atual).

SMTP (Gmail com senha de app, Brevo, SES...) também funciona; é um cliente mínimo (AUTH PLAIN/LOGIN, só TLS, sem
anexos nem HTML). Se algo der errado com ele, prefira o Resend.

## Limitações

- Sem verificação de e-mail no cadastro: o e-mail da conta é o que a staff cadastrou, e quem controla essa caixa de
  entrada pode redefinir a senha. Mantenha o e-mail correto.
- Os pedidos pendentes e os limites de taxa são por instância do servidor (uma instância, como o resto do projeto).
- O envio é feito em segundo plano; se o provedor falhar, a pessoa vê a mesma mensagem e o erro (sem segredos) vai para o log.
