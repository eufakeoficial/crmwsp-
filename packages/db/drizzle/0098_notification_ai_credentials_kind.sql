ALTER TABLE public."notifications" DROP CONSTRAINT "notifications_kind_check";--> statement-breakpoint
ALTER TABLE public."notifications" ADD CONSTRAINT "notifications_kind_check" CHECK ("kind" IN ('order_confirmed', 'order_paid', 'handoff', 'approval_requested', 'payment_review', 'reminder', 'channel_quality', 'ai_credentials'));
