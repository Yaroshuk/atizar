ALTER TABLE "work_items" ADD COLUMN "key" text;
UPDATE "work_items" SET "key" = "agent_id" WHERE "key" IS NULL;
ALTER TABLE "work_items" ALTER COLUMN "key" SET NOT NULL;
