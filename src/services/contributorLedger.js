export async function recordContributorLedgerEntry(tx, { contributorId, type, amountXaf, referenceId, note }) {
  const contributor = await tx.contributor.findUnique({
    where: { id: contributorId },
    select: { walletBalance: true },
  });
  if (!contributor) return;

  await tx.contributorWalletLedgerEntry.create({
    data: {
      contributorId,
      type,
      amountXaf,
      balanceAfterXaf: contributor.walletBalance,
      referenceId: referenceId ?? null,
      note: note ?? null,
    },
  });
}
