-- Idempotency and duplicate-prevention for money flows
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Withdrawal_idempotencyKey_key" ON "Withdrawal"("idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "Withdrawal_campayReference_key" ON "Withdrawal"("campayReference");
CREATE UNIQUE INDEX IF NOT EXISTS "Transaction_campayReference_key" ON "Transaction"("campayReference");

DROP INDEX IF EXISTS "Transaction_campayReference_idx";
