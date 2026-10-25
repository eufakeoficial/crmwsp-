<?php
/**
 * Plugin bootstrap.
 *
 * @package Vendemas_WooCommerce
 */

defined( 'ABSPATH' ) || exit;

class Vendemas_Plugin {

	/** @var Vendemas_Plugin|null */
	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	public function init() {
		add_action( 'plugins_loaded', array( $this, 'boot' ) );
	}

	public function boot() {
		if ( ! class_exists( 'WooCommerce' ) ) {
			add_action( 'admin_notices', array( $this, 'missing_woocommerce_notice' ) );
			return;
		}
		$admin = new Vendemas_Admin( new Vendemas_Connector() );
		$admin->hooks();
	}

	public function missing_woocommerce_notice() {
		if ( ! current_user_can( 'activate_plugins' ) ) {
			return;
		}
		echo '<div class="notice notice-error"><p>' . esc_html__( 'Vende+ Connector necesita que WooCommerce esté instalado y activo.', 'vendemas-connector' ) . '</p></div>';
	}
}
