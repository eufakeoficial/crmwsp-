ALTER TABLE "payment_connections" DROP CONSTRAINT "payment_connections_provider_check";--> statement-breakpoint
ALTER TABLE "commerce_connections" DROP CONSTRAINT "commerce_connections_provider_check";--> statement-breakpoint
ALTER TABLE "external_sales" DROP CONSTRAINT "external_sales_provider_check";--> statement-breakpoint
ALTER TABLE "payment_connections" ADD CONSTRAINT "payment_connections_provider_check" CHECK ("payment_connections"."provider" IN ('stripe', 'mercadopago'));--> statement-breakpoint
ALTER TABLE "commerce_connections" ADD CONSTRAINT "commerce_connections_provider_check" CHECK ("commerce_connections"."provider" IN ('shopify', 'hotmart', 'kiwify', 'eduzz', 'gumroad', 'payhip', 'tiendanube', 'woocommerce'));--> statement-breakpoint
ALTER TABLE "external_sales" ADD CONSTRAINT "external_sales_provider_check" CHECK ("external_sales"."provider" IN ('shopify', 'hotmart', 'kiwify', 'eduzz', 'gumroad', 'payhip', 'tiendanube', 'woocommerce'));
