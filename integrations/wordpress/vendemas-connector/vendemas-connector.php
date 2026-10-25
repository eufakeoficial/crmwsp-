<?php
/**
 * Plugin Name:       Vende+ Connector
 * Plugin URI:        https://www.vendemas.chat/integraciones/woocommerce
 * Description:       Conecta tu tienda WooCommerce con Vende+ (CRM de WhatsApp con IA) usando un código de conexión. Sin claves manuales.
 * Version:           0.1.0
 * Requires at least: 6.2
 * Requires PHP:      7.4
 * Requires Plugins:  woocommerce
 * Author:            Vende+
 * Author URI:        https://www.vendemas.chat
 * License:           GPLv2 or later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       vendemas-connector
 * Domain Path:       /languages
 *
 * @package Vendemas_WooCommerce
 */

defined( 'ABSPATH' ) || exit;

define( 'VENDEMAS_WC_VERSION', '0.1.0' );
define( 'VENDEMAS_WC_FILE', __FILE__ );
define( 'VENDEMAS_WC_DIR', plugin_dir_path( __FILE__ ) );

// Service API base. Override in wp-config.php: define( 'VENDEMAS_API_BASE', 'http://localhost:3001' );
if ( ! defined( 'VENDEMAS_API_BASE' ) ) {
	define( 'VENDEMAS_API_BASE', 'https://api.vendemas.chat' );
}

require_once VENDEMAS_WC_DIR . 'includes/class-vendemas-connector.php';
require_once VENDEMAS_WC_DIR . 'includes/class-vendemas-admin.php';
require_once VENDEMAS_WC_DIR . 'includes/class-vendemas-plugin.php';

add_action(
	'before_woocommerce_init',
	function () {
		if ( class_exists( '\Automattic\WooCommerce\Utilities\FeaturesUtil' ) ) {
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
		}
	}
);

Vendemas_Plugin::instance()->init();
