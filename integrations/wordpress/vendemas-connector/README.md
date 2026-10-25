# Vende+ Connector (plugin)

Dev notes. User-facing text lives in `readme.txt` (WordPress.org format).

## Lint

No build step. Syntax check every PHP file:

    find . -name '*.php' -exec php -l {} \;

## Zip for submission

The folder name must be `vendemas-connector`. From `integrations/wordpress/`:

    zip -r vendemas-connector.zip vendemas-connector -x@vendemas-connector/.distignore

(or `wp dist-archive vendemas-connector`, which honors `.distignore`).

## Point to a local API

In `wp-config.php`:

    define( 'VENDEMAS_API_BASE', 'http://host.docker.internal:3001' );

Or use the `vendemas_api_base` filter. The plugin calls `POST {base}/public/woocommerce/connect`.

## Storage

Option `vendemas_connection`: tenant_name, webhook_url, api_key_id, webhook_ids, connected_at.
The code, consumer secret and webhook secret are never stored by the plugin
(WooCommerce keeps the key and webhook secrets in its own tables).
