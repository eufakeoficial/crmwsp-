# Estrategia de producto — CRM SaaS de ventas y atención con IA (octubre de 2026)

**Objetivo**: crear un CRM WhatsApp-first, multiempresa, comercializable en España y Latinoamérica desde aproximadamente US$99/mes, que automatice acciones comerciales verificables, no solo respuestas.

**Alcance y evidencia**: comparativa exploratoria de competidores principales; no es un censo exhaustivo de todo el mercado. Se consultaron páginas públicas de producto, precios, documentación y discusiones de usuarios. El vídeo `https://www.youtube.com/watch?v=1PzSWqCHenA` no pudo reproducirse ni transcribirse desde el entorno de investigación, por lo que el análisis de Tokewoot procede de su landing y blog oficiales; las afirmaciones comerciales del proveedor no se consideran auditoría de resultados.

## 1. Tesis de producto

> **«Del WhatsApp al cobro, con el CRM actualizado solo»**.

El cliente expresa lo que necesita por voz, texto, imagen o PDF. El SaaS entiende la solicitud, la convierte en una oportunidad y una tarea ejecutable, calcula un presupuesto a partir de fuentes verificadas, lo presenta al cliente, registra el resultado, verifica un cobro con la pasarela de pago y coordina los siguientes pasos. El comerciante interviene solo cuando hace falta.

**NO competir solo en**: inbox compartida, bot FAQ, Kanban, audios, resúmenes, IA que califica clientes o integración con anuncios. Estos elementos ya existen en varios competidores.

**Competir en**: profundidad de una tarea comercial concreta, fiabilidad de ejecución, nula actualización manual, costes transparentes y tiempo mínimo de configuración.

## 2. Mercado y competidores — fortalezas comprobadas

| Producto | Fortaleza observable | Lección para nosotros |
|---|---|---|
| Tokewoot | Flujos IA, varios agentes, Kanban, Meta Ads, comprensión de audio, comprobantes, productos digitales, portal de miembros. Start US$59,90/mes y Pro US$99,90/mes anunciados. | No diferenciar por estas funciones aisladas. |
| Respond.io | Omnicanal, agentes que actualizan CRM, etapas, reservas, atribución y ciclos de vida. | La IA ya hace acciones en algunos CRMs. Debemos ser más verticales y fáciles de operar. |
| Kommo | Pipeline comercial, Salesbot, IA y mensajes multicanal. | La gestión del embudo es una capacidad consolidada. |
| Wati | WhatsApp, campañas, ecommerce, equipo, IA y automatización. | Comercialización dirigida a WhatsApp. |
| Manychat | Instagram, comentario a DM, automatizaciones y canales sociales. Pro anunciado desde US$29/mes. | Adquisición de leads desde redes no es diferenciador suficiente. |
| SleekFlow / Trengo | Bandeja omnicanal, colaboración y workflows. | La atención multicanal está muy competida. |
| Chatwoot | Inbox abierta, autohospedaje, Captain AI con memoria, resúmenes, copilot, clasificación y huecos de conocimiento. | Incluso las funciones de IA para operadores ya son commodity. |
| HubSpot | CRM transversal, contexto comercial, Customer Agent; precio público por resolución. | El comprador comienza a exigir resultados y métricas verificables. |
| Intercom Fin | IA de soporte, procedimientos y precios por resultados. | No vender cantidad de mensajes como promesa central. |
| HighLevel | Modelo agencia/SaaS, subcuentas, automatizaciones y reventa. | El white-label y onboarding multiempresa tienen demanda, pero también competencia. |

### Fuentes oficiales seleccionadas

- Tokewoot: https://wa.tokewoot.com/landing
- Respond.io: https://respond.io/es/ai-agents y https://respond.io/es/pricing
- Kommo: https://www.kommo.com/salesbot/ y https://www.kommo.com/whatsapp/whatsapp-ai/
- Wati: https://www.wati.io/pricing/
- Manychat: https://manychat.com/pricing
- Chatwoot: https://www.chatwoot.com/pricing
- HubSpot: https://www.hubspot.com/company-news/hubspots-customer-agent-and-prospecting-agent-now-you-pay-when-the-task-is-complete
- Intercom: https://www.intercom.com/help/es/articles/8205718-resultados-del-agente-fin-ai
- HighLevel: https://www.gohighlevel.com/pricing

## 3. Problemas detectados (señales cualitativas, no estadísticas de población)

1. El equipo tiene que registrar manualmente contactos, tareas, oportunidades y resultados después de hablar.
2. Los presupuestos quedan sin respuesta; nadie recuerda hacer seguimiento, ni sabe qué oportunidades se pierden.
3. Pedidos recibidos por audio, imágenes o escritura a mano deben reinterpretarse y copiarse a sistemas.
4. Los chats se mezclan entre varios números/agentes y se pierde la propiedad de la conversación.
5. La IA puede inventar precios, descuentos, stock, promesas y plazos sin haberlos verificado.
6. Los paneles muestran mensajes y contactos, pero no siempre enlazan cotización, venta, cobro y publicidad.
7. Costes crecientes por número, contacto, asiento, mensaje y uso de IA difíciles de explicar al comprador.
8. La configuración de reglas y árboles conversacionales exige demasiado trabajo para pequeñas empresas.

Referencias cualitativas:
- https://www.reddit.com/r/CRM/comments/1qf9rwe/people_hate_crms_why_dont_simple_whatsappbased/
- https://www.reddit.com/r/CRMSoftware/comments/1wybzoy/why_is_finding_a_decent_crm_for_whatsapp_with/
- https://www.reddit.com/r/CRM/comments/1uq6qdg/i_built_a_full_whatsappdriven_crm_for_a/
- https://www.reddit.com/r/CRM/comments/1sxytvo/true_aifirst_crms_that_actually_are_worth_trying/

## 4. Diferenciadores propuestos: combinación distintiva, no exclusividad global demostrada

### F1 — «Cotiza y cobra» (prioridad máxima)
**Ejemplo:** cliente: «Necesito instalar dos equipos de aire en Vilafranca; adjunto fotos». El sistema identifica datos y faltantes; pide medidas necesarias; crea oportunidad; consulta catálogo/tarifa real; genera presupuesto PDF; solicita aprobación humana si precio > umbral; envía propuesta; crea enlace de pago; confirma pago **solo por webhook de la pasarela o conciliación fiable**; asigna tarea de instalación y registra todo.
- No inventar precios ni disponibilidad.
- Comprobante visual sirve como pista, **nunca como prueba suficiente de cobro**.
- KPI: presupuestos enviados, aceptados, cobrados y tiempo medio de cierre.
- Complejidad: alta, pero valor percibido alto.

### F2 — CRM sin teclear: «Autopiloto administrativo»
Transcribe audios entrantes si procede, extrae nombre, necesidad, producto, presupuesto, urgencia, fechas, estado y siguiente acción. Actualiza ficha con historial de cambios y nivel de confianza. Los datos inciertos se presentan para confirmar.
- KPI: tiempo de administración ahorrado, correcciones del usuario, porcentaje de fichas completas.
- Complejidad: media.

### F3 — Recuperación de oportunidades con consentimiento
Detecta presupuestos sin respuesta, clientes que preguntaron por disponibilidad, renovaciones o conversaciones abandonadas. Sugiere seguimiento útil con una razón concreta; usa consentimiento registrado y plantilla aprobada cuando se cierra la ventana de servicio.
- Ejemplo: «Presupuesto de 780 € enviado hace 4 días; seguimiento permitido, no existe rechazo».
- KPI: ingresos recuperados y tasa de contacto útil, no spam enviado.
- Complejidad: media.

### F4 — Pedidos desde voz, foto o PDF a registros estructurados
Para comercios/distribuidores: audio «mándame 12 cajas del modelo A y 6 del B» o foto de lista manuscrita → tabla de productos, cantidades, unidades y precios; confirmar ítems dudosos antes de enviar al ERP.
- KPI: tiempo de pedido, errores de captura, pedidos completos sin intervención.
- Complejidad: media-alta según formatos.

### F5 — IA con prueba de lo que afirma
Cada respuesta sobre precios, stock, plazos o políticas indica internamente el registro de origen y fecha de actualización. Si no hay fuente válida, pide confirmación o transfiere a humano. Versionado de conocimiento y umbrales de confianza.
- KPI: promesas erróneas, escalados justificados y correcciones.
- Complejidad: media.

### F6 — Ensayo antes de publicar «Simulador de conversaciones»
Antes de activar la IA, simular conversaciones típicas y maliciosas: cambios de precio, reclamaciones, datos insuficientes, duplicados, negativa a consentir. Generar score y regresiones con datos anonimizados. Versionar prompts y comparar A/B bajo evaluación humana.
- KPI: errores detectados antes de producción y tasa de incidencias tras cambios.
- Complejidad: media-alta.

### F7 — Panel de rentabilidad por cliente y por venta
Mostrar: ingreso facturado y confirmado, gasto de Meta por categoría, coste de BSP, tokens de IA, campañas, margen estimado, coste por oportunidad ganada, tiempo ahorrado. Alertas de presupuesto y coste máximo mensual.
- KPI: margen operativo por cliente y número de clientes que superan presupuesto.
- Complejidad: media.

### F8 — Agentes económicos con control de calidad y BYOK
Permitir clave API propia del cliente de modelos comerciales (no suscripción OpenCode Go), cuotas, routing entre modelo barato y potente, límite de costes y derivación humana. La IA puede proponer acciones; operaciones económicas o destructivas exigen autorización.
- KPI: coste medio por conversación útil, tasa de error, escalados.
- Complejidad: media.

### F9 — «Modo dueño»: CRM desde el propio WhatsApp
El propietario escribe o manda nota de voz a un asistente autorizado: «¿Quién no ha respondido al presupuesto?», «Organiza las visitas de mañana» o «Crea tarea para José». Requiere identificación, permisos y confirmación para acciones sensibles.
- KPI: frecuencia de consulta, ahorro de tiempo, adopción móvil.
- Complejidad: media.

### F10 — Kit vertical listo para funcionar
Configuración por sector, con lenguaje, datos, documentos, embudos y acciones ya adaptados. Ejemplos:
- Instalaciones: fotos/medidas → presupuesto → visita → factura.
- Taller: matrícula/modelo → cita → presupuesto → aprobación → seguimiento.
- Distribuidor: audio/lista → pedido → disponibilidad → confirmación.
- Inmobiliaria: filtro de inmueble → visita → tarea → seguimiento (mayor complejidad de integración de inventario).
- KPI: tiempo a primera automatización funcionando y conversión por sector.
- Complejidad: media para un único vertical, alta para muchos.

### F11 — «Señales de pérdida» explicables
Alertas cuando un cliente pregunta lo mismo varias veces, hay 2 asesores respondiendo a la vez, sube el tiempo de atención o el modelo intenta prometer algo sin evidencia. Mostrar motivo y acción sugerida.
- KPI: reincidencias, retrasos y rescates efectivos.

### F12 — Onboarding desde archivos existentes
Importar hoja de precios, catálogo CSV/PDF, FAQs, sitio web autorizado y calendario; detectar conflictos entre documentos, pedir validación de los datos y montar un primer flujo editable. No entrenar silenciosamente con datos de clientes ajenos.
- KPI: tiempo hasta primera respuesta útil y configuración completada.

## 5. Matriz de priorización

| Función | Valor | Esfuerzo | Cuándo |
|---|---|---|---|
| Inbox + WhatsApp + contactos + roles | Imprescindible | Medio-alto | MVP |
| Autopiloto administrativo | Alto | Medio | MVP |
| Seguimiento de oportunidades y recordatorios | Muy alto | Medio | MVP |
| Respuesta IA con fuentes y derivación humana | Muy alto | Medio | MVP |
| Presupuesto digital con precios reales | Muy alto | Medio-alto | MVP de un sector |
| Verificación de pagos por webhook | Muy alto | Medio | MVP si el vertical cobra online |
| Audio/foto → pedido | Muy alto para distribución | Alto | V1 del vertical |
| Simulador de IA | Alto | Medio-alto | V1 |
| Rentabilidad por conversación y cliente | Alto | Medio | V1 |
| Integración con múltiples redes sociales | Medio | Alto | V2 |
| White-label completo | Medio | Alto | V2 |
| Inteligencia predictiva avanzada | Incierto antes de obtener datos | Alto | Después de validar |

## 6. Público de lanzamiento propuesto

**Primera opción: negocios españoles de servicios con presupuestos**: climatización, reformas, instalaciones, mantenimiento y talleres. Venden trabajos de valor relativamente alto y dependen de fotos, audios, visitas y presupuestos. Muestran ROI fácil de explicar: «presupuestos seguidos y cobrados». Evitar comenzar por clínicas con datos médicos sensibles o por sectores regulados.

**Segunda opción: distribución/venta al por mayor**: automación de pedidos desde WhatsApp; alto valor pero integraciones de catálogo/inventario más complejas.

**Tercera opción: inmobiliarias**: buen encaje en agenda y lead qualification; mercado con muchos rivales y requiere sincronizar fichas de propiedades.

Entrevistar primero a 10–15 empresas de un solo sector: ¿qué mensajes reciben? ¿qué los retrasa? ¿cuántos presupuestos pierden? ¿qué software usan? ¿quién autoriza descuentos? ¿aceptarían 99 USD/mes por resolverlo?

## 7. MVP vendible — experiencia exacta

1. Empresa se registra y crea su organización.
2. Conecta número con onboarding oficial/BSP habilitado.
3. Importa catálogo de productos/servicios y reglas de atención.
4. Define horarios, política de descuentos, derivaciones y presupuesto de mensajes/IA.
5. Prueba diez conversaciones simuladas y aprueba el agente.
6. Cliente escribe por WhatsApp (texto/voz/foto, según vertical).
7. CRM abre o identifica contacto, extrae datos útiles y asigna oportunidad.
8. IA responde a partir de fuentes veraces; humano toma control cuando se requiere.
9. Prepara presupuesto y enlace de pago; la confirmación económica llega del proveedor de pago.
10. Se agenda trabajo, se actualiza oportunidad y se programan seguimientos permitidos.
11. Dashboard muestra presupuesto enviado/aceptado/cobrado, gasto y margen.
12. El dueño revisa todo desde móvil, incluyendo motivo y auditoría de acciones.

## 8. Arquitectura sugerida

- Frontend: Next.js + React + Tailwind + shadcn/ui, responsive/PWA.
- Backend: servicio de API estable para webhooks, sesiones y acciones transaccionales; separar workers.
- PostgreSQL: aislamiento por `tenant_id` y controles de autorización en TODAS las consultas.
- Redis + BullMQ: recepción idempotente, colas, reintentos, temporizadores, seguimientos.
- Integración WhatsApp por adaptador BSP/Meta: webhooks firmados, estados, números por empresa, template manager.
- Motor IA modular: proveedor API externo; retrieval sobre fuentes verificadas, reglas explícitas de acciones, auditoría y costes.
- Archivos: almacenamiento privado por empresa, políticas de retención y acceso.
- Integraciones: inventario/precios, reservas, pagos con webhooks, facturación según caso de uso.
- Suscripciones: Stripe, límites por empresa, alertas y suspensión segura al superar presupuesto.
- Logs: trazabilidad por conversación, flujo, cambio de etapa, factura e invocación IA sin almacenar secretos.

**Modelo de datos base:** Tenant, User, Membership, Role, ChannelConnection, Contact, Consent, Conversation, Message, Attachment, Opportunity, PipelineStage, Product, Quote, QuoteItem, Order, Payment, Booking, Automation, KnowledgeSource, AgentConfig, ActionApproval, ExecutionLog, UsageLedger, Subscription, AuditEvent.

**Seguridad desde MVP:** cifrar secretos; controles de tenants; verificación de webhooks; protección contra duplicados y reenvíos; consentimiento; borrado/exportación; límites de gasto; acceso humano; prueba de errores/hallucinations; no validar pagos con fotos de capturas.

## 9. Normativa y límites relevantes

- Política oficial: https://business.whatsapp.com/policy/preview?lang=es_LA
- Para iniciar conversación, consentimiento y plantillas aprobadas; fuera de 24 horas desde último mensaje del usuario, plantillas aprobadas. No usar automatización para spam.
- La automatización debe permitir escalado claro a humano.
- Modelos de IA y claves no equivalen a usar una suscripción de agentes de código. OpenCode Go está previsto para tráfico de programación; usar APIs comerciales para atención al cliente: https://docs.opencode.ai/docs/go/
- España/UE: RGPD, contrato de encargado cuando aplique, información a usuarios, periodos de retención, control de proveedores internacionales, acceso/borrado, privacidad desde el diseño.
- Sectores regulados: revisar restricciones adicionales de Meta y legislación aplicable antes de admitir una empresa.

## 10. Modelo comercial propuesto (hipótesis a validar)

- **Business 99 USD/mes**: una conexión WhatsApp, bandeja compartida, perfiles y oportunidades, IA con API propia del cliente, un kit vertical, seguimiento, presupuestos, informes básicos, límite de usuarios/contactos/acciones apropiado.
- **Growth 149–199 USD/mes**: más números/agentes, acciones comerciales avanzadas, atribución, simulador de IA, integración de pedidos, API y análisis de rentabilidad.
- **Enterprise**: multi-sede, APIs especializadas, SLA, seguridad avanzada.
- **Costes de WhatsApp**: tarifados separadamente o con bolsa limitada y cobro de exceso, porque Meta factura mensajes según país/categoría y sus tarifas cambiaron en octubre de 2026.
- **IA del cliente**: BYOK solo con proveedor de API de inferencia autorizado. Si SaaS provee IA, facturar por bolsa de créditos con límites y alertas.
- **BSP**: Gupshup publica tarifa ISV «desde US$0,001 por mensaje» sin cuota de suscripción, aparte de las tarifas de WhatsApp, pero la negociación y elegibilidad deben verificarse (https://www.gupshup.ai/partners).
- **Objetivo de coste variable de US$10 por cliente**: hipótesis, NO coste garantizado. Depende de cuántos mensajes Meta facture, países, plantillas, medios, IA y PSP.

## 11. Roadmap por hitos (no promesa de fechas)

### MVP 0: fundamentos
Tenants, auth, roles, WhatsApp test, bandeja, guardado de eventos idempotente, contacto, auditoría. Criterio: los mensajes no se mezclan ni duplican y nadie de otra empresa puede leerlos.

### MVP 1: IA con control
Conocimiento por empresa, clasificación, extracción de campos, respuestas con fuentes, derivación humana, coste y evaluación de calidad. Criterio: pruebas positivas y negativas, sin precios inventados.

### MVP 2: oportunidad → presupuesto → seguimiento
Pipeline, presupuestos reales, condiciones comerciales aprobadas, recordatorios con consentimiento, registro de etapas. Criterio: negocio piloto genera y acepta un presupuesto completo.

### MVP 3: resultado económico
Pasarela para enlace de pago, confirmación por webhook, dashboard de ventas cobradas y trazabilidad de publicidad si hay integración. Criterio: ingreso verificado, no inferido desde chat/foto.

### Escala 1: SaaS automático
Onboarding de empresas con BSP/Meta según autorizaciones, suscripciones, cuota y límites, migraciones, observabilidad, soporte, seguridad y pruebas de volumen.

### Escala 2: vertical 2 y agente de voz/pedidos
Importación de catálogos avanzados, foto/audio → pedidos y acciones externas; simulator de prompts y reporting avanzado.

## 12. Métricas que importan

- Activación: tiempo desde alta hasta primera conversación correctamente atendida.
- Ventas: porcentaje de leads que reciben presupuesto, aceptan y pagan.
- Recuperación: ingresos de oportunidades seguidas contra grupo/comparación válida.
- Velocidad: tiempo a primera respuesta útil y a cotización.
- Confianza: errores por 100 conversaciones, tasa de retrabajo humano, disputas.
- Economía: margen de contribución por tenant = ingreso menos BSP/Meta, IA incluida, pagos y coste variable de infraestructura.
- Retención: clientes activos semanales, churn, cuentas con resultados comprobables.
- Automatización: porcentaje de trabajo concluido correctamente, no simplemente cantidad de mensajes de bot.

## 13. Investigación comercial antes de desarrollo grande

1. Mostrar prototipo clickable a 10–15 negocios de un único vertical.
2. Obtener 3–5 pilotos de pago, no solo interesados.
3. Revisar sus conversaciones reales con consentimiento y anonimización.
4. Medir volumen por cliente y coste real de mensajes antes de prometer 99 USD all inclusive.
5. Comparar al menos 2 modelos IA con 100 casos reales anonimizados y rúbrica de exactitud/acción, no solo velocidad.
6. Construir la integración WhatsApp con una cuenta de prueba antes de gastar meses en un SaaS multiempresa.
7. Negociar con BSP por escrito condiciones de alta ISV, facturación y acceso a webhooks, sin suponer que evita todas las aprobaciones de Meta.

## 14. Afirmaciones que NO deben hacerse

- «Nadie ofrece estas funciones»: no hay evidencia global de exclusividad; la innovación propuesta está en su combinación y ejecución sectorial.
- «La IA comprueba depósitos desde capturas»: capturas pueden manipularse; comprobar por pasarela o conciliación autorizada.
- «Todos los mensajes de WhatsApp son gratis»: tarifas de Meta/BSP cambian por país, categoría y contexto.
- «US$10 de coste fijo por cliente está garantizado»: el uso real y los acuerdos de proveedor determinan el coste.
- «La suscripción OpenCode Go sirve para atender WhatsApp de clientes»: su tráfico está orientado a agentes de programación.
- «El bot puede escribir a cualquiera sin permiso»: consentimiento y plantillas limitan mensajes proactivos.

## Resumen ejecutivo

**Recomendación:** no construir «un CRM para todos» en el primer lanzamiento. Crear un **Sales Operations CRM centrado en WhatsApp para negocios españoles de servicios con presupuestos**. Producto diferenciador: **convierte conversación → oportunidad → presupuesto → cobro verificado → seguimiento, casi sin trabajo administrativo, con IA auditada**. Validar el interés y volumen de mensajes con 3–5 pilotos antes de expandir a otros verticales.
