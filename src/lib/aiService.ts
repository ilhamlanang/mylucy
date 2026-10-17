import { GoogleGenAI } from '@google/genai';
import { Category, TransactionType } from '../types/finance';
import { formatIDR, isSupabaseConfigured, supabase } from './supabase';

export interface ParsedMutationResult {
  amount: number;
  merchant: string;
  category_name: string;
  type: TransactionType;
  transaction_date: string;
  description: string;
  confidence: number;
  engine: 'supabase-edge' | 'gemini-sdk' | 'smart-heuristic';
}

export interface FinancialSummaryContext {
  totalBalance: number;
  monthlyIncome: number;
  monthlyExpense: number;
  savingsRatePct: number;
  topCategories: Array<{
    name: string;
    amount: number;
    percentage: number;
    budgetLimit: number | null;
  }>;
  walletBreakdown: Array<{
    name: string;
    balance: number;
  }>;
  debtSummary?: {
    totalPayableRemaining: number;
    totalReceivableRemaining: number;
    unpaidMonthlyObligation: number;
    debtServiceRatioPct: number;
    activeDebts: Array<{
      title: string;
      counterparty: string;
      direction: 'payable' | 'receivable';
      remainingAmount: number;
      monthlyInstallment: number;
      dueDay: number;
      isPaidThisMonth: boolean;
    }>;
  };
}

const LOCAL_GEMINI_KEY_STORAGE = 'mylucy_dev_gemini_key';

export function getSavedGeminiApiKey(): string {
  return localStorage.getItem(LOCAL_GEMINI_KEY_STORAGE) || '';
}

export function setSavedGeminiApiKey(key: string): void {
  if (key.trim()) {
    localStorage.setItem(LOCAL_GEMINI_KEY_STORAGE, key.trim());
  } else {
    localStorage.removeItem(LOCAL_GEMINI_KEY_STORAGE);
  }
}

export const SAMPLE_MUTATIONS = [
  'QRIS Rp45.000 at Kopi Janji Jiwa berhasil pada 17 Okt 2026',
  'Pembayaran GoRide sebesar Rp28.500 dengan GoPay berhasil',
  'Notifikasi BCA: Transfer Masuk Rp3.500.000 dari PT Nusantara Digital (Bonus Proyek)',
  'ShopeePay: Pembayaran Rp165.000 di Uniqlo Grand Indonesia berhasil',
  'Tagihan Listrik PLN Prabayar Rp250.000 via Mandiri Livin berhasil dibayar'
];

/**
 * Smart Parsing: Extracts structured transaction data from banking/e-wallet notification text.
 * Priority: 1) Supabase Edge Function -> 2) @google/genai SDK (gemini-3.8-flash) -> 3) Smart Local Heuristic Fallback
 */
export async function parseTransactionText(
  rawText: string,
  categories: Category[]
): Promise<ParsedMutationResult> {
  const categoryNames = categories.map((c) => c.name);
  const today = new Date().toISOString().slice(0, 10);

  // 1. Try Supabase Edge Function if configured
  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase.functions.invoke('ai-parse', {
        body: { rawText, categories: categoryNames }
      });
      if (!error && data && data.amount) {
        return { ...data, engine: 'supabase-edge' };
      }
    } catch {
      // Fallback to SDK or local parser
    }
  }

  // 2. Use @google/genai Interactions API with gemini-3.8-flash & Structured Output
  const apiKey = getSavedGeminiApiKey();
  if (apiKey) {
    const client = new GoogleGenAI({ apiKey });
    const interaction = await client.interactions.create({
      model: 'gemini-3.8-flash',
      system_instruction:
        `Kamu adalah mesin parser transaksi perbankan dan e-wallet Indonesia (GoPay, OVO, ShopeePay, QRIS, BCA, Mandiri, BRI). ` +
        `Ekstrak nominal (angka bulat Rupiah), nama merchant, tanggal transaksi (YYYY-MM-DD, default ${today} jika tidak ada), ` +
        `jenis transaksi ('income' atau 'expense'), serta pilih nama kategori yang paling cocok dari daftar: [${categoryNames.join(', ')}].`,
      input: rawText,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: {
          type: 'object',
          properties: {
            amount: { type: 'integer', description: 'Nominal transaksi dalam angka bulat Rupiah (IDR)' },
            merchant: { type: 'string', description: 'Nama merchant, toko, atau pengirim' },
            category_name: { type: 'string', description: 'Nama kategori yang paling sesuai' },
            type: { type: 'string', enum: ['income', 'expense'] },
            transaction_date: { type: 'string', description: 'Format YYYY-MM-DD' },
            description: { type: 'string', description: 'Deskripsi singkat transaksi' },
            confidence: { type: 'number', description: 'Skor akurasi 0.0 - 1.0' }
          },
          required: ['amount', 'merchant', 'category_name', 'type', 'transaction_date', 'description', 'confidence']
        }
      }
    });

    const parsed = JSON.parse(interaction.output_text || '{}');
    return {
      amount: Number(parsed.amount) || 0,
      merchant: parsed.merchant || 'Merchant',
      category_name: parsed.category_name || categoryNames[0] || 'Makan & Minum',
      type: parsed.type === 'income' ? 'income' : 'expense',
      transaction_date: parsed.transaction_date || today,
      description: parsed.description || rawText.slice(0, 60),
      confidence: Number(parsed.confidence) || 0.95,
      engine: 'gemini-sdk'
    };
  }

  // 3. Built-in Indonesian Mutasi Smart Parser (Instant Demo Fallback)
  await new Promise((r) => setTimeout(r, 350));
  const lower = rawText.toLowerCase();

  // Extract nominal (handles Rp45.000, Rp 3.500.000, IDR 165,000, 45rb, etc.)
  let amount = 0;
  const rpMatch = rawText.match(/(?:rp|idr)\.?\s*([0-9][0-9.,]*)/i);
  const rbMatch = rawText.match(/([0-9]+)\s*(?:rb|ribu)/i);
  if (rpMatch) {
    const cleaned = rpMatch[1].replace(/,[0-9]{2}$/, '').replace(/[^0-9]/g, '');
    amount = Number(cleaned) || 0;
  } else if (rbMatch) {
    amount = Number(rbMatch[1]) * 1000;
  } else {
    const genericNum = rawText.match(/\b([0-9]{4,9})\b/);
    if (genericNum) amount = Number(genericNum[1]);
  }

  // Determine income vs expense
  const isIncome = /(transfer masuk|gaji|bonus|dana masuk|kredit|terima uang|cashback|pelunasan piutang)/i.test(lower);
  const type: TransactionType = isIncome ? 'income' : 'expense';

  // Determine category
  let categoryName = isIncome ? 'Bonus & Freelance' : 'Makan & Minum';
  if (isIncome && /gaji|salary|payroll/i.test(lower)) {
    categoryName = 'Gaji Bulanan';
  } else if (isIncome && /piutang|pinjam/i.test(lower)) {
    categoryName = 'Pelunasan Piutang';
  } else if (!isIncome) {
    if (/kopi|janji jiwa|fore|starbucks|resto|makan|warung|gofood|grabfood|sate|ayam|bakso/i.test(lower)) {
      categoryName = 'Makan & Minum';
    } else if (/goride|gocar|grab|mrt|krl|transjakarta|bensin|pertamina|shell|parkir|tol/i.test(lower)) {
      categoryName = 'Transportasi';
    } else if (/spaylater|shopeepaylater|kredivo|akulaku|cicilan|kartu kredit|kpr|hutang|pinjaman/i.test(lower)) {
      categoryName = 'Cicilan & Hutang';
    } else if (/pln|listrik|wifi|indihome|biznet|pulsa|telkomsel|bpjs|pdam|tagihan/i.test(lower)) {
      categoryName = 'Tagihan & Utilitas';
    } else if (/uniqlo|shopee|tokopedia|alfamart|indomaret|superindo|mall|belanja/i.test(lower)) {
      categoryName = 'Belanja';
    } else if (/netflix|spotify|bioskop|xxi|cgv|game|steam/i.test(lower)) {
      categoryName = 'Hiburan';
    } else if (/bibit|reksadana|emas|tabungan|deposito/i.test(lower)) {
      categoryName = 'Tabungan & Investasi';
    }
  }

  // Extract merchant
  let merchant = 'Transaksi Otomatis';
  const merchPattern = rawText.match(/(?:at|di|ke|dari)\s+([A-Za-z0-9\s.&'-]{3,35}?)(?:\s+berhasil|\s+pada|\s+sebesar|\s*\(|$)/i);
  if (merchPattern && merchPattern[1]) {
    merchant = merchPattern[1].trim();
  } else if (/goride/i.test(lower)) {
    merchant = 'GoRide';
  } else if (/pln/i.test(lower)) {
    merchant = 'PLN Prabayar';
  }

  return {
    amount: amount || 50000,
    merchant,
    category_name: categoryName,
    type,
    transaction_date: today,
    description: rawText.trim(),
    confidence: 0.92,
    engine: 'smart-heuristic'
  };
}

/**
 * AI Financial Advisor Chatbot (Lucy) with Streaming & Context Aggregation
 */
export async function streamLucyAdvisorResponse(
  question: string,
  context: FinancialSummaryContext,
  previousInteractionId: string | null,
  onDelta: (chunk: string) => void
): Promise<{ fullText: string; interactionId: string | null; engine: string }> {
  const debtInfoText = context.debtSummary
    ? `\n- Sisa Pokok Hutang/Cicilan Aktif: ${formatIDR(context.debtSummary.totalPayableRemaining)}` +
      `\n- Kewajiban Cicilan Bulan Ini Belum Dibayar: ${formatIDR(context.debtSummary.unpaidMonthlyObligation)}` +
      `\n- Debt Service Ratio (Rasio Cicilan terhadap Pemasukan): ${context.debtSummary.debtServiceRatioPct}%` +
      `\n- Sisa Piutang (Uang Dipinjam Orang): ${formatIDR(context.debtSummary.totalReceivableRemaining)}` +
      `\n- Rincian Hutang/Piutang: ${context.debtSummary.activeDebts
        .map(
          (d) =>
            `${d.title} (${d.direction === 'payable' ? 'Hutang ke' : 'Piutang dari'} ${d.counterparty}, sisa ${formatIDR(
              d.remainingAmount
            )}, cicilan ${formatIDR(d.monthlyInstallment)}/bln, jatuh tempo tgl ${d.dueDay}, ${
              d.isPaidThisMonth ? 'sudah dibayar bulan ini' : 'BELUM dibayar bulan ini'
            })`
        )
        .join('; ')}`
    : '';

  const systemPrompt =
    `Kamu adalah Lucy, AI Financial Advisor cerdas di aplikasi MyLucy. ` +
    `Jawab dengan bahasa Indonesia yang hangat, terstruktur (gunakan bullet points singkat), dan berikan rekomendasi konkret berdasarkan data keuangan pengguna bulan ini:\n` +
    `- Total Saldo Gabungan: ${formatIDR(context.totalBalance)}\n` +
    `- Pemasukan Bulan Ini: ${formatIDR(context.monthlyIncome)}\n` +
    `- Pengeluaran Bulan Ini: ${formatIDR(context.monthlyExpense)}\n` +
    `- Rasio Tabungan (Savings Rate): ${context.savingsRatePct}%\n` +
    `- Distribusi Pengeluaran Terbesar: ${context.topCategories
      .map(
        (c) =>
          `${c.name}: ${formatIDR(c.amount)} (${c.percentage}% dari pengeluaran${
            c.budgetLimit ? `, batas budget ${formatIDR(c.budgetLimit)}` : ''
          })`
      )
      .join('; ')}${debtInfoText}`;

  // 1. Try @google/genai Streaming Interactions API (gemini-3.8-flash) if key is configured
  const apiKey = getSavedGeminiApiKey();
  if (apiKey) {
    const client = new GoogleGenAI({ apiKey });
    const stream = await client.interactions.create({
      model: 'gemini-3.8-flash',
      system_instruction: systemPrompt,
      input: question,
      ...(previousInteractionId ? { previous_interaction_id: previousInteractionId } : {}),
      stream: true
    });

    let fullText = '';
    let newInteractionId: string | null = null;

    for await (const event of stream) {
      if (event.event_type === 'interaction.created' && event.interaction?.id) {
        newInteractionId = event.interaction.id;
      } else if (event.event_type === 'step.delta' && event.delta?.type === 'text' && event.delta.text) {
        fullText += event.delta.text;
        onDelta(event.delta.text);
      } else if (event.event_type === 'interaction.completed' && event.interaction?.id) {
        newInteractionId = event.interaction.id;
      }
    }

    return { fullText, interactionId: newInteractionId, engine: 'gemini-3.8-flash' };
  }

  // 2. Try Supabase Edge Function if configured
  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase.functions.invoke('ai-advisor', {
        body: { question, financialSummary: context, previousInteractionId }
      });
      if (!error && data?.reply) {
        onDelta(data.reply);
        return {
          fullText: data.reply,
          interactionId: data.interactionId || null,
          engine: 'supabase-edge'
        };
      }
    } catch {
      // Fallback below
    }
  }

  // 3. Context-Aware Simulated Streaming Response (Instant Local Demo)
  const topCat = context.topCategories[0];
  const overBudgetCats = context.topCategories.filter(
    (c) => c.budgetLimit && c.amount >= c.budgetLimit * 0.8
  );
  const ds = context.debtSummary;

  let simulatedReply = `Halo! Berdasarkan analisis *real-time* terhadap arus kas, anggaran, dan komitmen hutangmu bulan ini:\n\n`;
  simulatedReply += `• **Kesehatan Arus Kas**: Pemasukanmu tercatat **${formatIDR(context.monthlyIncome)}** dengan total pengeluaran **${formatIDR(context.monthlyExpense)}** (*Savings Rate* **${context.savingsRatePct}%**).\n`;

  if (ds) {
    simulatedReply += `• **Komitmen Hutang & Piutang**: Sisa pokok hutang aktifmu **${formatIDR(ds.totalPayableRemaining)}** dengan rasio cicilan (*Debt Service Ratio*) **${ds.debtServiceRatioPct}%** (${ds.debtServiceRatioPct < 30 ? 'Sehat < 30%' : 'Perlu Waspada'}). Tagihan wajib bulan ini yang belum dibayar sebesar **${formatIDR(ds.unpaidMonthlyObligation)}**, dan kamu memiliki piutang yang bisa ditagih sebesar **${formatIDR(ds.totalReceivableRemaining)}**.\n`;
  }

  if (topCat) {
    simulatedReply += `• **Pos Pengeluaran Terbesar**: Kategori **${topCat.name}** menyerap **${formatIDR(topCat.amount)}** (${topCat.percentage}% dari total pengeluaranmu).\n`;
  }

  if (overBudgetCats.length > 0) {
    simulatedReply += `• **Peringatan Anggaran**: Kategori **${overBudgetCats.map((c) => c.name).join(', ')}** sudah mendekati atau melampaui batas aman anggaran bulanan.\n`;
  } else {
    simulatedReply += `• **Status Anggaran**: Seluruh pos pengeluaran variabelmu masih berada di bawah ambang batas *alert* 80%.\n`;
  }

  simulatedReply += `\n**Rekomendasi Strategis Lucy:**\n`;
  if (ds && ds.unpaidMonthlyObligation > 0) {
    simulatedReply += `1. Prioritaskan penyisihan dana sebesar **${formatIDR(ds.unpaidMonthlyObligation)}** untuk melunasi cicilan yang jatuh tempo bulan ini agar *Safe-to-Spend* harianmu tetap akurat dan bebas denda keterlambatan.\n`;
  } else if (context.savingsRatePct < 20) {
    simulatedReply += `1. Usahakan menaikkan rasio tabungan ke minimal **20%** (${formatIDR(Math.round(context.monthlyIncome * 0.2))}) dengan membatasi transaksi impulsif harian.\n`;
  } else {
    simulatedReply += `1. Rasio tabunganmu (**${context.savingsRatePct}%**) sudah sangat sehat di atas standar ideal 20%! Kamu bisa mengalokasikan surplus ke kantong **Tabungan & Investasi**.\n`;
  }
  simulatedReply += `2. Gunakan metode **Debt Snowball** (lunasi sisa pokok terkecil dulu) untuk mempercepat kebebasan finansial, serta jangan lupa tindak lanjuti piutang yang jatuh tempo bulan ini.`;

  // Stream word by word for realistic < 100ms TTFT UX
  const words = simulatedReply.split(' ');
  let accumulated = '';
  for (let i = 0; i < words.length; i++) {
    const chunk = (i === 0 ? '' : ' ') + words[i];
    accumulated += chunk;
    onDelta(chunk);
    await new Promise((r) => setTimeout(r, 18));
  }

  return { fullText: accumulated, interactionId: null, engine: 'local-Contextual-AI' };
}


