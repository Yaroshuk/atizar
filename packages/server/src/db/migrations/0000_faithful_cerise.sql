CREATE TYPE "public"."gate_kind" AS ENUM('approval');--> statement-breakpoint
CREATE TYPE "public"."gate_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."origin_kind" AS ENUM('human', 'agent', 'inbound');--> statement-breakpoint
CREATE TYPE "public"."work_item_outcome" AS ENUM('running', 'done', 'stopped', 'rejected', 'error', 'superseded', 'reset');--> statement-breakpoint
CREATE TYPE "public"."work_item_phase" AS ENUM('queued', 'active', 'awaiting_human', 'terminal');--> statement-breakpoint
CREATE TABLE "action_ledger" (
	"key" text PRIMARY KEY NOT NULL,
	"work_item_id" uuid NOT NULL,
	"gate_id" uuid NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_item_id" uuid NOT NULL,
	"gate_id" uuid,
	"workflow_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"actor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"connection_id" text NOT NULL,
	"integration" text NOT NULL,
	"kind" text NOT NULL,
	"secret" text NOT NULL,
	"expires_at" timestamp with time zone,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credentials_connection_id_integration_pk" PRIMARY KEY("connection_id","integration")
);
--> statement-breakpoint
CREATE TABLE "gates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_item_id" uuid NOT NULL,
	"kind" "gate_kind" NOT NULL,
	"status" "gate_status" NOT NULL,
	"form" jsonb NOT NULL,
	"form_rev" integer DEFAULT 0 NOT NULL,
	"proposed_artifact" jsonb NOT NULL,
	"tool_name" text NOT NULL,
	"tool_call_id" text NOT NULL,
	"comment" text,
	"assignee" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schema_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trace" (
	"work_item_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"event" jsonb NOT NULL,
	"surfaced" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trace_work_item_id_seq_pk" PRIMARY KEY("work_item_id","seq")
);
--> statement-breakpoint
CREATE TABLE "work_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"parent_id" uuid,
	"origin" "origin_kind" NOT NULL,
	"source" text,
	"payload" jsonb NOT NULL,
	"phase" "work_item_phase" NOT NULL,
	"outcome" "work_item_outcome" DEFAULT 'running' NOT NULL,
	"card" jsonb,
	"run_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gates" ADD CONSTRAINT "gates_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE no action ON UPDATE no action;