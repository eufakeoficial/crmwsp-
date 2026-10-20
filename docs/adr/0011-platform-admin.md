# ADR 0011 — Backoffice de plataforma (super admin del SaaS)

**Estado:** aceptado · **Fecha:** 2026-10-21 · **Relacionado:** ADR 0002, ADR 0006

## Contexto
El dueño del SaaS necesita aprobar cuentas nuevas, suspender empresas, cambiar planes, registrar los
cobros de suscripción (no hay proveedor de cobro: `billingProvider = none`) y ver el estado del negocio.
Eso exige leer datos de varios tenants a la vez, lo que choca con el aislamiento por RLS (ADR 0002).
No queremos abrir un agujero: el rol de aplicación no tiene ni tendrá `BYPASSRLS`.

## Decisión
**Los admins de plataforma no son un rol de tenant.** Tabla aparte `platform_admins (user_id,
created_at)`. Solo se dan de alta con un script de CLI que usa la URL del migrador:
`pnpm --filter @crmwsp/db platform-admin:grant <email>` (también `:revoke` y `:list`). Ninguna API
crea admins de plataforma.

**Lecturas entre tenants solo por funciones `SECURITY DEFINER`** (migración 0052), con las mismas
reglas que 0006/0026/0050: dueño migrador, `search_path` fijo, objetos cualificados, `EXECUTE` solo
para `crmwsp_app`. Cada función recibe el actor y comprueba `platform_admins` (42501 si no lo es), y
devuelve solo columnas en lista blanca o agregadas: id, nombre, slug, estado, plan, alta, email del
propietario, nº de miembros, contadores de uso del mes, nº de canales, última actividad, pagado hasta.
Miembros: nombre, email y rol. Canales: solo estado. **Nunca** conversaciones, mensajes, contactos
ni secretos. Las tablas `platform_admins`, `platform_settings`, `platform_audit_events` y
`subscription_payments` no tienen ningún privilegio para `crmwsp_app` (además RLS activada sin
políticas): solo se tocan desde esas funciones.

**Auditoría.** Toda acción de un admin de plataforma (estado, plan, pago, ajustes) escribe en
`platform_audit_events (actor, acción, tenant, diff, ip, fecha)` dentro de la misma función.
La tabla es de solo inserción: un trigger rechaza `UPDATE`, `DELETE` y `TRUNCATE`, incluso al dueño.

**API `/platform/*`.** Exige sesión válida + fila en `platform_admins`, comprobada **en cada
petición** (sin caché), con rate limit por usuario. A un no-admin se le responde **404**, no 403,
para no revelar que el panel existe. `GET /platform/me → { isPlatformAdmin }` es la única ruta
abierta a cualquier sesión (la web la usa para mostrar la entrada "Admin").

**Aprobación de cuentas.** Ajuste de plataforma `requireApproval` (por defecto **apagado**: el alta
actual sigue igual). Encendido, `signup_tenant` crea el tenant en `pending_approval`. Estados:
`active`, `pending_approval`, `rejected`, `suspended`. Transiciones: aprobar (pendiente → activo),
rechazar con motivo (pendiente → rechazado), suspender con motivo (activo → suspendido), reactivar
(suspendido/rechazado → activo). Las reglas viven en `@crmwsp/domain` y se repiten en SQL.
Un tenant no activo puede iniciar sesión, pero ve la pantalla "Tu cuenta está en revisión" (o
rechazada/suspendida), el `TenantGuard` le responde 403 en toda la API del panel y
`ingest_inbound_event` descarta los webhooks de sus canales; los jobs del worker ya filtraban
`status = 'active'`. El propietario recibe un email al aprobar, rechazar o suspender.

**Planes.** El admin cambia el plan (Start/Pro) y, opcionalmente, guarda límites a medida en
`tenant_plans.limits_override`. El cambio de plan es efectivo en la siguiente petición (el plan se
lee en cada comprobación). Los límites a medida se aplican por clave: límite efectivo = override ??
límite del plan (`resolveEffectivePlan` en `@crmwsp/billing`), en `PlanLimitsService`, `GET /billing/plan`
y el turno de IA del worker.

**Cobros de suscripción.** `subscription_payments` (importe en unidades menores, moneda, periodo,
método `transfer | cash | card_manual | mercadopago | stripe`, referencia, notas, quién lo registró)
los registra a mano un admin. Es ingreso del SaaS, separado de los pedidos y pagos de los tenants.
"Pagado hasta" = el `period_end` más reciente. "Atrasado" = tenant activo cuyo periodo pagado ya
terminó, o que nunca pagó y tiene más de 14 días. Totales por mes (UTC) y moneda.

**Dashboard.** Tenants por estado, MRR estimado (tenants activos × precio mensual de lista del plan,
en USD, sin descuentos), cobros del mes y nº de atrasados.

## Consecuencias
- El aislamiento por tenant no cambia: el rol de app sigue sujeto a RLS y sin `BYPASSRLS`; la única
  vía entre tenants es un conjunto cerrado de funciones auditables y testeadas.
- `list_user_tenants` devuelve también el estado (cambio de tipo de retorno: se recrea).
- Revocar un admin es inmediato (se comprueba en cada petición).
- Pendiente: un historial de usuarios global y aplicar `limits_override` también en el modo dueño del worker.
