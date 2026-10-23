/** Plain-data landing copy shared by the page, JSON-LD and the /llms.txt routes (no React imports). */

export const DEFINITION =
  "Vende+ WSP es un CRM para WhatsApp con inteligencia artificial, pensado para negocios de servicios de Latinoamérica que envían presupuestos. Reúne en una bandeja compartida las conversaciones, responde con tu catálogo citando la fuente, crea y envía presupuestos, hace seguimiento y marca un cobro como pagado solo cuando el proveedor de pagos lo confirma.";

export const FEATURE_LIST = [
  "Bandeja compartida de WhatsApp para todo el equipo",
  "IA que responde con tu catálogo y cita la fuente",
  "Derivación a una persona cuando la IA no encuentra el dato",
  "Playbook de ventas con tono, reglas y objeciones",
  "Presupuestos y pedidos desde la conversación",
  "Seguimiento de presupuestos con consentimiento y plantillas aprobadas",
  "Pagos verificados por el proveedor (webhook o conciliación)",
  "Equipos, roles y medición",
  "Clave de IA propia (BYOK) o créditos incluidos",
  "Datos aislados por empresa",
] as const;

export const INTEGRATIONS = ["WhatsApp · Gupshup", "MercadoPago", "NOWPayments", "Meta Ads"] as const;

export const STEPS = [
  { title: "Conecta tu número", text: "Vincula tu WhatsApp Business mediante un proveedor oficial de la API." },
  { title: "Carga tu catálogo y tu playbook", text: "Sube productos, precios y reglas de venta: son la fuente de la IA." },
  { title: "Atiende con tu equipo y la IA", text: "La IA responde con cita; tu equipo toma el control cuando hace falta." },
  { title: "Cotiza y cobra", text: "Envía el presupuesto y cobra; el pago se marca al confirmarlo el proveedor." },
] as const;

export const FAQ = [
  { question: "¿Qué es Vende+ WSP?", answer: "Vende+ WSP es un CRM para WhatsApp con inteligencia artificial para negocios de servicios que envían presupuestos. Centraliza las conversaciones en una bandeja de equipo, responde con tu catálogo citando la fuente, envía presupuestos, hace seguimiento y confirma los cobros con el proveedor de pagos. Está pensado para equipos de Latinoamérica." },
  { question: "¿Cuál es el mejor CRM para WhatsApp para negocios de servicios?", answer: "Depende de tu proceso, pero un buen CRM para negocios de servicios debería cubrir bandeja de equipo, presupuestos desde el chat, seguimiento y cobro verificado, sobre la API oficial de WhatsApp. Vende+ WSP está diseñado para ese flujo: del primer mensaje al presupuesto aceptado y al pago confirmado, con IA que cita su fuente." },
  { question: "¿Cómo automatizar presupuestos por WhatsApp?", answer: "Carga tu catálogo y tus reglas de venta, y deja que la IA responda con esos datos. Desde la conversación creas el presupuesto y lo envías por WhatsApp. Después puedes seguir su estado: enviado, aceptado y pagado. Las acciones sensibles, como enviar un presupuesto grande o aplicar un descuento, pueden requerir la aprobación de una persona." },
  { question: "¿Es seguro usar IA para responder clientes por WhatsApp?", answer: "Lo es si la IA tiene límites claros. En Vende+ WSP solo afirma precios, stock o plazos cuando puede citar tu catálogo; si no encuentra el dato, deriva la conversación a una persona. Los datos de cada empresa están aislados, las claves se guardan cifradas y puedes revisar qué hizo la IA." },
  { question: "¿Necesito la API oficial de WhatsApp?", answer: "Sí, para usar un CRM con equipo e IA de forma estable conviene la API oficial de WhatsApp Business. No tienes que gestionarla tú: conectas tu número a través de un proveedor oficial (BSP), que se encarga del alta del número y de las plantillas. Vende+ WSP no usa librerías no oficiales." },
  { question: "¿Cómo hacer seguimiento a clientes que no responden un presupuesto?", answer: "Define cuántos días esperar y revisa los presupuestos enviados sin respuesta. Vende+ WSP sugiere cada seguimiento con un motivo explicable, comprueba el consentimiento del contacto y usa una plantilla aprobada cuando pasaron más de 24 horas desde su último mensaje. Tú eliges entre revisión manual o envío automático." },
  { question: "¿Funciona en mi país de Latinoamérica?", answer: "Vende+ WSP está pensado para negocios de Latinoamérica y se conecta a WhatsApp mediante un proveedor oficial de la API. Los medios de cobro dependen de los proveedores integrados, MercadoPago y NOWPayments, y su disponibilidad puede variar según el país. Crea una cuenta y comprueba qué opciones aplican a tu negocio." },
  { question: "¿Necesito un número nuevo de WhatsApp?", answer: "Conectas tu número a través de un proveedor oficial de la API de WhatsApp Business. Te guiamos en el proceso." },
  { question: "¿La IA puede dar precios equivocados?", answer: "No: solo afirma precios, stock o plazos si puede citar tu catálogo. Si no, deriva la conversación a una persona." },
  { question: "¿Cómo se confirman los pagos?", answer: "Solo por la confirmación del proveedor de pagos o por conciliación. Una imagen de comprobante nunca marca un pago como pagado. La única excepción es el marcado manual que hace un owner o admin, que queda auditado." },
  { question: "¿Mis datos están separados de los de otras empresas?", answer: "Sí. Cada empresa trabaja en su propio espacio aislado y las claves se guardan cifradas." },
  { question: "¿Qué es BYOK y por qué importa?", answer: "Puedes usar tu propia clave de IA (BYOK) y pagar el consumo directo al proveedor, sin margen nuestro sobre la IA." },
  { question: "¿Puedo cancelar cuando quiera?", answer: "Sí. Puedes cancelar tu suscripción en cualquier momento desde tu cuenta." },
] as const;

export const COMPARISON_COLUMNS = ["App WhatsApp Business", "CRM genérico", "Vende+ WSP"] as const;

export const COMPARISON_ROWS = [
  { capability: "Trabajo en equipo sobre un mismo número", cells: ["Pensada para un negocio pequeño; el trabajo en equipo es limitado", "Suele incluir bandeja o asignaciones, según el producto", "Bandeja compartida con asignación y roles"] },
  { capability: "Conexión con WhatsApp", cells: ["Aplicación de WhatsApp Business", "Varía: no todos usan la API oficial", "API oficial mediante un proveedor (BSP)"] },
  { capability: "Respuestas con IA", cells: ["Respuestas rápidas y mensajes automáticos básicos", "Varía según el producto", "IA que cita tu catálogo o deriva a una persona"] },
  { capability: "Presupuestos desde la conversación", cells: ["Se preparan a mano, fuera de la app", "Depende del producto o de integraciones", "Se crean y envían desde el chat"] },
  { capability: "Seguimiento de presupuestos sin respuesta", cells: ["Manual", "Tareas y recordatorios, no siempre con reglas de WhatsApp", "Sugerido con motivo explicable, consentimiento y plantilla si pasaron 24 h"] },
  { capability: "Confirmación de pagos", cells: ["No aplica", "Varía según el producto", "Pagado solo por webhook o conciliación del proveedor"] },
] as const;
