// Supabase Edge Function: /functions/v1/ai-advisor
// Menggunakan @google/genai Interactions API (gemini-3.8-flash) dengan Context Aggregation
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

    const { question, financialSummary, previousInteractionId } = await req.json();
    const client = new GoogleGenAI({ apiKey });

    const systemPrompt =
      `Kamu adalah Lucy, teman ngatur duit di aplikasi MyLucy. ` +
      `Gunakan gaya bahasa kasual ala copywriting Gojek / Gen-Z Indonesia yang santai, cerdas, relatable, tapi TIDAK lebay atau cringe (pakai aku/kamu, istilah wajar seperti boncos, bocor halus, aman terkendali, cuan, rem dikit, gas). ` +
      `ATURAN ANTI-YAPPING: Jangan bertele-tele, tanpa pembuka/penutup panjang, jawab maksimal 3-4 kalimat atau maksimal 3 poin singkat yang langsung to-the-point ke angka & solusi nyata.\n` +
      `Data keuangan pengguna:\n` +
      `${JSON.stringify(financialSummary, null, 2)}`;

    const interaction = await client.interactions.create({
      model: 'gemini-3.5-flash-lite',
      system_instruction: systemPrompt,
      input: question,
      ...(previousInteractionId ? { previous_interaction_id: previousInteractionId } : {})
    });

    return new Response(
      JSON.stringify({
        reply: interaction.output_text,
        interactionId: interaction.id
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Gagal menghubungi Lucy Advisor' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

