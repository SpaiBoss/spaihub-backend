-- Per-package limit on how many devices can use the same WiFi credentials at once.
ALTER TABLE "Package" ADD COLUMN "maxSharedDevices" INTEGER NOT NULL DEFAULT 1;
