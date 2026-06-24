-- CreateEnum
CREATE TYPE "PackageType" AS ENUM ('TIME_BASED', 'DATA_BASED');

-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "type" "PackageType" NOT NULL DEFAULT 'TIME_BASED';
