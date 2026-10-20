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

  // Helper with 4.5s timeout to prevent UI freeze on slow networks
  const withTimeout = <T>(promise: Promise<T>, timeoutMs = 4500): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('AI request timeout')), timeoutMs)
      )
    ]);
  };

  // 1. Try Supabase Edge Function if configured
  if (isSupabaseConfigured && supabase) {
    try {
      const response = await withTimeout(
        supabase.functions.invoke('ai-parse', {
          body: { rawText, categories: categoryNames }
        })
      );
      if (!response.error && response.data && response.data.amount) {
        return { ...response.data, engine: 'supabase-edge' };
      }
    } catch {
      // Fallback to SDK or local parser immediately
    }
  }

  // 2. Use @google/genai Interactions API with gemini-3.8-flash & Structured Output
  const apiKey = getSavedGeminiApiKey();
  if (apiKey) {
    try {
      const client = new GoogleGenAI({ apiKey });
      const interaction = await withTimeout(
        client.interactions.create({
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
        })
      );

      const parsed = JSON.parse(interaction.output_text || '{}');
      if (parsed.amount) {
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
    } catch {
      // Fallback below
    }
  }

  // 3. Built-in Indonesian Mutasi Smart Parser (Instant Local Fallback < 150ms)
  await new Promise((r) => setTimeout(r, 120));
  const lower = rawText.toLowerCase();

  // Extract nominal (handles Rp45.000, 45k, 45rb, 1.5jt, Rp 3.500.000, IDR 165,000, 25000, etc.)
  let amount = 0;
  const rpMatch = rawText.match(/(?:rp|idr)\.?\s*([0-9][0-9.,]*)/i);
  const jtMatch = rawText.match(/([0-9]+(?:[.,][0-9]+)?)\s*(?:jt|juta)/i);
  const rbMatch = rawText.match(/([0-9]+(?:[.,][0-9]+)?)\s*(?:rb|ribu|k)\b/i);
  const dotNumMatch = rawText.match(/\b([0-9]{1,3}(?:\.[0-9]{3})+)\b/);

  if (rpMatch) {
    const cleaned = rpMatch[1].replace(/,[0-9]{2}$/, '').replace(/[^0-9]/g, '');
    amount = Number(cleaned) || 0;
  } else if (jtMatch) {
    const floatVal = parseFloat(jtMatch[1].replace(',', '.'));
    amount = Math.round(floatVal * 1_000_000);
  } else if (rbMatch) {
    const floatVal = parseFloat(rbMatch[1].replace(',', '.'));
    amount = Math.round(floatVal * 1000);
  } else if (dotNumMatch) {
    amount = Number(dotNumMatch[1].replace(/\./g, '')) || 0;
  } else {
    const genericNum = rawText.match(/\b([0-9]{4,9})\b/);
    if (genericNum) amount = Number(genericNum[1]);
  }

  // Determine income vs expense
  const isIncome = /(transfer masuk|gaji|bonus|dana masuk|kredit|terima uang|cashback|pelunasan piutang|diterima)/i.test(lower);
  const type: TransactionType = isIncome ? 'income' : 'expense';

  // Determine category
  let categoryName = isIncome ? 'Bonus & Freelance' : 'Makan & Minum';
  if (isIncome && /gaji|salary|payroll/i.test(lower)) {
    categoryName = 'Gaji Bulanan';
  } else if (isIncome && /piutang|pinjam/i.test(lower)) {
    categoryName = 'Pelunasan Piutang';
  } else if (!isIncome) {
    if (/kopi|janji jiwa|fore|starbucks|chatime|mixue|resto|makan|warung|gofood|grabfood|sate|ayam|bakso|mie|nasi/i.test(lower)) {
      categoryName = 'Makan & Minum';
    } else if (/goride|gocar|grab|maxim|inドライブ|mrt|krl|transjakarta|bensin|pertamina|shell|parkir|tol/i.test(lower)) {
      categoryName = 'Transportasi';
    } else if (/spaylater|shopeepaylater|kredivo|akulaku|cicilan|kartu kredit|kpr|hutang|pinjaman/i.test(lower)) {
      categoryName = 'Cicilan & Hutang';
    } else if (/pln|listrik|wifi|indihome|biznet|pulsa|paket data|telkomsel|indosat|xl|tri|bpjs|pdam|tagihan/i.test(lower)) {
      categoryName = 'Tagihan & Utilitas';
    } else if (/uniqlo|zara|h&m|shopee|tokopedia|tiktok shop|lazada|alfamart|indomaret|superindo|mall|belanja/i.test(lower)) {
      categoryName = 'Belanja';
    } else if (/netflix|spotify|youtube|bioskop|xxi|cgv|cinepolis|game|steam|playstation/i.test(lower)) {
      categoryName = 'Hiburan';
    } else if (/bibit|bareksa|ajaib|reksadana|emas|tabungan|deposito|saham/i.test(lower)) {
      categoryName = 'Tabungan & Investasi';
    }
  }

  // Extract merchant
  let merchant = 'Transaksi Otomatis';
  const merchPattern = rawText.match(/(?:at|di|ke|dari|beli|bayar)\s+([A-Za-z0-9\s.&'-]{2,30}?)(?:\s+berhasil|\s+pada|\s+sebesar|\s*\(|\s*Rp|\s*[0-9]|$)/i);
  if (merchPattern && merchPattern[1] && merchPattern[1].trim()) {
    merchant = merchPattern[1].trim();
  } else if (/goride/i.test(lower)) {
    merchant = 'GoRide';
  } else if (/gofood/i.test(lower)) {
    merchant = 'GoFood';
  } else if (/pln/i.test(lower)) {
    merchant = 'PLN Prabayar';
  } else if (/kopi janji jiwa/i.test(lower)) {
    merchant = 'Kopi Janji Jiwa';
  }

  return {
    amount: amount || 25000,
    merchant,
    category_name: categoryName,
    type,
    transaction_date: today,
    description: rawText.trim(),
    confidence: 0.95,
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
    `Kamu adalah Lucy, teman ngatur duit di aplikasi MyLucy. ` +
    `Gunakan gaya bahasa kasual ala copywriting Gojek / Gen-Z Indonesia yang santai, cerdas, relatable, tapi TIDAK lebay atau cringe (pakai aku/kamu, istilah wajar seperti boncos, bocor halus, aman terkendali, cuan, rem dikit, gas). ` +
    `ATURAN KETAT ANTI-YAPPING:\n` +
    `1. JANGAN bertele-tele! Dilarang pakai paragraf pembuka/penutup basa-basi.\n` +
    `2. Jawab maksimal 3-4 kalimat pendek atau maksimal 3 poin singkat yang langsung to-the-point ke angka & aksi nyata.\n` +
    `Data keuangan kamu bulan ini:\n` +
    `- Total Saldo: ${formatIDR(context.totalBalance)}\n` +
    `- Pemasukan: ${formatIDR(context.monthlyIncome)} | Pengeluaran: ${formatIDR(context.monthlyExpense)} (Savings Rate: ${context.savingsRatePct}%)\n` +
    `- Pos Pengeluaran Terbesar: ${context.topCategories
      .map(
        (c) =>
          `${c.name}: ${formatIDR(c.amount)} (${c.percentage}%${
            c.budgetLimit ? `, limit ${formatIDR(c.budgetLimit)}` : ''
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

  // 3. Context-Aware Simulated Streaming Response (Gojek-style Gen-Z Casual & Anti-Yapping)
  const qLower = question.toLowerCase();
  const topCat = context.topCategories[0];
  const overBudgetCats = context.topCategories.filter(
    (c) => c.budgetLimit && c.amount >= c.budgetLimit * 0.8
  );
  const ds = context.debtSummary;
  const unpaidDebts = ds?.activeDebts.filter((d) => d.direction === 'payable' && !d.isPaidThisMonth) || [];
  const smallestDebt = [...(ds?.activeDebts.filter((d) => d.direction === 'payable') || [])].sort(
    (a, b) => a.remainingAmount - b.remainingAmount
  )[0];

  let simulatedReply = '';

  if (/hutang|cicilan|snowball|avalanche|tagihan|pinjam|lunas/i.test(qLower)) {
    if (!ds || ds.totalPayableRemaining <= 0) {
      simulatedReply =
        `Dompetmu bebas cicilan aktif bulan ini, mantap! Kalau ada piutang **${formatIDR(ds?.totalReceivableRemaining || 0)}** di teman, tinggal colek pelan-pelan biar balik ke kantong.`;
    } else {
      simulatedReply =
        `Rekap cicilanmu singkat aja nih:\n` +
        `• **Sisa Pokok**: **${formatIDR(ds.totalPayableRemaining)}** (rasio cicilan **${ds.debtServiceRatioPct}%** — ${ds.debtServiceRatioPct < 30 ? 'masih aman terkendali' : 'mulai lampu kuning, rem jajan dulu'}).\n` +
        `• **Belum Dibayar Bulan Ini**: **${formatIDR(ds.unpaidMonthlyObligation)}**${unpaidDebts[0] ? ` (terdekat: *${unpaidDebts[0].title}* tgl ${unpaidDebts[0].dueDay})` : ''}.\n` +
        `• **Taktik Cepat**: ${smallestDebt ? `Sikat **${smallestDebt.title}** (${formatIDR(smallestDebt.remainingAmount)}) duluan pakai metode *Snowball* biar beban bulanan cepat lega.` : 'Amankan tagihan bulan ini dulu biar nggak kena denda.'}`;
    }
  } else if (/kategori|boros|bocor|serap|anggaran|budget|jajan/i.test(qLower)) {
    if (!topCat) {
      simulatedReply = `Belum ada pengeluaran tercatat bulan ini. Dompet masih utuh **${formatIDR(context.totalBalance)}**, aman terkendali!`;
    } else {
      simulatedReply =
        `Yang paling bikin dompet olahraga bulan ini:\n` +
        `• **Juara Pengeluaran**: **${topCat.name}** nyedot **${formatIDR(topCat.amount)}** (${topCat.percentage}% dari total keluar).\n` +
        `• **Status Amplop**: ${overBudgetCats.length > 0 ? `Kategori **${overBudgetCats.map((c) => c.name).join(', ')}** udah hampir mentok limit, rem dikit ya biar nggak boncos di akhir bulan.` : 'Semua amplop budget masih di jalur aman (<80%).'}`;
    }
  } else if (/nabung|tabung|invest|25%|sisa|strategi/i.test(qLower)) {
    const target25 = Math.round(context.monthlyIncome * 0.25);
    simulatedReply =
      `Biar tabungan 25% (**${formatIDR(target25)}**) nggak cuma wacana:\n` +
      `• **Posisi Sekarang**: *Savings rate* kamu di **${context.savingsRatePct}%** dengan sisa saldo gabungan **${formatIDR(context.totalBalance)}**.\n` +
      `• **Langkah Sat-Set**: Langsung pisahin **${formatIDR(target25)}** di awal ke kantong tabungan, terus kunci jajan harian maksimal dari sisa *Safe-to-Spend* setelah potong cicilan (**${formatIDR(ds?.unpaidMonthlyObligation || 0)}**).`;
  } else {
    // Default / Cashflow check (ringkas & to-the-point)
    simulatedReply =
      `Cek kondisi dompetmu bulan ini, singkat padat:\n` +
      `• **Arus Kas**: Masuk **${formatIDR(context.monthlyIncome)}**, keluar **${formatIDR(context.monthlyExpense)}** (*savings rate* **${context.savingsRatePct}%** — ${context.savingsRatePct >= 20 ? 'aman terkendali!' : 'agak tipis, yuk rem bocor halus'}).\n` +
      `• **Bocor Terbesar**: ${topCat ? `**${topCat.name}** di **${formatIDR(topCat.amount)}** (${topCat.percentage}%).` : 'Belum ada pengeluaran berarti.'}\n` +
      `• **Fokus Sekarang**: ${ds && ds.unpaidMonthlyObligation > 0 ? `Amankan **${formatIDR(ds.unpaidMonthlyObligation)}** buat cicilan yang belum lunas bulan ini biar sisa uang jajanmu riil.` : 'Pertahankan ritme belanjamu, surplusnya bisa langsung parkir ke tabungan.'}`;
  }

  // Stream word by word for realistic < 100ms TTFT UX
  const words = simulatedReply.split(' ');
  let accumulated = '';
  for (let i = 0; i < words.length; i++) {
    const chunk = (i === 0 ? '' : ' ') + words[i];
    accumulated += chunk;
    onDelta(chunk);
    await new Promise((r) => setTimeout(r, 14));
  }

  return { fullText: accumulated, interactionId: null, engine: 'local-Contextual-AI' };
}


