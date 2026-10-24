-- Recovery follow-up for quotes sent but unanswered: new rule value. No new table or column
-- (follow_ups.quote_id and its tenant-composite FK already exist; RLS unchanged).
ALTER TYPE "public"."follow_up_rule" ADD VALUE IF NOT EXISTS 'quote_unanswered';
