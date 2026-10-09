CREATE TABLE "m_shop" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shopify_domain" text NOT NULL,
	"currency" char(3) NOT NULL,
	"iana_timezone" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uninstalled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_m_shop" PRIMARY KEY("id"),
	CONSTRAINT "uq_m_shop_shopify_domain" UNIQUE("shopify_domain"),
	CONSTRAINT "uq_m_shop_tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "ck_m_shop_status" CHECK ("m_shop"."status" in ('active', 'uninstalled', 'reauth_required')),
	CONSTRAINT "ck_m_shop_domain" CHECK ("m_shop"."shopify_domain" ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
	CONSTRAINT "ck_m_shop_currency" CHECK ("m_shop"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "m_tenant" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_m_tenant" PRIMARY KEY("id"),
	CONSTRAINT "ck_m_tenant_status" CHECK ("m_tenant"."status" in ('active', 'suspended', 'deleted'))
);
--> statement-breakpoint
CREATE TABLE "s_shop_credential" (
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"encrypted_access_token" text NOT NULL,
	"key_id" text NOT NULL,
	"scopes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_s_shop_credential" PRIMARY KEY("shop_id")
);
--> statement-breakpoint
ALTER TABLE "m_shop" ADD CONSTRAINT "fk_m_shop_tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."m_tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "s_shop_credential" ADD CONSTRAINT "fk_s_shop_credential_shop" FOREIGN KEY ("tenant_id","shop_id") REFERENCES "public"."m_shop"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_m_shop_tenant_id" ON "m_shop" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ix_s_shop_credential_tenant_id" ON "s_shop_credential" USING btree ("tenant_id");