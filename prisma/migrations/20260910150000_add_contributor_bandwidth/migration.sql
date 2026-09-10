-- CreateEnum
CREATE TYPE "ContributorLinkStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED', 'DISABLED');
CREATE TYPE "ContributorMeterSource" AS ENUM ('ADMIN');
CREATE TYPE "ContributorAccrualStatus" AS ENUM ('OPEN', 'PAID', 'VOID');
CREATE TYPE "ContributorWalletLedgerType" AS ENUM ('CONTRIBUTION_CREDIT', 'WITHDRAWAL_DEBIT', 'WITHDRAWAL_REFUND', 'ADMIN_ADJUSTMENT');

-- AlterEnum
ALTER TYPE "WalletLedgerType" ADD VALUE 'CONTRIBUTOR_PAYOUT_DEBIT';
ALTER TYPE "WalletLedgerType" ADD VALUE 'CONTRIBUTOR_PAYOUT_REFUND';

-- CreateTable
CREATE TABLE "Contributor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "walletBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "OwnerStatus" NOT NULL DEFAULT 'PENDING',
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifyToken" TEXT,
    "resetPasswordToken" TEXT,
    "resetPasswordExpiry" TIMESTAMP(3),
    "momoPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contributor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContributorLink" (
    "id" TEXT NOT NULL,
    "contributorId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "routerId" TEXT,
    "interfaceName" TEXT NOT NULL,
    "capMbps" INTEGER NOT NULL,
    "rateXafPerGb" INTEGER NOT NULL,
    "status" "ContributorLinkStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContributorLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContributorMeterSample" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "bytesTotal" BIGINT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "ContributorMeterSource" NOT NULL DEFAULT 'ADMIN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContributorMeterSample_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContributorWithdrawal" (
    "id" TEXT NOT NULL,
    "contributorId" TEXT NOT NULL,
    "amountXaf" INTEGER NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "adminNote" TEXT,
    "campayReference" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "ContributorWithdrawal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContributorAccrual" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "bytes" BIGINT NOT NULL,
    "amountXaf" INTEGER NOT NULL,
    "status" "ContributorAccrualStatus" NOT NULL DEFAULT 'OPEN',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "withdrawalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContributorAccrual_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContributorWalletLedgerEntry" (
    "id" TEXT NOT NULL,
    "contributorId" TEXT NOT NULL,
    "type" "ContributorWalletLedgerType" NOT NULL,
    "amountXaf" INTEGER NOT NULL,
    "balanceAfterXaf" DECIMAL(12,2) NOT NULL,
    "referenceId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContributorWalletLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Contributor_email_key" ON "Contributor"("email");
CREATE UNIQUE INDEX "ContributorWithdrawal_campayReference_key" ON "ContributorWithdrawal"("campayReference");
CREATE UNIQUE INDEX "ContributorWithdrawal_idempotencyKey_key" ON "ContributorWithdrawal"("idempotencyKey");

CREATE INDEX "ContributorLink_contributorId_status_idx" ON "ContributorLink"("contributorId", "status");
CREATE INDEX "ContributorLink_locationId_idx" ON "ContributorLink"("locationId");
CREATE INDEX "ContributorLink_routerId_interfaceName_idx" ON "ContributorLink"("routerId", "interfaceName");
CREATE INDEX "ContributorMeterSample_linkId_recordedAt_idx" ON "ContributorMeterSample"("linkId", "recordedAt");
CREATE INDEX "ContributorAccrual_ownerId_status_idx" ON "ContributorAccrual"("ownerId", "status");
CREATE INDEX "ContributorAccrual_linkId_status_idx" ON "ContributorAccrual"("linkId", "status");
CREATE INDEX "ContributorAccrual_withdrawalId_idx" ON "ContributorAccrual"("withdrawalId");
CREATE INDEX "ContributorWalletLedgerEntry_contributorId_createdAt_idx" ON "ContributorWalletLedgerEntry"("contributorId", "createdAt");

ALTER TABLE "ContributorLink" ADD CONSTRAINT "ContributorLink_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "Contributor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContributorLink" ADD CONSTRAINT "ContributorLink_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContributorLink" ADD CONSTRAINT "ContributorLink_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContributorMeterSample" ADD CONSTRAINT "ContributorMeterSample_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ContributorLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContributorWithdrawal" ADD CONSTRAINT "ContributorWithdrawal_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "Contributor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContributorAccrual" ADD CONSTRAINT "ContributorAccrual_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ContributorLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContributorAccrual" ADD CONSTRAINT "ContributorAccrual_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContributorAccrual" ADD CONSTRAINT "ContributorAccrual_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "ContributorWithdrawal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContributorWalletLedgerEntry" ADD CONSTRAINT "ContributorWalletLedgerEntry_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "Contributor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
