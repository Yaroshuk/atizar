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
