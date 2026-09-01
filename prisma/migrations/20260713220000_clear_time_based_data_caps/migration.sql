-- Time-based packages are governed by limit-uptime, not limit-bytes-total.
-- Stale dataCapMb values on TIME_BASED packages caused MikroTik to cut off
-- subscribers after a few MB despite "unlimited" browse packages.
-- Owners can re-enable an optional fair-use cap in the package editor if needed.
UPDATE "Package"
SET "dataCapMb" = NULL
WHERE "type" = 'TIME_BASED'
  AND "dataCapMb" IS NOT NULL;
