-- F3-D: exact variant of catalog quote lines (convert-to-order no longer guesses by label)
-- and an indexed lookup for the public acceptance token hash.
ALTER TABLE "quote_items" ADD COLUMN "variant_id" uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_tenant_accept_token_hash_idx" ON "quotes" USING btree ("tenant_id","accept_token_hash") WHERE "quotes"."accept_token_hash" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_tenant_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "public"."product_variants"("tenant_id","id") ON DELETE SET NULL ("variant_id") ON UPDATE no action;
