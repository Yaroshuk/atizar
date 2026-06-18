CREATE TYPE "public"."question_status" AS ENUM('open', 'answered', 'failed');--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"asker_work_item_id" uuid NOT NULL,
	"answerer_work_item_id" uuid,
	"target" jsonb NOT NULL,
	"tool_call_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "question_status" DEFAULT 'open' NOT NULL,
	"answer" jsonb,
	"reason" text,
	"round" integer DEFAULT 1 NOT NULL,
	"retries" integer DEFAULT 0 NOT NULL,
	"deadline" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_asker_work_item_id_work_items_id_fk" FOREIGN KEY ("asker_work_item_id") REFERENCES "public"."work_items"("id") ON DELETE no action ON UPDATE no action;