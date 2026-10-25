# UX nivel enterprise (auditoría 2026-10-25)

Rama: `feat/ux-enterprise` (desde `feat/guia-gupshup`, PR #16). Objetivo: navegación clara, sin jerga, sin funciones escondidas.

## Tareas
- [ ] T1 (fable) CTA en estados vacíos: ProductsView, ChannelsView, SourceList, OrdersView, BroadcastsView
- [ ] T2 (fable) Texto de ayuda "dónde lo encuentro" en campos con jerga: ConnectChannelPanel, PartnerCredentialsPanel, IntegrationsView
- [ ] T3 (fable) Renombrar etiquetas: Plantillas→Plantillas de WhatsApp / Plantillas de negocio; Aprobaciones→Aprobar respuestas de la IA; Ejecuciones→Historial de la IA; Playbook→Guion de ventas; Modo dueño→Gestionar desde tu WhatsApp; Desarrolladores→Claves de API; quitar texto "ver roadmap"
- [ ] T4 (sonnet) Sidebar 7 grupos: Inicio, Inbox, Clientes, Ventas, Agenda, Automatizar, Configuración; mover Canales/Productos fuera de "Más"
- [ ] T5 (sonnet) Contadores Comprobantes / Necesitan atención; Simulador visible en Inicio y Config IA; enlace a Puesta en marcha persistente
- [ ] Revisión Opus de cada diff antes de commit

## Checks por tarea
`pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web test`

## Evidencia
