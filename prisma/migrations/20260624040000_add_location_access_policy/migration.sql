-- AlterTable
ALTER TABLE "Location" ADD COLUMN "allowHotspotSharing" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Location" ADD COLUMN "maxHotspotDevices" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Location" ADD COLUMN "maxDevicesPerAccessCode" INTEGER NOT NULL DEFAULT 0;

-- DropIndex
DROP INDEX "Transaction_voucherId_key";

-- CreateIndex
CREATE INDEX "Transaction_voucherId_idx" ON "Transaction"("voucherId");
