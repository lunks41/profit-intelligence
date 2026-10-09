CREATE TABLE "o_feedback" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"contact_email" text,
	"status" text DEFAULT 'new' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_o_feedback" PRIMARY KEY("id"),
	CONSTRAINT "ck_o_feedback_kind" CHECK ("o_feedback"."kind" in ('feedback', 'question', 'problem')),
	CONSTRAINT "ck_o_feedback_status" CHECK ("o_feedback"."status" in ('new', 'seen', 'answered', 'closed')),
	CONSTRAINT "ck_o_feedback_message" CHECK (length(btrim("o_feedback"."message")) between 3 and 2000)
);
--> statement-breakpoint
CREATE TABLE "s_subscription" (
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"plan" text NOT NULL,
	"status" text NOT NULL,
	"shopify_subscription_id" text,
	"plan_name" text,
	"is_test" boolean DEFAULT false NOT NULL,
	"current_period_end" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_s_subscription" PRIMARY KEY("shop_id"),
	CONSTRAINT "ck_s_subscription_plan" CHECK ("s_subscription"."plan" in ('free', 'growth', 'pro')),
	CONSTRAINT "ck_s_subscription_status" CHECK ("s_subscription"."status" in ('none', 'pending', 'active', 'frozen', 'cancelled', 'declined', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "o_feedback" ADD CONSTRAINT "fk_o_feedback_shop" FOREIGN KEY ("tenant_id","shop_id") REFERENCES "public"."m_shop"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "s_subscription" ADD CONSTRAINT "fk_s_subscription_shop" FOREIGN KEY ("tenant_id","shop_id") REFERENCES "public"."m_shop"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_o_feedback_shop" ON "o_feedback" USING btree ("shop_id","created_at");