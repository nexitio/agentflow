CREATE TABLE "channel_status" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"webhook_url" text,
	"verified_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_status" ADD CONSTRAINT "channel_status_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_status_workspace_channel_idx" ON "channel_status" USING btree ("workspace_id","channel");