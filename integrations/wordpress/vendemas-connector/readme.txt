=== Vende+ Connector ===
Contributors: vendemas
Tags: woocommerce, whatsapp, crm, chatbot, ai
Requires at least: 6.2
Tested up to: 6.7
Requires PHP: 7.4
Requires Plugins: woocommerce
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Conecta tu tienda WooCommerce con Vende+, el CRM de WhatsApp con IA, pegando un código de conexión.

== Description ==

Vende+ es un CRM para WhatsApp con asistente de IA. Este plugin conecta tu tienda WooCommerce con tu cuenta de Vende+ sin copiar claves a mano: generas un código en Vende+, lo pegas en el plugin y listo.

**Qué hace al conectar**

* Crea una clave de API REST de WooCommerce de solo lectura ("Vende+ (catálogo)").
* Crea tres webhooks: `order.created`, `order.updated` y `product.updated`.
* Te muestra el estado de la conexión y permite probarla o desconectarla.

**Servicio externo y datos que se envían**

Este plugin depende del servicio externo Vende+ (https://www.vendemas.chat, API en https://api.vendemas.chat). Al conectar se envía una vez: el código de conexión, la URL de tu tienda, y la clave de API de solo lectura y el secreto de los webhooks. Después, WooCommerce envía a Vende+ los datos de **pedidos** (incluidos datos del cliente como nombre, teléfono, email y dirección) y de **productos** cada vez que se crean o actualizan, y Vende+ puede leer tu catálogo con la clave de solo lectura. Estos datos se usan para atender a tus clientes por WhatsApp y mantener el catálogo al día. No se envía nada hasta que conectas la tienda con un código.

* Términos de servicio: https://www.vendemas.chat/terminos
* Política de privacidad: https://www.vendemas.chat/privacidad

== Installation ==

1. Instala y activa WooCommerce.
2. Sube la carpeta `vendemas-connector` a `/wp-content/plugins/` o instálalo desde Plugins, Añadir nuevo.
3. Activa el plugin.
4. En Vende+ ve a Integraciones, WooCommerce y genera un código de conexión (formato XXXX-XXXX-XX, vence en 15 minutos).
5. En WordPress ve a WooCommerce, Vende+, pega el código y pulsa "Conectar".

== Frequently Asked Questions ==

= El código dice "inválido o vencido" =
Los códigos duran 15 minutos y se usan una sola vez. Genera uno nuevo en Vende+.

= ¿Cómo desconecto la tienda? =
En WooCommerce, Vende+, pulsa "Desconectar". Se eliminan los webhooks y la clave de API. También puedes revocar la conexión desde Vende+.

= ¿Qué pasa si elimino el plugin sin desconectar? =
Al borrar el plugin solo se elimina su ajuste interno. Los webhooks y la clave de API quedan en WooCommerce (WooCommerce, Ajustes, Avanzado). Desconecta antes de borrarlo, o elimínalos a mano.

= ¿Puedo apuntar a otra API (pruebas)? =
Sí, define `VENDEMAS_API_BASE` en wp-config.php.

== Changelog ==

= 0.1.0 =
* Primera versión: conexión por código, clave REST de solo lectura y tres webhooks.

== Upgrade Notice ==

= 0.1.0 =
Primera versión.
