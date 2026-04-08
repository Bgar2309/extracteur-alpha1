import Anthropic from '@anthropic-ai/sdk';
import { BL_EXTRACTION_PROMPT } from '../../lib/prompts';

export const config = {
  api: {
    bodyParser: { sizeLimit: '20mb' },
  },
};

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = 'claude-haiku-4-5-20251001';

async function extractFromPdf(pdfBase64, prompt) {
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });

  let responseText = '';
  for (const block of message.content) {
    if (block.type === 'text') responseText += block.text;
  }

  // Extraire la section RAISONNEMENT (entre "RAISONNEMENT:" et "JSON:")
  const reasoningMatch = responseText.match(/RAISONNEMENT\s*:\s*([\s\S]*?)(?=\nJSON\s*:)/i);
  const reasoning = reasoningMatch ? reasoningMatch[1].trim() : null;

  // Extraire le bloc JSON (après "JSON:")
  const jsonMatch = responseText.match(/JSON\s*:\s*([\s\S]*)/i);
  let jsonText = jsonMatch ? jsonMatch[1].trim() : responseText.trim();

  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/m, '').replace(/```\s*$/m, '').trim();
  }

  return { data: JSON.parse(jsonText), reasoning };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { blBase64 } = req.body;

    if (!blBase64) {
      return res.status(400).json({ error: 'Le PDF du bon de livraison (BL) est requis' });
    }

    const blResult = await extractFromPdf(blBase64, BL_EXTRACTION_PROMPT);

    return res.status(200).json({ success: true, bl: blResult.data, reasoning: blResult.reasoning });

  } catch (error) {
    console.error('Erreur extraction:', error);

    if (error instanceof SyntaxError) {
      return res.status(500).json({
        error: "Le modèle n'a pas retourné un JSON valide",
        details: error.message,
      });
    }

    return res.status(500).json({
      error: "Erreur lors de l'extraction",
      details: error.message,
    });
  }
}
