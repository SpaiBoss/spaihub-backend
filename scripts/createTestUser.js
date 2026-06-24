import 'dotenv/config';
import bcrypt from 'bcryptjs';
import prisma from '../src/utils/prisma.js';

const TEST_EMAIL = 'test@spaihub.local';
const TEST_PASSWORD = 'Test1234!';
const TEST_NAME = 'Test Owner';

async function main() {
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);

  const owner = await prisma.owner.upsert({
    where: { email: TEST_EMAIL },
    update: {
      name: TEST_NAME,
      passwordHash,
      status: 'ACTIVE',
      emailVerified: true,
      emailVerifyToken: null,
    },
    create: {
      name: TEST_NAME,
      email: TEST_EMAIL,
      passwordHash,
      status: 'ACTIVE',
      emailVerified: true,
    },
  });

  console.log('Test owner ready:');
  console.log(`  Email:    ${TEST_EMAIL}`);
  console.log(`  Password: ${TEST_PASSWORD}`);
  console.log(`  ID:       ${owner.id}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
