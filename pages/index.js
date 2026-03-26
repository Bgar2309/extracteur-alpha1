import { useState, useCallback } from 'react';
import Head from 'next/head';
import {
  processOrderLines,
  applyMarkingFees,
  generateOdooOutput,
} from '../lib/matchEquivalence';
import EQUIV_MAP from '../lib/equivalences.json';

export default function Home() {
  // PDFs
  const [blFile, setBlFile] = useState(null);
  const [blUrl, setBlUrl]   = useState(null);
  const [bcFile, setBcFile] = useState(null);
  const [bcUrl, setBcUrl]   = useState(null);
  const [showBcUpload, setShowBcUpload] = useState(false);

  // Extraction
  const [loading, setLoading]         = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [error, setError]             = useState(null);

  // Résultats
  const [blData, setBlData]               = useState(null);
  const [totalHt, setTotalHt]             = useState(null);
  const [processedLines, setProcessedLines] = useState(null);

  // UI
  const [activePdf, setActivePdf]   = useState('bl');
  const [showConfig, setShowConfig] = useState(false);
  const [copiedField, setCopiedField] = useState(null);

  // Configuration des frais — pré-remplie avec les refs EHS
  const [feeConfig, setFeeConfig] = useState({
    refMarquage: '910002',
    designationMarquage: 'Marquage / Sérigraphie',
    refFraisGestion: '999001',
    designationFraisGestion: 'Frais de gestion (marquage < 100 pcs)',
    refFraisEcran: '910001',
    designationFraisEcran: 'Ecran de sérigraphie',
    seuilFraisGestion: 100,
    inclureFraisEcran: true,
  });

  const totalRefs = Object.keys(EQUIV_MAP).length;

  // ── Gestion des PDFs ───────────────────────────────────────────────────────

  const handlePdfChange = useCallback((type, file) => {
    if (!file || file.type !== 'application/pdf') return;
    const url = URL.createObjectURL(file);
    if (type === 'bl') {
      if (blUrl) URL.revokeObjectURL(blUrl);
      setBlFile(file);
      setBlUrl(url);
      setActivePdf('bl');
    } else {
      if (bcUrl) URL.revokeObjectURL(bcUrl);
      setBcFile(file);
      setBcUrl(url);
      setActivePdf('bc');
    }
    setError(null);
    setBlData(null);
    setProcessedLines(null);
    setTotalHt(null);
  }, [blUrl, bcUrl]);

  // ── Drag and drop ──────────────────────────────────────────────────────────

  const makeDragHandlers = (type) => ({
    onDragOver:  (e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); },
    onDragLeave: (e) => e.currentTarget.classList.remove('drag-over'),
    onDrop: (e) => {
      e.preventDefault();
      e.currentTarget.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) handlePdfChange(type, file);
    },
  });

  // ── Extraction ─────────────────────────────────────────────────────────────

  const handleExtract = useCallback(async () => {
    if (!blFile) return;
    setLoading(true);
    setError(null);
    setBlData(null);
    setProcessedLines(null);
    setTotalHt(null);

    try {
      setLoadingStep('Préparation du BL...');
      const toBase64 = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const blBase64 = await toBase64(blFile);
      const bcBase64 = bcFile ? await toBase64(bcFile) : null;

      setLoadingStep('Extraction par Claude Haiku...');
      const response = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blBase64, bcBase64 }),
      });

      const data = await response.json();
      if (!data.success) {
        setError(data.error || "Erreur lors de l'extraction");
        return;
      }

      setBlData(data.bl);
      setTotalHt(data.total_ht);

      setLoadingStep('Matching des références...');
      const matched   = processOrderLines(data.bl.lignes || [], EQUIV_MAP);
      const withFees  = applyMarkingFees(matched, feeConfig);
      setProcessedLines(withFees);

    } catch (err) {
      setError('Erreur technique : ' + err.message);
    } finally {
      setLoading(false);
      setLoadingStep('');
    }
  }, [blFile, bcFile, feeConfig]);

  // ── Copie ──────────────────────────────────────────────────────────────────

  const copy = useCallback((text, fieldId) => {
    navigator.clipboard.writeText(String(text || '')).then(() => {
      setCopiedField(fieldId);
      setTimeout(() => setCopiedField(null), 1500);
    });
  }, []);

  const copyAll = useCallback(() => {
    if (!blData || !processedLines) return;
    const header = {
      numero_commande: blData.numero_commande,
      date: blData.date,
      client: blData.client,
      total_ht: totalHt,
    };
    const blAddr = {
      adresse_rue: blData.adresse_rue,
      code_postal: blData.code_postal,
      ville: blData.ville,
      telephone: blData.telephone,
      contact: blData.contact,
    };
    const text = generateOdooOutput(header, blAddr, processedLines);
    copy(text, 'all');
  }, [blData, totalHt, processedLines, copy]);

  // ── Stats ──────────────────────────────────────────────────────────────────

  const stats = processedLines ? {
    found:        processedLines.filter(l => l.status === 'found').length,
    notFound:     processedLines.filter(l => l.status === 'not_found').length,
    prixErrors:   processedLines.filter(l => l.prixMatch === 'error').length,
    prixWarnings: processedLines.filter(l => l.prixMatch === 'warning').length,
  } : null;

  const hasResults = blData && processedLines;

  // ── Rendu ──────────────────────────────────────────────────────────────────

  return (
    <>
      <Head>
        <title>Extracteur Prozon — EHS Group</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </Head>

      <div className="app">
        {/* ── Header ── */}
        <header className="header">
          <div className="header-inner">
            <div className="logo">
              <span className="logo-icon">📦</span>
              <div>
                <h1>Extracteur Prozon</h1>
                <p>EHS Group — {totalRefs} références chargées</p>
              </div>
            </div>
            <button className="config-btn" onClick={() => setShowConfig(s => !s)}>
              ⚙ Frais
            </button>
          </div>
        </header>

        <main className="main">

          {/* ── Config frais ── */}
          {showConfig && (
            <div className="config-panel">
              <h3>Configuration des frais de marquage</h3>
              <div className="config-grid">
                <label>Ref marquage<input value={feeConfig.refMarquage} onChange={e => setFeeConfig(c => ({ ...c, refMarquage: e.target.value }))} /></label>
                <label>Désignation marquage<input value={feeConfig.designationMarquage} onChange={e => setFeeConfig(c => ({ ...c, designationMarquage: e.target.value }))} /></label>
                <label>Ref frais gestion<input value={feeConfig.refFraisGestion} onChange={e => setFeeConfig(c => ({ ...c, refFraisGestion: e.target.value }))} /></label>
                <label>Seuil frais gestion (pcs)<input type="number" value={feeConfig.seuilFraisGestion} onChange={e => setFeeConfig(c => ({ ...c, seuilFraisGestion: parseInt(e.target.value) || 100 }))} /></label>
                <label>Ref écran sérigraphie<input value={feeConfig.refFraisEcran} onChange={e => setFeeConfig(c => ({ ...c, refFraisEcran: e.target.value }))} /></label>
                <label className="checkbox-label">
                  <input type="checkbox" checked={feeConfig.inclureFraisEcran} onChange={e => setFeeConfig(c => ({ ...c, inclureFraisEcran: e.target.checked }))} />
                  Inclure écran par défaut
                </label>
              </div>
            </div>
          )}

          {/* ── Upload ── */}
          <section className="section">
            <div className="section-header">
              <h2>Document PDF</h2>
            </div>

            {/* BL — principal */}
            <div className="upload-block">
              <label className="upload-label">BL — Bon de livraison Prozon <span className="required">requis</span></label>
              <div
                className={`drop-zone ${blFile ? 'loaded' : ''}`}
                onClick={() => document.getElementById('bl-input').click()}
                {...makeDragHandlers('bl')}
              >
                {blFile ? (
                  <><span className="drop-loaded">✓ {blFile.name}</span><br /><span className="drop-size">{(blFile.size / 1024).toFixed(0)} KB</span></>
                ) : (
                  <><span className="drop-icon">📋</span><br />Glisser le BL ici<br /><span className="drop-size">ou cliquer pour sélectionner</span></>
                )}
                <input id="bl-input" type="file" accept="application/pdf" style={{ display: 'none' }}
                  onChange={e => handlePdfChange('bl', e.target.files[0])} />
              </div>
            </div>

            {/* BC — optionnel (toggle) */}
            <div className="bc-toggle-row">
              <button className="bc-toggle-btn" onClick={() => setShowBcUpload(s => !s)}>
                {showBcUpload ? '▲ Masquer' : '▼ Ajouter le BC'} <span className="optional-tag">optionnel — pour les prix</span>
              </button>
            </div>

            {showBcUpload && (
              <div className="upload-block">
                <label className="upload-label">BC — Bon de commande Prozon <span className="optional">optionnel</span></label>
                <div
                  className={`drop-zone ${bcFile ? 'loaded' : ''}`}
                  onClick={() => document.getElementById('bc-input').click()}
                  {...makeDragHandlers('bc')}
                >
                  {bcFile ? (
                    <><span className="drop-loaded">✓ {bcFile.name}</span><br /><span className="drop-size">{(bcFile.size / 1024).toFixed(0)} KB</span></>
                  ) : (
                    <><span className="drop-icon">📄</span><br />Glisser le BC ici<br /><span className="drop-size">ou cliquer pour sélectionner</span></>
                  )}
                  <input id="bc-input" type="file" accept="application/pdf" style={{ display: 'none' }}
                    onChange={e => handlePdfChange('bc', e.target.files[0])} />
                </div>
              </div>
            )}

            <button
              className="extract-btn"
              onClick={handleExtract}
              disabled={!blFile || loading}
            >
              {loading
                ? <><span className="spinner" />{loadingStep || 'Extraction en cours...'}</>
                : <>⚡ Extraire la commande</>}
            </button>
          </section>

          {/* ── Erreur ── */}
          {error && (
            <div className="error-box"><strong>Erreur</strong><br />{error}</div>
          )}

          {/* ── Résultats ── */}
          {blUrl && (
            <section className="section results-section">
              <div className="section-header">
                <h2>
                  Résultats
                  {stats && (
                    <span style={{ marginLeft: '1rem', fontWeight: 400, fontSize: '0.9rem' }}>
                      <span className="badge-success">{stats.found} trouvés</span>
                      {stats.notFound  > 0 && <span className="badge-error">{stats.notFound} introuvables</span>}
                      {stats.prixErrors > 0 && <span className="badge-error">{stats.prixErrors} prix ≠</span>}
                      {stats.prixWarnings > 0 && <span className="badge-warning">{stats.prixWarnings} prix ~</span>}
                    </span>
                  )}
                </h2>
                {hasResults && (
                  <button className="copy-all-btn" onClick={copyAll}>
                    {copiedField === 'all' ? '✓ Copié !' : '📋 Tout copier pour Odoo'}
                  </button>
                )}
              </div>

              <div className="results-layout">
                {/* Viewer PDF */}
                <div className="pdf-panel">
                  {blUrl && bcUrl && (
                    <div className="pdf-tabs">
                      <button className={activePdf === 'bl' ? 'active' : ''} onClick={() => setActivePdf('bl')}>BL</button>
                      <button className={activePdf === 'bc' ? 'active' : ''} onClick={() => setActivePdf('bc')}>BC</button>
                    </div>
                  )}
                  <div className="pdf-viewer">
                    {activePdf === 'bl' && blUrl && <iframe src={blUrl} title="Bon de livraison" />}
                    {activePdf === 'bc' && bcUrl && <iframe src={bcUrl} title="Bon de commande" />}
                  </div>
                </div>

                {/* Données */}
                <div className="data-panel">
                  {!hasResults && !loading && (
                    <div className="pending-msg">Cliquez sur "Extraire" pour lancer l'analyse</div>
                  )}

                  {hasResults && (
                    <>
                      {/* En-tête commande */}
                      <div className="data-block">
                        <h3>Commande</h3>
                        <div className="fields-grid">
                          <Field label="N° commande" value={blData.numero_commande} onCopy={copy} id="num" copiedField={copiedField} />
                          <Field label="Date"        value={blData.date}            onCopy={copy} id="date" copiedField={copiedField} />
                          <Field label="Client"      value={blData.client}          onCopy={copy} id="client" copiedField={copiedField} />
                        </div>
                      </div>

                      {/* Adresse de livraison */}
                      <div className="data-block">
                        <h3>Adresse de livraison</h3>
                        <div className="fields-grid">
                          <Field label="Rue"         value={blData.adresse_rue}  onCopy={copy} id="rue"     copiedField={copiedField} />
                          <Field label="Code postal" value={blData.code_postal}  onCopy={copy} id="cp"      copiedField={copiedField} />
                          <Field label="Ville"       value={blData.ville}        onCopy={copy} id="ville"   copiedField={copiedField} />
                          <Field label="Téléphone"   value={blData.telephone}    onCopy={copy} id="tel"     copiedField={copiedField} />
                          <Field label="Contact"     value={blData.contact}      onCopy={copy} id="contact" copiedField={copiedField} />
                        </div>
                      </div>

                      {/* Lignes */}
                      <div className="data-block">
                        <h3>Lignes de commande</h3>
                        <div className="lines-table-wrap">
                          <table className="lines-table">
                            <thead>
                              <tr>
                                <th>Ref Prozon</th>
                                <th>Ref EHS</th>
                                <th>Désignation EHS</th>
                                <th>Qté</th>
                                <th>PU PDF</th>
                                <th>PU Table</th>
                                <th>Prix</th>
                                <th></th>
                              </tr>
                            </thead>
                            <tbody>
                              {processedLines.map((line, i) => (
                                <OrderLine key={i} line={line} onCopy={copy} copiedField={copiedField} idx={i} />
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {totalHt && (
                          <div className="total-row">
                            <span>Total HT (BC) :</span>
                            <span className="total-value">{totalHt} €</span>
                            <button className="copy-btn-sm" onClick={() => copy(totalHt, 'total')}>
                              {copiedField === 'total' ? '✓' : 'Copier'}
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </section>
          )}
        </main>

        {/* ── Styles ── */}
        <style jsx global>{`
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          html { font-size: 15px; }
          body {
            font-family: 'Inter', -apple-system, sans-serif;
            background: #0d0d1a;
            color: #e2e2ef;
            min-height: 100vh;
          }
          button { cursor: pointer; font-family: inherit; }
          input, select { font-family: inherit; }
        `}</style>

        <style jsx>{`
          .app { min-height: 100vh; }

          .header {
            background: rgba(255,255,255,0.03);
            border-bottom: 1px solid rgba(251,191,36,0.15);
            padding: 0.9rem 2rem;
            position: sticky; top: 0; z-index: 100;
            backdrop-filter: blur(12px);
          }
          .header-inner { max-width: 1900px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; }
          .logo { display: flex; align-items: center; gap: 0.9rem; }
          .logo-icon { font-size: 2rem; }
          .logo h1 { font-size: 1.4rem; font-weight: 700; color: #fbbf24; }
          .logo p { font-size: 0.78rem; color: #71717a; font-family: 'JetBrains Mono', monospace; }
          .config-btn {
            background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
            color: #a1a1aa; padding: 0.4rem 0.9rem; border-radius: 6px; font-size: 0.85rem; transition: all 0.2s;
          }
          .config-btn:hover { background: rgba(255,255,255,0.1); color: #e2e2ef; }

          .main { max-width: 1900px; margin: 0 auto; padding: 1.5rem 2rem; display: flex; flex-direction: column; gap: 1.25rem; }

          .config-panel {
            background: rgba(251,191,36,0.05); border: 1px solid rgba(251,191,36,0.2);
            border-radius: 10px; padding: 1.25rem;
          }
          .config-panel h3 { font-size: 0.9rem; font-weight: 600; color: #fbbf24; margin-bottom: 0.9rem; }
          .config-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.75rem; }
          .config-grid label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.8rem; color: #a1a1aa; }
          .config-grid input[type="text"], .config-grid input[type="number"] {
            background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1);
            border-radius: 6px; padding: 0.35rem 0.6rem; color: #e2e2ef; font-size: 0.85rem;
          }
          .checkbox-label { flex-direction: row !important; align-items: center; gap: 0.5rem; }
          .checkbox-label input { width: 15px; height: 15px; }

          .section {
            background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.07);
            border-radius: 12px; padding: 1.25rem;
          }
          .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem; }
          .section-header h2 { font-size: 1rem; font-weight: 600; color: #e2e2ef; display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }

          .upload-block { margin-bottom: 0.75rem; }
          .upload-label { display: block; font-size: 0.82rem; font-weight: 600; color: #a1a1aa; margin-bottom: 0.4rem; }
          .required { color: #fbbf24; font-weight: 700; }
          .optional { font-weight: 400; color: #52525b; }

          .drop-zone {
            border: 2px dashed rgba(251,191,36,0.25); border-radius: 10px; padding: 1.5rem;
            text-align: center; cursor: pointer; transition: all 0.2s;
            background: rgba(251,191,36,0.02); font-size: 0.88rem; color: #a1a1aa; line-height: 1.7;
          }
          .drop-zone:hover, .drop-zone.drag-over { border-color: rgba(251,191,36,0.6); background: rgba(251,191,36,0.06); }
          .drop-zone.loaded { border-color: rgba(16,185,129,0.4); background: rgba(16,185,129,0.04); }
          .drop-loaded { color: #6ee7b7; font-weight: 600; font-size: 0.88rem; }
          .drop-icon { font-size: 1.8rem; }
          .drop-size { font-size: 0.78rem; color: #52525b; }

          .bc-toggle-row { margin-bottom: 0.75rem; }
          .bc-toggle-btn {
            background: none; border: 1px solid rgba(255,255,255,0.08);
            color: #71717a; padding: 0.35rem 0.85rem; border-radius: 6px;
            font-size: 0.8rem; transition: all 0.2s;
          }
          .bc-toggle-btn:hover { color: #a1a1aa; border-color: rgba(255,255,255,0.15); }
          .optional-tag { color: #52525b; font-size: 0.75rem; margin-left: 0.4rem; }

          .extract-btn {
            width: 100%; padding: 0.9rem; font-size: 1rem; font-weight: 600;
            background: linear-gradient(135deg, #fbbf24, #f59e0b);
            color: #0d0d1a; border: none; border-radius: 10px; transition: all 0.25s;
            display: flex; align-items: center; justify-content: center; gap: 0.75rem;
            box-shadow: 0 4px 20px rgba(251,191,36,0.25);
          }
          .extract-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 25px rgba(251,191,36,0.4); }
          .extract-btn:disabled { opacity: 0.55; cursor: not-allowed; }
          .spinner { width: 18px; height: 18px; border: 2px solid rgba(13,13,26,0.3); border-top-color: #0d0d1a; border-radius: 50%; animation: spin 0.7s linear infinite; flex-shrink: 0; }
          @keyframes spin { to { transform: rotate(360deg); } }

          .error-box { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: 8px; padding: 1rem; color: #fca5a5; font-size: 0.88rem; }

          .badge-success { background: rgba(16,185,129,0.15); color: #6ee7b7; border: 1px solid rgba(16,185,129,0.3); padding: 0.15rem 0.55rem; border-radius: 10px; font-size: 0.78rem; font-weight: 600; }
          .badge-error   { background: rgba(239,68,68,0.15); color: #fca5a5; border: 1px solid rgba(239,68,68,0.3); padding: 0.15rem 0.55rem; border-radius: 10px; font-size: 0.78rem; font-weight: 600; }
          .badge-warning { background: rgba(251,191,36,0.15); color: #fcd34d; border: 1px solid rgba(251,191,36,0.3); padding: 0.15rem 0.55rem; border-radius: 10px; font-size: 0.78rem; font-weight: 600; }

          .results-section { padding: 1.25rem; }
          .copy-all-btn { background: rgba(16,185,129,0.15); border: 1px solid rgba(16,185,129,0.3); color: #6ee7b7; padding: 0.45rem 1rem; border-radius: 6px; font-size: 0.85rem; font-weight: 600; transition: all 0.2s; }
          .copy-all-btn:hover { background: rgba(16,185,129,0.25); }

          .results-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; }

          .pdf-panel { display: flex; flex-direction: column; }
          .pdf-tabs { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; }
          .pdf-tabs button { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #71717a; padding: 0.3rem 1rem; border-radius: 6px; font-size: 0.85rem; font-weight: 600; transition: all 0.2s; }
          .pdf-tabs button.active { background: rgba(251,191,36,0.15); border-color: rgba(251,191,36,0.4); color: #fbbf24; }
          .pdf-viewer { background: #111120; border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; overflow: hidden; flex: 1; min-height: 700px; }
          .pdf-viewer iframe { width: 100%; height: 100%; border: none; min-height: 700px; }

          .data-panel { display: flex; flex-direction: column; gap: 1rem; overflow-y: auto; max-height: 850px; }
          .pending-msg { color: #52525b; font-size: 0.9rem; text-align: center; padding: 2rem; }

          .data-block { background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; padding: 1rem; }
          .data-block h3 { font-size: 0.82rem; font-weight: 600; color: #fbbf24; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem; }
          .fields-grid { display: flex; flex-direction: column; gap: 0.4rem; }

          .lines-table-wrap { overflow-x: auto; }
          .lines-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
          .lines-table th { text-align: left; color: #71717a; font-weight: 500; padding: 0.3rem 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.08); white-space: nowrap; }
          .lines-table td { padding: 0.3rem 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.04); vertical-align: middle; }
          .lines-table tr:last-child td { border-bottom: none; }

          .total-row { display: flex; align-items: center; gap: 0.75rem; margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid rgba(255,255,255,0.08); font-size: 0.88rem; color: #a1a1aa; }
          .total-value { font-weight: 700; color: #fbbf24; font-size: 1rem; }
          .copy-btn-sm { background: rgba(251,191,36,0.1); border: 1px solid rgba(251,191,36,0.25); color: #fbbf24; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; transition: all 0.2s; }
          .copy-btn-sm:hover { background: rgba(251,191,36,0.2); }

          @media (max-width: 1200px) {
            .results-layout { grid-template-columns: 1fr; }
            .pdf-viewer { min-height: 500px; }
            .pdf-viewer iframe { min-height: 500px; }
            .data-panel { max-height: none; }
          }
          @media (max-width: 768px) {
            .main { padding: 1rem; }
          }
        `}</style>
      </div>
    </>
  );
}

// ── Sous-composants ──────────────────────────────────────────────────────────

function Field({ label, value, onCopy, id, copiedField }) {
  const display = value ?? '—';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
      <span style={{ color: '#71717a', minWidth: 110, flexShrink: 0 }}>{label}</span>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", color: '#e2e2ef', flex: 1, wordBreak: 'break-all' }}>
        {display}
      </span>
      {value && (
        <button
          style={{
            background: copiedField === id ? 'rgba(16,185,129,0.15)' : 'rgba(251,191,36,0.1)',
            border: `1px solid ${copiedField === id ? 'rgba(16,185,129,0.3)' : 'rgba(251,191,36,0.25)'}`,
            color: copiedField === id ? '#6ee7b7' : '#fbbf24',
            padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.72rem',
            fontWeight: 600, flexShrink: 0, transition: 'all 0.2s', cursor: 'pointer',
          }}
          onClick={() => onCopy(value, id)}
        >
          {copiedField === id ? '✓' : 'Copier'}
        </button>
      )}
    </div>
  );
}

function OrderLine({ line, onCopy, copiedField, idx }) {
  const isFee      = line.status === 'fee';
  const isNotFound = line.status === 'not_found';
  const isSecond   = line.composantIndex === 2;

  const rowStyle = {
    background: isFee      ? 'rgba(251,191,36,0.05)'
               : isNotFound ? 'rgba(239,68,68,0.05)'
               : isSecond   ? 'rgba(255,255,255,0.02)'
               : 'transparent',
  };

  const prixColor = { ok: '#6ee7b7', warning: '#fcd34d', error: '#fca5a5' }[line.prixMatch] || '#71717a';
  const prixLabel = { ok: '✓', warning: '~', error: '≠' }[line.prixMatch] || '—';

  const lineSummary = `${line.ehsRef || ''}\t${line.designation_ehs || ''}\t${line.quantite || ''}\t${line.prixTable ?? line.prixPdf ?? ''}`;

  return (
    <tr style={rowStyle}>
      <td style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', color: '#71717a' }}>
        {line.ref_prozon || ''}
        {isFee      && <span style={{ color: '#fbbf24', fontSize: '0.7rem', display: 'block' }}>{line.feeType}</span>}
        {isNotFound && <span style={{ color: '#fca5a5', fontSize: '0.7rem', display: 'block' }}>⚠ introuvable</span>}
      </td>
      <td style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.78rem', color: isNotFound ? '#fca5a5' : isSecond ? '#a1a1aa' : '#e2e2ef', fontWeight: isSecond ? 400 : 600 }}>
        {line.ehsRef || '?'}
      </td>
      <td style={{ fontSize: '0.8rem', color: '#d4d4d8', maxWidth: 200 }}>{line.designation_ehs || ''}</td>
      <td style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: '#fbbf24', textAlign: 'right' }}>{line.quantite}</td>
      <td style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.78rem', color: '#a1a1aa', textAlign: 'right' }}>{line.prixPdf != null ? line.prixPdf : ''}</td>
      <td style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.78rem', color: '#e2e2ef', textAlign: 'right' }}>{line.prixTable != null ? line.prixTable : ''}</td>
      <td style={{ textAlign: 'center', color: prixColor, fontWeight: 700, fontSize: '0.85rem' }}>{prixLabel}</td>
      <td>
        {!isFee && (
          <button
            style={{ background: copiedField === `line-${idx}` ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: copiedField === `line-${idx}` ? '#6ee7b7' : '#71717a', padding: '0.15rem 0.4rem', borderRadius: '3px', fontSize: '0.7rem', cursor: 'pointer' }}
            onClick={() => onCopy(lineSummary, `line-${idx}`)}
          >
            {copiedField === `line-${idx}` ? '✓' : 'Copier'}
          </button>
        )}
      </td>
    </tr>
  );
}
