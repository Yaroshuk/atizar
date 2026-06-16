ALTER TABLE "work_items" ADD COLUMN "key" text;--> statement-breakpoint
UPDATE "work_items" SET "key" = "agent_id" WHERE "key" IS NULL;--> statement-breakpoint
ALTER TABLE "work_items" ALTER COLUMN "key" SET NOT NULL;
