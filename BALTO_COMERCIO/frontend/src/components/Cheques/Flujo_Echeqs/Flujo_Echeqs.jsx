import React, { useCallback, useEffect, useMemo, useState } from "react";
import "../../Global/Global_css/Global_Section.css";
import "../../Global/Global_css/Global_responsive.css";
import Toast from "../../Global/Toast.jsx";
import ModalVerComprobante from "../../Global/Ver_Comprobantes/ModalVerComprobante.jsx";
import ModalRevertirDeposito from "../modales/ModalRevertirDeposito.jsx";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faMagnifyingGlass,
  faBoxOpen,
  faArrowRightToBracket,
  faBuildingColumns,
  faCircleInfo,
  faEye,
  faRotateLeft,
} from "@fortawesome/free-solid-svg-icons";
import {
  construirUrlComprobante,
  listarFlujoEcheqs,
  revertirDepositoEcheq,
} from "../api/chequesApi";
import useChequesToast from "../hooks/useChequesToast";
import {
  EVENTO_CANONICO,
  formatFecha,
  getArchivoRef,
  humanizarEventoDesconocido,
  inferMime,
  moneyARS,
  normalizeFlujoEcheq,
  normalizarEvento,
  notifyReversionDeposito,
  safeText,
  usuarioActualEsAdmin,
} from "../utils/chequesUtils";

const EVENTO_CONFIG = {
  [EVENTO_CANONICO.INGRESO_CARTERA]: {
    label: "Ingreso a cartera",
    icon: faArrowRightToBracket,
    chipClass: "mov-chip--ok",
  },
  [EVENTO_CANONICO.DEPOSITADO_BANCO]: {
    label: "Depositado en banco",
    icon: faBuildingColumns,
    chipClass: "mov-chip--info",
  },
  [EVENTO_CANONICO.EGRESO_CARTERA]: {
    label: "Egreso de cartera",
    icon: faCircleInfo,
    chipClass: "mov-chip--warn",
  },
};

function eventoConfig(evento) {
  const key = normalizarEvento(evento);

  return (
    EVENTO_CONFIG[key] ?? {
      label: humanizarEventoDesconocido(evento),
      icon: faCircleInfo,
      chipClass: "mov-chip--neutral",
    }
  );
}

const PAGE_SIZE = 100;
const SKELETON_ROWS = 8;

/* ═══════════════════════════════════════════
   Componente principal
═══════════════════════════════════════════ */
const Flujo_Echeqs = () => {
  const [allRows, setAllRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  const [modalComprobanteOpen, setModalComprobanteOpen] = useState(false);
  const [modalComprobanteUrl, setModalComprobanteUrl] = useState("");
  const [modalComprobanteMime, setModalComprobanteMime] = useState("");
  const [modalComprobanteTitle, setModalComprobanteTitle] =
    useState("Comprobante de E-Cheq");

  const [modalReversionOpen, setModalReversionOpen] = useState(false);
  const [reversionRow, setReversionRow] = useState(null);
  const [revirtiendo, setRevirtiendo] = useState(false);
  const esAdmin = useMemo(() => usuarioActualEsAdmin(), []);

  const { toast, showToast, closeToast } = useChequesToast();

  const closeModalComprobante = useCallback(() => {
    setModalComprobanteOpen(false);
    setModalComprobanteUrl("");
    setModalComprobanteMime("");
    setModalComprobanteTitle("Comprobante de E-Cheq");
  }, []);

  const openModalComprobante = useCallback(
    (row) => {
      const flujo = normalizeFlujoEcheq(row);
      const idCheque = Number(flujo?.id_cheque || 0);

      if (!idCheque) {
        showToast("error", "No se pudo identificar el e-cheq.");
        return;
      }

      const finalUrl = construirUrlComprobante(
        "echeq_cartera_comprobante_ver",
        idCheque
      );

      const archivoRef =
        row?.archivo_path ||
        row?.archivoPath ||
        row?.archivo_url ||
        row?.archivoUrl ||
        flujo?.archivo_path ||
        flujo?.archivo_url ||
        "";

      const mimeFinal =
        inferMime(archivoRef) ||
        String(row?.archivo_mime || row?.mime || flujo?.archivo_mime || "").trim() ||
        "application/pdf";

      setModalComprobanteUrl(finalUrl);
      setModalComprobanteMime(mimeFinal);
      setModalComprobanteTitle("Comprobante de E-Cheq");
      setModalComprobanteOpen(true);
    },
    [showToast]
  );

  const fetchFlujo = useCallback(
    async ({ offset = 0, append = false, qValue = "" } = {}) => {
      const data = await listarFlujoEcheqs({
        limit: PAGE_SIZE,
        offset,
        q: qValue,
      });

      const lista = Array.isArray(data?.flujo)
        ? data.flujo.map(normalizeFlujoEcheq)
        : [];

      if (append) {
        setAllRows((prev) => {
          const base = Array.isArray(prev) ? prev : [];
          const ids = new Set(base.map((x) => String(x.id_flujo)));

          return [...base, ...lista.filter((x) => !ids.has(String(x.id_flujo)))];
        });
      } else {
        setAllRows(lista);
      }

      setHasMore(!!data?.has_more);
      setNextOffset(Number(data?.next_offset || 0));

      return { ...data, flujo: lista };
    },
    []
  );

  const closeModalReversion = useCallback(() => {
    if (revirtiendo) return;
    setModalReversionOpen(false);
    setReversionRow(null);
  }, [revirtiendo]);

  const openModalReversion = useCallback(
    (row) => {
      if (!esAdmin) {
        showToast("error", "Sólo un administrador puede reactivar un depósito.");
        return;
      }

      const flujo = normalizeFlujoEcheq(row);
      if (
        Number(flujo?.id_cheque || 0) <= 0 ||
        normalizarEvento(flujo?.evento) !== EVENTO_CANONICO.DEPOSITADO_BANCO ||
        String(flujo?.estado || "").trim().toUpperCase() !== "DEPOSITADO_BANCO"
      ) {
        showToast("error", "Este depósito ya no se puede reactivar desde el flujo.");
        return;
      }

      setReversionRow(flujo);
      setModalReversionOpen(true);
    },
    [esAdmin, showToast]
  );

  const confirmarReversion = useCallback(
    async (payload) => {
      const idCheque = Number(reversionRow?.id_cheque || 0);
      if (!idCheque || revirtiendo) return;

      setRevirtiendo(true);
      try {
        const data = await revertirDepositoEcheq({
          idCheque,
          fechaReversion: payload?.fecha_reversion,
          motivo: payload?.motivo,
        });

        setModalReversionOpen(false);
        setReversionRow(null);
        notifyReversionDeposito("echeq");
        await fetchFlujo({ offset: 0, append: false, qValue: debouncedQ });
        showToast(
          "exito",
          data?.mensaje || "E-Cheq reactivado correctamente y disponible en cartera.",
          3600
        );
      } catch (errorReversion) {
        showToast(
          "error",
          errorReversion?.message || "No se pudo reactivar el e-cheq.",
          4800
        );
      } finally {
        setRevirtiendo(false);
      }
    },
    [debouncedQ, fetchFlujo, reversionRow, revirtiendo, showToast]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQ(q);
    }, 500);

    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    let active = true;

    (async () => {
      setLoading(true);
      setError("");

      try {
        await fetchFlujo({
          offset: 0,
          append: false,
          qValue: debouncedQ,
        });
      } catch (e) {
        if (active) {
          setError(e?.message || "No se pudo cargar el flujo de e-cheqs.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [fetchFlujo, debouncedQ]);

  const rows = useMemo(() => {
    return allRows;
  }, [allRows]);

  const depositosRevertibles = useMemo(() => {
    const ids = new Set();
    const chequesVistos = new Set();

    for (const row of rows) {
      const idCheque = Number(row?.id_cheque || 0);
      if (
        idCheque <= 0 ||
        chequesVistos.has(idCheque) ||
        normalizarEvento(row?.evento) !== EVENTO_CANONICO.DEPOSITADO_BANCO ||
        String(row?.estado || "").trim().toUpperCase() !== "DEPOSITADO_BANCO"
      ) {
        continue;
      }

      chequesVistos.add(idCheque);
      ids.add(Number(row?.id_flujo || 0));
    }

    return ids;
  }, [rows]);

  const handleLoadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;

    setLoadingMore(true);
    setError("");

    try {
      const data = await fetchFlujo({
        offset: nextOffset,
        append: true,
        qValue: debouncedQ,
      });

      showToast(
        "exito",
        `${Array.isArray(data?.flujo) ? data.flujo.length : 0} registros más cargados.`
      );
    } catch (e) {
      setError(e?.message || "No se pudieron cargar más registros.");
      showToast("error", e?.message || "No se pudieron cargar más registros.");
    } finally {
      setLoadingMore(false);
    }
  }, [fetchFlujo, hasMore, loadingMore, nextOffset, debouncedQ, showToast]);

  const columns = useMemo(
    () => [
      {
        key: "fecha_evento",
        label: "FECHA",
        align: "center",
        fr: 0.9,
        render: (r) => formatFecha(r.fecha_evento),
      },
      {
        key: "tipo_cheque",
        label: "TIPO",
        align: "center",
        fr: 0.6,
        render: () => "ECHEQ",
      },
      {
        key: "numero_cheque",
        label: "N° ECHEQ",
        align: "center",
        fr: 1.0,
        render: (r) => safeText(r.numero_cheque),
      },
      {
        key: "emisor",
        label: "EMISOR",
        align: "left",
        fr: 2.2,
        strong: true,
        render: (r) => safeText(r.emisor),
      },
      {
        key: "importe",
        label: "IMPORTE",
        align: "right",
        fr: 1.0,
        render: (r) => moneyARS(r.importe),
      },
      {
        key: "evento",
        label: "EVENTO",
        align: "center",
        fr: 1.3,
        render: () => null,
      },
      {
        key: "fecha_emision",
        label: "EMITIDO",
        align: "center",
        fr: 0.9,
        render: (r) => formatFecha(r.fecha_emision),
      },
      {
        key: "acciones",
        label: "ACCIONES",
        align: "center",
        fr: 0.6,
        render: () => null,
      },
    ],
    []
  );

  const gridCols = useMemo(
    () => columns.map((c) => `${c.fr ?? 1}fr`).join(" "),
    [columns]
  );

  const skelWidths = useMemo(
    () => ({
      fecha_evento: ["44%", "38%", "42%", "36%"],
      tipo_cheque: ["55%", "50%"],
      numero_cheque: ["52%", "44%", "48%"],
      emisor: ["72%", "58%", "66%", "50%"],
      importe: ["38%", "30%", "34%"],
      evento: ["60%", "55%"],
      fecha_emision: ["44%", "36%"],
    }),
    []
  );

  const renderSkeletonRow = (idx) => (
    <div
      key={`skel-${idx}`}
      className="mov-gridTable mov-gridTable--row mov-row--skeleton"
      style={{ gridTemplateColumns: gridCols }}
      role="row"
      aria-hidden="true"
    >
      {columns.map((c) => {
        if (c.key === "acciones") {
          return (
            <div
              key={c.key}
              className="mov-gridCell mov-gridCell--actions is-center"
              role="cell"
              data-label={c.label}
            >
              <div className="mov-skelActions">
                <span className="mov-skelIcon" />
              </div>
            </div>
          );
        }

        const list = skelWidths[c.key] || ["60%"];
        const w = list[idx % list.length];

        return (
          <div
            key={c.key}
            className={[
              "mov-gridCell",
              c.align === "right" ? "is-right" : "",
              c.align === "center" ? "is-center" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            role="cell"
            data-label={c.label}
          >
            <span className="mov-skeletonBar" style={{ width: w }} />
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="mov-page">
      {toast && (
        <Toast
          tipo={toast.tipo}
          mensaje={toast.mensaje}
          duracion={toast.duracion}
          onClose={closeToast}
        />
      )}

      <ModalVerComprobante
        open={modalComprobanteOpen}
        url={modalComprobanteUrl}
        mime={modalComprobanteMime}
        onClose={closeModalComprobante}
        title={modalComprobanteTitle}
      />

      <ModalRevertirDeposito
        open={modalReversionOpen}
        onClose={closeModalReversion}
        onConfirm={confirmarReversion}
        loading={revirtiendo}
        cheque={reversionRow}
        tipoLabel="E-Cheq"
      />

      {error && (
        <div className="mov-alert" role="alert">
          {error}
        </div>
      )}

      <section className="mov-card mov-card--table">
        <div className="mov-card__head">
          <div className="mov-card__headLeft">
            <div className="title-mov">
              <div className="mov-card__title">Flujo de E-Cheqs</div>
              <div className="mov-card__hint">
                Mostrando <b>{rows.length}</b> registros
                {hasMore ? " (hay más por cargar)" : ""}
              </div>
            </div>

            <div className="mov-headFilters">
              <div className="cc-filter cc-filter--search">
                <div className="cc-floatingField cc-floatingField--search is-active">
                  <div className="cc-searchInput">
                    <div className="cc-searchInput__fieldWrap">
                      <input
                        className="cc-input cc-input--floating"
                        type="text"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Buscar por emisor, N° echeq, evento..."
                        autoComplete="off"
                      />

                      <span className="cc-floatingLabel">
                        <FontAwesomeIcon icon={faMagnifyingGlass} /> Búsqueda
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          className="mov-gridTable mov-gridTable--head"
          style={{ gridTemplateColumns: gridCols }}
          role="row"
        >
          {columns.map((c) => (
            <div
              key={c.key}
              className={[
                "mov-gridCell",
                "mov-gridCell--head",
                c.align === "right" ? "is-right" : "",
                c.align === "center" ? "is-center" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              role="columnheader"
            >
              {c.label}
            </div>
          ))}
        </div>

        <div
          className="mov-tableWrap mov-tableWrap--mov"
          role="rowgroup"
          id="cheques-st"
        >
          <div
            className={[
              "mov-gridBody",
              "mov-gridBody--relative",
              loading ? "mov-softLoading" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {loading ? (
              <div className="mov-skeletonWrap" aria-busy="true">
                {Array.from({ length: SKELETON_ROWS }).map((_, i) =>
                  renderSkeletonRow(i)
                )}
              </div>
            ) : (
              <>
                {rows.map((r) => {
                  const cfg = eventoConfig(r.evento);

                  const puedeVerComprobante =
                    Number(r?.id_cheque || 0) > 0 && !!r?.tiene_comprobante;

                  const puedeReactivarDeposito =
                    esAdmin &&
                    Number(r?.id_cheque || 0) > 0 &&
                    depositosRevertibles.has(Number(r?.id_flujo || 0));

                  return (
                    <div
                      key={r.id_flujo}
                      className="mov-gridTable mov-gridTable--row"
                      style={{ gridTemplateColumns: gridCols }}
                      role="row"
                    >
                      {columns.map((c) => {
                        if (c.key === "evento") {
                          return (
                            <div
                              key={c.key}
                              className="mov-gridCell is-center"
                              role="cell"
                              data-label={c.label}
                            >
                              <span
                                className={`mov-chip flujo-badge ${cfg.chipClass}`}
                                title={cfg.label}
                              >
                                <FontAwesomeIcon icon={cfg.icon} />
                                <span className="flujo-badge__text">
                                  {cfg.label}
                                </span>
                              </span>
                            </div>
                          );
                        }

                        if (c.key === "acciones") {
                          return (
                            <div
                              key={c.key}
                              className="mov-gridCell mov-gridCell--actions is-center"
                              role="cell"
                              data-label={c.label}
                            >
                              <div className="mov-actionsInline">
                                <button
                                  type="button"
                                  className={[
                                    "mov-iconBtn",
                                    puedeVerComprobante
                                      ? "mov-iconBtn--comprobante"
                                      : "mov-iconBtn--disabled",
                                  ]
                                    .filter(Boolean)
                                    .join(" ")}
                                  title={
                                    puedeVerComprobante
                                      ? "Ver comprobante"
                                      : "Sin comprobante"
                                  }
                                  disabled={!puedeVerComprobante}
                                  onClick={() => openModalComprobante(r)}
                                  style={{
                                    opacity: puedeVerComprobante ? 1 : 0.35,
                                    cursor: puedeVerComprobante
                                      ? "pointer"
                                      : "not-allowed",
                                  }}
                                >
                                  <FontAwesomeIcon icon={faEye} />
                                </button>

                                {puedeReactivarDeposito && (
                                  <button
                                    type="button"
                                    className="mov-iconBtn"
                                    title="Reactivar en cartera"
                                    onClick={() => openModalReversion(r)}
                                    disabled={revirtiendo}
                                  >
                                    <FontAwesomeIcon icon={faRotateLeft} />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        }

                        const val = c.render ? c.render(r) : safeText(r[c.key]);

                        return (
                          <div
                            key={c.key}
                            className={[
                              "mov-gridCell",
                              c.align === "right" ? "is-right" : "",
                              c.align === "center" ? "is-center" : "",
                              c.strong ? "is-strong" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            role="cell"
                            data-label={c.label}
                            title={typeof val === "string" ? val : undefined}
                          >
                            <span className="mov-ellipsissss">{val}</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                {rows.length === 0 && (
                  <div className="cc-emptyState">
                    <FontAwesomeIcon icon={faBoxOpen} className="cc-emptyIcon" />

                    <div className="cc-emptyText">
                      {q.trim()
                        ? "No se encontraron registros con el término de búsqueda."
                        : "No hay movimientos en el flujo de e-cheqs."}
                    </div>
                  </div>
                )}

                {allRows.length > 0 && hasMore && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      padding: "12px 0",
                    }}
                  >
                    <button
                      type="button"
                      className="mov-btn mov-btn--loadAll"
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                      title="Cargar 100 registros más"
                    >
                      {loadingMore ? "Cargando…" : "Cargar 100 más"}
                    </button>
                  </div>
                )}

                {loadingMore && (
                  <div className="mov-skeletonMore" aria-busy="true">
                    {Array.from({ length: 4 }).map((_, i) =>
                      renderSkeletonRow(i)
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

export default Flujo_Echeqs;