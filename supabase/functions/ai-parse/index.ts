// Supabase Edge Function: /functions/v1/ai-parse
// Menggunakan @google/genai Interactions API (gemini-3.8-flash) dengan Structured Output (JSON Schema)
import { GoogleGenAI } from 'npm:@google/genai';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY belum dikonfigurasi pada Supabase Secrets.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { rawText, categories } = await req.json();
    if (!rawText || typeof rawText !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Parameter rawText wajib diisi.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const client = new GoogleGenAI({ apiKey });
    const categoryNames = Array.isArray(categories) && categories.length > 0
      ? categories.join(', ')
      : 'Makan & Minum, Transportasi, Belanja, Tagihan & Utilitas, Hiburan, Tabungan & Investasi, Gaji Bulanan, Bonus & Freelance';

    const interaction = await client.interactions.create({
      model: 'gemini-3.8-flash',
      system_instruction:
        `Kamu adalah mesin parser transaksi perbankan dan e-wallet Indonesia (GoPay, OVO, ShopeePay, QRIS, BCA, Mandiri, BRI). ` +
        `Ekstrak nominal (dalam angka bulat Rupiah tanpa titik/koma), nama merchant, tanggal transaksi (YYYY-MM-DD, gunakan tanggal hari ini jika tidak disebutkan), ` +
        `jenis transaksi ('income' atau 'expense'), serta pilih nama kategori yang paling relevan dari daftar berikut: [${categoryNames}].`,
      input: rawText,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: {
          type: 'object',
          properties: {
            amount: { type: 'integer', description: 'Nominal transaksi dalam angka bulat Rupiah (IDR)' },
            merchant: { type: 'string', description: 'Nama toko, merchant, atau pengirim/penerima' },
            category_name: { type: 'string', description: 'Nama kategori yang paling cocok dari daftar kategori' },
            type: { type: 'string', enum: ['income', 'expense'], description: 'Jenis transaksi pemasukan atau pengeluaran' },
            transaction_date: { type: 'string', description: 'Tanggal transaksi dalam format YYYY-MM-DD' },
            description: { type: 'string', description: 'Ringkasan singkat transaksi' },
            confidence: { type: 'number', description: 'Tingkat keyakinan ekstraksi antara 0.0 hingga 1.0' }
          },
          required: ['amount', 'merchant', 'category_name', 'type', 'transaction_date', 'description', 'confidence']
        }
      }
    });

    const parsed = JSON.parse(interaction.output_text || '{}');

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Gagal memproses Smart Parsing AI' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

