-- CreateEnum
CREATE TYPE "DeploymentType" AS ENUM ('PHYSICAL', 'CHR');

-- AlterTable
ALTER TABLE "Router" ADD COLUMN "deploymentType" "DeploymentType" NOT NULL DEFAULT 'PHYSICAL',
ADD COLUMN "chrConfig" JSONB,
ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);
