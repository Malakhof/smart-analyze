-- Make Message.dealId optional and add tenant/manager/thread linkage
-- for GC conversation messages that aren't tied to a sales Deal.

ALTER TABLE "Message" DROP CONSTRAINT "Message_dealId_fkey";
ALTER TABLE "Message" ALTER COLUMN "dealId" DROP NOT NULL;

ALTER TABLE "Message" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "Message" ADD COLUMN "managerId" TEXT;
ALTER TABLE "Message" ADD COLUMN "crmId" TEXT;
ALTER TABLE "Message" ADD COLUMN "threadId" TEXT;
ALTER TABLE "Message" ADD COLUMN "channel" TEXT;

ALTER TABLE "Message" ADD CONSTRAINT "Message_dealId_fkey"
    FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_managerId_fkey"
    FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Message_tenantId_idx" ON "Message"("tenantId");
CREATE INDEX "Message_threadId_idx" ON "Message"("threadId");
CREATE INDEX "Message_managerId_idx" ON "Message"("managerId");
