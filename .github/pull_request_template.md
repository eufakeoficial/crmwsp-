## Qué cambia

<!-- Resumen en 2-5 líneas. Qué problema resuelve y cómo. -->

## Ticket

<!-- Ej.: T5 — CI en GitHub Actions y commitlint (Fase 0). Enlace al ticket/issue si existe. -->

## Pruebas (comando → exit code)

<!-- Lista exactamente lo que ejecutaste y el resultado. -->

| Comando | Exit code |
| --- | --- |
| `pnpm lint` | |
| `pnpm typecheck` | |
| `pnpm test` | |

## Riesgos

<!-- Qué puede romperse, migraciones irreversibles, cambios en webhooks/IA/pagos, rollback. -->

## ¿Nueva dependencia?

- [ ] No
- [ ] Sí — justificación (por qué no se resuelve con lo que ya hay, tamaño, mantenimiento, licencia):

## ¿Tabla nueva?

- [ ] No
- [ ] Sí — lleva `tenant_id`, política RLS y adjunto el test de aislamiento de tenants:

<!-- Ruta al test, ej.: packages/db/test/rls/<tabla>.test.ts -->

## Checklist

- [ ] Conventional Commits en español (`feat:`, `fix:`, `docs:`…)
- [ ] Sin secretos en código, logs ni fixtures
- [ ] Todo acceso a datos pasa por `withTenant(tenantId, fn)`
- [ ] ADR añadido en `docs/adr/` si hubo una decisión no obvia
