# ADR 0006 — Autenticación y sesiones propias en la API

**Estado:** aceptado · **Fecha:** 2026-10-19

## Contexto
La Fase 1 necesita login de usuarios, alta self-service de empresas (tenant + usuario dueño) y un contexto de tenant fiable en cada request para que `withTenant` y RLS (ADR 0002) hagan su trabajo. `ARCHITECTURE.md` proponía Auth.js o Clerk. Clerk cobra por usuario activo y saca la identidad fuera de nuestra base; Auth.js vive en Next.js y obligaría a la API a confiar en tokens emitidos por la web. Ninguno de los dos encaja con el modelo RLS, donde la base de datos debe saber qué usuario actúa y en qué tenant.

## Decisión
- **La API (NestJS) es la dueña de la autenticación.** Sin Auth.js ni Clerk: sin coste por usuario ni dependencia externa. Sustituye a la fila "Auth" de `ARCHITECTURE.md` §2 para usuarios humanos (las API keys por tenant para integraciones siguen pendientes).
- **Login con email y contraseña.** Email normalizado (trim + minúsculas) y único global (`users_email_lower_unique`). Contraseña de 10 a 256 caracteres.
- **Hash de contraseñas con `crypto.scrypt` nativo de Node**, sin dependencias: N=2^15, r=8, p=1 (32 MiB por hash), sal aleatoria de 16 bytes, clave de 32 bytes y formato autodescriptivo `scrypt$ln=15,r=8,p=1$<sal b64>$<hash b64>`, que permite subir parámetros más adelante y rehashear en el siguiente login. Se descartó `argon2id` (`@node-rs/argon2`): es técnicamente preferible, pero añade un binario nativo por plataforma a la cadena de suministro y scrypt con estos parámetros es aceptable (recomendación OWASP para scrypt). Verificación en tiempo constante (`timingSafeEqual`) y parámetros acotados al leer el hash almacenado.
- **Tiempo constante en el login:** si el email no existe, se verifica igualmente contra un hash dummy generado al arrancar, y la respuesta es el mismo 401 genérico (`Invalid email or password`).
- **Sesiones opacas en servidor:** token aleatorio de 32 bytes (base64url) en la cookie `__Host-crmwsp_session` con `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age`. El prefijo `__Host-` impide que un subdominio hermano plante (cookie tossing) una sesión propia. El parseo manual rechaza cabeceras `Cookie` de más de 8 KiB y duplicados ambiguos (dos valores distintos), y acepta valores entre comillas. En BD solo se guarda su SHA-256 (`sessions.token_hash bytea`, único, `CHECK` de 32 bytes). Un volcado de la base no permite suplantar sesiones.
- **Expiración deslizante de 30 días** (`SESSION_TTL_DAYS`, máximo 90) **con tope absoluto de 90 días desde `created_at`** (migración `0007`): cada request autenticada mueve `expires_at = least(now() + ttl, created_at + 90 días)`, actualiza `last_seen_at` y renueva el `Max-Age` de la cookie (nunca más allá de ese `expires_at`). Una sesión con más de 90 días no resuelve aunque se use a diario: hay que volver a hacer login. **Revocación con logout** (`revoked_at`); un usuario puede tener varias sesiones (varios dispositivos) y el logout solo revoca la actual.
- **Cookie y no bearer token:** el navegador habla con la API a través de la web (mismo sitio), así que una cookie `HttpOnly` evita exponer el token a JavaScript (XSS) y `SameSite=Lax` bloquea el envío en peticiones cross-site no seguras (CSRF en POST).
- **Las tablas de credenciales y sesiones son solo de sistema.** `user_credentials` y `sessions` (migración `0006`) tienen RLS `ENABLE` + `FORCE`, solo la política `system_owner` del dueño y ningún privilegio para `crmwsp_app` (`REVOKE ALL`). El rol app nunca puede leer hashes de contraseña ni de sesión. Todo pasa por funciones `SECURITY DEFINER` mínimas, con el mismo patrón que `ingest_inbound_event` (dueño migrador, `search_path = pg_catalog, public, pg_temp`, objetos calificados, `REVOKE` de `PUBLIC`, `GRANT EXECUTE` solo a `crmwsp_app`, errores sin datos y sin `set_config('app.*')`):
  - `auth_login(email)` devuelve `(user_id, password_hash)` o nada; la verificación se hace en Node.
  - `create_session(user_id, token_hash, ip, user_agent, ttl_seconds)`, con un TTL de entre 1 minuto y 90 días.
  - `resolve_session(token_hash, ttl_seconds)` devuelve `(user_id, email, name, expires_at)` si la sesión no está revocada ni expirada ni supera el tope absoluto, y la desliza.
  - `revoke_session(token_hash)`.
  - `list_user_tenants(user_id)` devuelve las memberships con slug, nombre y rol.
  - `signup_tenant(email, name, password_hash, tenant_name, tenant_slug)` crea en una sola transacción el user, las credenciales, el tenant y la membership `owner`. Esto cierra el pendiente de ADR 0002 ("diseñar la vía de signup"). Si el email **o** el slug ya existen, devuelve el mismo error genérico (`23505`, `signup rejected`), y la API responde `409 Signup could not be completed` sin decir cuál de los dos existe.
- **Contexto de tenant por request en la API:**
  - `SessionGuard` es **guard global** (`APP_GUARD`): toda ruta exige sesión salvo las marcadas con `@Public()` (signup, login, logout, health y el controller de webhooks, que debe llevar `@Public()`). Resuelve la cookie y pone `request.user`.
  - `TenantGuard` valida la cabecera `x-tenant-id` (uuid), comprueba la membership con `list_user_tenants` y `@Roles(...)`, y pone `request.tenant = { id, role }` y un `TenantDb`.
  - `TenantDb.run(fn)` llama a `withTenant(db, tenantId, fn, { userId })`. Los controllers solo obtienen acceso a datos a través de `@CurrentTenantDb()`.
  - Un filtro global de excepciones convierte todo error con `toErrorResponse`.
  - El cliente de BD se crea una vez por proceso con `DATABASE_URL` (rol app).
- **Rate limiting** en memoria para login y signup, con respuesta 429: 10 intentos por IP+email y 100 por IP (global) por ventana fija de 15 minutos. Memoria acotada: barrido de ventanas caducadas y tope de claves con expulsión de las más antiguas.
- **CSRF, defensa adicional a `SameSite=Lax`:** ninguna ruta muta con GET. Toda petición que muta (POST/PUT/PATCH/DELETE) pasa si lleva `x-tenant-id` (cabecera no simple: fuerza un preflight CORS que la API no aprueba; por eso toda ruta de negocio que muta va tras `TenantGuard`) o, si no, si no viene marcada `Sec-Fetch-Site: cross-site` y su `Origin`, cuando existe, está en `WEB_ORIGINS` o coincide con el `Host`. Se aplica también a signup, login (evita login CSRF) y logout (`@Public({ sameOrigin: true })`). Logout es público para poder borrar la cookie con una sesión ya caducada; solo revoca la sesión cuyo token presenta. Si algún día se habilita CORS con credenciales, hay que revisar esta regla.
- **Build:** la API se empaqueta con `esbuild` (`apps/api/build.mjs`): los paquetes del workspace exportan `.ts` y se incluyen en el bundle junto con sus dependencias; las dependencias directas de la API quedan externas. El typecheck sigue con `tsc --noEmit`. esbuild no emite metadatos de decoradores, así que toda inyección de Nest usa `@Inject` explícito.

## Alternativas descartadas
- **Clerk / Auth0:** coste por MAU y la identidad vive fuera. Además, RLS necesitaría sincronizar usuarios.
- **Auth.js en la web:** acopla la autenticación a Next.js, y la API tendría que validar JWT o sesiones de otra app.
- **JWT sin estado:** no permite revocar en el momento sin una lista negra, que vuelve a ser estado. Las sesiones opacas son más simples y revocables.
- **Dar `SELECT` al rol app sobre `sessions` con RLS por `app.user_id`:** para resolver la sesión hace falta leer antes de conocer el usuario, así que acabaría siendo una ruta sin contexto. Las funciones `SECURITY DEFINER` exponen solo lo necesario.

## Consecuencias
- Cada request autenticada hace un `UPDATE` en `sessions` (deslizamiento). Es aceptable al volumen actual; si molesta, se puede limitar a una escritura por minuto.
- La API pasa a ser la única que emite y valida sesiones. La web debe hacer de proxy hacia la API en el mismo sitio para que la cookie viaje.
- Las sesiones expiradas o revocadas se acumulan: hace falta un job de limpieza (índice `sessions_expires_at_idx`).

## Pendiente
- **Recuperación de contraseña** (token de un solo uso, hash en BD, expiración corta) y **verificación de email**: fuera de este ticket. Hasta entonces un signup puede reservar un email ajeno; cuando exista la verificación, las cuentas no verificadas deberían caducar.
- Mover el rate limiting a Redis, compartido entre réplicas (hay un `TODO` en `apps/api/src/auth/rate-limiter.ts`).
- `trustProxy` de Fastify cuando la API esté detrás de la web o de un balanceador, para que la IP del rate limit y de `sessions.ip` sea la real.
- Rehash automático si cambian los parámetros de scrypt, "cerrar todas las sesiones" y limpieza periódica de sesiones caducadas.
