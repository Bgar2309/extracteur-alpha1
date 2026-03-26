// ============================================================
// MATCHING DE RÉFÉRENCES ET CALCULS PROZON → EHS
// Traitement programmatique (pas d'IA) après extraction Claude
// ============================================================

/**
 * Normalise une référence pour la comparaison
 * Supprime espaces, tirets, points et met en minuscules
 */
function normalizeRef(ref) {
  if (!ref) return '';
  return String(ref).toLowerCase().replace(/[\s\-_.\/]/g, '');
}

/**
 * Cherche une correspondance dans la table d'équivalence
 * D'abord match exact, puis match normalisé
 * @param {string} prozonRef - Référence Prozon brute
 * @param {Object} equivalenceMap - Map { normalizedRef: entry }
 * @returns {{ found: boolean, entry: Object|null, matchType: string }}
 */
export function matchReference(prozonRef, equivalenceMap) {
  if (!prozonRef || !equivalenceMap) return { found: false, entry: null, matchType: 'none' };

  // Exact match (case-insensitive)
  const keyExact = prozonRef.trim().toLowerCase();
  if (equivalenceMap[keyExact]) {
    return { found: true, entry: equivalenceMap[keyExact], matchType: 'exact' };
  }

  // Normalized match (ignore spaces, dashes, dots)
  const keyNorm = normalizeRef(prozonRef);
  for (const [k, v] of Object.entries(equivalenceMap)) {
    if (normalizeRef(k) === keyNorm) {
      return { found: true, entry: v, matchType: 'normalized' };
    }
  }

  return { found: false, entry: null, matchType: 'none' };
}

/**
 * Traite les lignes de commande extraites :
 * - Match les références Prozon → EHS
 * - Gère les produits composés (2 refs EHS pour 1 ref Prozon)
 * - Vérifie les prix
 * - Explose les lignes composées en 2 lignes séparées
 *
 * @param {Array} rawLines - Lignes brutes extraites par Claude du BC
 * @param {Object} equivalenceMap - Table d'équivalence parsée
 * @returns {Array} Lignes traitées
 */
export function processOrderLines(rawLines, equivalenceMap) {
  if (!rawLines) return [];
  const processed = [];

  for (const line of rawLines) {
    const { found, entry, matchType } = matchReference(line.ref_prozon, equivalenceMap);

    if (!found || !entry) {
      // Référence non trouvée dans la table
      processed.push({
        ...line,
        ehsRef1: null,
        ehsRef2: null,
        designation_ehs: line.designation,
        prixTable: null,
        prixPdf: line.prix_unitaire,
        prixMatch: null,
        status: 'not_found',
        matchType: 'none',
      });
      continue;
    }

    // Vérification croisée du prix
    const prixPdf = line.prix_unitaire;
    const prixTable = entry.prixUnitaire;
    let prixMatch = null;
    if (prixPdf !== null && prixTable !== null) {
      const diff = Math.abs(prixPdf - prixTable);
      const pct = prixTable > 0 ? (diff / prixTable) * 100 : 0;
      prixMatch = pct < 1 ? 'ok' : pct < 5 ? 'warning' : 'error';
    }

    // Ligne principale (ref EHS 1)
    processed.push({
      ref_prozon: line.ref_prozon,
      designation_prozon: line.designation,
      ehsRef: entry.ehsRef1,
      designation_ehs: entry.designation || line.designation,
      quantite: line.quantite,
      prixPdf,
      prixTable,
      prixMatch,
      marquage: line.marquage,
      status: 'found',
      matchType,
      isCompound: !!entry.ehsRef2,
      composantIndex: 1,
    });

    // Ligne secondaire si produit composé (ex: cône + base)
    if (entry.ehsRef2) {
      processed.push({
        ref_prozon: line.ref_prozon,
        designation_prozon: line.designation,
        ehsRef: entry.ehsRef2,
        designation_ehs: entry.designation2 || entry.designation || line.designation,
        quantite: line.quantite,
        prixPdf: null,
        prixTable: null,
        prixMatch: null,
        marquage: false,
        status: 'found',
        matchType,
        isCompound: true,
        composantIndex: 2,
      });
    }
  }

  return processed;
}

/**
 * Ajoute les lignes de frais de marquage, de gestion et d'écran
 *
 * @param {Array} processedLines - Lignes déjà matchées
 * @param {Object} config - Configuration des frais
 * @returns {Array} Lignes avec frais ajoutés
 */
export function applyMarkingFees(processedLines, config = {}) {
  const {
    refMarquage = '910.0.0.2',
    designationMarquage = 'Marquage / Sérigraphie',
    refFraisGestion = '',
    designationFraisGestion = 'Frais de gestion (marquage < 100 pcs)',
    refFraisEcran = '',
    designationFraisEcran = "Frais d'écran",
    seuilFraisGestion = 100,
    inclureFraisEcran = true,
  } = config;

  const result = [];
  let hasAnyMarquage = false;

  for (const line of processedLines) {
    result.push(line);

    if (line.marquage && line.status === 'found' && line.composantIndex !== 2) {
      hasAnyMarquage = true;

      // Ligne de marquage
      if (refMarquage) {
        result.push({
          ref_prozon: null,
          designation_prozon: null,
          ehsRef: refMarquage,
          designation_ehs: designationMarquage,
          quantite: line.quantite,
          prixPdf: null,
          prixTable: null,
          prixMatch: null,
          marquage: false,
          status: 'fee',
          feeType: 'marquage',
          isCompound: false,
          composantIndex: null,
        });
      }

      // Frais de gestion si qty < seuil
      if (refFraisGestion && line.quantite < seuilFraisGestion) {
        result.push({
          ref_prozon: null,
          designation_prozon: null,
          ehsRef: refFraisGestion,
          designation_ehs: designationFraisGestion,
          quantite: 1,
          prixPdf: null,
          prixTable: null,
          prixMatch: null,
          marquage: false,
          status: 'fee',
          feeType: 'gestion',
          isCompound: false,
          composantIndex: null,
        });
      }
    }
  }

  // Frais d'écran (une seule fois par commande)
  if (inclureFraisEcran && refFraisEcran && hasAnyMarquage) {
    result.push({
      ref_prozon: null,
      designation_prozon: null,
      ehsRef: refFraisEcran,
      designation_ehs: designationFraisEcran,
      quantite: 1,
      prixPdf: null,
      prixTable: null,
      prixMatch: null,
      marquage: false,
      status: 'fee',
      feeType: 'ecran',
      isCompound: false,
      composantIndex: null,
    });
  }

  return result;
}

/**
 * Parse la table d'équivalence Excel (structure flexible)
 * Détecte automatiquement les colonnes via les en-têtes
 *
 * @param {Array} rows - Lignes du fichier Excel (tableau 2D)
 * @returns {{ map: Object, headers: Array, colMap: Object, preview: Array, totalRefs: number }}
 */
export function buildEquivalenceMap(rows) {
  if (!rows || rows.length < 2) return { map: {}, headers: [], colMap: {}, preview: [], totalRefs: 0 };

  // Trouver la ligne d'en-tête (première ligne non vide)
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    if (rows[i].some(cell => cell && String(cell).trim().length > 0)) {
      headerRowIdx = i;
      break;
    }
  }

  const headers = rows[headerRowIdx].map(h => String(h || '').trim());
  const colMap = detectColumns(headers);

  const map = {};
  const preview = [];

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const prozonRef = colMap.prozon >= 0 ? String(row[colMap.prozon] || '').trim() : '';

    if (!prozonRef) continue;

    const entry = {
      ehsRef1: colMap.ehs1 >= 0 ? String(row[colMap.ehs1] || '').trim() : '',
      ehsRef2: colMap.ehs2 >= 0 ? String(row[colMap.ehs2] || '').trim() : '',
      designation: colMap.designation >= 0 ? String(row[colMap.designation] || '').trim() : '',
      designation2: colMap.designation2 >= 0 ? String(row[colMap.designation2] || '').trim() : '',
      prixUnitaire: colMap.prix >= 0 ? parseFloat(String(row[colMap.prix] || '').replace(',', '.')) || null : null,
      notes: colMap.notes >= 0 ? String(row[colMap.notes] || '').trim() : '',
    };

    // Clé = référence Prozon en minuscules (pour matching insensible à la casse)
    map[prozonRef.toLowerCase()] = { ...entry, prozonRef };

    if (preview.length < 8) {
      preview.push({ prozonRef, ...entry });
    }
  }

  return { map, headers, colMap, preview, totalRefs: Object.keys(map).length };
}

/**
 * Détecte automatiquement les colonnes d'un fichier Excel via les en-têtes
 */
function detectColumns(headers) {
  const colMap = {
    prozon: -1, // Référence Prozon/client
    ehs1: -1,   // Référence EHS principale
    ehs2: -1,   // Référence EHS secondaire (produit composé)
    designation: -1,  // Désignation EHS principale
    designation2: -1, // Désignation EHS secondaire
    prix: -1,   // Prix unitaire
    notes: -1,  // Notes/remarques
  };

  headers.forEach((h, i) => {
    const lower = h.toLowerCase();

    // Référence Prozon (client)
    if (colMap.prozon < 0 && (
      lower.includes('prozon') || lower.includes('prozone') ||
      lower.includes('client') || lower.includes('fournisseur') ||
      lower.includes('ref client') || lower.includes('référence client') ||
      lower === 'ref' || lower === 'référence'
    )) colMap.prozon = i;

    // Référence EHS
    if (lower.includes('ehs')) {
      if (colMap.ehs1 < 0) colMap.ehs1 = i;
      else if (colMap.ehs2 < 0) colMap.ehs2 = i;
    }

    // Désignation
    if (lower.includes('désignation') || lower.includes('designation') ||
        lower.includes('libellé') || lower.includes('produit') ||
        lower.includes('description')) {
      if (colMap.designation < 0) colMap.designation = i;
      else if (colMap.designation2 < 0) colMap.designation2 = i;
    }

    // Prix
    if (colMap.prix < 0 && (
      lower.includes('prix') || lower.includes('tarif') ||
      lower.includes('pu') || lower.includes('unitaire') ||
      lower === 'p.u.' || lower === 'ht'
    )) colMap.prix = i;

    // Notes
    if (colMap.notes < 0 && (
      lower.includes('note') || lower.includes('remarque') ||
      lower.includes('commentaire') || lower.includes('observation')
    )) colMap.notes = i;
  });

  return colMap;
}

/**
 * Génère le texte de sortie structuré pour Odoo
 */
export function generateOdooOutput(header, blData, processedLines) {
  const lines = [];

  // En-tête commande
  lines.push('=== COMMANDE ===');
  lines.push(`N° commande Prozon : ${header.numero_commande || ''}`);
  lines.push(`Date : ${header.date || ''}`);
  lines.push(`Client : ${header.client || ''}`);
  lines.push('');

  // Adresse de livraison
  if (blData) {
    lines.push('=== ADRESSE DE LIVRAISON ===');
    lines.push(`Rue : ${blData.adresse_rue || ''}`);
    lines.push(`Code postal : ${blData.code_postal || ''}`);
    lines.push(`Ville : ${blData.ville || ''}`);
    lines.push(`Téléphone : ${blData.telephone || ''}`);
    lines.push(`Contact : ${blData.contact || ''}`);
    lines.push('');
  }

  // Lignes de commande
  lines.push('=== LIGNES DE COMMANDE ===');
  lines.push('Ref EHS\tDésignation\tQuantité\tPrix unitaire\tTotal');
  for (const line of processedLines) {
    const pu = line.prixTable || line.prixPdf || '';
    const total = pu && line.quantite ? (parseFloat(pu) * line.quantite).toFixed(2) : '';
    lines.push(`${line.ehsRef || ''}\t${line.designation_ehs || ''}\t${line.quantite || ''}\t${pu}\t${total}`);
  }

  lines.push('');
  lines.push(`=== TOTAL HT : ${header.total_ht || ''} ===`);

  return lines.join('\n');
}
