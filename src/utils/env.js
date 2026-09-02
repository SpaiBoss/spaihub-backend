/** Fail fast in production when critical env vars are missing. */
export function assertProductionEnv() {
  if (process.env.NODE_ENV !== 'production') return;

  const required = ['API_BASE_URL', 'FRONTEND_URL', 'DATABASE_URL', 'JWT_SECRET'];
  const missing = required.filter((key) => !process.env[key]?.trim());

  if (missing.length > 0) {
    throw new Error(`Missing required production env: ${missing.join(', ')}`);
  }
}
