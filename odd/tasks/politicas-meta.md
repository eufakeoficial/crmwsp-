# Feature: políticas de Meta/WhatsApp (politicas-meta)

**Objetivo:** reducir el riesgo de que Meta restrinja números o cuentas de los tenants, aplicando en
producto las reglas recogidas en `docs/research/politicas-meta-whatsapp-2026-10.md`.

**Problema / por qué:** hoy cualquier rubro puede conectar WhatsApp, las plantillas se envían sin
revisión previa, los cambios de calidad del número no se ven y nadie vigila cambios de política.

**Alcance:** T1 rubro del negocio, T2 salvaguardas de mensajería, T3 monitor diario de políticas.
Rama `feat/politicas-meta` desde `origin/feat/integracion`. Migraciones desde 0077, ADR desde 0021.

**Restricciones:** RLS + `withTenant`; tablas de plataforma solo vía funciones `SECURITY DEFINER`
con `platform_assert_admin_internal` y auditoría en `platform_audit_events` (ADR 0011). Nunca
aplicar automáticamente cambios de reglas. Sin secretos en logs.

**Estrategia de entrega:** `ask-on-risk`; commits por tarea, sin push.

## Tareas

- [x] T1 — Rubro del negocio: tabla `business_categories` sembrada desde la investigación,
  columnas en `tenants`, decisión en `@crmwsp/domain` (TDD) repetida en SQL, alta y panel, cola de
  revisión en el backoffice (auditada), bloqueo de conexión de WhatsApp mientras está en revisión.
  Ruta: inline (un solo escritor, el propio agente). Checks: typecheck, lint, tests.
- [x] T2 — Salvaguardas: opt-in/opt-out (ya existía `consents`; se amplían palabras y se confirma
  una vez), linter de plantillas (TDD), eventos de calidad/estado de Meta (v3) guardados y
  alertados, reglas del agente acotadas al negocio (test).
- [ ] T3 — Monitor diario de políticas: worker con fetch acotado (timeout, reintentos, tope de
  tamaño), normalización + SHA-256 + diff (TDD), snapshots y cambios en el backoffice, revisión
  manual por admin.

## Criterios de aceptación
- BLOQUEAR rechaza el alta con mensaje claro; REVISIÓN deja al tenant pendiente y no puede conectar
  WhatsApp hasta que un admin aprueba; ADVERTIR muestra la guía. Tenants existentes sin rubro: aviso
  en el panel, sin bloqueo.
- Difusiones solo a contactos con opt-in; STOP/BAJA/CANCELAR/NO MÁS revoca y confirma una vez.
- Linter de plantillas con errores/advertencias antes del envío a Meta.
- Monitor diario que guarda snapshots y crea un "cambio de política" revisable.

## Progreso / evidencia
- T1: tests de dominio 7/7 verdes (escritos junto a la implementación, sin RED aislado); api 195 pass / 173 skip; web 152 pass; typecheck y lint OK. Test de BD `business-categories.test.ts` se salta sin BD local.
- T2: RED observado (CANCELAR, prompt acotado), GREEN; dominio 289, whatsapp 94, ai 149, worker 130/93 skip, api 196/173 skip, web 152. Ruta inline.
