import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CC_API_URL as API_URL,
  ccApiGetStrict as apiGet,
  ccApiPostActionStrict as apiPost,
} from "../../api/cuentasCorrientesApi";
import {
  buildEmptyForm,
  isTemaOscuro,
  normalizeCuitInput,
  normalizeProveedorFiscalData as normalizeFiscalData,
  normalizeSearch,
  notifyGlobalListasUpdated,
  onlyDigits,
  proveedorFiscalHasAnyData as fiscalHasAnyData,
  proveedorFiscalIsUsable as fiscalIsUsable,
  safeStr,
  toUpperValue,
} from "../../utils/cuentasCorrientesFormUtils";
import "../../../Global/Global_css/Global_Modals.css";
import "../../cuentas_corrientes.css";
import "../../cuentas_corrientes_modales.css";
import "../../modales/ModalEntidadFiscal.css";
import "./ModalProveedorFormulario.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faXmark,
  faPlus,
  faPenToSquare,
  faTrashCan,
  faFloppyDisk,
  faArrowRotateRight,
  faTruckField,
  faBuilding,
  faUserSlash,
  faUserCheck,
  faMagnifyingGlass,
  faIdCard,
  faFileInvoiceDollar,
  faCircleCheck,
} from "@fortawesome/free-solid-svg-icons";
import ModalEliminar from "../../../Global/Modales/ModalEliminar";
import "../../../Global/Global_css/Global_oscuro.css";

function getProveedorId(row) {
  return Number(row?.id_proveedor ?? row?.id ?? 0);
}

function getProveedorFiscalId(row) {
  return Number(row?.id_cliente_fiscal ?? row?.cliente_fiscal?.id_cliente_fiscal ?? 0);
}

function fiscalFromProveedorRow(row) {
  if (!row || typeof row !== "object") return null;
  const nested = row.proveedor_fiscal || row.cliente_fiscal || row.fiscal || null;
  const fiscal = normalizeFiscalData(nested || row);
  if (!fiscal.cuit && !fiscal.razon_social && !fiscal.id_cliente_fiscal) return null;
  fiscal.id_proveedor = fiscal.id_proveedor || getProveedorId(row) || null;
  return fiscal;
}

function FiscalResumen({ fiscal }) {
  const f = normalizeFiscalData(fiscal);
  if (!fiscalIsUsable(f) && !f.id_cliente_fiscal) return null;

  return (
    <div className="cc-fiscal-summary-card">
      <div className="cc-fiscal-summary-card__title">
        <FontAwesomeIcon icon={faCircleCheck} />
        Datos fiscales cargados
      </div>

      <div className="cc-fiscal-summary-grid">
        <div className="cc-fiscal-summary-item">
          <span>CUIT</span>
          <b>{f.cuit || "—"}</b>
        </div>
        <div className="cc-fiscal-summary-item">
          <span>IVA</span>
          <b>{f.condicion_iva || "—"}</b>
        </div>
        <div className="cc-fiscal-summary-item cc-fiscal-summary-item--full">
          <span>Razón social</span>
          <b>{f.razon_social || "—"}</b>
        </div>
        <div className="cc-fiscal-summary-item cc-fiscal-summary-item--full">
          <span>Domicilio</span>
          <b>{f.domicilio || "—"}</b>
        </div>
      </div>
    </div>
  );
}

function FiscalEditableFields({ fiscal, cuit, saving, fiscalLoading, onFieldChange }) {
  // No mostrar el panel legal solo por escribir un CUIT.
  // Se habilita recien cuando existen datos fiscales reales (por ARCA o edicion).
  if (!fiscalHasAnyData(fiscal)) return null;

  const f = normalizeFiscalData({ ...(fiscal || {}), cuit: fiscal?.cuit || cuit });

  return (
    <div className="cc-legal-edit-card">
      <div className="cc-legal-edit-card__head">
        <span className="cc-legal-edit-card__icon" aria-hidden="true">
          <FontAwesomeIcon icon={faFileInvoiceDollar} />
        </span>
        <div>
          <b>Datos legales editables</b>
          <span>Información que se usará en facturación y comprobantes.</span>
        </div>
      </div>

      <p className="cc-legal-edit-card__hint">
        Podés corregir razón social, condición IVA o domicilio si ARCA vino incompleto o desactualizado.
      </p>

      <div className="cc-legal-edit-card__grid">
        <div className="fl-field cc-legal-edit-card__field cc-legal-edit-card__field--full is-active">
          <input
            type="text"
            className="fl-input"
            placeholder=" "
            value={f.razon_social}
            onChange={(e) => onFieldChange("razon_social", e.target.value)}
            disabled={saving || fiscalLoading}
          />
          <label className="fl-label">Razón social legal *</label>
        </div>

        <div className="fl-field cc-legal-edit-card__field cc-legal-edit-card__field--full is-active">
          <input
            type="text"
            className="fl-input"
            placeholder=" "
            value={f.condicion_iva}
            onChange={(e) => onFieldChange("condicion_iva", e.target.value)}
            disabled={saving || fiscalLoading}
          />
          <label className="fl-label">Condición IVA</label>
        </div>

        <div className="fl-field cc-legal-edit-card__field cc-legal-edit-card__field--full is-active">
          <textarea
            className="fl-input cc-legal-edit-card__textarea"
            placeholder=" "
            value={f.domicilio}
            onChange={(e) => onFieldChange("domicilio", e.target.value)}
            disabled={saving || fiscalLoading}
            rows={3}
          />
          <label className="fl-label">Domicilio fiscal</label>
        </div>
      </div>
    </div>
  );
}

function ModalDatosLegalesProveedor({ open, dark, row, fiscal, loading, onClose, onEdit }) {
  if (!open) return null;

  const f = normalizeFiscalData(fiscal || fiscalFromProveedorRow(row) || {});
  const tieneDatos = fiscalHasAnyData(f);
  const nombre = row?.nombre || "—";

  return createPortal(
    <div className={["mi-modal__overlay", "cc-legal-modal__overlay", dark ? "mi-modal__overlay--dark" : ""].join(" ").trim()}>
      <div
        className={["mi-modal__container", "cc-legal-modal", dark ? "mi-modal--dark" : ""].join(" ").trim()}
        role="dialog"
        aria-modal="true"
        aria-label="Datos legales del proveedor"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mi-modal__header cc-legal-modal__head">
          <div className="mi-modal__head-icon cc-legal-modal__headIcon" aria-hidden="true">
            <FontAwesomeIcon icon={faFileInvoiceDollar} />
          </div>
          <div className="mi-modal__head-left cc-legal-modal__headText">
            <span>Datos fiscales</span>
            <h2 className="mi-modal__title">Datos legales del proveedor</h2>
          </div>
          <button type="button" className="mi-modal__close" onClick={onClose} disabled={loading} aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="mi-modal__content cc-legal-modal__content">
          <div className="cc-legal-modal__layout">
            <section className="cc-legal-client-card" aria-label="Tarjeta del proveedor">
              <div className="cc-legal-client-card__top">
                <div className="cc-legal-client-card__avatar" aria-hidden="true">
                  <FontAwesomeIcon icon={faBuilding} />
                </div>
                <div className="cc-legal-client-card__heading">
                  <span className="cc-legal-client-card__eyebrow">Proveedor seleccionado</span>
                  <h3 title={nombre}>{nombre}</h3>
                  <div className="cc-legal-client-card__description">
                    {tieneDatos
                      ? "Información fiscal guardada para compras, pagos y comprobantes."
                      : "Este proveedor todavía no tiene datos fiscales cargados."}
                  </div>
                </div>
              </div>

              {loading ? (
                <div className="cc-loading-state cc-legal-client-card__loading">
                  <FontAwesomeIcon icon={faArrowRotateRight} spin />
                  <span>Cargando datos legales del proveedor...</span>
                </div>
              ) : tieneDatos ? (
                <>
                  <div className="cc-legal-client-card__status cc-legal-client-card__status--success">
                    <FontAwesomeIcon icon={faCircleCheck} />
                    Datos encontrados y listos para revisar
                  </div>

                  <div className="cc-legal-client-data">
                    <div className="cc-legal-data-chip cc-legal-data-chip--strong">
                      <span>CUIT</span>
                      <b>{f.cuit || "—"}</b>
                    </div>
                    <div className="cc-legal-data-chip">
                      <span>IVA</span>
                      <b>{f.condicion_iva || "—"}</b>
                    </div>
                    <div className="cc-legal-data-row cc-legal-data-row--full">
                      <span>Razón social</span>
                      <b>{f.razon_social || "—"}</b>
                    </div>
                    <div className="cc-legal-data-row cc-legal-data-row--full">
                      <span>Domicilio fiscal</span>
                      <b>{f.domicilio || "—"}</b>
                    </div>
                  </div>
                </>
              ) : (
                <div className="cc-legal-client-empty">
                  <div className="cc-legal-client-empty__icon" aria-hidden="true">
                    <FontAwesomeIcon icon={faIdCard} />
                  </div>
                  <div>
                    <b>Sin datos legales</b>
                    <span>Usá el panel derecho para cargar o consultar los datos fiscales por CUIT.</span>
                  </div>
                </div>
              )}
            </section>

            <aside className="cc-legal-side-panel" aria-label="Acciones de datos legales">
              <section className="cc-legal-panel-section">
                <div className="cc-legal-panel-section__head">
                  <span className="cc-legal-panel-section__dot" />
                  <span>Resumen fiscal</span>
                </div>

                <div className="cc-legal-panel-section__body">
                  <div className="cc-legal-panel-intro">
                    <b>{tieneDatos ? "Datos guardados" : "Carga pendiente"}</b>
                    <span>
                      {tieneDatos
                        ? "Podés revisar la información actual o editarla si hace falta corregir algún dato."
                        : "Editá el proveedor para consultar ARCA por CUIT y guardar la información legal."}
                    </span>
                  </div>

                  <div className="cc-legal-side-list">
                    <div className="cc-legal-side-item">
                      <span>Estado</span>
                      <b>{tieneDatos ? "Con datos fiscales" : "Pendiente"}</b>
                    </div>
                    <div className="cc-legal-side-item">
                      <span>CUIT</span>
                      <b>{f.cuit || "—"}</b>
                    </div>
                    <div className="cc-legal-side-item">
                      <span>Origen</span>
                      <b>{f.origen || "—"}</b>
                    </div>
                  </div>
                </div>
              </section>

              {!loading && !tieneDatos && (
                <div className="cc-fiscal-alert cc-fiscal-alert--warning">
                  Este proveedor todavía no tiene datos fiscales cargados. Podés editarlo y consultar ARCA por CUIT para crear los datos legales.
                </div>
              )}

              <div className="cc-legal-modal__help">
                Los datos legales se usan en compras, pagos y documentos comerciales.
              </div>

              <div className="cc-legal-modal__actions">
                <button type="button" className="mit-btn mit-btn--ghost" onClick={onClose} disabled={loading}>
                  Cerrar
                </button>
                <button type="button" className="mit-btn mit-btn--solid" onClick={onEdit} disabled={loading}>
                  {tieneDatos ? "Editar datos legales" : "Cargar datos legales"}
                </button>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}


function ModalFormularioProveedor({ open, dark, modo, saving, fiscalLoading, activo, onActivoChange, onGuardar, saveLabel, onClose, arcaControls, children }) {
  if (!open) return null;

  const busy = saving || fiscalLoading;
  const esEdicion = modo === "editar";
  const titulo = esEdicion ? "Editar proveedor" : "Agregar proveedor";
  const descripcion = esEdicion
    ? "Modificá los datos simples o fiscales del proveedor seleccionado."
    : "Creá un proveedor manual o consultá ARCA por CUIT para cargar datos fiscales.";

  return createPortal(
    <div className={["mi-modal__overlay", "cc-entity-form-modal__overlay", dark ? "mi-modal__overlay--dark" : ""].join(" ").trim()}>
      <div
        className={[
          "mi-modal__container",
          "cc-legal-modal",
          "cc-entity-form-modal",
          dark ? "mi-modal--dark" : "",
        ].join(" ").trim()}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mi-modal__header cc-legal-modal__head cc-entity-form-modal__head">
          <div className="mi-modal__head-icon cc-legal-modal__headIcon" aria-hidden="true">
            <FontAwesomeIcon icon={esEdicion ? faPenToSquare : faPlus} />
          </div>

          <div className="mi-modal__head-left cc-legal-modal__headText">
            <span>{esEdicion ? "Edición de proveedor" : "Nuevo proveedor"}</span>
            <h2 className="mi-modal__title">{titulo}</h2>
          </div>

          <button
            type="button"
            className="mi-modal__close"
            disabled={busy}
            onClick={onClose}
            aria-label="Cerrar formulario de proveedor"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="mi-modal__content cc-legal-modal__content cc-entity-form-modal__content">
          <div className="cc-legal-modal__layout cc-entity-form-modal__layout">
            <section className="cc-legal-client-card cc-entity-form-card" aria-label={titulo}>
              {!esEdicion && (
                <div className="cc-legal-client-card__top">
                  <div className="cc-legal-client-card__avatar" aria-hidden="true">
                    <FontAwesomeIcon icon={faBuilding} />
                  </div>
                  <div className="cc-legal-client-card__heading">
                    <span className="cc-legal-client-card__eyebrow">Formulario del proveedor</span>
                    <h3>{titulo}</h3>
                    <div className="cc-legal-client-card__description">{descripcion}</div>
                  </div>
                </div>
              )}

              <div className="cc-entity-form-card__body">
                {children}
              </div>
            </section>

            <aside className="cc-legal-side-panel cc-entity-form-side-panel" aria-label="Opciones del formulario de proveedor">
              <section className="cc-legal-panel-section">
                <div className="cc-legal-panel-section__head">
                  <span className="cc-legal-panel-section__dot" />
                  <span>Opciones del proveedor</span>
                </div>

                <div className="cc-legal-panel-section__body">
                  <div className="cc-legal-panel-intro">
                    <b>{esEdicion ? "Actualizar estado" : "Estado inicial"}</b>
                    <span>
                      Definí si el proveedor queda disponible en el listado activo o si se guarda como inactivo.
                    </span>
                  </div>

                  <div className="fl-field cc-entity-form-status-field">
                    <select
                      className="fl-input"
                      value={String(activo)}
                      onChange={(e) => onActivoChange?.(Number(e.target.value) === 1 ? 1 : 0)}
                      disabled={busy}
                    >
                      <option value="1">Activo</option>
                      <option value="0">Inactivo</option>
                    </select>
                    <label className="fl-label">Estado</label>
                  </div>

                  {arcaControls}
                </div>
              </section>

              <div className="cc-legal-modal__actions cc-entity-form-side-actions">
                <button
                  type="button"
                  className="mit-btn mit-btn--solid mit-btn--block"
                  onClick={onGuardar}
                  disabled={busy}
                >
                  <FontAwesomeIcon icon={faFloppyDisk} style={{ marginRight: 8 }} />
                  {saveLabel}
                </button>

                <button
                  type="button"
                  className="mit-btn mit-btn--ghost mit-btn--block"
                  onClick={onClose}
                  disabled={busy}
                >
                  Cancelar
                </button>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function ModalProveedores({
  open,
  onClose,
  onActualizado,
  onToast,
}) {
  const closeBtnRef = useRef(null);

  const [dark, setDark] = useState(isTemaOscuro);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [accionandoId, setAccionandoId] = useState(null);
  const [proveedores, setProveedores] = useState([]);
  const [busqueda, setBusqueda] = useState("");
  const [pestana, setPestana] = useState("activos");
  const [modo, setModo] = useState("crear");
  const [editandoId, setEditandoId] = useState(null);
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [form, setForm] = useState(() => buildEmptyForm(1));

  const [modalAccion, setModalAccion] = useState({
    open: false,
    type: null,
    row: null,
    loading: false,
  });

  const [modalFiscal, setModalFiscal] = useState({
    open: false,
    row: null,
    fiscal: null,
    loading: false,
  });

  const isBusy =
    loading ||
    saving ||
    form.fiscalLoading ||
    modalAccion.loading ||
    modalAccion.open ||
    modalFiscal.loading ||
    modalFiscal.open ||
    formModalOpen;

  useEffect(() => {
    const update = () => setDark(isTemaOscuro());

    const o1 = new MutationObserver(update);
    o1.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const o2 = new MutationObserver(update);
    if (document.body) {
      o2.observe(document.body, {
        attributes: true,
        attributeFilter: ["class"],
      });
    }

    return () => {
      o1.disconnect();
      o2.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const stopEscape = (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
    };

    const h = (e) => {
      if (e.key !== "Escape") return;

      if (modalAccion.open) {
        stopEscape(e);
        if (!modalAccion.loading) {
          setModalAccion({
            open: false,
            type: null,
            row: null,
            loading: false,
          });
        }
        return;
      }

      if (modalFiscal.open) {
        stopEscape(e);
        if (!modalFiscal.loading) {
          setModalFiscal({ open: false, row: null, fiscal: null, loading: false });
        }
        return;
      }

      if (formModalOpen) {
        stopEscape(e);
        if (!saving && !form.fiscalLoading) {
          setFormModalOpen(false);
          setModo("crear");
          setEditandoId(null);
          setForm(buildEmptyForm(pestana === "inactivos" ? 0 : 1));
        }
        return;
      }

      if (!loading && !saving && !form.fiscalLoading) {
        stopEscape(e);
        onClose?.();
      }
    };

    document.addEventListener("keydown", h, true);
    return () => document.removeEventListener("keydown", h, true);
  }, [
    open,
    onClose,
    loading,
    saving,
    form.fiscalLoading,
    modalAccion.open,
    modalAccion.loading,
    modalFiscal.open,
    modalFiscal.loading,
    formModalOpen,
    pestana,
  ]);

  useEffect(() => {
    if (open) {
      setTimeout(() => closeBtnRef.current?.focus(), 0);
      setBusqueda("");
      setFormModalOpen(false);
      setModalFiscal({ open: false, row: null, fiscal: null, loading: false });
    }
  }, [open]);

  const resetForm = useCallback(() => {
    setModo("crear");
    setEditandoId(null);
    setForm(buildEmptyForm(pestana === "inactivos" ? 0 : 1));
  }, [pestana]);

  const cargarProveedores = useCallback(
    async (tabActual = pestana) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          action: "cc_proveedores_listar",
          activo: tabActual === "inactivos" ? "0" : "1",
        });

        const data = await apiGet(`${API_URL}?${params.toString()}`);
        setProveedores(Array.isArray(data?.proveedores) ? data.proveedores : []);
      } catch (err) {
        onToast?.("error", err?.message || "No se pudieron cargar los proveedores.");
      } finally {
        setLoading(false);
      }
    },
    [onToast, pestana]
  );

  const cargarFiscalProveedor = useCallback(async (idProveedor) => {
    const id = Number(idProveedor || 0);
    if (!id) return null;

    try {
      const params = new URLSearchParams({
        action: "cc_proveedor_fiscal_get",
        id_proveedor: String(id),
      });
      const data = await apiGet(`${API_URL}?${params.toString()}`);
      const fiscal = (data?.cliente_fiscal || data?.proveedor_fiscal) ? normalizeFiscalData(data.cliente_fiscal || data.proveedor_fiscal) : null;
      return fiscal && (fiscal.id_cliente_fiscal || fiscal.cuit) ? fiscal : null;
    } catch {
      return null;
    }
  }, []);

  const actualizarCampoFiscal = useCallback((campo, valor) => {
    setForm((prev) => {
      const cuitActual = onlyDigits(prev.cuit);
      const base = normalizeFiscalData(prev.fiscalData || {
        cuit: cuitActual,
        doc_nro: cuitActual,
        doc_tipo: 80,
        origen: "manual",
        activo: 1,
      });

      const next = { ...base };

      if (campo === "cuit") {
        const cuit = onlyDigits(valor);
        next.cuit = cuit;
        next.doc_nro = cuit;
        return {
          ...prev,
          cuit,
          fiscalData: next,
          fiscalError: "",
          fiscalConsultado: false,
          cargaManual: false,
        };
      }

      if (campo === "razon_social") {
        next.razon_social = toUpperValue(valor);
        return {
          ...prev,
          nombre: toUpperValue(valor),
          fiscalData: next,
          fiscalError: "",
          cargaManual: false,
        };
      }

      next[campo] = campo === "condicion_iva" ? safeStr(valor) : String(valor ?? "");

      return {
        ...prev,
        fiscalData: next,
        fiscalError: "",
        cargaManual: false,
      };
    });
  }, []);

  const abrirDatosLegales = useCallback(async (row) => {
    const fiscalRow = fiscalFromProveedorRow(row);
    setModalFiscal({
      open: true,
      row,
      fiscal: fiscalRow,
      loading: true,
    });

    const fiscalDb = await cargarFiscalProveedor(getProveedorId(row));

    setModalFiscal({
      open: true,
      row,
      fiscal: fiscalDb || fiscalRow,
      loading: false,
    });
  }, [cargarFiscalProveedor]);

  const cerrarDatosLegales = useCallback(() => {
    if (modalFiscal.loading) return;
    setModalFiscal({ open: false, row: null, fiscal: null, loading: false });
  }, [modalFiscal.loading]);

  useEffect(() => {
    if (!open) return;
    cargarProveedores(pestana);
    resetForm();
  }, [open, pestana, cargarProveedores, resetForm]);

  const proveedoresOrdenados = useMemo(() => {
    return [...proveedores].sort((a, b) =>
      String(a?.nombre || "").localeCompare(String(b?.nombre || ""), "es", {
        sensitivity: "base",
      })
    );
  }, [proveedores]);

  const proveedoresFiltrados = useMemo(() => {
    const needle = normalizeSearch(busqueda);

    if (!needle) return proveedoresOrdenados;

    const needleDigits = onlyDigits(busqueda);

    return proveedoresOrdenados.filter((row) => {
      const fiscal = fiscalFromProveedorRow(row);
      const nombre = normalizeSearch(row?.nombre);
      const razonSocial = normalizeSearch(fiscal?.razon_social || row?.razon_social || "");
      const cuit = onlyDigits(fiscal?.cuit || row?.cuit || "");
      const id = String(getProveedorId(row));

      return (
        nombre.includes(needle) ||
        razonSocial.includes(needle) ||
        id.includes(needle) ||
        (needleDigits !== "" && cuit.includes(needleDigits))
      );
    });
  }, [proveedoresOrdenados, busqueda]);

  const iniciarEdicion = async (row, fiscalPreloaded = null) => {
    const fiscalRow = fiscalPreloaded || fiscalFromProveedorRow(row);
    setModo("editar");
    setEditandoId(getProveedorId(row));
    setFormModalOpen(true);
    setForm({
      ...buildEmptyForm(Number(row?.activo ?? 1) === 1 ? 1 : 0),
      nombre: toUpperValue(row?.nombre),
      cuit: onlyDigits(fiscalRow?.cuit || row?.cuit || ""),
      fiscalData: fiscalRow,
      fiscalConsultado: !!fiscalRow,
      cargaManual: !fiscalRow,
    });

    if (fiscalPreloaded) return;

    const fiscalDb = await cargarFiscalProveedor(getProveedorId(row));
    if (fiscalDb) {
      setForm((prev) => ({
        ...prev,
        cuit: onlyDigits(fiscalDb.cuit || fiscalDb.doc_nro || prev.cuit),
        fiscalData: fiscalDb,
        fiscalConsultado: true,
        cargaManual: false,
      }));
    }
  };

  const editarDesdeModalFiscal = useCallback(() => {
    const row = modalFiscal.row;
    const fiscal = modalFiscal.fiscal;
    setModalFiscal({ open: false, row: null, fiscal: null, loading: false });
    if (row) iniciarEdicion(row, fiscal);
  }, [modalFiscal.row, modalFiscal.fiscal]);

  const cancelarEdicion = () => {
    setFormModalOpen(false);
    resetForm();
  };

  const abrirNuevoProveedor = () => {
    resetForm();
    setFormModalOpen(true);
  };

  const consultarArca = useCallback(async () => {
    const cuit = onlyDigits(form.cuit);

    if (cuit.length !== 11) {
      setForm((prev) => ({
        ...prev,
        fiscalError: "Ingresá un CUIT válido de 11 dígitos.",
        fiscalData: null,
        fiscalConsultado: true,
      }));
      return null;
    }

    setForm((prev) => ({
      ...prev,
      fiscalLoading: true,
      fiscalError: "",
      fiscalData: null,
      fiscalConsultado: false,
    }));

    try {
      const params = new URLSearchParams({
        action: "padron_cuit",
        op: "padron_cuit",
        cuit,
      });

      const data = await apiGet(`${API_URL}?${params.toString()}`);
      const summary = data?.data?.summary ?? data?.summary ?? data?.proveedor ?? data?.data ?? null;
      const fiscal = normalizeFiscalData(summary);

      if (!fiscal.cuit || !fiscal.razon_social) {
        throw new Error("ARCA no devolvió datos completos para ese CUIT.");
      }

      setForm((prev) => ({
        ...prev,
        nombre: toUpperValue(fiscal.razon_social || prev.nombre),
        cuit: fiscal.cuit,
        fiscalData: fiscal,
        fiscalError: "",
        fiscalLoading: false,
        fiscalConsultado: true,
        cargaManual: false,
      }));

      if (summary?.constancia_completa === false || summary?.advertencia) {
        onToast?.(
          "advertencia",
          summary?.advertencia ||
            "ARCA identificó a la persona, pero no devolvió la constancia fiscal completa. Revisá el nombre y guardá."
        );
      } else {
        onToast?.("exito", "Datos fiscales encontrados. Revisá y guardá el proveedor.");
      }
      return fiscal;
    } catch (err) {
      setForm((prev) => ({
        ...prev,
        fiscalData: null,
        fiscalError:
          err?.message ||
          "No se encontró el CUIT en ARCA. Podés cargar el proveedor manualmente con el nombre solamente.",
        fiscalLoading: false,
        fiscalConsultado: true,
        cargaManual: true,
      }));
      return null;
    }
  }, [form.cuit, onToast]);

  const usarCargaManual = useCallback(() => {
    setForm((prev) => ({
      ...prev,
      cuit: "",
      fiscalData: null,
      fiscalError: "",
      fiscalLoading: false,
      fiscalConsultado: false,
      cargaManual: true,
    }));
    onToast?.("info", "Carga manual activada. Guardá solo el nombre del proveedor.");
  }, [onToast]);

  const guardarConFiscal = async (payloadBase, fiscal) => {
    const f = normalizeFiscalData(fiscal);
    const data = await apiPost("cc_proveedor_guardar_con_fiscal", {
      id_proveedor: modo === "editar" ? editandoId : null,
      nombre: payloadBase.nombre,
      activo: payloadBase.activo,
      actualizar_nombre_proveedor: 1,
      fiscal: {
        id_cliente_fiscal: f.id_cliente_fiscal,
        doc_tipo: Number(f.doc_tipo || 80),
        doc_nro: f.doc_nro || f.cuit,
        cuit: f.cuit,
        razon_social: f.razon_social,
        condicion_iva: f.condicion_iva,
        domicilio: f.domicilio,
        origen: f.origen || "arca_cuit",
        activo: 1,
      },
    });

    return data;
  };

  const handleGuardar = async () => {
    const payload = {
      nombre: toUpperValue(form.nombre).trim(),
      activo: Number(form.activo) === 1 ? 1 : 0,
    };

    const tieneFiscalValido = fiscalIsUsable(form.fiscalData);
    const cuitIngresado = onlyDigits(form.cuit);

    if (!payload.nombre && !tieneFiscalValido) {
      onToast?.("error", "El nombre del proveedor es obligatorio. Si tiene CUIT, primero consultalo en ARCA.");
      return;
    }

    if (cuitIngresado && cuitIngresado.length !== 11) {
      onToast?.("error", "El CUIT debe tener 11 dígitos o dejarse vacío para cargar manualmente.");
      return;
    }

    if (cuitIngresado.length === 11 && !tieneFiscalValido) {
      onToast?.(
        "advertencia",
        "Ingresaste un CUIT pero todavía no hay datos de ARCA. Podés consultarlo o borrar el CUIT para guardarlo como proveedor manual.",
        5200
      );
      return;
    }

    setSaving(true);

    try {
      let data;
      let tabDestino = payload.activo === 1 ? "activos" : "inactivos";

      if (tieneFiscalValido) {
        data = await guardarConFiscal(payload, form.fiscalData);
        const proveedorGuardado = data?.proveedor || null;
        tabDestino = Number(proveedorGuardado?.activo ?? payload.activo) === 1 ? "activos" : "inactivos";
        onToast?.("exito", data?.mensaje || "Proveedor y datos fiscales guardados correctamente.");
      } else if (modo === "crear") {
        data = await apiPost("cc_proveedor_crear", payload);
        onToast?.("exito", data?.mensaje || "Proveedor creado correctamente.");
      } else {
        data = await apiPost("cc_proveedor_actualizar", {
          id_proveedor: editandoId,
          ...payload,
        });
        onToast?.("exito", data?.mensaje || "Proveedor actualizado correctamente.");
      }

      notifyGlobalListasUpdated("proveedores");
      setPestana(tabDestino);
      await cargarProveedores(tabDestino);
      await onActualizado?.();
      setFormModalOpen(false);
      resetForm();
    } catch (err) {
      onToast?.("error", err?.message || "No se pudo guardar el proveedor.");
    } finally {
      setSaving(false);
    }
  };

  const abrirModalAccion = useCallback((type, row) => {
    setModalAccion({
      open: true,
      type,
      row,
      loading: false,
    });
  }, []);

  const cerrarModalAccion = useCallback(() => {
    if (modalAccion.loading) return;

    setModalAccion({
      open: false,
      type: null,
      row: null,
      loading: false,
    });
  }, [modalAccion.loading]);

  const ejecutarAccionModal = useCallback(async () => {
    const { row, type } = modalAccion;
    const id = getProveedorId(row);

    if (!id || !type) {
      throw new Error("No se encontró el proveedor seleccionado.");
    }

    setModalAccion((prev) => ({ ...prev, loading: true }));
    setAccionandoId(id);

    try {
      let action = "";
      let successFallback = "";

      if (type === "baja") {
        action = "cc_proveedor_dar_baja";
        successFallback = "Proveedor dado de baja correctamente.";
      } else if (type === "alta") {
        action = "cc_proveedor_dar_alta";
        successFallback = "Proveedor dado de alta correctamente.";
      } else if (type === "eliminar") {
        action = "cc_proveedor_eliminar";
        successFallback = "Proveedor eliminado correctamente.";
      } else {
        throw new Error("Acción inválida.");
      }

      const data = await apiPost(action, { id_proveedor: id });

      onToast?.("exito", data?.mensaje || successFallback);

      if ((type === "baja" || type === "eliminar") && id === Number(editandoId || 0)) {
        resetForm();
      }

      notifyGlobalListasUpdated("proveedores");
      await cargarProveedores(pestana);
      await onActualizado?.();

      setModalAccion({
        open: false,
        type: null,
        row: null,
        loading: false,
      });
    } catch (err) {
      onToast?.("error", err?.message || "No se pudo completar la acción.");
    } finally {
      setAccionandoId(null);
      setModalAccion((prev) => ({ ...prev, loading: false }));
    }
  }, [
    modalAccion,
    editandoId,
    cargarProveedores,
    pestana,
    onActualizado,
    onToast,
    resetForm,
  ]);

  const modalConfig = useMemo(() => {
    const row = modalAccion.row;
    const nombre = String(row?.nombre || "—");
    const activo = Number(row?.activo ?? 1) === 1;
    const fiscal = fiscalFromProveedorRow(row);
    const detailsBase = [
      { label: "ID Proveedor", value: `#${getProveedorId(row)}` },
      { label: "Nombre", value: nombre },
      ...(fiscal?.cuit ? [{ label: "CUIT", value: fiscal.cuit }] : []),
    ];

    if (modalAccion.type === "baja") {
      return {
        title: "Dar de baja proveedor",
        message: "¿Seguro que querés dar de baja este proveedor?",
        warning: "El proveedor pasará a la pestaña de inactivos.",
        loadingMessage: "Dando de baja proveedor...",
        successMessage: "Proveedor dado de baja correctamente.",
        errorMessage: "No se pudo dar de baja el proveedor.",
        confirmLabel: "Dar de baja",
        confirmVariant: "danger",
        details: [...detailsBase, { label: "Estado actual", value: "Activo" }],
      };
    }

    if (modalAccion.type === "alta") {
      return {
        title: "Dar de alta proveedor",
        message: "¿Seguro que querés dar de alta este proveedor?",
        warning: "El proveedor volverá a la pestaña de activos.",
        loadingMessage: "Dando de alta proveedor...",
        successMessage: "Proveedor dado de alta correctamente.",
        errorMessage: "No se pudo dar de alta el proveedor.",
        confirmLabel: "Dar de alta",
        confirmVariant: "primary",
        details: [...detailsBase, { label: "Estado actual", value: "Inactivo" }],
      };
    }

    return {
      title: "Eliminar proveedor",
      message: "¿Seguro que querés eliminar este proveedor definitivamente?",
      warning: "Esta acción no se puede deshacer.",
      loadingMessage: "Eliminando proveedor...",
      successMessage: "Proveedor eliminado correctamente.",
      errorMessage: "No se pudo eliminar el proveedor.",
      confirmLabel: "Eliminar",
      confirmVariant: "danger",
      details: [...detailsBase, { label: "Estado", value: activo ? "Activo" : "Inactivo" }],
    };
  }, [modalAccion]);

  if (!open) return null;

  return createPortal(
    <div
      className={[
        "mi-modal__overlay",
        dark ? "mi-modal__overlay--dark" : "",
      ].join(" ").trim()}
    >
      <div
        className={[
          "mi-modal__container",
          "mi-modal__container--categorias",
          "cc-entity-modal",
          dark ? "mi-modal--dark" : "",
        ].join(" ").trim()}
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mi-modal__header">
          <div className="mi-modal__head-icon" aria-hidden="true">
            <FontAwesomeIcon icon={faTruckField} />
          </div>

          <div className="mi-modal__head-left">
            <h2 className="mi-modal__title">Proveedores</h2>
            <p className="mi-modal__subtitle">
              Administrá el listado de proveedores. Usá Agregar proveedor o Editar para abrir el formulario separado.
            </p>
          </div>

          <button
            ref={closeBtnRef}
            type="button"
            className="mi-modal__close"
            disabled={isBusy}
            onClick={() => onClose?.()}
            aria-label="Cerrar"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="mi-modal__content">
          <div className="mi-cr-grid cc-entity-admin-grid cc-entity-admin-grid--list-only">
            <section className="mi-cr-table cc-entity-list-panel">
              <div className="mi-cr-table__foot mi-cr-table__foot--top">
                <div className="mi-cr-table__summary">
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--nv-text)" }}>
                      Listado de proveedores
                    </div>
                    <div style={{ fontSize: 12, color: "var(--nv-muted)" }}>
                      Total: <b>{proveedoresFiltrados.length}</b>
                      {busqueda.trim() && (
                        <>
                          {" "}
                          / {proveedoresOrdenados.length}
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="cc-filter cc-filter--search" id="vents-comppr-wits">
                  <div className="cc-floatingField cc-floatingField--search is-active">
                    <div className="cc-searchInput">
                      <div className="cc-searchInput__fieldWrap cc-field">
                        <input
                          className="cc-input cc-input--floating"
                          value={busqueda}
                          onChange={(e) => setBusqueda(e.target.value)}
                          placeholder="Buscar por proveedor o CUIT..."
                          disabled={loading || saving || modalAccion.loading}
                        />

                        <span className="cc-floatingLabel">
                          <FontAwesomeIcon icon={faMagnifyingGlass} /> Búsqueda
                        </span>

                        {busqueda.trim() !== "" && !loading && (
                          <button
                            type="button"
                            className="cc-clearSearch cc-clearSearch--inside"
                            onClick={() => setBusqueda("")}
                            disabled={saving || modalAccion.loading}
                            title="Limpiar búsqueda"
                          >
                            <FontAwesomeIcon icon={faXmark} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="cc-entity-toolbar-actions">
                  <button
                    type="button"
                    className="mit-btn mit-btn--solid"
                    onClick={abrirNuevoProveedor}
                    disabled={loading || saving || modalAccion.loading}
                  >
                    <FontAwesomeIcon icon={faPlus} />
                    Agregar proveedor
                  </button>

                  <button
                    type="button"
                    className={`mit-btn ${pestana === "activos" ? "mit-btn--solid" : "mit-btn--ghost"}`}
                    onClick={() => {
                      setPestana("activos");
                      setModo("crear");
                      setEditandoId(null);
                      setForm(buildEmptyForm(1));
                      setFormModalOpen(false);
                    }}
                    disabled={loading || saving || modalAccion.loading}
                  >
                    Activos
                  </button>

                  <button
                    type="button"
                    className={`mit-btn ${pestana === "inactivos" ? "mit-btn--solid" : "mit-btn--ghost"}`}
                    onClick={() => {
                      setPestana("inactivos");
                      setModo("crear");
                      setEditandoId(null);
                      setForm(buildEmptyForm(0));
                      setFormModalOpen(false);
                    }}
                    disabled={loading || saving || modalAccion.loading}
                  >
                    Inactivos
                  </button>
                </div>
              </div>

              <div className="cc-cliente-table cc-entity-list-table">
                <div className="cc-cliente-table__desktopHead">
                  <div className="cc-grid-header">
                    <div className="cc-grid-header__cell">Proveedor</div>
                    <div className="cc-grid-header__cell">Estado</div>
                    <div className="cc-grid-header__cell">Acciones</div>
                  </div>
                </div>

                <div className="cc-cliente-table__body">
                  {loading ? (
                    <div className="cc-loading-state">
                      <FontAwesomeIcon icon={faArrowRotateRight} spin />
                      <span>Cargando proveedores...</span>
                    </div>
                  ) : proveedoresFiltrados.length === 0 ? (
                    <div className="cc-empty-state">
                      <FontAwesomeIcon icon={faTruckField} />
                      <span>
                        {busqueda.trim()
                          ? `No se encontraron proveedores para "${busqueda}".`
                          : pestana === "activos"
                          ? "No hay proveedores activos."
                          : "No hay proveedores inactivos."}
                      </span>
                    </div>
                  ) : (
                    <div className="cc-grid-rows">
                      {proveedoresFiltrados.map((row) => {
                        const activo = Number(row?.activo ?? 1) === 1;
                        const bloqueado =
                          accionandoId === getProveedorId(row) ||
                          saving ||
                          modalAccion.loading;
                        const fiscal = fiscalFromProveedorRow(row);
                        // ── Solo mostrar botón fiscal si el proveedor tiene CUIT ──
                        const tieneCuit = !!fiscal?.cuit;

                        return (
                          <div key={getProveedorId(row)} className="cc-grid-row">
                            <div className="cc-grid-cell">
                              <span
                                className="cc-ellipsis-text"
                                title={row?.nombre || "—"}
                                style={{ display: "block" }}
                              >
                                {row?.nombre || "—"}
                              </span>
                              <span
                                className="cc-grid-submeta"
                                title={tieneCuit ? `${fiscal.cuit} - ${fiscal.razon_social || ""}` : "Proveedor sin datos fiscales"}
                              >
                                {tieneCuit ? `CUIT ${fiscal.cuit}` : "Sin datos fiscales / manual"}
                              </span>
                            </div>

                            <div className="cc-grid-cell">
                              <span
                                className={`cc-status-badge ${
                                  activo
                                    ? "cc-status-badge--active"
                                    : "cc-status-badge--inactive"
                                }`}
                              >
                                {activo ? "Activo" : "Inactivo"}
                              </span>
                            </div>

                            <div className="cc-grid-cell">
                              <div className="cc-actions-group">
                                {/* ── Botón datos fiscales: solo si tiene CUIT ── */}
                                {tieneCuit && (
                                  <button
                                    type="button"
                                    className="cc-action-btn cc-action-btn--legal"
                                    onClick={() => abrirDatosLegales(row)}
                                    disabled={bloqueado}
                                    title="Ver datos legales"
                                  >
                                    <FontAwesomeIcon icon={faFileInvoiceDollar} />
                                  </button>
                                )}

                                {activo ? (
                                  <>
                                    <button
                                      type="button"
                                      className="cc-action-btn"
                                      onClick={() => iniciarEdicion(row)}
                                      disabled={bloqueado}
                                      title="Editar"
                                    >
                                      <FontAwesomeIcon icon={faPenToSquare} />
                                    </button>

                                    <button
                                      type="button"
                                      className="cc-action-btn"
                                      onClick={() => abrirModalAccion("baja", row)}
                                      disabled={bloqueado}
                                      title="Dar de baja"
                                    >
                                      <FontAwesomeIcon icon={faUserSlash} />
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    className="cc-action-btn"
                                    onClick={() => abrirModalAccion("alta", row)}
                                    disabled={bloqueado}
                                    title="Dar de alta"
                                  >
                                    <FontAwesomeIcon icon={faUserCheck} />
                                  </button>
                                )}

                                <button
                                  type="button"
                                  className="cc-action-btn cc-action-btn--danger"
                                  onClick={() => abrirModalAccion("eliminar", row)}
                                  disabled={bloqueado}
                                  title="Eliminar"
                                >
                                  <FontAwesomeIcon icon={faTrashCan} />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>


              </div>
            </section>
          </div>
        </div>

        <div className="mit-actions">
          <span className="mit-help">
            Proveedores simples para cuenta corriente y proveedores fiscales para facturación ARCA.
          </span>
          <button
            type="button"
            className="mit-btn mit-btn--ghost"
            onClick={() => onClose?.()}
            disabled={isBusy}
          >
            Cerrar
          </button>
        </div>
      </div>


      <ModalFormularioProveedor
        open={formModalOpen}
        dark={dark}
        modo={modo}
        saving={saving}
        fiscalLoading={form.fiscalLoading}
        activo={form.activo}
        onActivoChange={(activo) => setForm((prev) => ({ ...prev, activo }))}
        onGuardar={handleGuardar}
        saveLabel={
          saving
            ? "Guardando..."
            : modo === "crear"
            ? fiscalIsUsable(form.fiscalData)
              ? "Crear proveedor fiscal"
              : "Crear proveedor"
            : fiscalIsUsable(form.fiscalData)
            ? "Guardar proveedor fiscal"
            : "Guardar"
        }
        onClose={cancelarEdicion}
        arcaControls={modo === "editar" ? (
          <div className="cc-entity-form-arca-side">
            <div className="cc-entity-form-arca-side__title">CUIT ARCA</div>
            <div className="cc-entity-form-arca-row">
              <div className="fl-field cc-entity-form-arca-field">
                <input
                  type="text"
                  inputMode="numeric"
                  className="fl-input"
                  placeholder=" "
                  value={form.cuit}
                  onChange={(e) =>
                    setForm((prev) => {
                      const cuit = normalizeCuitInput(e.target.value);
                      const fiscalActual = fiscalHasAnyData(prev.fiscalData)
                        ? { ...normalizeFiscalData(prev.fiscalData), cuit, doc_nro: cuit }
                        : null;

                      return {
                        ...prev,
                        cuit,
                        fiscalData: fiscalActual,
                        fiscalError: "",
                        fiscalConsultado: false,
                        cargaManual: !fiscalActual,
                      };
                    })
                  }
                  disabled={saving || form.fiscalLoading}
                />
                <label className="fl-label">
                  <FontAwesomeIcon icon={faIdCard} style={{ marginRight: 5 }} />
                  CUIT ARCA
                </label>
              </div>

              <button
                type="button"
                className="mit-btn mit-btn--ghost cc-entity-form-arca-no-cuit"
                onClick={usarCargaManual}
                disabled={saving || form.fiscalLoading}
                title="Cargar proveedor sin datos fiscales"
              >
                Sin CUIT
              </button>
            </div>

            <div className="cc-entity-form-arca-actions">
              <button
                type="button"
                className="mit-btn mit-btn--ghost mit-btn--block"
                onClick={consultarArca}
                disabled={saving || form.fiscalLoading || onlyDigits(form.cuit).length !== 11}
              >
                <FontAwesomeIcon icon={faMagnifyingGlass} style={{ marginRight: 8 }} />
                {form.fiscalLoading ? "Consultando..." : "Consultar ARCA"}
              </button>
            </div>

            {form.fiscalError && (
              <div className="cc-fiscal-alert cc-fiscal-alert--error cc-entity-form-arca-alert">
                {form.fiscalError} Completá el nombre y guardalo sin CUIT si corresponde.
              </div>
            )}
          </div>
        ) : null}
      >
        <div className="mi-cr-filters__body cc-entity-form-body">
          {modo === "crear" && (
            <>
              <div className="cc-fiscal-intro-card">
                <b className="cc-fiscal-intro-card__title">
                  <FontAwesomeIcon icon={faFileInvoiceDollar} /> Proveedor fiscal o manual
                </b>
                <span>
                  Ingresá CUIT para traer datos de ARCA. Si no aparece o es compra informal, dejá el CUIT vacío y cargá solo el nombre.
                </span>
              </div>

              <div className="fl-field">
                <input
                  type="text"
                  inputMode="numeric"
                  className="fl-input"
                  placeholder=" "
                  value={form.cuit}
                  onChange={(e) =>
                    setForm((prev) => {
                      const cuit = normalizeCuitInput(e.target.value);
                      const fiscalActual = fiscalHasAnyData(prev.fiscalData)
                        ? { ...normalizeFiscalData(prev.fiscalData), cuit, doc_nro: cuit }
                        : null;

                      return {
                        ...prev,
                        cuit,
                        fiscalData: fiscalActual,
                        fiscalError: "",
                        fiscalConsultado: false,
                        cargaManual: !fiscalActual,
                      };
                    })
                  }
                  disabled={saving || form.fiscalLoading}
                />
                <label className="fl-label">
                  <FontAwesomeIcon icon={faIdCard} style={{ marginRight: 5 }} />
                  CUIT ARCA
                </label>
              </div>

              <div className="mi-cr-filters__actions cc-fiscal-action-row">
                <button
                  type="button"
                  className="mit-btn mit-btn--ghost mit-btn--block"
                  onClick={consultarArca}
                  disabled={saving || form.fiscalLoading || onlyDigits(form.cuit).length !== 11}
                >
                  <FontAwesomeIcon icon={faMagnifyingGlass} style={{ marginRight: 8 }} />
                  {form.fiscalLoading ? "Consultando..." : "Consultar ARCA"}
                </button>

                <button
                  type="button"
                  className="mit-btn mit-btn--ghost mit-btn--block"
                  onClick={usarCargaManual}
                  disabled={saving || form.fiscalLoading}
                  title="Cargar proveedor sin datos fiscales"
                >
                  Sin CUIT
                </button>
              </div>

              {form.fiscalError && (
                <div className="cc-fiscal-alert cc-fiscal-alert--error">
                  {form.fiscalError} Completá el nombre y guardalo sin CUIT si corresponde.
                </div>
              )}

              <FiscalResumen fiscal={form.fiscalData} />
            </>
          )}

          <FiscalEditableFields
            fiscal={form.fiscalData}
            cuit={form.cuit}
            saving={saving}
            fiscalLoading={form.fiscalLoading}
            onFieldChange={actualizarCampoFiscal}
          />

          <div className="fl-field">
            <input
              type="text"
              className="fl-input"
              placeholder=" "
              value={form.nombre}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  nombre: toUpperValue(e.target.value),
                }))
              }
              disabled={saving || form.fiscalLoading}
            />
            <label className="fl-label">
              <FontAwesomeIcon icon={faBuilding} style={{ marginRight: 5 }} />
              Nombre / razón social *
            </label>
          </div>
        </div>
      </ModalFormularioProveedor>

      <ModalDatosLegalesProveedor
        open={modalFiscal.open}
        dark={dark}
        row={modalFiscal.row}
        fiscal={modalFiscal.fiscal}
        loading={modalFiscal.loading}
        onClose={cerrarDatosLegales}
        onEdit={editarDesdeModalFiscal}
      />

      <ModalEliminar
        open={modalAccion.open}
        row={
          modalAccion.row
            ? {
                id: getProveedorId(modalAccion.row),
                nombre: modalAccion.row?.nombre || "—",
                estado:
                  Number(modalAccion.row?.activo ?? 1) === 1 ? "Activo" : "Inactivo",
              }
            : null
        }
        loading={modalAccion.loading}
        onClose={cerrarModalAccion}
        onConfirm={ejecutarAccionModal}
        onToast={onToast}
        title={modalConfig.title}
        message={modalConfig.message}
        warning={modalConfig.warning}
        loadingMessage={modalConfig.loadingMessage}
        successMessage={modalConfig.successMessage}
        errorMessage={modalConfig.errorMessage}
        confirmLabel={modalConfig.confirmLabel}
        cancelLabel="Cancelar"
        confirmVariant={modalConfig.confirmVariant}
        details={modalConfig.details}
      />
    </div>,
    document.body
  );
}
