# Verificación de correo al registrarse

## Objetivo
Un usuario sin verificar puede entrar y configurar todo, pero el tenant no puede conectar un canal de
WhatsApp (Gupshup o 360dialog) hasta que el correo del owner esté verificado.

## Alcance
- Migración 0095: `users.email_verified_at` (usuarios existentes = verificados), tabla
  `email_verification_tokens` (hash SHA-256, uso único, 24 h), funciones SECURITY DEFINER.
- Dominio: TTL, límite de reenvío (3/h), estado del token, regla `canConnectWhatsApp`.
- API: signup envía `bienvenida-verificacion`; `POST /auth/verify-email` (público, rate limit);
  `POST /auth/resend-verification` (autenticado, 3/h); `/auth/me` expone `user.emailVerified`;
  `EmailVerifiedGuard` (403 `EMAIL_NOT_VERIFIED`) en `POST /channels/gupshup`,
  `/channels/360dialog/connect-state` y `/channels/360dialog/connect`.
- Web: página `/verify/[token]`, banner «Confirma tu correo para conectar WhatsApp» con «Reenviar
  correo» y botones de conexión deshabilitados en Canales.

## Tareas
- [x] T1 Migración + schema + test DB (solo CI). Ruta: delegated direct.
- [x] T2 Dominio + tests (RED observado, luego GREEN).
- [x] T3 Contracts (error, schemas) + API (repo, servicio, controlador, guard) + tests.
- [x] T4 Web (página verify, banner, api client).
- [ ] T5 CI verde en el PR.

## Decisiones
- El guard mira al primer owner del tenant (mismo criterio que los correos de ciclo de vida); un
  admin de un tenant con owner sin verificar también queda bloqueado y ve el banner sin reenvío.
- Usuarios invitados no se marcan verificados (no afecta: la regla mira al owner).

## Verificación
`pnpm -r typecheck`, `pnpm lint`, tests unitarios de domain/api/web. Tests DB corren en CI.
