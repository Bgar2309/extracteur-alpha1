import Anthropic from '@anthropic-ai/sdk';
import { BC_EXTRACTION_PROMPT, BL_EXTRACTION_PROMPT } from '../../lib/prompts';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb',
    },
  },
};

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = 'claude-haiku-4-5-20251001';

/**
 * Appelle Claude Haiku avec un PDF en base64 et un prompt
 * Retourne le JSON parsé ou lance une erreur
 */
async function extractFromPdf(pdfBase64, prompt) {
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBase64,
            },
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
  });

  // Extraire le texte de la réponse
  let responseText = '';
  for (const block of message.content) {
    if (block.type === 'text') responseText += block.text;
  }

  // Nettoyer les éventuels blocs markdown
  let jsonText = responseText.trim();
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/m, '').replace(/```\s*$/m, '').trim();
  }

  return JSON.parse(jsonText);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { bcBase64, blBase64 } = req.body;

    if (!bcBase64) {
      return res.status(400).json({ error: 'Le PDF du bon de commande (BC) est requis' });
    }

    // Extraction parallèle BC + BL
    const tasks = [extractFromPdf(bcBase64, BC_EXTRACTION_PROMPT)];
    if (blBase64) {
      tasks.push(extractFromPdf(blBase64, BL_EXTRACTION_PROMPT));
    }

    const results = await Promise.all(tasks);
    const bcData = results[0];
    const blData = blBase64 ? results[1] : null;

    return res.status(200).json({
      success: true,
      bc: bcData,
      bl: blData,
    });

  } catch (error) {
    console.error('Erreur extraction:', error);

    // Distinguer les erreurs JSON des erreurs API
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
