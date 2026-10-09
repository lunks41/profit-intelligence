CREATE TABLE "o_webhook_event" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"webhook_id" text NOT NULL,
	"topic" text NOT NULL,
	"resource_id" bigint,
	"triggered_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"processed_at" timestamp with time zone,
	CONSTRAINT "pk_o_webhook_event" PRIMARY KEY("id"),
	CONSTRAINT "uq_o_webhook_event_shop_webhook_id" UNIQUE("shop_id","webhook_id"),
	CONSTRAINT "ck_o_webhook_event_status" CHECK ("o_webhook_event"."status" in ('received', 'processing', 'processed', 'failed', 'ignored'))
);
--> statement-breakpoint
ALTER TABLE "o_webhook_event" ADD CONSTRAINT "fk_o_webhook_event_shop" FOREIGN KEY ("tenant_id","shop_id") REFERENCES "public"."m_shop"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_o_webhook_event_shop_received" ON "o_webhook_event" USING btree ("shop_id","received_at");--> statement-breakpoint
CREATE INDEX "ix_o_webhook_event_received" ON "o_webhook_event" USING btree ("received_at");