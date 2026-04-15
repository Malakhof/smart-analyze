-- AlterEnum
ALTER TYPE "CrmProvider" ADD VALUE 'GETCOURSE';

-- AlterTable
ALTER TABLE "CrmConfig" ADD COLUMN "gcEmail" TEXT,
ADD COLUMN "gcPassword" TEXT,
ADD COLUMN "gcCookie" TEXT,
ADD COLUMN "gcCookieAt" TIMESTAMP(3);
