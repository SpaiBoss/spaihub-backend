-- AlterTable
ALTER TABLE "Owner" ADD COLUMN "portalBrandName" TEXT;
ALTER TABLE "Owner" ADD COLUMN "portalLogoUrl" TEXT;
ALTER TABLE "Owner" ADD COLUMN "portalAccentColor" TEXT;
ALTER TABLE "Owner" ADD COLUMN "portalWelcomeText" TEXT;
ALTER TABLE "Owner" ADD COLUMN "showPlatformCredit" BOOLEAN NOT NULL DEFAULT true;
