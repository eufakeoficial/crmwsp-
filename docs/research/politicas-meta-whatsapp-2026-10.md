# Políticas de Meta/WhatsApp relevantes para Vende+ WSP (investigación 2026-10-24)

Fecha de consulta de todas las fuentes: **2026-10-24**. Solo fuentes primarias (Meta / WhatsApp). Todo lo que no se pudo confirmar en una página oficial figura como **no verificado**. Las páginas se leyeron vía fetch con resumen automático (no texto literal íntegro), por lo que las citas literales son las que la herramienta devolvió entre comillas; antes de bloquear a un cliente por una regla, validar el texto oficial. Esto es investigación técnica, no asesoría legal.

## 1. Resumen de reglas

### 1.1 Política de mensajes de WhatsApp Business
Fuente: https://whatsappbusiness.com/es-la/policy/ (redirige desde https://business.whatsapp.com/policy). **Última actualización indicada en la página: 23 de septiembre de 2026.** Consultada 2026-10-24.

- **Opt-in:** solo contactar a quien dio su número/usuario y aceptó recibir mensajes de la empresa. Consentimiento separado por categoría de mensaje y otro para llamadas. Instrucciones claras para rechazar, respetar bajas, flujos de consentimiento fáciles de entender. La empresa responde por cumplir la ley local de consentimiento.
- **Ventana de 24 h:** dentro de las 24 h desde el último mensaje del usuario se responde sin plantilla; fuera, solo plantillas aprobadas. Meta puede revisar, pausar o rechazar plantillas en cualquier momento.
- **Automatización/chatbots:** permitida en la ventana de 24 h. Debe haber "prompt, clear, and direct escalation paths" a una persona (chat con agente humano, teléfono, email, web, tienda, formulario).
- **Datos:** publicar política de privacidad; no pedir/compartir números completos de tarjeta, cuentas bancarias ni documentos de identidad; no reenviar la conversación de un cliente a otro.
- **Prohibido:** actividades ilegales, terrorismo/crimen organizado, discriminación, contenido ofensivo o sexual explícito, partidos políticos/candidatos/campañas, fuerzas del orden/militares/inteligencia (gobiernos solo vía proveedor de soluciones). Ver tabla de negocios (sección 3).
- **Cumplimiento:** Meta puede limitar o eliminar acceso por infracciones, quejas negativas o daño a usuarios; detección automatizada + manual; la política puede cambiar sin previo aviso.

### 1.2 Plantillas
Fuente: https://developers.facebook.com/docs/whatsapp/message-templates/guidelines (2026-10-24; sin fecha de actualización visible).
- Categorías: **marketing, utility, authentication** (afecta el precio). Revisión automática, hasta 24 h. Rechazada = no enviable.
- Calidad (WhatsApp Manager): Quality pending / High / Medium / Low. Medium/Low se pueden enviar pero con riesgo de **pausa** (Paused: feedback negativo recurrente o baja lectura) o **deshabilitación** (Disabled). Existe "template pacing" y límite por usuario de plantillas de marketing recibidas de cualquier negocio.
- Reglas de reclasificación/errores de categoría y motivos de rechazo: remiten a otras guías, **no verificado** en esta investigación.

### 1.3 Reglas de IA (crítico)
Fuentes consultadas:
- https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/ai-providers.md (2026-10-24): define "AI Providers" como "Providers and developers of artificial intelligence or machine learning technologies, such as large language models" (incluye plataformas de IA generativa y asistentes de propósito general), con base en los **WhatsApp Terms of Service actualizados el 15-ene-2026**. Se aplican solo cuando Meta está legalmente obligada a permitir ese uso. Los demás negocios no están cubiertos por esa política de precios.
- Texto de los Terms (vía resultados de búsqueda, **el texto completo de https://www.whatsapp.com/legal/business-solution-terms no se pudo leer por fetch (contenido renderizado por JS / 404 en preview)**; la paráfrasis de los snippets): prohíbe a proveedores de IA/LLM acceder o usar la WhatsApp Business Solution, directa o indirectamente, cuando la IA es la funcionalidad **principal** y no incidental; Meta decide qué es "principal". Un negocio puede contratar un proveedor de IA como tercero, pero **no** puede permitir que los datos de la Business Solution se usen para crear/entrenar/mejorar sistemas de IA/ML (excepción de ajuste fino exclusivo para el propio negocio, redacción exacta **no verificado**).
- Cobertura de prensa (secundaria, **no oficial**): fecha efectiva 15-ene-2026 (nuevos usuarios desde 15-oct-2025); Meta aclaró que el objetivo son los proveedores de asistentes de propósito general, no empresas que usan IA para atención al cliente (soporte, reservas, seguimiento de pedidos). Excepciones por obligación legal: Italia y Brasil (competencia).
- Política de precios AI Providers (oficial, mismo .md): vigente desde **16-feb-2026**; cargos en Italia (16-feb a 12-may-2026), Brasil (desde 11-mar-2026) y 29 mercados europeos (11-mar a 12-may-2026); desde 13-may-2026 no se cobra en UE/EEA/Italia; Brasil sigue cobrándose; Türkiye añadida el 15-oct-2026 sin cobro. Categoría de analítica `AI_BOT`; webhooks con categoría `general_purpose_ai`.
- Changelog oficial 2026-05-12 confirma el cambio de cobro UE/EEA/Brasil (https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog).

**Conclusión para Vende+ WSP:** un agente de IA **específico del negocio del tenant** (atiende sus clientes, cotiza con base en `knowledge_chunks`, deriva a humano) encaja en el uso permitido (la IA es incidental al servicio del negocio, no el producto distribuido). Riesgos: (a) que el agente funcione como asistente genérico (responde cualquier tema, "chatea con ChatGPT"); (b) que el tenant sea él mismo un proveedor de IA/asistentes; (c) que nosotros, como plataforma, se nos califique como AI Provider si el producto principal percibido fuera la IA en WhatsApp — **no verificado**, mitigar manteniendo el agente acotado a la base de conocimiento del tenant; (d) usar datos de WhatsApp para entrenar modelos (prohibido). Existe además el producto de Meta "Meta Business Agent" (categoría de precio desde 1-jul-2026, US$2.00 por millón de tokens, ~4–5 centavos por mensaje; https://developers.facebook.com/docs/whatsapp/pricing/updates-to-pricing/), no relacionado con nuestro agente BYOK.

### 1.4 Calidad, límites y enforcement
- **Límites** (https://developers.facebook.com/docs/whatsapp/messaging-limits, 2026-10-24): se calculan **por portafolio de negocio** (compartidos por todos los números); nuevos portafolios 250 contactos únicos/24 h móviles fuera de ventana de servicio. Vía a 2.000: verificar el negocio, verificación por el partner, o 2.000 mensajes entregados a números únicos en 30 días con plantillas de alta calidad. Sobre 2.000: sube un nivel en 6 h si envía mensajes de alta calidad y usa al menos la mitad del límite en 7 días; niveles 10.000 / 100.000 / ilimitado. Campo `messaging_limit_tier` deprecado → `whatsapp_business_manager_messaging_limit`. Cómo/cuándo baja el límite y semáforo verde/amarillo/rojo del número: **no verificado** en esa página. Implicación: un tenant con mala calidad puede consumir/afectar el límite compartido del portafolio.
- **Enforcement** (https://developers.facebook.com/documentation/business-messaging/whatsapp/policy-enforcement, 2026-10-24): primera infracción normalmente advertencia; luego restricciones de 1 o 3 días (sin plantillas ni agregar números), 5/7/30 días (sin mensajes), bloqueo de cuenta (solo por apelación) y desactivación permanente. Baja inmediata sin escalado por daño grave (explotación infantil, estafas, terrorismo, venta ilegal de drogas). Feedback negativo excesivo puede llevar a límites o baja; **no hay umbrales numéricos publicados**. Apelación en Business Support Home, respuesta típica 24–48 h ("Unchanged"/"Reversed"); no todas las infracciones de spam son apelables. Avisos por Notifications Center, banner, email y webhook `account_update`.
- **Códigos de violación** (https://developers.facebook.com/docs/whatsapp/overview/policy-enforcement/violations): ADULT, OVERTLY_SEXUALIZED_POSITIONING, DATING, ALCOHOL, TOBACCO, DRUGS, SUPPLEMENTS, ANIMALS, BODY_PARTS_FLUIDS, HEALTHCARE, GAMBLING, WEAPONS, REAL_FAKE_CURRENCY, DIGITAL_SERVICES_PRODUCTS, UNAUTHORIZED_MEDIA, SCAM, MISLEADING, ILLEGAL_PRODUCTS, THIRD_PARTY_INFRINGEMENTS (la lista puede cambiar).

### 1.5 Verificación del negocio y display name
- Display name (https://developers.facebook.com/documentation/business-messaging/whatsapp/display-names): requerido al registrar el número; la aprobación se dispara automáticamente al alcanzar un límite mayor; estados `name_status` APPROVED/DECLINED (webhook `phone_number_name_update`); 10 cambios cada 30 días; tras aprobación, 14 días para re-registrar el número (`POST /<PHONE_NUMBER_ID>/register`). Las reglas de nombre (coincidir con el negocio, nombres genéricos, etc.) están en un artículo del Help Center: **no verificado** (no se pudo leer).
- Requisitos de verificación de negocio (documentos): **no verificado** (el artículo del Help Center no devolvió cuerpo).
- Verificar el negocio es una de las vías oficiales para subir a 2.000 mensajes/24 h.

### 1.6 Precios 2026
Fuente: https://developers.facebook.com/docs/whatsapp/pricing (2026-10-24; sin fecha de actualización; el cambio más reciente es de oct-2026).
- Precio por mensaje entregado desde 1-jul-2025 (reemplaza por conversación); mensajes del usuario al negocio gratis.
- **1-oct-2026:** vuelven los cargos: 1.000 mensajes de servicio gratis por mes por número de teléfono (desde el 1001 se cobra; no se acumulan); los mensajes utility enviados dentro de una ventana de servicio abierta dejan de ser gratis. Gobierno/ONG elegibles: servicio gratis hasta 31-dic-2027.
- Ventana de punto de entrada gratuito (anuncios Click-to-WhatsApp): hasta 7 días con mensajes gratis (excepto Meta Business Agent).
- 1-oct-2026: 40 actualizaciones de tarifas. 12-oct-2026: nuevo campo `subtype` en webhooks de estado.
- Efecto en el modelo de negocio: el tope de 1.000 servicios gratis por número y los utility en ventana ahora cuestan; revisar el costo trasladado a tenants (ver ADR de pagos).

## 2. Comercio (Meta Commerce Policy)
Fuente: https://www.facebook.com/policies_center/commerce (2026-10-24; sin fecha visible). La política de WhatsApp remite a ella para funciones de comercio (catálogos, carrito). Si el tenant vende artículos prohibidos, WhatsApp "may prohibit you from using some or all of WhatsApp for Business". Si mezcla productos permitidos y prohibidos, solo se puede usar WhatsApp para los permitidos (fuente secundaria Rasayel, **no oficial**).

## 3. Tabla: negocios prohibidos / restringidos (para bloquear o advertir en onboarding)

Leyenda de acción: **BLOQUEAR** = no onboardear; **REVISIÓN** = revisión manual + condiciones; **ADVERTIR** = permitir con aviso/límites.

| Categoría | Estado | Condiciones / país | Acción sugerida | Fuente |
|---|---|---|---|---|
| Armas de fuego, munición, explosivos | Prohibido | Aplica "irrespective of global or local licenses" | BLOQUEAR | Messaging Policy §4; Commerce (weapons) |
| Drogas ilegales / recetadas (Rx) | Prohibido | Sin excepción | BLOQUEAR | Messaging Policy; Commerce |
| Dispositivos médicos, productos y servicios de salud/healthcare | Prohibido | Commerce: incluye suplementos orales y dispositivos; códigos `HEALTHCARE`, `SUPPLEMENTS` | BLOQUEAR (consultorios que solo agendan citas sin vender productos: REVISIÓN, **no verificado** si el servicio de citas está permitido) | Messaging Policy; violations |
| Medicamentos sin receta (OTC) | Restringido | Solo países permitidos (lista larga, "American Samoa" a "Vietnam"); licencia vigente; no a menores de 18; dejar de enviar si vence licencia | REVISIÓN (lista exacta de países: consultar página) | whatsappbusiness.com/policy §5 |
| Alcohol | Restringido | Solo países permitidos; sin menores de 18; licencia | REVISIÓN | idem; Commerce lo prohíbe en catálogos |
| Tabaco | Prohibido en Commerce; en Messaging Policy figura con alcohol/OTC como condicionado por país (redacción exacta **no verificado**) | — | BLOQUEAR por defecto | Commerce; Messaging Policy |
| Apuestas / juegos de dinero real | Restringido | Países: Australia, Japón, Colombia, México, Perú; **requiere solicitud previa a Meta** con licencia; sin menores | BLOQUEAR por defecto; REVISIÓN si tiene permiso de Meta | policy §5–6 |
| Criptomonedas, ICO, opciones binarias | Prohibido | Según resumen de la política; Commerce prohíbe monedas virtuales/instrumentos financieros | BLOQUEAR | Messaging Policy; Commerce |
| Préstamos de día de pago (payday) | Prohibido | — | BLOQUEAR | Messaging Policy |
| Otros servicios financieros (préstamos, seguros, inversiones) | **No verificado**; no aparecen en la lista prohibida resumida | Cumplir leyes locales; no pedir tarjeta/cuenta completas | ADVERTIR / REVISIÓN | — |
| Servicios/productos para adultos, contenido sexual explícito, escorts, trata | Prohibido | Códigos `ADULT`, `OVERTLY_SEXUALIZED_POSITIONING` | BLOQUEAR | Messaging Policy; Commerce |
| Citas (dating) | Prohibido | Código `DATING` | BLOQUEAR | idem |
| Marketing multinivel (MLM) | Prohibido | — | BLOQUEAR | Messaging Policy |
| Moneda/documentos reales o falsos | Prohibido | `REAL_FAKE_CURRENCY` | BLOQUEAR | violations; Commerce |
| Productos falsificados, infracción de propiedad intelectual, medios no autorizados | Prohibido | `THIRD_PARTY_INFRINGEMENTS`, `UNAUTHORIZED_MEDIA` | BLOQUEAR | violations; Commerce |
| Estafas, ofertas engañosas, productos ilegales | Prohibido | `SCAM`, `MISLEADING`, `ILLEGAL_PRODUCTS`; baja inmediata posible | BLOQUEAR | violations; enforcement |
| Animales / partes de animales, partes y fluidos corporales | Prohibido (Commerce) | `ANIMALS`, `BODY_PARTS_FLUIDS` | BLOQUEAR | Commerce |
| Materiales peligrosos, productos retirados, bienes robados | Prohibido | — | BLOQUEAR | Commerce |
| Cosméticos usados, ciertas piezas de vehículos | Prohibido (Commerce) | — | REVISIÓN | Commerce |
| Suscripciones / productos y cuentas digitales descargables | Prohibido (Commerce) | `DIGITAL_SERVICES_PRODUCTS` | REVISIÓN (afecta a negocios de venta digital) | Commerce; violations |
| Ofertas de empleo | Prohibido (Commerce) | — | REVISIÓN | Commerce |
| Partidos políticos, candidatos, campañas | Prohibido | — | BLOQUEAR | Messaging Policy |
| Fuerzas del orden, militares, inteligencia | Prohibido | Gobierno solo vía proveedor de soluciones | BLOQUEAR | Messaging Policy |
| Entradas a eventos, gift cards, adopción de mascotas | Restringido (Commerce) | Solo vendedores aprobados | REVISIÓN | Commerce |
| Servicios (en catálogo de comercio) | Restringido (Commerce) | No permitidos salvo vía WhatsApp Business app o citas de FB/IG; no afecta la mensajería de servicio habitual | ADVERTIR (no usar funciones de catálogo para servicios) | Commerce |
| Discriminación, contenido de odio/violento | Prohibido | — | BLOQUEAR | Messaging Policy; Commerce |
| Proveedores de IA / asistentes de propósito general como producto | Prohibido (salvo obligación legal) | Terms 15-ene-2026 | BLOQUEAR | Terms; AI Providers pricing |

Notas:
1. La lista de Meta es "determinada a su exclusiva discreción"; tratar la tabla como mínimo.
2. Restricciones por país dependen de la lista vigente en la página; implementar como datos configurables (`restricted_verticals` con país/estado), no código fijo.
3. Menores de 18: los mensajes de verticales regulados no pueden enviarse a menores.

## 4. Checklist de salvaguardas de plataforma

**Onboarding**
- [ ] Declaración de rubro obligatoria (select cerrado + texto libre) contrastada con la tabla de la sección 3; bloquear/derivar a revisión.
- [ ] Aceptación de términos del tenant: reconoce Messaging Policy, Commerce Policy y que Meta puede restringir; no usar para productos prohibidos; sin uso de datos para entrenar IA.
- [ ] Revisión del sitio/catálogo del tenant (manual o con IA) antes de activar la conexión BSP.
- [ ] Guiar la verificación de negocio y el display name (nombre coincide con el negocio, sin nombres genéricos).
- [ ] Un portafolio/WABA por tenant cuando el BSP lo permita, para evitar contagio de límites y calidad.

**Opt-in y bajas**
- [ ] Capturar y almacenar por contacto: fecha, fuente, texto del consentimiento, categoría (marketing/utility/autenticación) y canal.
- [ ] Consentimiento separado para marketing; sin opt-in = sin broadcast.
- [ ] Detección de STOP/BAJA/"no quiero recibir" (es/en, variantes) que marca `opted_out` y corta toda plantilla de marketing de inmediato; confirmación breve.
- [ ] Bloqueo duro en el worker: nunca enviar plantilla a contactos `opted_out`.

**Plantillas (linting)**
- [ ] Validar categoría vs contenido (promo en utility = riesgo de reclasificación y pausa).
- [ ] Rechazar términos de verticales prohibidos, solicitud de datos sensibles (tarjeta, cuenta, documento), enlaces acortados, variables vacías.
- [ ] Incluir opción de baja en plantillas de marketing.
- [ ] Mostrar al tenant estado/calidad de cada plantilla (webhook de estado) y alertar en Paused/Disabled.

**Envíos y calidad**
- [ ] Rate limiter por tenant y por portafolio respetando el tier; no superar el límite diario.
- [ ] Ramp-up gradual de broadcasts; segmentar a contactos activos; pausar campañas ante caída de calidad.
- [ ] Suscribirse a `account_update`, `phone_number_name_update`, `business_capability_update`, `account_alerts` y alertar al owner/ops; auto-pausa de envíos de marketing al recibir advertencia o restricción.
- [ ] Panel interno: tasa de bloqueo/respuesta "STOP", plantillas pausadas, tier actual por tenant.
- [ ] Proceso de apelación documentado (Business Support Home, 24–48 h).

**IA y atención humana**
- [ ] El agente responde solo con base en `knowledge_chunks` del tenant; rechaza temas fuera del negocio (no asistente general).
- [ ] Identificar al agente como asistente automatizado al inicio o a pedido; no hacerse pasar por humano.
- [ ] Ruta clara de escalamiento a humano ("hablar con una persona") siempre disponible; handoff inmediato ante solicitud, queja o tema sensible.
- [ ] Automatización solo dentro de la ventana de 24 h; fuera, solo plantillas aprobadas.
- [ ] No usar datos de WhatsApp para entrenar/mejorar modelos; configurar proveedor LLM sin retención/entrenamiento.
- [ ] No pedir ni almacenar datos de tarjeta completos, cuentas bancarias o documentos por chat.
- [ ] Nunca reenviar la conversación de un cliente a otro; política de privacidad publicada.

## 5. Fuentes monitoreables

| Fuente | URL | Método sugerido | Notas |
|---|---|---|---|
| Messaging Policy (muestra "última actualización") | https://whatsappbusiness.com/es-la/policy/ y `https://whatsappbusiness.com/policy/?lang=en_US` | Hash del texto normalizado + extraer la fecha "última actualización" | Fecha vista: 23-sep-2026; redirige desde business.whatsapp.com |
| Commerce Policy | https://www.facebook.com/policies_center/commerce | Hash del texto; fetch puede devolver contenido parcial | Sin fecha visible; la ruta `whatsappbusiness.com/policy/commerce-policy` dio 404 |
| Terms / Business Solution Terms | https://www.facebook.com/legal/Meta-Terms-for-WhatsApp-Business-Platform y https://www.whatsapp.com/legal/meta-terms-whatsapp-business/revisions/20251015 | Navegador headless (contenido renderizado por JS); comparar revisiones | El fetch simple devolvió solo "Facebook" |
| Changelog WhatsApp | https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog | Hash + parseo de fechas de entradas | No anuncia RSS/Atom; última entrada vista 12-may-2026 |
| Índice de documentación | https://developers.facebook.com/documentation/business-messaging/whatsapp/llms.txt | Diff del índice (nuevas páginas) | Oficialmente enlazado desde el changelog |
| Política de precios AI Providers | https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/ai-providers.md | Hash (markdown limpio) | Versión .md fácil de comparar |
| Precios / tarifas | https://developers.facebook.com/docs/whatsapp/pricing | Hash + descargar CSV/PDF de tarifas | Sin fecha de actualización |
| Enforcement y violaciones | https://developers.facebook.com/documentation/business-messaging/whatsapp/policy-enforcement y https://developers.facebook.com/docs/whatsapp/overview/policy-enforcement/violations | Hash; diff de códigos de violación | Útil para actualizar el catálogo de rubros |
| Límites de mensajería | https://developers.facebook.com/docs/whatsapp/messaging-limits | Hash | |
| Plantillas (guidelines) | https://developers.facebook.com/docs/whatsapp/message-templates/guidelines | Hash | |
| Display names | https://developers.facebook.com/documentation/business-messaging/whatsapp/display-names | Hash | |
| Webhooks propios | `account_update`, `account_alerts`, `business_capability_update`, `phone_number_name_update` | Evento en tiempo real (no polling) | Más fiable que el scraping para el estado de cada tenant |

Método general: job diario en el worker; descargar con User-Agent identificable, normalizar texto (quitar scripts, fechas dinámicas, espacios), SHA-256, comparar con el último snapshot, guardar el texto en `policy_snapshots` y notificar el diff por email/Slack. Para páginas renderizadas por JS usar navegador headless.

**robots.txt / ToS:** https://developers.facebook.com/robots.txt permite `Allow: /` para agentes genéricos sin reglas específicas para `/docs`, pero un comentario del archivo establece que "Collection of data on Facebook through automated means is prohibited unless you have express written permission from Meta" (resumen de fetch, texto exacto **no verificado**). Riesgo: el monitoreo automatizado de páginas de facebook.com podría contravenir esa nota; mitigar con frecuencia baja (1 vez/día), caché con `If-None-Match`, y preferir developers.facebook.com/documentation y whatsappbusiness.com. robots.txt de whatsappbusiness.com y de facebook.com/legal: **no verificado**. No hay feed RSS oficial confirmado; Graph API changelog (https://developers.facebook.com/docs/graph-api/changelog): **no verificado** en esta investigación.

## 6. Lagunas pendientes (no verificado)
- Texto literal del AI Providers en los WhatsApp/Meta Terms (fetch no renderiza); confirmar en navegador.
- Reglas de display name y requisitos documentales de verificación de negocio (Help Center).
- Umbrales numéricos de calidad/bloqueos, semáforo de calidad del número, cuándo bajan los límites.
- Lista exacta de países por vertical regulada (hay que leerla en https://whatsappbusiness.com/policy/ §5).
- Si agendamiento de servicios de salud/citas médicas es admisible; servicios financieros no listados.
- Reglas de reclasificación de categoría de plantillas y motivos de rechazo.
