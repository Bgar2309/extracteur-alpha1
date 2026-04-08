import { useState, useCallback, useRef } from 'react';
import Head from 'next/head';
import { processOrderLines, applyMarkingFees, generateOdooOutput } from '../lib/matchEquivalence';
import EQUIV_MAP from '../lib/equivalences.json';

// ═══════════════════════════════════════════════════════
//  VIEWER PDF — iframe natif, toolbar clippée par CSS
//  Zoom Ctrl+molette, scroll natif, aucune dépendance
// ═══════════════════════════════════════════════════════

// Hauteur de la toolbar du viewer PDF natif Chrome/Edge/Firefox
const TOOLBAR_H = 40;

function PdfViewer({ url }) {
  if (!url) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: '#1e1e2e', fontSize: 13, letterSpacing: '.06em',
      }}>
        Glissez un PDF ici
      </div>
    );
  }

  return (
    // overflow:hidden + iframe décalé vers le haut → toolbar native invisible
    <div style={{ position: 'relative', overflow: 'hidden', width: '100%', height: '100%' }}>
      <iframe
        key={url}
        src={url}
        title="PDF"
        style={{
          position: 'absolute',
          top:    -TOOLBAR_H,
          left:   0,
          width:  '100%',
          height: `calc(100% + ${TOOLBAR_H}px)`,
          border: 'none',
          display: 'block',
        }}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  PAGE PRINCIPALE
// ═══════════════════════════════════════════════════════

export default function Home() {
  const [bcFile, setBcFile] = useState(null);
  const [bcUrl,  setBcUrl]  = useState(null);
  const [blFile, setBlFile] = useState(null);
  const [blUrl,  setBlUrl]  = useState(null);

  const [loading,     setLoading]     = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [error,       setError]       = useState(null);

  const [blData,         setBlData]         = useState(null);
  const [totalHt,        setTotalHt]        = useState(null);
  const [processedLines, setProcessedLines] = useState(null);
  const [reasoning,      setReasoning]      = useState(null);

  const [activePdf,   setActivePdf]   = useState('bc');
  const [copiedField, setCopiedField] = useState(null);

  const [feeConfig] = useState({
    refMarquage:             '910002',
    designationMarquage:     'Marquage / Sérigraphie',
    refFraisGestion:         '999001',
    designationFraisGestion: 'Frais de gestion (marquage < 100 pcs)',
    refFraisEcran:           '910001',
    designationFraisEcran:   'Ecran de sérigraphie',
    seuilFraisGestion:       100,
    inclureFraisEcran:       true,
  });

  const bcInputRef = useRef();
  const blInputRef = useRef();

  // ── PDF loading ────────────────────────────────────────

  const loadPdf = useCallback((type, file) => {
    if (!file || file.type !== 'application/pdf') return;
    const url = URL.createObjectURL(file);
    if (type === 'bc') {
      if (bcUrl) URL.revokeObjectURL(bcUrl);
      setBcFile(file); setBcUrl(url); setActivePdf('bc');
    } else {
      if (blUrl) URL.revokeObjectURL(blUrl);
      setBlFile(file); setBlUrl(url); setActivePdf('bl');
    }
    setError(null); setBlData(null); setProcessedLines(null); setTotalHt(null);
  }, [bcUrl, blUrl]);

  const clearPdf = useCallback((type, e) => {
    e.stopPropagation();
    if (type === 'bc') {
      if (bcUrl) URL.revokeObjectURL(bcUrl);
      setBcFile(null); setBcUrl(null);
      if (activePdf === 'bc') setActivePdf('bl');
    } else {
      if (blUrl) URL.revokeObjectURL(blUrl);
      setBlFile(null); setBlUrl(null);
      if (activePdf === 'bl') setActivePdf('bc');
    }
  }, [bcUrl, blUrl, activePdf]);

  const onDropLeft = useCallback((e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const name = file.name.toLowerCase();
    loadPdf((name.includes('bl') || name.includes('livr')) ? 'bl' : 'bc', file);
  }, [loadPdf]);

  // ── Extraction ─────────────────────────────────────────

  const handleExtract = useCallback(async () => {
    if (!bcFile && !blFile) return;
    setLoading(true); setError(null);
    setBlData(null); setProcessedLines(null); setTotalHt(null); setReasoning(null);

    try {
      const toB64 = (f) => new Promise((res, rej) => {
        const r = new FileReader();
        r.onload  = () => res(r.result.split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(f);
      });

      setLoadingStep('Lecture…');
      const bcBase64 = bcFile ? await toB64(bcFile) : null;
      const blBase64 = blFile ? await toB64(blFile) : null;

      setLoadingStep('Claude Haiku…');
      const res  = await fetch('/api/extract', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ bcBase64, blBase64 }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.error || 'Erreur extraction'); return; }

      setBlData(data.bl);
      setTotalHt(data.total_ht);
      setReasoning(data.reasoning || null);

      setLoadingStep('Matching…');
      const src      = data.bl || data.bc;
      const matched  = processOrderLines(src?.lignes || [], EQUIV_MAP);
      const withFees = applyMarkingFees(matched, feeConfig);
      setProcessedLines(withFees);

    } catch (err) {
      setError('Erreur : ' + err.message);
    } finally {
      setLoading(false); setLoadingStep('');
    }
  }, [bcFile, blFile, feeConfig]);

  // ── Copy ───────────────────────────────────────────────

  const copy = useCallback((text, id) => {
    navigator.clipboard.writeText(String(text ?? '')).then(() => {
      setCopiedField(id);
      setTimeout(() => setCopiedField(null), 1400);
    });
  }, []);

  const copyAll = useCallback(() => {
    if (!blData || !processedLines) return;
    const text = generateOdooOutput(
      { numero_commande: blData.numero_commande, date: blData.date, client: blData.client, total_ht: totalHt },
      { adresse_rue: blData.adresse_rue, code_postal: blData.code_postal, ville: blData.ville, telephone: blData.telephone, contact: blData.contact },
      processedLines
    );
    copy(text, '__all__');
  }, [blData, totalHt, processedLines, copy]);

  // ── Computed ────────────────────────────────────────────

  const pdfUrl     = activePdf === 'bc' ? bcUrl : blUrl;
  const hasResults = blData && processedLines;
  const notFound   = processedLines?.filter(l => l.status === 'not_found').length ?? 0;
  const prixErrors = processedLines?.filter(l => l.prixMatch === 'error').length ?? 0;

  // ── Render ──────────────────────────────────────────────

  return (
    <>
      <Head>
        <title>Extracteur Prozon</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </Head>

      <div className="root">

        {/* ══ GAUCHE ══════════════════════════════════════ */}
        <div className="left" onDragOver={e => e.preventDefault()} onDrop={onDropLeft}>

          {/* Barre upload */}
          <div className="upload-bar">
            <FileChip label="BC" file={bcFile}
              onClick={() => bcInputRef.current.click()}
              onClear={e => clearPdf('bc', e)} />
            <FileChip label="BL" file={blFile}
              onClick={() => blInputRef.current.click()}
              onClear={e => clearPdf('bl', e)} />

            <button className="btn-extract" onClick={handleExtract}
              disabled={(!bcFile && !blFile) || loading}>
              {loading ? <><Spin />{loadingStep}</> : '⚡ Extraire'}
            </button>

            <input ref={bcInputRef} type="file" accept="application/pdf"
              style={{display:'none'}} onChange={e => loadPdf('bc', e.target.files[0])} />
            <input ref={blInputRef} type="file" accept="application/pdf"
              style={{display:'none'}} onChange={e => loadPdf('bl', e.target.files[0])} />
          </div>

          {/* Erreur */}
          {error && <p className="err">{error}</p>}

          {/* Données */}
          <div className="data-scroll">
            {!hasResults && !loading && !error && (
              <p className="hint">Chargez un BC et / ou un BL, puis extrayez.</p>
            )}

            {hasResults && <>
              {(notFound > 0 || prixErrors > 0) && (
                <div className="alerts">
                  {notFound   > 0 && <span className="a-err">⚠ {notFound} réf. introuvable{notFound > 1 ? 's' : ''}</span>}
                  {prixErrors > 0 && <span className="a-err">⚠ {prixErrors} écart{prixErrors > 1 ? 's' : ''} de prix</span>}
                </div>
              )}

              <Section label="Commande">
                <Row label="N° commande" value={blData.numero_commande} id="num"    {...{copy,copiedField}} />
                <Row label="Date"        value={blData.date}            id="date"   {...{copy,copiedField}} />
                <Row label="Client"      value={blData.client}          id="client" {...{copy,copiedField}} />
                {totalHt && <Row label="Total HT" value={`${totalHt} €`} id="ht"  {...{copy,copiedField}} />}
              </Section>

              {(blData.adresse_rue || blData.ville) && (
                <Section label="Livraison">
                  <Row label="Rue"         value={blData.adresse_rue} id="rue"     {...{copy,copiedField}} />
                  <Row label="Code postal" value={blData.code_postal} id="cp"      {...{copy,copiedField}} />
                  <Row label="Ville"       value={blData.ville}       id="ville"   {...{copy,copiedField}} />
                  <Row label="Téléphone"   value={blData.telephone}   id="tel"     {...{copy,copiedField}} />
                  <Row label="Contact"     value={blData.contact}     id="contact" {...{copy,copiedField}} />
                </Section>
              )}

              <Section
                label={`Lignes · ${processedLines.filter(l => l.status !== 'fee').length} articles`}
                action={
                  <button className="btn-copy-all" onClick={copyAll}>
                    {copiedField === '__all__' ? '✓ Copié' : 'Tout copier'}
                  </button>
                }
              >
                {processedLines.map((line, i) => (
                  <OrderRow key={i} line={line} idx={i} copy={copy} copiedField={copiedField} />
                ))}
              </Section>

              {reasoning && <ReasoningBlock text={reasoning} />}
            </>}
          </div>
        </div>

        {/* ══ DROITE — PDF VIEWER ══════════════════════════ */}
        <div className="right">
          {/* Switcher BC/BL si les deux sont chargés */}
          {bcUrl && blUrl && (
            <div className="switcher">
              <button className={activePdf === 'bc' ? 'on' : ''} onClick={() => setActivePdf('bc')}>BC</button>
              <button className={activePdf === 'bl' ? 'on' : ''} onClick={() => setActivePdf('bl')}>BL</button>
            </div>
          )}

          <PdfViewer url={pdfUrl} />
        </div>
      </div>

      {/* ── Styles globaux ── */}
      <style jsx global>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; overflow: hidden; }
        body {
          font-family: 'Inter', system-ui, sans-serif;
          background: #0e0e18;
          color: #d8d8e8;
          font-size: 14px;
        }
        button { font-family: inherit; cursor: pointer; }
      `}</style>

      <style jsx>{`
        .root {
          display: grid;
          grid-template-columns: 42% 58%;
          height: 100vh;
          overflow: hidden;
        }

        /* ── Gauche ── */
        .left {
          display: flex;
          flex-direction: column;
          border-right: 1px solid rgba(255,255,255,.05);
          overflow: hidden;
          background: #0e0e18;
        }

        .upload-bar {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 10px 14px;
          border-bottom: 1px solid rgba(255,255,255,.05);
          flex-shrink: 0;
        }

        .btn-extract {
          margin-left: auto;
          display: flex;
          align-items: center;
          gap: 6px;
          background: #f59e0b;
          color: #0a0a10;
          border: none;
          border-radius: 6px;
          padding: 5px 13px;
          font-size: 12px;
          font-weight: 600;
          white-space: nowrap;
          transition: opacity .15s;
        }
        .btn-extract:disabled { opacity: .35; cursor: not-allowed; }
        .btn-extract:not(:disabled):hover { opacity: .82; }

        .err {
          padding: 7px 14px;
          font-size: 11.5px;
          color: #f87171;
          border-bottom: 1px solid rgba(248,113,113,.1);
          flex-shrink: 0;
        }

        .data-scroll {
          flex: 1;
          overflow-y: auto;
          padding: 18px 14px 40px;
        }
        .data-scroll::-webkit-scrollbar { width: 3px; }
        .data-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,.07); border-radius: 2px; }

        .hint { color: #2a2a3e; font-size: 12.5px; }

        .alerts { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
        .a-err {
          font-size: 11px; color: #f87171;
          background: rgba(248,113,113,.07);
          border: 1px solid rgba(248,113,113,.15);
          border-radius: 4px; padding: 2px 7px;
        }

        .btn-copy-all {
          background: none;
          border: 1px solid rgba(255,255,255,.09);
          color: #333348;
          border-radius: 4px;
          padding: 2px 8px;
          font-size: 11px;
          transition: all .15s;
        }
        .btn-copy-all:hover { border-color: rgba(255,255,255,.18); color: #71717a; }

        /* ── Droite ── */
        .right {
          position: relative;
          overflow: hidden;
          background: #141420;
        }

        .switcher {
          position: absolute;
          top: 10px;
          left: 10px;
          z-index: 20;
          display: flex;
          gap: 3px;
          background: rgba(14,14,24,.92);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255,255,255,.08);
          border-radius: 6px;
          padding: 3px;
        }
        .switcher button {
          background: none;
          border: none;
          color: #333348;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: .05em;
          padding: 3px 10px;
          border-radius: 4px;
          transition: all .15s;
        }
        .switcher button.on {
          background: rgba(245,158,11,.12);
          color: #f59e0b;
        }

      `}</style>
    </>
  );
}

// ═══════════════════════════════════════════════════════
//  Composants utilitaires
// ═══════════════════════════════════════════════════════

function Spin() {
  return (
    <span style={{
      display: 'inline-block',
      width: 10, height: 10,
      border: '2px solid rgba(0,0,0,.2)',
      borderTopColor: '#0a0a10',
      borderRadius: '50%',
      animation: 'spin .6s linear infinite',
    }} />
  );
}

function FileChip({ label, file, onClick, onClear }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 5,
      background: file ? 'rgba(245,158,11,.07)' : 'rgba(255,255,255,.03)',
      border: `1px solid ${file ? 'rgba(245,158,11,.2)' : 'rgba(255,255,255,.06)'}`,
      borderRadius: 6, padding: '4px 9px',
      color: file ? '#f59e0b' : '#3a3a54',
      fontSize: 12, fontWeight: 600,
      transition: 'all .15s',
      maxWidth: 130, overflow: 'hidden',
    }}>
      <span style={{flexShrink:0}}>{label}</span>
      {file && <>
        <span style={{
          color: '#555570', fontWeight: 400,
          overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap', maxWidth: 66, fontSize: 11,
        }}>
          {file.name.replace(/\.pdf$/i, '')}
        </span>
        <span onClick={onClear} style={{ color: '#3a3a54', fontSize: 14, lineHeight: 1, flexShrink: 0 }}>×</span>
      </>}
    </button>
  );
}

function Section({ label, children, action }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 7 }}>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing:'.08em', color:'#2e2e48', textTransform:'uppercase' }}>
          {label}
        </span>
        {action}
      </div>
      <div style={{ display:'flex', flexDirection:'column' }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, value, id, copy, copiedField }) {
  if (!value) return null;
  const copied = copiedField === id;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '4px 0',
      borderBottom: '1px solid rgba(255,255,255,.025)',
    }}>
      <span style={{ width: 92, flexShrink: 0, fontSize: 11.5, color: '#333348' }}>{label}</span>
      <span style={{
        flex: 1,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12, color: '#aaaabf',
        wordBreak: 'break-all',
      }}>{value}</span>
      <button onClick={() => copy(value, id)} style={{
        flexShrink: 0,
        background: copied ? 'rgba(52,211,153,.08)' : 'none',
        border: `1px solid ${copied ? 'rgba(52,211,153,.2)' : 'rgba(255,255,255,.06)'}`,
        color: copied ? '#34d399' : '#2e2e48',
        borderRadius: 4, padding: '1px 7px',
        fontSize: 11, fontWeight: 600,
        transition: 'all .15s',
      }}>
        {copied ? '✓' : 'Copier'}
      </button>
    </div>
  );
}

function ReasoningBlock({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 18, borderTop: '1px solid rgba(255,255,255,.04)', paddingTop: 14 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'none', border: 'none', padding: 0,
          color: '#2e2e48', fontSize: 10, fontWeight: 600,
          letterSpacing: '.08em', textTransform: 'uppercase',
          cursor: 'pointer', transition: 'color .15s',
        }}
        onMouseEnter={e => e.currentTarget.style.color = '#555570'}
        onMouseLeave={e => e.currentTarget.style.color = '#2e2e48'}
      >
        <span style={{ fontSize: 9, lineHeight: 1 }}>{open ? '▼' : '▶'}</span>
        Raisonnement du modèle
      </button>
      {open && (
        <div style={{
          marginTop: 8,
          padding: '10px 12px',
          background: 'rgba(255,255,255,.02)',
          border: '1px solid rgba(255,255,255,.05)',
          borderRadius: 6,
          fontSize: 11.5,
          lineHeight: 1.65,
          color: '#555570',
          whiteSpace: 'pre-wrap',
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {text}
        </div>
      )}
    </div>
  );
}

function OrderRow({ line, idx, copy, copiedField }) {
  const isFee      = line.status === 'fee';
  const isNotFound = line.status === 'not_found';
  const isSecond   = line.composantIndex === 2;
  const id         = `line-${idx}`;
  const copied     = copiedField === id;

  const lineText  = [line.ehsRef, line.designation_ehs, line.quantite, line.prixTable ?? line.prixPdf ?? ''].join('\t');
  const prixIcon  = { ok: '✓', warning: '~', error: '≠' }[line.prixMatch];
  const prixColor = { ok: '#34d399', warning: '#fcd34d', error: '#f87171' }[line.prixMatch];

  return (
    <div style={{
      padding: '6px 0',
      borderBottom: '1px solid rgba(255,255,255,.025)',
      opacity: isFee ? .6 : 1,
    }}>
      <div style={{ display:'flex', alignItems:'baseline', gap: 7 }}>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12, fontWeight: isSecond ? 400 : 600,
          color: isNotFound ? '#f87171' : isSecond ? '#444460' : '#d0d0e4',
          flexShrink: 0, minWidth: 70,
        }}>
          {line.ehsRef || '?'}
        </span>

        <span style={{
          fontSize: 11.5, flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          color: isFee ? '#f59e0b' : '#505068',
          fontStyle: isFee ? 'italic' : 'normal',
        }}>
          {isFee ? (line.feeType || line.designation_ehs) : line.designation_ehs}
        </span>

        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12, fontWeight: 600,
          color: '#f59e0b', flexShrink: 0,
        }}>
          {line.quantite}
        </span>

        {prixIcon && (
          <span style={{ fontSize: 11, color: prixColor, flexShrink: 0, fontWeight: 700 }}>
            {prixIcon}
          </span>
        )}

        {!isFee && (
          <button onClick={() => copy(lineText, id)} style={{
            flexShrink: 0,
            background: copied ? 'rgba(52,211,153,.08)' : 'none',
            border: `1px solid ${copied ? 'rgba(52,211,153,.2)' : 'rgba(255,255,255,.06)'}`,
            color: copied ? '#34d399' : '#2e2e48',
            borderRadius: 4, padding: '1px 7px',
            fontSize: 11, fontWeight: 600,
            transition: 'all .15s',
          }}>
            {copied ? '✓' : 'Copier'}
          </button>
        )}
      </div>

      {!isFee && (
        <div style={{ display:'flex', gap: 12, marginTop: 2 }}>
          <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize: 10.5, color: '#26263a' }}>
            {line.ref_prozon}
          </span>
          {line.prixPdf != null && (
            <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize: 10.5, color: '#26263a' }}>
              PDF {line.prixPdf} € · Table {line.prixTable ?? '—'} €
            </span>
          )}
        </div>
      )}

      {isNotFound && (
        <div style={{ fontSize: 10.5, color: '#f87171', marginTop: 2 }}>
          ⚠ référence introuvable dans la table
        </div>
      )}
    </div>
  );
}
