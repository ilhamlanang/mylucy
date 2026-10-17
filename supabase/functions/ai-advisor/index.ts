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
      `Kamu adalah Lucy, AI Financial Advisor pribadi di aplikasi MyLucy. ` +
      `Berikan saran keuangan yang ramah, praktis, terukur, dan relevan dengan konteks pengguna di Indonesia (dalam Bahasa Indonesia). ` +
      `Gunakan data agregasi keuangan pengguna berikut sebagai acuan analisis:\n` +
      `${JSON.stringify(financialSummary, null, 2)}`;

    const interaction = await client.interactions.create({
      model: 'gemini-3.8-flash',
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

