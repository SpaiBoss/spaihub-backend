import prisma from '../src/utils/prisma.js';

/** Expire duplicate PENDING payments per phone/router before unique index migration. */
async function main() {
  const pending = await prisma.transaction.findMany({
    where: {
      status: 'PENDING',
      subscriberPhone: { not: 'VOUCHER' },
    },
    orderBy: { createdAt: 'desc' },
  });

  const seen = new Map();
  let expired = 0;

  for (const tx of pending) {
    const key = `${tx.routerId}:${tx.subscriberPhone}`;
    if (seen.has(key)) {
      await prisma.transaction.update({
        where: { id: tx.id },
        data: { status: 'FAILED' },
      });
      expired += 1;
    } else {
      seen.set(key, tx.id);
    }
  }

  console.log(`Expired ${expired} duplicate pending payment(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
