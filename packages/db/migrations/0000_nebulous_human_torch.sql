CREATE TYPE "public"."channel" AS ENUM('messenger', 'instagram', 'whatsapp', 'tiktok', 'widget');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('open', 'closed', 'human_inbox');--> statement-breakpoint
CREATE TYPE "public"."flow_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('pending', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"external_thread_id" text NOT NULL,
	"external_customer_id" text,
	"customer_name" text,
	"status" "conversation_status" DEFAULT 'open' NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"name" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"masked_hint" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"flow_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "flow_status" NOT NULL,
	"version" integer NOT NULL,
	"flow_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"direction" "message_direction" NOT NULL,
	"external_message_id" text,
	"idempotency_key" text,
	"sender" jsonb,
	"text" text DEFAULT '' NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"flow_snapshot_id" uuid NOT NULL,
	"conversation_id" uuid,
	"channel" "channel" NOT NULL,
	"input" jsonb NOT NULL,
	"node_outputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"token_usage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "run_status" DEFAULT 'pending' NOT NULL,
	"error" jsonb,
	"expires_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_flow_snapshot_id_flows_id_fk" FOREIGN KEY ("flow_snapshot_id") REFERENCES "public"."flows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_channel_thread_idx" ON "conversations" USING btree ("channel","external_thread_id");--> statement-breakpoint
CREATE INDEX "conversations_workspace_idx" ON "conversations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "credentials_workspace_idx" ON "credentials" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flows_flow_id_version_idx" ON "flows" USING btree ("flow_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "flows_draft_one_per_flow_idx" ON "flows" USING btree ("flow_id") WHERE "flows"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "flows_workspace_idx" ON "flows" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_channel_external_id_idx" ON "messages" USING btree ("channel","external_message_id") WHERE "messages"."external_message_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_idempotency_key_idx" ON "messages" USING btree ("idempotency_key") WHERE "messages"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "messages_workspace_idx" ON "messages" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "runs_workspace_idx" ON "runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "runs_conversation_idx" ON "runs" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "runs_status_expires_idx" ON "runs" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "workspaces_name_idx" ON "workspaces" USING btree ("name");