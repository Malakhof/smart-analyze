-- Add CommunicationType enum and convert CallRecord.type column
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommunicationType') THEN
    CREATE TYPE "CommunicationType" AS ENUM ('CALL', 'CHAT');
  END IF;
END$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'CallRecord' AND column_name = 'type' AND data_type = 'text'
  ) THEN
    ALTER TABLE "CallRecord" ALTER COLUMN "type" DROP DEFAULT;
    ALTER TABLE "CallRecord" ALTER COLUMN "type" TYPE "CommunicationType" USING "type"::"CommunicationType";
    ALTER TABLE "CallRecord" ALTER COLUMN "type" SET DEFAULT 'CALL'::"CommunicationType";
  END IF;
END$$;
