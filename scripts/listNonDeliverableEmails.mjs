import 'dotenv/config';
import prisma from '../src/utils/prisma.js';
import { getEmailValidationError } from '../src/utils/queryValidation.js';

async function listBad(model, label) {
  const rows = await prisma[model].findMany({
    select: { id: true, email: true, status: true, emailVerified: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  const bad = rows.filter((r) => getEmailValidationError(r.email));
  console.log(`\n${label}: ${bad.length} / ${rows.length} fail deliverable-email checks`);
  for (const r of bad) {
    console.log(
      `  ${r.email}  status=${r.status}  verified=${r.emailVerified}  reason=${getEmailValidationError(r.email)}`
    );
  }
  return bad.length;
}

const ownerBad = await listBad('owner', 'Owners');
const contribBad = await listBad('contributor', 'Contributors');
console.log(`\nTotal non-deliverable: ${ownerBad + contribBad}`);
await prisma.$disconnect();
