# UX nivel enterprise (auditoría 2026-10-25)

Rama: `feat/ux-enterprise` (desde `feat/guia-gupshup`, PR #16). Objetivo: navegación clara, sin jerga, sin funciones escondidas.

## Tareas
- [x] T1 (9aa135c) (fable) CTA en estados vacíos: ProductsView, ChannelsView, SourceList, OrdersView, BroadcastsView
- [x] T2 (c6ff78a) (fable) Texto de ayuda "dónde lo encuentro" en campos con jerga: ConnectChannelPanel, PartnerCredentialsPanel, IntegrationsView
- [x] T3 (c6ff78a) (fable) Renombrar etiquetas: Plantillas→Plantillas de WhatsApp / Plantillas de negocio; Aprobaciones→Aprobar respuestas de la IA; Ejecuciones→Historial de la IA; Playbook→Guion de ventas; Modo dueño→Gestionar desde tu WhatsApp; Desarrolladores→Claves de API; quitar texto "ver roadmap"
- [x] T4 (5c018a5) (sonnet) Sidebar 7 grupos: Inicio, Inbox, Clientes, Ventas, Agenda, Automatizar, Configuración; mover Canales/Productos fuera de "Más"
- [x] T5 (62cf902) (sonnet) Contadores Comprobantes / Necesitan atención; Simulador visible en Inicio y Config IA; enlace a Puesta en marcha persistente
- [x] Revisión del orquestador de cada diff antes de commit

## Checks por tarea
`pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web test`

## Evidencia

- Extra: sidebar 232px sin scroll, tarjeta IA compacta (2bd7db7)
- Checks: typecheck/lint/test (202) verdes en cada commit. Pendiente: revisión visual en navegador.
