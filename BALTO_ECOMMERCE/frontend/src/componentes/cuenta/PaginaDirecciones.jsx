import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Briefcase, Check, LoaderCircle, MapPin, Pencil, Plus, Star, Trash2, X } from 'lucide-react';
import { useCuenta } from './contexto/CuentaContext';
import { eliminarDireccion, guardarDireccion, listarDirecciones, predeterminarDireccion } from './api/cuentaApi';
import CamposDireccion from '../direccion/CamposDireccion';
import { EstadoVacio, EstadoError, EstadoCargando } from '../global/Estados';
import { EMPTY_ADDRESS, addressCity, addressFromServer, addressLine, addressPayload, validateAddress } from '../direccion/utilidades/validacionDireccion';
import EstructuraCuenta from './EstructuraCuenta';

const ETIQUETA = { CASA: 'Casa', TRABAJO: 'Trabajo', OTRA: 'Otra' };

function AddressForm({ inicial, paises, onCancel, onSaved }) {
  const [value, setValue] = useState(inicial);
  const [errors, setErrors] = useState({});
  const [predeterminada, setPredeterminada] = useState(false);
  const [estado, setEstado] = useState({ guardando: false, error: null });
  const ref = useRef(null);
  useEffect(() => { ref.current?.querySelector('input:not([type=radio]), select')?.focus(); }, []);
  const onChange = (patch) => {
    setValue((v) => ({ ...v, ...patch }));
    setErrors((e) => { const n = { ...e }; Object.keys(patch).forEach((k) => delete n[k]); return n; });
  };
  const submit = async (ev) => {
    ev.preventDefault();
    const e = validateAddress(value, { destinatario: 'requerido', paises });
    setErrors(e);
    const first = Object.keys(e)[0];
    if (first) { document.getElementById(`dirform-${first}`)?.focus(); return; }
    setEstado({ guardando: true, error: null });
    try {
      const data = await guardarDireccion({ ...addressPayload(value), predeterminada });
      onSaved(data.direcciones, inicial.id ? 'Dirección actualizada.' : 'Dirección guardada.');
    } catch (error) {
      if (error.datos?.errores) setErrors(error.datos.errores);
      setEstado({ guardando: false, error: error.message });
    }
  };
  return <form ref={ref} className="account-card address-form" onSubmit={submit} noValidate aria-label={inicial.id ? 'Editar dirección' : 'Nueva dirección'}>
    <div className="account-card-head"><h2>{inicial.id ? 'Editar dirección' : 'Nueva dirección'}</h2>
      <button type="button" className="icon-button" onClick={onCancel} aria-label="Cancelar"><X size={18}/></button></div>
    <CamposDireccion value={value} onChange={onChange} errors={errors} disabled={estado.guardando} idPrefix="dirform" destinatario="requerido" paises={paises}/>
    {!inicial.predeterminada && <label className="check-inline"><input type="checkbox" checked={predeterminada} onChange={(e) => setPredeterminada(e.target.checked)}/> Usar como dirección predeterminada</label>}
    {estado.error && <div className="checkout-alert" role="alert">{estado.error}</div>}
    <div className="account-actions">
      <button type="button" className="btn btn-outline" onClick={onCancel} disabled={estado.guardando}>Cancelar</button>
      <button type="submit" className="btn btn-dark" disabled={estado.guardando}>{estado.guardando ? <><LoaderCircle size={17} className="spin"/> Guardando…</> : 'Guardar dirección'}</button>
    </div>
  </form>;
}

/** /mi-cuenta/direcciones — alta, edición, eliminación y predeterminada. */
export default function PaginaDirecciones() {
  const auth = useCuenta();
  const [state, setState] = useState({ cargando: true, error: null, direcciones: [], maximo: 20, paises: ['AR'] });
  const [editando, setEditando] = useState(null); // null | 'nueva' | direccion
  const [confirmar, setConfirmar] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [rev, setRev] = useState(0);

  useEffect(() => {
    const c = new AbortController();
    setState((s) => ({ ...s, cargando: true, error: null }));
    listarDirecciones(c.signal)
      .then((d) => setState({ cargando: false, error: null, direcciones: d.direcciones || [], maximo: d.maximo || 20, paises: d.paises || ['AR'] }))
      .catch((error) => { if (error.name !== 'AbortError') setState((s) => ({ ...s, cargando: false, error })); });
    return () => c.abort();
  }, [rev]);

  const aplicar = useCallback((direcciones, mensaje) => {
    setState((s) => ({ ...s, direcciones }));
    const pred = direcciones.find((d) => d.predeterminada);
    if (auth.cliente) auth.actualizarCliente({ ...auth.cliente, id_direccion_predeterminada: pred ? pred.id : null });
    setEditando(null);
    setConfirmar(null);
    setAviso(mensaje);
  }, [auth]);

  const accion = async (id, fn, mensaje) => {
    setOcupado(id);
    setAviso(null);
    try {
      const data = await fn(id);
      aplicar(data.direcciones || [], mensaje);
    } catch (error) {
      setAviso(error.message);
      if (error.status === 404) setRev((n) => n + 1);
    } finally {
      setOcupado(null);
    }
  };

  const { direcciones } = state;
  const lleno = direcciones.length >= state.maximo;
  return <EstructuraCuenta title="Mis direcciones" description="Guardá tus direcciones para elegirlas al finalizar una compra. Los pedidos conservan la dirección que usaste, aunque después la cambies.">
    {aviso && <div className="account-notice" role="status"><Check size={16}/> {aviso}</div>}
    {editando
      ? <AddressForm key={editando === 'nueva' ? 'nueva' : editando.id} paises={state.paises}
        inicial={editando === 'nueva'
          ? { ...EMPTY_ADDRESS, destinatario_nombre: auth.cliente?.nombre || '', destinatario_apellido: auth.cliente?.apellido || '', telefono: auth.cliente?.telefono || '' }
          : { ...addressFromServer(editando), predeterminada: editando.predeterminada }}
        onCancel={() => setEditando(null)} onSaved={aplicar}/>
      : <div className="account-toolbar">
        <button type="button" className="btn btn-dark" onClick={() => { setEditando('nueva'); setAviso(null); }} disabled={lleno || state.cargando}><Plus size={17}/> Agregar dirección</button>
        {lleno && <small>Alcanzaste el máximo de {state.maximo} direcciones.</small>}
      </div>}
    {state.cargando ? <EstadoCargando compact message="Cargando tus direcciones…"/>
      : state.error ? <EstadoError error={state.error} retry={() => setRev((n) => n + 1)}/>
        : direcciones.length === 0 ? (!editando && <EstadoVacio icon={MapPin} title="Todavía no guardaste direcciones" description="Agregá una dirección para usarla en tus próximas compras con envío."/>)
          : <ul className="address-list">
            {direcciones.map((d) => <li key={d.id} className={`address-card ${d.predeterminada ? 'is-default' : ''}`}>
              <div className="address-card-top">
                <span className="address-tag">{d.etiqueta === 'TRABAJO' ? <Briefcase size={14}/> : <MapPin size={14}/>} {ETIQUETA[d.etiqueta] || d.etiqueta}</span>
                {d.predeterminada && <span className="address-default"><Star size={13}/> Predeterminada</span>}
              </div>
              <strong>{addressLine(d)}</strong>
              <span>{addressCity(d)}</span>
              <small>Recibe: {d.destinatario_nombre} {d.destinatario_apellido}{d.telefono ? ` · ${d.telefono}` : ''}</small>
              {d.referencias && <small className="muted-small">{d.referencias}</small>}
              {confirmar === d.id
                ? <div className="address-confirm" role="group" aria-label="Confirmar eliminación"><span>¿Eliminar esta dirección?</span>
                  <button type="button" className="danger" onClick={() => accion(d.id, eliminarDireccion, 'Dirección eliminada.')} disabled={ocupado === d.id}>{ocupado === d.id ? 'Eliminando…' : 'Sí, eliminar'}</button>
                  <button type="button" onClick={() => setConfirmar(null)}>Cancelar</button></div>
                : <div className="address-actions">
                  <button type="button" onClick={() => { setEditando(d); setAviso(null); }} disabled={Boolean(ocupado)}><Pencil size={14}/> Editar</button>
                  {!d.predeterminada && <button type="button" onClick={() => accion(d.id, predeterminarDireccion, 'Dirección predeterminada actualizada.')} disabled={Boolean(ocupado)}>{ocupado === d.id ? <LoaderCircle size={14} className="spin"/> : <Star size={14}/>} Predeterminada</button>}
                  <button type="button" className="danger" onClick={() => setConfirmar(d.id)} disabled={Boolean(ocupado)}><Trash2 size={14}/> Eliminar</button>
                </div>}
            </li>)}
          </ul>}
  </EstructuraCuenta>;
}
