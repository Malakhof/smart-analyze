-- Add currentStageCrmId to Deal
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Deal' AND column_name = 'currentStageCrmId'
  ) THEN
    ALTER TABLE "Deal" ADD COLUMN "currentStageCrmId" TEXT;
  END IF;
END$$;

-- Create TaskType enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TaskType') THEN
    CREATE TYPE "TaskType" AS ENUM ('CALL', 'MEETING', 'LETTER', 'OTHER');
  END IF;
END$$;

-- Create Task table
CREATE TABLE IF NOT EXISTS "Task" (
  "id"          TEXT PRIMARY KEY,
  "tenantId"    TEXT NOT NULL,
  "dealId"      TEXT,
  "managerId"   TEXT,
  "crmId"       TEXT,
  "type"        "TaskType" NOT NULL,
  "text"        TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL,
  "dueAt"       TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "isCompleted" BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT "Task_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "Task_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "Task_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "Task_tenantId_managerId_idx" ON "Task"("tenantId", "managerId");
CREATE INDEX IF NOT EXISTS "Task_tenantId_dealId_idx" ON "Task"("tenantId", "dealId");
