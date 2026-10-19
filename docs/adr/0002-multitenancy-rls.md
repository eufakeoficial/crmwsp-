# ADR 0002 — Aislamiento multi-tenant con RLS

**Estado:** aceptado · **Fecha:** 2026-10-19

## Contexto
Una fuga de datos entre empresas sería fatal para el producto. El aislamiento no puede depender de que cada consulta recuerde filtrar por `tenant_id`.

## Decisión
- Toda tabla de negocio tiene `tenant_id NOT NULL` y política RLS sobre `current_setting('app.tenant_id')`.
- El acceso a datos pasa por `withTenant(tenantId, fn)`, que abre transacción, fija `app.tenant_id` y ejecuta; el repositorio no expone conexión sin tenant.
- Rol de base de datos de la aplicación sin `BYPASSRLS`; migraciones con rol separado.
- Test de aislamiento obligatorio en CI: intenta leer/escribir datos de otro tenant y debe fallar.

## Consecuencias
- Pequeño coste por consulta (set de variable de sesión) a cambio de aislamiento por defecto.
- Jobs de workers deben recibir siempre `tenantId` en su payload.

## Notas de implementación
- **Expresión estándar de política:** toda política RLS usa `NULLIF(current_setting('app.tenant_id', true), '')::uuid`. Tras una transacción con `set_config(..., true)`, el GUC vuelve como `''` (no `NULL`) en esa conexión del pool; sin `NULLIF` el cast a `uuid` lanzaría error. Con `NULLIF`, sin tenant fijado la política evalúa a `NULL` y se ven 0 filas. Las políticas futuras deben llevar `USING` y `WITH CHECK` con esta misma expresión, y `ENABLE` + `FORCE ROW LEVEL SECURITY`.
- **El rol de aplicación no puede crear ni borrar tenants:** `tenants` solo tiene políticas `SELECT` y `UPDATE` (migración `0002`); `INSERT`/`DELETE` quedan denegados por RLS aunque existan grants. El alta de tenant es un job de sistema con rol privilegiado. Pendiente diseñar la vía de signup en Fase 1.
- **`users` no tiene RLS en Fase 0** (identidad global, sin `tenant_id`). El rol de aplicación tiene grants sobre ella y podría leer o modificar usuarios de otras empresas; el acceso debe ir solo vía `memberships` del tenant actual. Debe cubrirse (RLS vía `memberships` o restricción de grants) antes de Fase 1.
