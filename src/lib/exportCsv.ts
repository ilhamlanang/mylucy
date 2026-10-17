import { Category, Transaction, Wallet } from '../types/finance';

/**
 * Exports transactions to an Excel-compatible CSV file (with UTF-8 BOM)
 */
export function exportTransactionsToCsv(
  transactions: Transaction[],
  categories: Category[],
  wallets: Wallet[]
): void {
  const headers = [
    'Tanggal',
    'Jenis',
    'Kategori',
    'Merchant',
    'Deskripsi',
    'Dompet / Sumber Dana',
    'Nominal (IDR)',
    'Sumber Input'
  ];

  const escapeCsvCell = (val: string | number | undefined) => {
    const str = String(val ?? '').replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows = transactions.map((tx) => {
    const catName = categories.find((c) => c.id === tx.category_id)?.name || 'Lainnya';
    const walletName = wallets.find((w) => w.id === tx.wallet_id)?.name || 'Dompet Utama';
    const typeLabel = tx.type === 'income' ? 'Pemasukan' : 'Pengeluaran';
    const sourceLabel = tx.source === 'ai_parsed' ? 'Smart Parse AI' : 'Input Manual';

    return [
      escapeCsvCell(tx.transaction_date),
      escapeCsvCell(typeLabel),
      escapeCsvCell(catName),
      escapeCsvCell(tx.merchant || '-'),
      escapeCsvCell(tx.description),
      escapeCsvCell(walletName),
      tx.amount,
      escapeCsvCell(sourceLabel)
    ].join(',');
  });

  // Add UTF-8 BOM (\uFEFF) so Microsoft Excel opens columns cleanly
  const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  const dateStamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.setAttribute('download', `MyLucy_Laporan_Transaksi_${dateStamp}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

