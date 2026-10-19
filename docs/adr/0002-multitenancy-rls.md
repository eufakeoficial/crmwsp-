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
