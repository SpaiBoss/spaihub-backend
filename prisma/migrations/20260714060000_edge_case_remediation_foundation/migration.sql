-- CreateEnum
CREATE TYPE "RouterCommandStatus" AS ENUM ('PENDING', 'DISPATCHED', 'ACKNOWLEDGED', 'FAILED', 'DEAD_LETTER');

-- AlterEnum
ALTER TYPE "RouterCommandType" ADD VALUE IF NOT EXISTS 'UPDATE_ACCESS_POLICY';

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "kickedAt" TIMESTAMP(3);

-- AlterTable RouterCommand
ALTER TABLE "RouterCommand" ADD COLUMN IF NOT EXISTS "status" "RouterCommandStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "RouterCommand" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RouterCommand" ADD COLUMN IF NOT EXISTS "dispatchedAt" TIMESTAMP(3);
ALTER TABLE "RouterCommand" ADD COLUMN IF NOT EXISTS "acknowledgedAt" TIMESTAMP(3);
ALTER TABLE "RouterCommand" ADD COLUMN IF NOT EXISTS "lastError" TEXT;
ALTER TABLE "RouterCommand" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill command status from legacy executed flag
UPDATE "RouterCommand"
SET "status" = 'ACKNOWLEDGED', "acknowledgedAt" = "createdAt"
WHERE "executed" = true AND "status" = 'PENDING';

-- Expire duplicate pending payments per phone/router (keep newest)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "routerId", "subscriberPhone"
           ORDER BY "createdAt" DESC
         ) AS rn
  FROM "Transaction"
  WHERE status = 'PENDING'
    AND "subscriberPhone" IS NOT NULL
    AND "subscriberPhone" <> 'VOUCHER'
)
UPDATE "Transaction" t
SET status = 'FAILED'
FROM ranked r
WHERE t.id = r.id AND r.rn > 1;

-- Partial unique: one pending MoMo payment per phone per router
CREATE UNIQUE INDEX IF NOT EXISTS "Transaction_routerId_subscriberPhone_pending_key"
ON "Transaction"("routerId", "subscriberPhone")
WHERE status = 'PENDING' AND "subscriberPhone" <> 'VOUCHER';

CREATE INDEX IF NOT EXISTS "RouterCommand_routerId_status_idx" ON "RouterCommand"("routerId", "status");
CREATE INDEX IF NOT EXISTS "RouterCommand_status_createdAt_idx" ON "RouterCommand"("status", "createdAt");

-- Wallet ledger (Phase 7 foundation)
CREATE TYPE "WalletLedgerType" AS ENUM ('PAYMENT_CREDIT', 'WITHDRAWAL_DEBIT', 'WITHDRAWAL_REFUND', 'ADMIN_ADJUSTMENT');

CREATE TABLE IF NOT EXISTS "WalletLedgerEntry" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "type" "WalletLedgerType" NOT NULL,
  "amountXaf" INTEGER NOT NULL,
  "balanceAfterXaf" DECIMAL(12,2) NOT NULL,
  "referenceId" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WalletLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WalletLedgerEntry_ownerId_createdAt_idx" ON "WalletLedgerEntry"("ownerId", "createdAt");

ALTER TABLE "WalletLedgerEntry"
  ADD CONSTRAINT "WalletLedgerEntry_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
