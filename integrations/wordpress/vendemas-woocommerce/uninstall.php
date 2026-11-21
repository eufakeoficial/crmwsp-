<?php
/**
 * Uninstall: removes only the plugin option. Webhooks and the REST API key are
 * intentionally left in place; use "Desconectar" before deleting the plugin
 * to remove them (see readme.txt).
 *
 * @package Vendemas_WooCommerce
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

delete_option( 'vendemas_connection' );
