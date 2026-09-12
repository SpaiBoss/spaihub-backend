-- AlterEnum
ALTER TYPE "RouterCommandType" ADD VALUE 'REBIND_MAC';

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "macBindCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Router" ADD COLUMN "hotspotActiveSnapshot" JSONB,
ADD COLUMN "hotspotActiveAt" TIMESTAMP(3);
