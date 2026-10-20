CREATE TABLE "team_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "membership_role" NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"last_sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_invitations_role_not_owner" CHECK ("team_invitations"."role" <> 'owner'),
	CONSTRAINT "team_invitations_token_hash_len" CHECK (octet_length("team_invitations"."token_hash") = 32),
	CONSTRAINT "team_invitations_email_lower" CHECK ("team_invitations"."email" = lower("team_invitations"."email") AND length("team_invitations"."email") BETWEEN 3 AND 320)
);
--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_invitations_token_hash_unique" ON "team_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "team_invitations_pending_email_unique" ON "team_invitations" USING btree ("tenant_id","email") WHERE "team_invitations"."accepted_at" IS NULL AND "team_invitations"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "team_invitations_tenant_id_id_idx" ON "team_invitations" USING btree ("tenant_id","id");