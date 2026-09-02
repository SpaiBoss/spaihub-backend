-- CreateEnum
CREATE TYPE "WhatsappMessageType" AS ENUM ('PAYMENT_CONFIRMED', 'SESSION_EXPIRING', 'SESSION_EXPIRED');

-- CreateEnum
CREATE TYPE "WhatsappNotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "WhatsappNotification" (
    "id" TEXT NOT NULL,
    "recipientPhone" TEXT NOT NULL,
    "sessionId" TEXT,
    "messageType" "WhatsappMessageType" NOT NULL,
    "payload" JSONB,
    "status" "WhatsappNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "openwaMessageId" TEXT,
    "transactionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsappNotification_status_createdAt_idx" ON "WhatsappNotification"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsappNotification_recipientPhone_idx" ON "WhatsappNotification"("recipientPhone");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappNotification_transactionId_messageType_key" ON "WhatsappNotification"("transactionId", "messageType");

-- AddForeignKey
ALTER TABLE "WhatsappNotification" ADD CONSTRAINT "WhatsappNotification_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
