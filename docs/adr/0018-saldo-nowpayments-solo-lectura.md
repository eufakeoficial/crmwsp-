# ADR 0018 — Saldo de NOWPayments en el backoffice (solo lectura)

**Estado:** aceptado · **Fecha:** 2026-10-24 · **Relacionado:** ADR 0011, ADR 0013, ADR 0017

## Contexto
El equipo de plataforma necesita ver cuánto hay en la cuenta de NOWPayments y compararlo con lo
que nuestros cobros dicen haber recibido, sin entrar al panel del proveedor. No queremos ninguna
capacidad de mover fondos desde nuestro sistema.

## Decisión
- Fuente: documentación oficial de la API de NOWPayments,
  <https://documenter.getpostman.com/view/7907941/2s93JusNJt> (secciones "Authentication" y
  "Get balance"). `GET /v1/balance` exige **dos** credenciales: la cabecera `x-api-key` y
  `Authorization: Bearer <JWT>`. El JWT se obtiene con `POST /v1/auth` enviando el `email` y la
  `password` de la cuenta y caduca a los 5 minutos. La API key sola no basta.
  Nota: la página de Postman no se pudo leer completa con las herramientas de esta sesión; el
  par de cabeceras y `/auth` se confirmaron con la especificación OpenAPI publicada de la API de
  payouts (`getBalance`, esquemas `ApiKeyAuth` + `BearerAuth` "obtenido de /auth"). Verificar el
  cuerpo de `/auth` contra la cuenta real antes de activarlo en producción.
- Credenciales solo por entorno: `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_EMAIL`,
  `NOWPAYMENTS_PASSWORD` (y `NOWPAYMENTS_API_BASE` opcional). Si falta alguna, la tarjeta muestra
  "No configurado". Nunca se registran ni se devuelven; el JWT vive solo en memoria del proceso
  (se renueva a los 4 minutos o ante un 401/403, un reintento).
- Caché de 60 s del saldo por proceso; "Actualizar" ignora la caché pero no consulta al proveedor
  más de una vez cada 10 s. Errores tipados sin datos: `auth_failed` | `unavailable`.
- `GET /platform/finance` (solo admins, 404 para el resto) devuelve: ingresos de nuestros cobros
  pagados con proveedor (hoy, mes, por plan, por período; reembolsados excluidos; canjes de cupón
  contados aparte), el saldo por moneda y una **pista de conciliación** por moneda de pago:
  cripto recibida por cobros pagados vs saldo actual. Es orientativa (retiros y comisiones la
  desvían) y se calcula en coma flotante solo para mostrar.
- **Sin retiros ni payouts**: el cliente no implementa ningún endpoint de escritura del proveedor.
  Los retiros se hacen solo en el panel de NOWPayments.

## Consecuencias
- Guardar email y contraseña de la cuenta NOWPayments en el entorno del API amplía el impacto de
  una filtración de variables: usar una cuenta/rol con el mínimo acceso que NOWPayments permita y
  2FA en el panel. Si el proveedor ofrece una credencial de solo lectura, sustituirla.
- La caché es por instancia del API; con varias instancias cada una consulta su propio saldo.
