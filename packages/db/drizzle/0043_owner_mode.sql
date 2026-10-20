-- memberships (tenant_id, id) becomes UNIQUE so owner_phones can reference it with a composite FK.
DROP INDEX "memberships_tenant_id_id_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_id_id_idx" ON "memberships" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE TABLE "ai_pauses" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"paused_at" timestamp with time zone,
	"paused_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_phone_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"channel_connection_id" uuid NOT NULL,
	"inbound_external_id" text NOT NULL,
	"body" text,
	"intent" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"nonce_hash" text,
	"expires_at" timestamp with time zone,
	"reply" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "owner_commands_status_check" CHECK ("owner_commands"."status" IN ('received', 'answered', 'awaiting_confirmation', 'confirmed', 'cancelled', 'expired', 'rejected', 'failed')),
	CONSTRAINT "owner_commands_pending_nonce_check" CHECK ("owner_commands"."status" <> 'awaiting_confirmation' OR ("owner_commands"."nonce_hash" IS NOT NULL AND "owner_commands"."expires_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "owner_phones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"phone_e164" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"code_hash" text,
	"code_salt" text,
	"code_expires_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_phones_status_check" CHECK ("owner_phones"."status" IN ('pending', 'verified')),
	CONSTRAINT "owner_phones_phone_check" CHECK ("owner_phones"."phone_e164" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "owner_phones_attempts_check" CHECK ("owner_phones"."attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "owner_commands_tenant_id_id_idx" ON "owner_commands" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "owner_commands_tenant_external_unique" ON "owner_commands" USING btree ("tenant_id","inbound_external_id");
--> statement-breakpoint
CREATE INDEX "owner_commands_tenant_phone_created_idx" ON "owner_commands" USING btree ("tenant_id","owner_phone_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE UNIQUE INDEX "owner_phones_tenant_id_id_idx" ON "owner_phones" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "owner_phones_tenant_phone_unique" ON "owner_phones" USING btree ("tenant_id","phone_e164");
--> statement-breakpoint
CREATE UNIQUE INDEX "owner_phones_tenant_membership_unique" ON "owner_phones" USING btree ("tenant_id","membership_id");
--> statement-breakpoint
ALTER TABLE "ai_pauses" ADD CONSTRAINT "ai_pauses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_pauses" ADD CONSTRAINT "ai_pauses_paused_by_users_id_fk" FOREIGN KEY ("paused_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "owner_commands" ADD CONSTRAINT "owner_commands_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "owner_commands" ADD CONSTRAINT "owner_commands_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "owner_commands" ADD CONSTRAINT "owner_commands_tenant_phone_fk" FOREIGN KEY ("tenant_id","owner_phone_id") REFERENCES "public"."owner_phones"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "owner_commands" ADD CONSTRAINT "owner_commands_tenant_channel_fk" FOREIGN KEY ("tenant_id","channel_connection_id") REFERENCES "public"."channel_connections"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "owner_phones" ADD CONSTRAINT "owner_phones_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "owner_phones" ADD CONSTRAINT "owner_phones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "owner_phones" ADD CONSTRAINT "owner_phones_tenant_membership_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
