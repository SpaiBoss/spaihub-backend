import 'dotenv/config';
import prisma from '../src/utils/prisma.js';
import * as campay from '../src/services/campay.js';
import { normalizeCampayStatus } from '../src/utils/pendingPayment.js';

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

  console.log(`Checking ${pending.length} pending withdrawal(s) against Campay before refund...\n`);

  for (const withdrawal of pending) {
    if (withdrawal.campayReference) {
      try {
        const tx = await campay.getTransactionStatus(withdrawal.campayReference);
        const status = normalizeCampayStatus(tx.status);
        if (status === 'SUCCESSFUL') {
          console.log(
            `- SKIP ${withdrawal.owner.name}: Campay shows SUCCESS for ${withdrawal.campayReference} — mark paid in admin instead`
          );
          continue;
        }
        if (status === 'PENDING') {
          console.log(
            `- SKIP ${withdrawal.owner.name}: Campay still PENDING for ${withdrawal.campayReference}`
          );
          continue;
        }
      } catch (err) {
        console.log(
          `- SKIP ${withdrawal.owner.name}: Campay lookup failed (${err.message}) — verify manually`
        );
        continue;
      }
    }

    await prisma.$transaction(async (tx) => {
      const current = await tx.withdrawal.findUnique({ where: { id: withdrawal.id } });
      if (!current || current.status !== 'PENDING') return;

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
      `- REFUNDED ${owner.name} (${owner.email}): +${withdrawal.amountXaf} XAF | phone ${withdrawal.phoneNumber}`
    );
  }

  console.log('\nDone. Skipped rows may still need manual Campay verification.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
