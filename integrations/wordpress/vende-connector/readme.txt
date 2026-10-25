=== Vende+ Connector ===
Contributors: vendemas
Tags: woocommerce, whatsapp, crm, chatbot, ai
Requires at least: 6.2
Tested up to: 7.1
Requires PHP: 7.4
Requires Plugins: woocommerce
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Connect your WooCommerce store to Vende+, the WhatsApp CRM with AI assistant, by pasting a one-time connection code.

== Description ==

Vende+ is a WhatsApp CRM with an AI assistant. This plugin connects your WooCommerce store to your Vende+ account without copying API keys by hand: generate a code in Vende+, paste it into the plugin and you are done.

**What happens when you connect**

* It creates a read-only WooCommerce REST API key ("Vende+ (catalog)").
* It registers three webhooks: `order.created`, `order.updated` and `product.updated`.
* It shows the connection status and lets you test or disconnect it.

**External service and data sent**

This plugin relies on the external service Vende+ (https://www.vendemas.chat, API at https://api.vendemas.chat). When you connect, the following is sent once: the connection code, your store URL, the read-only API key and the webhook secret. After that, WooCommerce sends **order** data (including customer data such as name, phone, email and address) and **product** data to Vende+ whenever they are created or updated, and Vende+ may read your catalog using the read-only key. This data is used to serve your customers on WhatsApp and keep the catalog up to date. Nothing is sent until you connect the store with a code.

* Terms of service: https://www.vendemas.chat/terminos
* Privacy policy: https://www.vendemas.chat/privacidad

== Installation ==

1. Install and activate WooCommerce.
2. Upload the `vende-connector` folder to `/wp-content/plugins/`, or install it from Plugins > Add New.
3. Activate the plugin.
4. In Vende+, go to Integrations > WooCommerce and generate a connection code (format XXXX-XXXX-XX, expires in 15 minutes).
5. In WordPress, go to WooCommerce > Vende+, paste the code and click "Connect".

== Frequently Asked Questions ==

= The code says "invalid or expired" =
Codes last 15 minutes and can be used only once. Generate a new one in Vende+.

= How do I disconnect the store? =
In WooCommerce > Vende+, click "Disconnect". The webhooks and the API key are removed. You can also revoke the connection from Vende+.

= What if I delete the plugin without disconnecting? =
Deleting the plugin only removes its internal setting. The webhooks and the API key remain in WooCommerce (WooCommerce > Settings > Advanced). Disconnect before deleting, or remove them manually.

= Can I point the plugin to another API (testing)? =
Yes, define `VENDEMAS_API_BASE` in wp-config.php.

== Changelog ==

= 0.1.0 =
* First release: connection by code, read-only REST key and three webhooks.

== Upgrade Notice ==

= 0.1.0 =
First release.
