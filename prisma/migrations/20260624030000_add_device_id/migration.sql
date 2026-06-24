-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "deviceId" TEXT;
ALTER TABLE "Transaction" ALTER COLUMN "subscriberMac" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Transaction_deviceId_routerId_idx" ON "Transaction"("deviceId", "routerId");
