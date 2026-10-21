# @crmwsp/mailer

Transactional email behind a `Mailer` interface.

## Dependency justification

`nodemailer` is the only new dependency. No email sender existed in the repo; SMTP works with
Mailpit locally (`localhost:1025`) and with any provider in production, so no vendor lock-in.

## Config (env)

`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`.
When `SMTP_HOST` is unset, `createMailerFromEnv()` returns a `NoopMailer` that logs only the recipient domain.
Credentials and bodies are never logged. Connection/greeting/socket timeouts are 10s; failures throw `MailerError`.
