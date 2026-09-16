-- AlterTable
ALTER TABLE "Owner" ADD COLUMN IF NOT EXISTS "preferredLocale" TEXT NOT NULL DEFAULT 'en';

-- AlterTable
ALTER TABLE "Contributor" ADD COLUMN IF NOT EXISTS "preferredLocale" TEXT NOT NULL DEFAULT 'en';
