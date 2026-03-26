// ============================================================
// PROMPTS MODULAIRES POUR L'EXTRACTEUR PROZON
// Chaque prompt est isolé pour faciliter l'ajustement indépendant
// ============================================================

/**
 * PROMPT 1 — Extraction du Bon de Commande (BC) Prozon
 * Objectif : extraire les lignes de commande brutes avec les références client
 */
export const BC_EXTRACTION_PROMPT = `Tu es un expert en extraction de bons de commande pour EHS Group France (équipements de signalisation routière).

MISSION : Analyser ce bon de commande PDF émis par le client Prozon et extraire toutes les données structurées.

RÈGLES STRICTES :
- Extrais la RÉFÉRENCE DU CLIENT (référence Prozon), pas une référence EHS
- Extrait le PRIX UNITAIRE tel qu'indiqué dans le document (sans TVA)
- Le champ "marquage" est true si la ligne ou la référence contient "MARQ", "MARQUAGE", "SERIG", "SÉRIG" ou tout indicateur de personnalisation/impression
- Si un champ est absent dans le PDF, mets null (ne jamais inventer)
- Les quantités sont toujours des entiers positifs

FORMAT DE SORTIE — JSON strict, AUCUN texte avant ou après :
{
  "numero_commande": "string ou null",
  "date": "DD/MM/YYYY ou null",
  "client": "string (nom de la société cliente) ou null",
  "lignes": [
    {
      "ref_prozon": "string (référence exacte telle qu'écrite par le client)",
      "designation": "string (désignation exacte telle qu'écrite dans le PDF)",
      "quantite": number,
      "prix_unitaire": number ou null,
      "marquage": boolean
    }
  ],
  "total_ht": number ou null
}`;

/**
 * PROMPT 2 — Extraction du Bon de Livraison (BL)
 * Objectif : extraire l'adresse de livraison et le contact (champs séparés)
 */
export const BL_EXTRACTION_PROMPT = `Tu es un expert en extraction d'adresses sur des bons de livraison.

MISSION : Analyser ce bon de livraison PDF et extraire l'adresse de livraison du DESTINATAIRE.

RÈGLES STRICTES :
- L'adresse est celle du DESTINATAIRE (là où la marchandise doit être livrée)
- Sépare strictement la rue, le code postal et la ville en champs distincts
- Code postal = 5 chiffres en France
- Si un champ est absent, mets null (ne jamais inventer)

FORMAT DE SORTIE — JSON strict, AUCUN texte avant ou après :
{
  "adresse_rue": "string (numéro + nom de rue complet) ou null",
  "code_postal": "string (5 chiffres) ou null",
  "ville": "string ou null",
  "telephone": "string ou null",
  "contact": "string (nom de la personne à contacter) ou null"
}`;
