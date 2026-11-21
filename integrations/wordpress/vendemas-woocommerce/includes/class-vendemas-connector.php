<?php
/**
 * Handles the REST API key, webhooks and remote connect call.
 *
 * @package Vendemas_WooCommerce
 */

defined( 'ABSPATH' ) || exit;

class Vendemas_Connector {

	const OPTION = 'vendemas_connection';

	/** Webhook topics Vende+ subscribes to. */
	const TOPICS = array( 'order.created', 'order.updated', 'product.updated' );

	/**
	 * API base URL (filterable).
	 *
	 * @return string
	 */
	public function api_base() {
		$base = apply_filters( 'vendemas_api_base', VENDEMAS_API_BASE );
		return untrailingslashit( (string) $base );
	}

	/**
	 * Current connection data or null.
	 *
	 * @return array|null
	 */
	public function get_connection() {
		$data = get_option( self::OPTION );
		return ( is_array( $data ) && ! empty( $data['api_key_id'] ) ) ? $data : null;
	}

	/**
	 * Normalize a connection code to XXXX-XXXX-XX or return false.
	 *
	 * @param string $raw Raw input.
	 * @return string|false
	 */
	public function normalize_code( $raw ) {
		$code = strtoupper( trim( sanitize_text_field( (string) $raw ) ) );
		return preg_match( '/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{2}$/', $code ) ? $code : false;
	}

	/**
	 * Run the full connect flow.
	 *
	 * @param string $code Normalized code.
	 * @return array|WP_Error Connection data on success.
	 */
	public function connect( $code ) {
		if ( $this->get_connection() ) {
			return new WP_Error( 'vendemas_already', __( 'Esta tienda ya está conectada. Desconéctala primero.', 'vendemas-woocommerce' ) );
		}

		$key = $this->create_api_key();
		if ( is_wp_error( $key ) ) {
			return $key;
		}

		$webhook_secret = wp_generate_password( 32, false );

		$response = wp_remote_post(
			$this->api_base() . '/public/woocommerce/connect',
			array(
				'timeout' => 20,
				'headers' => array(
					'Content-Type' => 'application/json',
					'Accept'       => 'application/json',
				),
				'body'    => wp_json_encode(
					array(
						'code'           => $code,
						'shopUrl'        => home_url( '/' ),
						'consumerKey'    => $key['consumer_key'],
						'consumerSecret' => $key['consumer_secret'],
						'webhookSecret'  => $webhook_secret,
					)
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			$this->delete_api_key( $key['id'] );
			return new WP_Error( 'vendemas_http', __( 'No se pudo contactar con Vende+. Inténtalo de nuevo en unos minutos.', 'vendemas-woocommerce' ) );
		}

		$status = (int) wp_remote_retrieve_response_code( $response );
		if ( 401 === $status ) {
			$this->delete_api_key( $key['id'] );
			return new WP_Error( 'vendemas_code', __( 'Código inválido o vencido. Genera uno nuevo en Vende+.', 'vendemas-woocommerce' ) );
		}

		$body        = json_decode( wp_remote_retrieve_body( $response ), true );
		$webhook_url = ( is_array( $body ) && isset( $body['webhookUrl'] ) ) ? esc_url_raw( (string) $body['webhookUrl'] ) : '';
		if ( 200 !== $status || '' === $webhook_url ) {
			$this->delete_api_key( $key['id'] );
			return new WP_Error( 'vendemas_response', __( 'Vende+ respondió con un error. Inténtalo de nuevo más tarde.', 'vendemas-woocommerce' ) );
		}
		$tenant_name = isset( $body['tenantName'] ) ? sanitize_text_field( (string) $body['tenantName'] ) : '';

		$webhook_ids = $this->create_webhooks( $webhook_url, $webhook_secret );
		if ( is_wp_error( $webhook_ids ) ) {
			$this->delete_api_key( $key['id'] );
			return $webhook_ids;
		}

		$data = array(
			'tenant_name'  => $tenant_name,
			'webhook_url'  => $webhook_url,
			'api_key_id'   => $key['id'],
			'webhook_ids'  => $webhook_ids,
			'connected_at' => time(),
		);
		update_option( self::OPTION, $data, false );
		return $data;
	}

	/**
	 * Delete webhooks and API key, clear the option.
	 */
	public function disconnect() {
		$data = $this->get_connection();
		if ( ! $data ) {
			delete_option( self::OPTION );
			return;
		}
		foreach ( (array) $data['webhook_ids'] as $id ) {
			$this->delete_webhook( (int) $id );
		}
		$this->delete_api_key( (int) $data['api_key_id'] );
		delete_option( self::OPTION );
	}

	/**
	 * Status of the stored webhooks.
	 *
	 * @return array[] Each: id, topic, status ('missing' when deleted).
	 */
	public function webhook_statuses() {
		$data = $this->get_connection();
		$out  = array();
		if ( ! $data ) {
			return $out;
		}
		foreach ( (array) $data['webhook_ids'] as $id ) {
			$webhook = new WC_Webhook( (int) $id );
			if ( ! $webhook->get_id() ) {
				$out[] = array(
					'id'     => (int) $id,
					'topic'  => '',
					'status' => 'missing',
				);
				continue;
			}
			$out[] = array(
				'id'     => (int) $id,
				'topic'  => $webhook->get_topic(),
				'status' => $webhook->get_status(),
			);
		}
		return $out;
	}

	/**
	 * Verify the webhooks exist and are active, and the API key still exists.
	 *
	 * @return true|WP_Error
	 */
	public function test() {
		$data = $this->get_connection();
		if ( ! $data ) {
			return new WP_Error( 'vendemas_not_connected', __( 'La tienda no está conectada.', 'vendemas-woocommerce' ) );
		}
		foreach ( $this->webhook_statuses() as $row ) {
			if ( 'active' !== $row['status'] ) {
				return new WP_Error( 'vendemas_webhook', __( 'Hay webhooks desactivados o eliminados. Desconecta y vuelve a conectar la tienda.', 'vendemas-woocommerce' ) );
			}
		}
		global $wpdb;
		$exists = $wpdb->get_var( $wpdb->prepare( "SELECT key_id FROM {$wpdb->prefix}woocommerce_api_keys WHERE key_id = %d", (int) $data['api_key_id'] ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		if ( ! $exists ) {
			return new WP_Error( 'vendemas_key', __( 'La clave de API de WooCommerce ya no existe. Desconecta y vuelve a conectar la tienda.', 'vendemas-woocommerce' ) );
		}
		return true;
	}

	/**
	 * Create a read-only WooCommerce REST API key the same way WooCommerce does.
	 *
	 * @return array|WP_Error id, consumer_key, consumer_secret.
	 */
	private function create_api_key() {
		global $wpdb;

		$consumer_key    = 'ck_' . wc_rand_hash();
		$consumer_secret = 'cs_' . wc_rand_hash();

		$inserted = $wpdb->insert( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->prefix . 'woocommerce_api_keys',
			array(
				'user_id'         => get_current_user_id(),
				'description'     => 'Vende+ (catálogo)',
				'permissions'     => 'read',
				'consumer_key'    => wc_api_hash( $consumer_key ),
				'consumer_secret' => $consumer_secret,
				'truncated_key'   => substr( $consumer_key, -7 ),
			),
			array( '%d', '%s', '%s', '%s', '%s', '%s' )
		);

		if ( ! $inserted ) {
			return new WP_Error( 'vendemas_key', __( 'No se pudo crear la clave de API de WooCommerce.', 'vendemas-woocommerce' ) );
		}

		return array(
			'id'              => (int) $wpdb->insert_id,
			'consumer_key'    => $consumer_key,
			'consumer_secret' => $consumer_secret,
		);
	}

	/**
	 * @param int $key_id API key id.
	 */
	private function delete_api_key( $key_id ) {
		global $wpdb;
		$wpdb->delete( $wpdb->prefix . 'woocommerce_api_keys', array( 'key_id' => (int) $key_id ), array( '%d' ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
	}

	/**
	 * @param string $delivery_url Webhook URL.
	 * @param string $secret       Webhook secret.
	 * @return int[]|WP_Error
	 */
	private function create_webhooks( $delivery_url, $secret ) {
		$ids = array();
		foreach ( self::TOPICS as $topic ) {
			$webhook = new WC_Webhook();
			$webhook->set_name( 'Vende+ - ' . $topic );
			$webhook->set_user_id( get_current_user_id() );
			$webhook->set_topic( $topic );
			$webhook->set_delivery_url( $delivery_url );
			$webhook->set_secret( $secret );
			$webhook->set_api_version( 3 );
			$webhook->set_status( 'active' );
			$id = $webhook->save();
			if ( ! $id ) {
				foreach ( $ids as $created ) {
					$this->delete_webhook( $created );
				}
				return new WP_Error( 'vendemas_webhook', __( 'No se pudieron crear los webhooks de WooCommerce.', 'vendemas-woocommerce' ) );
			}
			$ids[] = (int) $id;
		}
		return $ids;
	}

	/**
	 * @param int $id Webhook id.
	 */
	private function delete_webhook( $id ) {
		if ( $id <= 0 ) {
			return;
		}
		$webhook = new WC_Webhook( $id );
		if ( $webhook->get_id() ) {
			$webhook->delete( true );
		}
	}
}
