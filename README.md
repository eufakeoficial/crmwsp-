# CRMWSP

CRM WhatsApp-first con IA para negocios de servicios con presupuestos (España y Latinoamérica). Convierte conversación → oportunidad → presupuesto → cobro verificado → seguimiento, con mínima administración manual y IA auditada.

## Documentación

- [`docs/STRATEGY.md`](docs/STRATEGY.md) — tesis de producto, mercado, diferenciadores y modelo comercial.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — stack, estructura del monorepo, modelo de datos, flujos críticos, seguridad y escalabilidad.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — fases de desarrollo con criterios de salida.
- [`docs/adr/`](docs/adr/) — registros de decisiones de arquitectura.

## Estado

Producto en producción en **https://www.vendemas.chat** (vendemas.chat). Fases 0, 1 y 2 completadas; las fases 3 a 6 están en curso en paralelo (marcadas 🟡 en `docs/ROADMAP.md`).

Ya operativo:

- Inbox WhatsApp multi-tenant (Gupshup y 360dialog detrás de `WhatsAppProvider`), plantillas de Meta con sincronización de estado y motivo de rechazo, seguimientos y difusiones.
- IA con fuentes y BYOK, pipeline de oportunidades, presupuestos y pedidos, agenda y catálogo.
- Cobros verificados por webhook, suscripciones del SaaS con NOWPayments (cripto), cupones y referidos, tickets de soporte, panel de plataforma y correos transaccionales.

El detalle por feature vive en `odd/tasks/` y las decisiones en `docs/adr/`. Siguiente: ver `docs/ROADMAP.md` (cobro con tarjeta y renovación automática en `feat/cobro-tarjeta`).
