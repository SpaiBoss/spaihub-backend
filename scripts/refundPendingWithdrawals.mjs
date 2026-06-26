import 'dotenv/config';
import prisma from '../src/utils/prisma.js';

const NOTE = 'Refunded by admin — you can request withdrawal again.';

async function main() {
  const pending = await prisma.withdrawal.findMany({
    where: { status: 'PENDING' },
    include: { owner: { select: { id: true, name: true, email: true, walletBalance: true } } },
    orderBy: { createdAt: 'asc' },
  });

  if (pending.length === 0) {
    console.log('No pending withdrawals to refund.');
    return;
  }

  console.log(`Refunding ${pending.length} pending withdrawal(s)...\n`);

  for (const withdrawal of pending) {
    await prisma.$transaction(async (tx) => {
      await tx.owner.update({
        where: { id: withdrawal.ownerId },
        data: { walletBalance: { increment: withdrawal.amountXaf } },
      });

      await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: {
          status: 'REJECTED',
          adminNote: NOTE,
          processedAt: new Date(),
        },
      });
    });

    const owner = withdrawal.owner;
    console.log(
      `- ${owner.name} (${owner.email}): +${withdrawal.amountXaf} XAF | phone ${withdrawal.phoneNumber}`
    );
  }

  console.log('\nDone. Owners can withdraw again from their wallet.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
