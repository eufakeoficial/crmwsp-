# Inventario de portado del front de referencia

Origen: `conectabo-src` (solo lectura). Marca, textos, logos y `BRAND` NO se portan. Sin next-intl, Cache Components, proxy.ts, next-safe-action ni Better Auth. Rutas de origen relativas a `conectabo-src/`.

| Origen | Destino (`apps/web/src/`) | Decisión |
|---|---|---|
| `apps/web/app/globals.css` (@theme, base, container-page, no-scrollbar) | `app/globals.css` | portado (tokens exactos) |
| `apps/web/app/layout.tsx` (Plus Jakarta Sans) | `app/layout.tsx` | adaptado (sin env/BRAND) |
| `packages/ui/src/cn.ts` | `lib/cn.ts` (+ `ui/cx.ts` alias) | portado |
| `packages/ui/src/button.tsx` | `components/ui/Button.tsx` | adaptado: variantes primary/accent/outline/ghost/whatsapp |
| `packages/ui/src/faq-accordion.tsx` | `components/ui/Accordion.tsx` | adaptado |
| `packages/ui/src/table-frame.tsx` | `components/ui/DataTable.tsx` (TableFrame) | portado |
| `packages/ui/src/toast-region.tsx`, `use-toast.ts`, `admin/table/toast.tsx` | `components/ui/Toast.tsx`, `lib/hooks/use-toast.ts` | portado |
| `packages/ui/src/use-dialog.ts` | `lib/hooks/use-dialog.ts` | portado |
| `packages/ui/src/use-dialog-focus.ts`, `panel/shell/use-dialog-focus.ts` | `lib/hooks/use-dialog-focus.ts` | portado |
| `packages/ui/src/code-input.tsx`, `flows/code-input.tsx` | `components/ui/CodeInput.tsx` | adaptado (sin lógica de verificación) |
| `panel/shell/panel-sidebar.tsx`, `panel-menu-sheet.tsx`, `panel-nav-link.tsx`, `nav-items.ts` | `components/app/AppSidebar.tsx`, `AppMenuSheet.tsx`, `nav-items.ts` | adaptado: navegación CRMWSP, contadores por prop |
| `panel/shell/panel-topbar.tsx`, `profile-menu.tsx` | `components/app/AppTopbar.tsx`, `TenantSwitcher.tsx` | adaptado a la lógica de tenant existente |
| `panel/shell/panel-shell.tsx` | `components/app/AppShell.tsx` | adaptado (sin asistente/notificaciones) |
| `panel/shell/assistant-fab.tsx` | `components/ui/AssistantFab.tsx` | adaptado (visual) |
| `panel/shell/assistant-panel.tsx`, `use-assistant-chat.ts`, `notifications-panel.tsx` | - | descartado: dependen de datos demo; sin backend aún |
| `panel/shell/panel-bottom-nav.tsx`, `panel-fab-offset.tsx`, `use-panel-hash.ts`, `panel-context.tsx` | - | descartado: el menú móvil usa hoja; hash de vistas es del dominio |
| `panel/ui/page-title.tsx` | `components/app/EmptyState.tsx` (PageHeader) | portado |
| `panel/ui/banner.tsx`, `flows/notice.tsx` | `ui/Banner.tsx`, `ui/Notice.tsx` | portado |
| `panel/ui/param-switch.tsx` | - | descartado: vistas por parámetro de URL del dominio |
| `brand/badges.tsx` (VerifiedBadge) | `ui/Badge.tsx` | adaptado (Verificado/Nuevo); Recommended/Rating descartados (reseñas) |
| `brand/logo.tsx` | `components/brand/Logo.tsx` | reescrito con marca CRMWSP (cuadrado lima + "C") |
| `admin/table/{data-table,status-chip,tones,pagination,check-box,side-panel,reason-dialog,filters,module-kpis,module-hero,pill-tabs}.tsx` | `ui/{DataTable,StatusChip,tones,Pagination,CheckBox,SidePanel,Dialog,Chip,KpiCard,SectionHero,Tabs}.tsx` | portado/adaptado (estados CRMWSP) |
| `admin/table/{action-button,admin-module-view,module-table,types}` | - | descartado: acoplado a configs demo y wa.me |
| `admin/shell/{admin-topbar,admin-sidebar,topbar-menus,admin-search,nav}.tsx` | `components/admin-shell/*` | adaptado: nav de backoffice SaaS; búsqueda sobre secciones |
| `admin/shell/{icons,admin-demo-provider,public-url,wa-link}` | - | descartado: demo/multi-host |
| `admin/b/shared/{kpi-card,switch,field,dialog,filter-chip,search-box,pill-tabs,data-table}` | `ui/{KpiCard,Switch,Chip,Dialog,DataTable,Tabs}` | duplicados de lo anterior: portado una vez |
| `site/site-header.tsx`, `mobile-menu.tsx` | `components/site/SiteHeader.tsx`, `MobileMenu.tsx` | adaptado (CTA "Ir a mi panel" con sesión) |
| `site/site-footer.tsx` | `components/site/SiteFooter.tsx` | adaptado con enlaces placeholder |
| `site/coming-soon.tsx` | `components/app/EmptyState.tsx` (`soon`) | adaptado |
| `flows/{step-bars,option-card,phone-field,spinner,success-card,upload-tile,back-button,initials-box,notice}` | `ui/{StepBars,OptionCard,PhoneField,Spinner,SuccessCard,UploadTile,BackButton,Avatar,Notice}` | portado/adaptado (PhoneField con prefijo obligatorio, sin país por defecto) |
| `flows/{action-bar,step-title,fields,validation,use-step-focus}` | - | descartado: helpers de wizards de dominio; se hará cuando exista un flujo |
| `flows/*` restantes (register, review, quote, sign-in, invitation) | - | descartado: dominio (directorio, reseñas, invitaciones) |
| `panel/quotes/quotes-board.tsx` ("pedido de presupuesto") | `ui/LeadCard.tsx` | patrón convertido en componente neutro con mini-campos |
| `directory/common/breadcrumbs.tsx` | `ui/Breadcrumbs.tsx` | portado |
| `directory/**`, `home/**`, `marketing/**` (sello, Top, Club, diagnóstico, cookies) | - | descartado: dominio de directorio/marketing. `cookie-banner` sin política definida |
| `emprende/**`, `invitation/**`, `admin/{listings,verifications,reviews,captacion,payments,home}`, `admin/b/**`, `panel/{b,c,listing,reviews,search,home,first-steps,results}` | - | descartado: funcionalidad de su dominio |
| `panel/b/payment/payment-timeline.tsx` | - | pendiente: útil para cobros, requiere modelo de pagos (Fase posterior) |
| `lucide-react` (iconos) | dependencia | permitida |
| `shadcn`/`components.json`, `qr-code`, mapas, charts | - | descartado: dependencias no autorizadas |

Nuevos formateadores: `lib/format.ts` (dinero, número, fecha, relativo) escritos para CRMWSP (locale `es`, moneda siempre explícita).

## Acceso a `/app/admin` (backoffice)

No existe todavía un rol de superadmin de plataforma. Hasta que exista, `app/app/admin/layout.tsx` y la página llaman a `assertAdminPreviewEnabled()` (`lib/admin-preview.ts`), que hace `notFound()` (404) salvo que:

- `NODE_ENV !== "production"` (desarrollo y tests), o
- la variable de servidor `ENABLE_ADMIN_PREVIEW === "1"` (solo para entornos de vista previa internos).

Además, `src/middleware.ts` responde 404 a `/app/admin` y `/app/admin/*` con la misma condición: en Next 15 `notFound()` desde el layout dinámico renderizaba la página de 404 pero con estado HTTP 200, así que el middleware garantiza el 404 real y `notFound()` queda como defensa (no se renderiza contenido). La ruta es dinámica (`force-dynamic`) para que la variable se lea en tiempo de ejecución. Aunque se habilite, sigue detrás del middleware y del `SessionProvider` de `/app/*`; habilitarla no da permisos sobre datos, solo muestra el shell vacío.
