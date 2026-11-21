# fix-prelanzamiento

Objetivo: corregir los hallazgos verificados de la revisión previa al lanzamiento (F1–F10) sobre
`feat/integracion`, con tests y un commit por hallazgo. Rama: `fix/prelanzamiento` (PR #9, draft,
base `feat/integracion`, no mergear).

Fuera de alcance: BYOK vs tope de `ai_messages` (decisión de producto pendiente).

Restricciones: migraciones nuevas desde 0090 (journal escrito a mano); no tocar migraciones de main
(≤0059) ni de 0060–0079. Verificación de registro: CI de GitHub Actions (Postgres). Ruta: delegated
direct (un único writer).

## Tareas
- [x] F1 (HIGH) 360dialog: dueño cross-tenant (409 auditado, sin llamadas al Partner API),
  clientId obligatorio verificado en el Partner API, `state` de un solo uso. Migración 0090.
- [x] F2 (HIGH) email_lifecycle_candidates: cursor keyset (`email_lifecycle_candidates_page`,
  0091), hasta 20 páginas de 500 por tick.
- [x] F3 (MEDIUM) ActivationGuard exige trial/active/grace/unbilled; `@AllowLapsedWrite` para
  vista previa y cancelar difusión; mensajes 402 en español; ADR 0015.
- [x] F4 (MEDIUM) pago-por-vencer con precio de lista del ciclo real (0092) y variante "vence hoy".
- [x] F5 (MEDIUM) SETUP_REQUIRED en español con enlace a Canales; botones deshabilitados en setup;
  error de importación localizado; dedupe defensivo de teléfonos.
- [x] F6 (LOW) forgot-password: 3/hora por email (descarte silencioso); Referrer-Policy
  no-referrer en /reset/*; token quitado de la URL; ADR 0019.
- [x] F7 (LOW) cupones: `over_cap` + auditoría + marca en backoffice (0093); ADR 0017.
- [x] F8 (LOW) trigger de precio de lista (0094); referral/signup-signals exigen app.tenant_id;
  funciones solo del worker revisadas (sin rol de worker: documentado en ADR 0015).
- [x] F9 (LOW) pestaña "Modo dueño" duplicada.
- [x] F10 (LOW) Agenda 24:00 ida y vuelta.

## Evidencia
- Commits: F1 4d281da, F2 6e1d4f3, F3 ed05b3c, F4 865c589, F5 b700fa6, F6 53e7588, F7 63d12f3,
  F8 8ff96f2, F9 b8edc8e, F10 012a8e6.
- Local: `pnpm typecheck` y `pnpm lint` en verde; tests unitarios de cada paquete tocado en verde.
- CI (Postgres) run 40111434282: success (tests de BD 0090–0094 ejecutados, no omitidos).
- Rebase sobre `origin/feat/integracion` (0077–0079 de politicas-meta) resuelto antes de F6.

## Riesgos residuales
- F1: el formato del `client_id` en la respuesta del Hub y si Connect devuelve `state` deben
  validarse en sandbox; si el Hub no lo devuelve se usa el respaldo en sessionStorage.
- F5: test de dedupe no tuvo RED (planContactImport ya deduplicaba); es defensa en profundidad.
- F6: recargar /reset tras quitar el token exige pedir otro enlace.
- F8: API y worker comparten `crmwsp_app`; las funciones solo del worker siguen ejecutables por la
  API (sin llamadas hoy). Un cambio de precio en PLANS exige migración (test de sincronía).
