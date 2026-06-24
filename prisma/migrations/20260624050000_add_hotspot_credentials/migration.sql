-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "hotspotUsername" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "hotspotPin" TEXT;

-- AlterTable
ALTER TABLE "Voucher" ADD COLUMN "pin" TEXT;
