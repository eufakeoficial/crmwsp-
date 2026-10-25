<?php
/**
 * Settings page under the WooCommerce menu.
 *
 * @package Vendemas_WooCommerce
 */

defined( 'ABSPATH' ) || exit;

class Vendemas_Admin {

	const SLUG   = 'vendemas';
	const NOTICE = 'vendemas_notice_';

	/** @var Vendemas_Connector */
	private $connector;

	public function __construct( Vendemas_Connector $connector ) {
		$this->connector = $connector;
	}

	public function hooks() {
		add_action( 'admin_menu', array( $this, 'menu' ) );
		add_action( 'admin_post_vendemas_connect', array( $this, 'handle_connect' ) );
		add_action( 'admin_post_vendemas_disconnect', array( $this, 'handle_disconnect' ) );
		add_action( 'admin_post_vendemas_test', array( $this, 'handle_test' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( VENDEMAS_WC_FILE ), array( $this, 'action_links' ) );
	}

	public function menu() {
		add_submenu_page(
			'woocommerce',
			__( 'Vende+', 'vendemas-connector' ),
			__( 'Vende+', 'vendemas-connector' ),
			'manage_woocommerce',
			self::SLUG,
			array( $this, 'render' )
		);
	}

	public function action_links( $links ) {
		$url = admin_url( 'admin.php?page=' . self::SLUG );
		array_unshift( $links, '<a href="' . esc_url( $url ) . '">' . esc_html__( 'Ajustes', 'vendemas-connector' ) . '</a>' );
		return $links;
	}

	private function page_url() {
		return admin_url( 'admin.php?page=' . self::SLUG );
	}

	private function guard( $action ) {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'No tienes permisos para hacer esto.', 'vendemas-connector' ), '', array( 'response' => 403 ) );
		}
		check_admin_referer( $action );
	}

	private function flash( $type, $message ) {
		set_transient( self::NOTICE . get_current_user_id(), array( $type, $message ), 60 );
	}

	private function back() {
		wp_safe_redirect( $this->page_url() );
		exit;
	}

	public function handle_connect() {
		$this->guard( 'vendemas_connect' );
		$raw  = isset( $_POST['vendemas_code'] ) ? wp_unslash( $_POST['vendemas_code'] ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- sanitized in normalize_code().
		$code = $this->connector->normalize_code( $raw );
		if ( false === $code ) {
			$this->flash( 'error', __( 'El código no tiene el formato correcto (XXXX-XXXX-XX).', 'vendemas-connector' ) );
			$this->back();
		}
		$result = $this->connector->connect( $code );
		if ( is_wp_error( $result ) ) {
			$this->flash( 'error', $result->get_error_message() );
		} else {
			$this->flash( 'success', __( 'Tienda conectada con Vende+.', 'vendemas-connector' ) );
		}
		$this->back();
	}

	public function handle_disconnect() {
		$this->guard( 'vendemas_disconnect' );
		$this->connector->disconnect();
		$this->flash( 'success', __( 'Tienda desconectada. Se eliminaron los webhooks y la clave de API.', 'vendemas-connector' ) );
		$this->back();
	}

	public function handle_test() {
		$this->guard( 'vendemas_test' );
		$result = $this->connector->test();
		if ( is_wp_error( $result ) ) {
			$this->flash( 'error', $result->get_error_message() );
		} else {
			$this->flash( 'success', __( 'Todo en orden: los webhooks están activos y la clave de API existe.', 'vendemas-connector' ) );
		}
		$this->back();
	}

	public function render() {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}
		$notice_key = self::NOTICE . get_current_user_id();
		$notice     = get_transient( $notice_key );
		if ( $notice ) {
			delete_transient( $notice_key );
		}
		$conn = $this->connector->get_connection();
		?>
		<div class="wrap">
			<h1><?php echo esc_html__( 'Vende+ Connector', 'vendemas-connector' ); ?></h1>

			<?php if ( is_array( $notice ) ) : ?>
				<div class="notice notice-<?php echo ( 'success' === $notice[0] ) ? 'success' : 'error'; ?> is-dismissible"><p><?php echo esc_html( $notice[1] ); ?></p></div>
			<?php endif; ?>

			<?php
			if ( $conn ) {
				$this->render_connected( $conn );
			} else {
				$this->render_disconnected();
			}
			?>
		</div>
		<?php
	}

	private function render_disconnected() {
		?>
		<p><strong><?php echo esc_html__( 'Estado: No conectada', 'vendemas-connector' ); ?></strong></p>
		<p><?php echo esc_html__( 'En Vende+ ve a Integraciones, WooCommerce y genera un código de conexión. Pégalo aquí.', 'vendemas-connector' ); ?></p>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="vendemas_connect" />
			<?php wp_nonce_field( 'vendemas_connect' ); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="vendemas_code"><?php echo esc_html__( 'Código de conexión', 'vendemas-connector' ); ?></label></th>
					<td><input type="text" id="vendemas_code" name="vendemas_code" class="regular-text" placeholder="XXXX-XXXX-XX" maxlength="14" autocomplete="off" required /></td>
				</tr>
			</table>
			<?php submit_button( __( 'Conectar', 'vendemas-connector' ) ); ?>
		</form>
		<p class="description"><?php echo esc_html__( 'Al conectar se crea una clave de solo lectura de WooCommerce y tres webhooks (pedidos y productos) que se envían a Vende+.', 'vendemas-connector' ); ?></p>
		<?php
	}

	private function render_connected( array $conn ) {
		$since = ! empty( $conn['connected_at'] ) ? wp_date( get_option( 'date_format' ), (int) $conn['connected_at'] ) : '';
		?>
		<p><strong><?php echo esc_html__( 'Estado: Conectada', 'vendemas-connector' ); ?></strong></p>
		<table class="form-table" role="presentation">
			<tr>
				<th scope="row"><?php echo esc_html__( 'Cuenta Vende+', 'vendemas-connector' ); ?></th>
				<td><?php echo esc_html( $conn['tenant_name'] ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php echo esc_html__( 'Conectada desde', 'vendemas-connector' ); ?></th>
				<td><?php echo esc_html( $since ); ?></td>
			</tr>
		</table>

		<h2><?php echo esc_html__( 'Webhooks', 'vendemas-connector' ); ?></h2>
		<table class="widefat striped" style="max-width:640px">
			<thead><tr><th><?php echo esc_html__( 'Evento', 'vendemas-connector' ); ?></th><th><?php echo esc_html__( 'Estado', 'vendemas-connector' ); ?></th></tr></thead>
			<tbody>
			<?php foreach ( $this->connector->webhook_statuses() as $row ) : ?>
				<tr>
					<td><?php echo esc_html( '' !== $row['topic'] ? $row['topic'] : '#' . $row['id'] ); ?></td>
					<td><?php echo esc_html( 'missing' === $row['status'] ? __( 'eliminado', 'vendemas-connector' ) : $row['status'] ); ?></td>
				</tr>
			<?php endforeach; ?>
			</tbody>
		</table>

		<div style="display:flex;gap:8px;margin-top:16px">
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="vendemas_test" />
				<?php wp_nonce_field( 'vendemas_test' ); ?>
				<?php submit_button( __( 'Probar conexión', 'vendemas-connector' ), 'secondary', 'submit', false ); ?>
			</form>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" onsubmit="return confirm('<?php echo esc_js( __( '¿Desconectar la tienda de Vende+?', 'vendemas-connector' ) ); ?>');">
				<input type="hidden" name="action" value="vendemas_disconnect" />
				<?php wp_nonce_field( 'vendemas_disconnect' ); ?>
				<?php submit_button( __( 'Desconectar', 'vendemas-connector' ), 'delete', 'submit', false ); ?>
			</form>
		</div>
		<?php
	}
}
