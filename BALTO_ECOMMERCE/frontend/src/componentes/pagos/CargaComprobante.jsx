import React, { useEffect, useId, useRef, useState } from 'react';
import { FileText, LoaderCircle, RefreshCw, Upload, X } from 'lucide-react';
import { subirComprobante } from './api/pagoApi';
import { tamanoLegible, validarArchivoComprobante } from './utilidades/reglasPago';

/**
 * Carga del comprobante: elegir/cambiar archivo, vista previa de imágenes,
 * progreso real de subida y resultado. El servidor valida el contenido.
 */
export default function CargaComprobante({ numero, token, maxBytes = 5 * 1024 * 1024, onUploaded, onCancel }) {
  const inputId = useId();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [progreso, setProgreso] = useState(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const elegir = (f) => {
    setError(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    if (!f) { setFile(null); return; }
    const err = validarArchivoComprobante(f, maxBytes);
    if (err) { setFile(null); setError(err); if (inputRef.current) inputRef.current.value = ''; return; }
    setFile(f);
    if (f.type.startsWith('image/')) setPreview(URL.createObjectURL(f));
  };
  const enviar = async () => {
    if (!file || progreso !== null) return;
    setError(null);
    setProgreso(0);
    try {
      const data = await subirComprobante(numero, file, { token, onProgress: setProgreso });
      onUploaded?.(data);
    } catch (e) {
      setError(e.message || 'No pudimos subir el comprobante.');
      setProgreso(null);
    }
  };
  const subiendo = progreso !== null;
  return <div className="proof-uploader">
    <label htmlFor={inputId} className={`proof-drop ${file ? 'has-file' : ''}`}>
      <input ref={inputRef} id={inputId} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={subiendo}
        onChange={(e) => elegir(e.target.files?.[0] || null)} aria-describedby={`${inputId}-hint`}/>
      {!file && <><Upload size={22}/><strong>Elegí el comprobante</strong><small id={`${inputId}-hint`}>JPG, PNG, WEBP o PDF · hasta {tamanoLegible(maxBytes)}</small></>}
      {file && <span className="proof-file">
        {preview ? <img src={preview} alt="Vista previa del comprobante"/> : <span className="proof-icon"><FileText size={26}/></span>}
        <span><strong>{file.name}</strong><small>{tamanoLegible(file.size)}</small></span>
      </span>}
    </label>
    {file && !subiendo && <button type="button" className="link-button" onClick={() => inputRef.current?.click()}><RefreshCw size={14}/> Cambiar archivo</button>}
    {subiendo && <div className="proof-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progreso} aria-label="Subiendo comprobante">
      <span style={{ width: `${progreso}%` }}/><small>{progreso < 100 ? `Subiendo… ${progreso}%` : 'Verificando el archivo…'}</small>
    </div>}
    {error && <div className="checkout-alert" role="alert" data-testid="proof-error">{error}</div>}
    <div className="proof-actions">
      {onCancel && <button type="button" className="btn btn-outline" onClick={onCancel} disabled={subiendo}><X size={16}/> Cancelar</button>}
      <button type="button" className="btn btn-dark" onClick={enviar} disabled={!file || subiendo} data-testid="proof-submit">
        {subiendo ? <><LoaderCircle size={17} className="spin"/> Enviando…</> : <><Upload size={17}/> Enviar comprobante</>}
      </button>
    </div>
  </div>;
}
