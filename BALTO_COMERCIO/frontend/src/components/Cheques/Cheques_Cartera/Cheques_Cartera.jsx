import React, { useCallback, useEffect, useMemo, useState } from "react";
import "../../Global/Global_css/Global_Section.css";
import "../../Global/Global_css/Global_responsive.css";
import Toast from "../../Global/Toast.jsx";
import ModalVerComprobante from "../../Global/Ver_Comprobantes/ModalVerComprobante.jsx";
import ModalDepositarCheque from "../modales/ModalDepositarCheque.jsx";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faMagnifyingGlass,
  faBoxOpen,
  faEye,
  faBuildingColumns,
} from "@fortawesome/free-solid-svg-icons";
import {
  construirUrlComprobante,
  depositarChequeCartera,
  listarChequesCartera,
} from "../api/chequesApi";
import useChequesToast from "../hooks/useChequesToast";
import {
  clearMovimientosAfterDepositoCheque,
  formatFecha,
  isValidISODate,
  moneyARS,
  normalizeCheque,
  safeText,
  toISODate,
} from "../utils/chequesUtils";

const PAGE_SIZE = 100;
const SKELETON_ROWS = 8;

const Cheques_Cartera = () => {
  const [allRows, setAllRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const [q, setQ] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);

  const [modalComprobanteOpen, setModalComprobanteOpen] = useState(false);
  const [modalComprobanteUrl, setModalComprobanteUrl] = useState("");
  const [modalComprobanteMime, setModalComprobanteMime] = useState("");
  const [modalComprobanteTitle, setModalComprobanteTitle] = useState("Comprobante de Cheque");

  const [modalDepositarOpen, setModalDepositarOpen] = useState(false);
  const [chequeSeleccionado, setChequeSeleccionado] = useState(null);
  const [depositando, setDepositando] = useState(false);

  /* Toast */
  const { toast, showToast, closeToast } = useChequesToast();

  /* Modal comprobante */
  const closeModalComprobante = useCallback(() => {
    setModalComprobanteOpen(false);
    setModalComprobanteUrl("");
    setModalComprobanteMime("");
    setModalComprobanteTitle("Comprobante de Cheque");
  }, []);

  const openModalComprobante = useCallback(
    (row) => {
      const cheque = normalizeCheque(row);
      const idCheque = Number(cheque?.id_cheque || 0);

      if (!idCheque) {
        showToast("error", "Cheque inválido.");
        return;
      }

      const finalUrl = construirUrlComprobante(
        "cheques_cartera_comprobante_ver",
        idCheque
      );
      setModalComprobanteUrl(finalUrl);
      setModalComprobanteMime(String(cheque?.archivo_mime || "").trim() || "application/pdf");
      setModalComprobanteTitle("Comprobante de Cheque");
      setModalComprobanteOpen(true);
    },
    [showToast]
  );

  /* Modal depositar */
  const openModalDepositar = useCallback((row) => {
    setChequeSeleccionado(normalizeCheque(row));
    setModalDepositarOpen(true);
  }, []);

  const closeModalDepositar = useCallback(() => {
    if (depositando) return;
    setModalDepositarOpen(false);
    setChequeSeleccionado(null);
  }, [depositando]);

  /* =========================
     Fetch
  ========================= */
  const fetchCheques = useCallback(
    async ({ offset = 0, append = false, qValue = "" } = {}) => {
      const data = await listarChequesCartera({
        limit: PAGE_SIZE,
        offset,
        q: qValue,
      });

      const lista = Array.isArray(data?.cheques)
        ? data.cheques.map(normalizeCheque)
        : [];

      if (append) {
        setAllRows((prev) => {
          const base = Array.isArray(prev) ? prev : [];
          const ids = new Set(base.map((x) => String(x.id_cheque)));
          return [...base, ...lista.filter((x) => !ids.has(String(x.id_cheque)))];
        });
      } else {
        setAllRows(lista);
      }

      setHasMore(!!data?.has_more);
      setNextOffset(Number(data?.next_offset || 0));

      return { ...data, cheques: lista };
    },
    []
  );

  /* Initial load */
  useEffect(() => {
    let active = true;

    (async () => {
      setLoading(true);
      setError("");
      try {
        await fetchCheques({ offset: 0, append: false, qValue: "" });
      } catch (e) {
        if (active) setError(e?.message || "No se pudieron cargar los cheques.");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [fetchCheques]);

  /* Filtered rows (client-side) with descending sort */
  const rows = useMemo(() => {
    const value = q.trim().toLowerCase();

    const filtered = !value
      ? allRows
      : allRows.filter((item) => {
          const fields = [
            item?.fecha_emision,
            item?.emisor,
            item?.numero_cheque,
            item?.importe,
            item?.fecha_pago,
          ].map((v) => String(v || "").toLowerCase());

          return fields.some((f) => f.includes(value));
        });

    // Orden descendente: fecha más reciente primero
    return [...filtered].sort((a, b) => {
      const fa = String(a?.fecha_pago || a?.fecha_emision || "");
      const fb = String(b?.fecha_pago || b?.fecha_emision || "");
      if (fb > fa) return 1;
      if (fb < fa) return -1;
      return 0;
    });
  }, [q, allRows]);

  /* Load more */
  const handleLoadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;

    setLoadingMore(true);
    setError("");

    try {
      const data = await fetchCheques({ offset: nextOffset, append: true, qValue: "" });
      showToast(
        "exito",
        `${Array.isArray(data?.cheques) ? data.cheques.length : 0} cheques más cargados.`
      );
    } catch (e) {
      setError(e?.message || "No se pudieron cargar más cheques.");
      showToast("error", e?.message || "No se pudieron cargar más cheques.");
    } finally {
      setLoadingMore(false);
    }
  }, [fetchCheques, hasMore, loadingMore, nextOffset, showToast]);

  /* Depositar */
  const handleDepositarCheque = useCallback(async (fechaDepositoSeleccionada) => {
    const idCheque = Number(chequeSeleccionado?.id_cheque || 0);

    if (!idCheque) {
      showToast("error", "No se pudo identificar el cheque seleccionado.");
      return;
    }

    const fechaDeposito = toISODate(fechaDepositoSeleccionada);
    if (!isValidISODate(fechaDeposito)) {
      showToast("error", "Seleccioná una fecha de depósito válida desde el modal.");
      return;
    }

    setDepositando(true);

    try {
      const data = await depositarChequeCartera({
        idCheque,
        fechaDeposito,
      });

      clearMovimientosAfterDepositoCheque();

      setAllRows((prev) =>
        (Array.isArray(prev) ? prev : []).filter(
          (item) => Number(item?.id_cheque) !== idCheque
        )
      );

      setModalDepositarOpen(false);
      setChequeSeleccionado(null);

      showToast(
        "exito",
        data?.mensaje || "Cheque depositado correctamente."
      );
    } catch (e) {
      showToast("error", e?.message || "No se pudo depositar el cheque.");
    } finally {
      setDepositando(false);
    }
  }, [chequeSeleccionado, showToast]);

  /* =========================
     Columns
  ========================= */
  const columns = useMemo(
    () => [
      {
        key: "fecha_emision",
        label: "FECHA DE EMISIÓN",
        align: "center",
        fr: 1.1,
        render: (r) => formatFecha(r.fecha_emision),
      },
      {
        key: "emisor",
        label: "EMISOR",
        align: "left",
        fr: 2,
        strong: true,
        render: (r) => safeText(r.emisor),
      },
      {
        key: "numero_cheque",
        label: "N° DE CHEQUE",
        align: "center",
        fr: 1.2,
        render: (r) => safeText(r.numero_cheque),
      },
      {
        key: "importe",
        label: "IMPORTE",
        align: "right",
        fr: 1.1,
        render: (r) => moneyARS(r.importe),
      },
      {
        key: "fecha_pago",
        label: "FECHA DE PAGO",
        align: "center",
        fr: 1.1,
        render: (r) => formatFecha(r.fecha_pago),
      },
      {
        key: "acciones",
        label: "ACCIONES",
        align: "center",
        fr: 0.8,
        render: () => null,
      },
    ],
    []
  );

  const gridCols = useMemo(
    () => columns.map((c) => `${c.fr ?? 1}fr`).join(" "),
    [columns]
  );

  /* =========================
     Skeleton
  ========================= */
  const skelWidths = useMemo(
    () => ({
      fecha_emision: ["44%", "38%", "42%", "36%"],
      emisor: ["72%", "58%", "66%", "50%"],
      numero_cheque: ["52%", "44%", "48%", "40%"],
      importe: ["38%", "30%", "34%", "28%"],
      fecha_pago: ["44%", "36%", "40%", "34%"],
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
            ].join(" ")}
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

      <ModalDepositarCheque
        open={modalDepositarOpen}
        onClose={closeModalDepositar}
        onConfirm={handleDepositarCheque}
        loading={depositando}
        cheque={chequeSeleccionado}
        titulo="Depositar cheque en el banco"
        pregunta="¿Querés depositar este cheque?"
        tipoLabel="Cheque"
        confirmText="Depositar"
        loadingText="Depositando..."
        infoText="Al presionar Depositar, el cheque se dará de baja de Cheques de Cartera y se registrará automáticamente en Otros Egresos, dejando reflejado el movimiento para que la salida de fondos quede correctamente impactada en el sistema."
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
              <div className="mov-card__title">Cheques en Cartera</div>
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
                        placeholder="Buscar por emisor, número de cheque, importe..."
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
              ].join(" ")}
              role="columnheader"
            >
              {c.label}
            </div>
          ))}
        </div>

        <div className="mov-tableWrap mov-tableWrap--mov" role="rowgroup" id="cheques-st">
          <div
            className={[
              "mov-gridBody",
              "mov-gridBody--relative",
              loading ? "mov-softLoading" : "",
            ].join(" ")}
          >
            {loading ? (
              <div className="mov-skeletonWrap" aria-busy="true">
                {Array.from({ length: SKELETON_ROWS }).map((_, i) => renderSkeletonRow(i))}
              </div>
            ) : (
              <>
                {rows.map((r) => (
                  <div
                    key={r.id_cheque || `${r.numero_cheque}-${r.fecha_pago}`}
                    className="mov-gridTable mov-gridTable--row"
                    style={{ gridTemplateColumns: gridCols }}
                    role="row"
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
                            <div className="mov-actionsInline">
                              <button
                                type="button"
                                className={[
                                  "mov-iconBtn",
                                  r?.tiene_comprobante
                                    ? "mov-iconBtn--comprobante"
                                    : "mov-iconBtn--disabled",
                                ].join(" ")}
                                title={
                                  r?.tiene_comprobante
                                    ? "Ver comprobante"
                                    : "Sin comprobante"
                                }
                                disabled={!r?.tiene_comprobante}
                                onClick={() => openModalComprobante(r)}
                                style={{
                                  opacity: r?.tiene_comprobante ? 1 : 0.35,
                                  cursor: r?.tiene_comprobante ? "pointer" : "not-allowed",
                                }}
                              >
                                <FontAwesomeIcon icon={faEye} />
                              </button>

                              <button
                                type="button"
                                className="mov-iconBtn"
                                title="Depositar en el banco"
                                onClick={() => openModalDepositar(r)}
                              >
                                <FontAwesomeIcon icon={faBuildingColumns} />
                              </button>
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
                ))}

                {rows.length === 0 && (
                  <div className="cc-emptyState">
                    <FontAwesomeIcon icon={faBoxOpen} className="cc-emptyIcon" />
                    <div className="cc-emptyText">
                      {q.trim()
                        ? `No se encontraron cheques para "${q.trim()}".`
                        : "No hay cheques en cartera para mostrar."}
                    </div>
                  </div>
                )}

                {allRows.length > 0 && hasMore && q.trim() === "" && (
                  <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
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
                    {Array.from({ length: 4 }).map((_, i) => renderSkeletonRow(i))}
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

export default Cheques_Cartera;