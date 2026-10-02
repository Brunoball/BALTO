import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GlobalFloatingNotice from "../Global/GlobalFloatingNotice";
import ModalEliminarStock from "./modales/ModalEliminarStock";
import {
  aplicarRevisionPreciosStock,
  obtenerRevisionPreciosPendienteStock,
  rechazarRevisionPreciosStock,
} from "./api/stockApi";

const PRICE_REVIEW_POLL_MS = 10000;

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function coefficient(value) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("es-AR", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

function percent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${number.toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}%`;
}

function periodLabel(period) {
  const match = String(period || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return period || "—";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  const label = date.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  return label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : period;
}

export default function PriceReviewNotice({ hidden = false, onApplied, onRejected }) {
  const [payload, setPayload] = useState({ revision: null, pendientes_total: 0 });
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejectConfirmOpen, setRejectConfirmOpen] = useState(false);
  const mountedRef = useRef(true);
  const requestRef = useRef(0);

  const revision = payload?.revision || null;
  const revisionId = Number(revision?.id_revision || 0);

  const loadPending = useCallback(async ({ silent = true } = {}) => {
    const requestId = ++requestRef.current;
    try {
      const response = await obtenerRevisionPreciosPendienteStock({ _: Date.now() });
      if (!mountedRef.current || requestId !== requestRef.current) return null;
      const next = {
        revision: response?.revision ?? response?.data?.revision ?? null,
        pendientes_total: Number(response?.pendientes_total ?? response?.data?.pendientes_total ?? 0),
      };
      setPayload(next);
      return next;
    } catch (error) {
      // El polling del aviso no debe generar toasts repetitivos si hay una pérdida
      // temporal de red o si producción todavía no recibió la migración.
      if (!silent) throw error;
      return null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    loadPending();

    const interval = window.setInterval(() => {
      if (!document.hidden && !busy) loadPending();
    }, PRICE_REVIEW_POLL_MS);

    const handleFocus = () => {
      if (!busy) loadPending();
    };
    const handleVisibility = () => {
      if (!document.hidden && !busy) loadPending();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [busy, loadPending]);

  useEffect(() => {
    if (!revisionId) {
      setCollapsed(false);
      setRejectConfirmOpen(false);
      return;
    }
    try {
      setCollapsed(window.sessionStorage.getItem(`balto:stock:revision-precios:${revisionId}:collapsed`) === "1");
    } catch (_error) {
      setCollapsed(false);
    }
  }, [revisionId]);

  const setCollapsedPersisted = useCallback((value) => {
    setCollapsed(value);
    if (!revisionId) return;
    try {
      const key = `balto:stock:revision-precios:${revisionId}:collapsed`;
      if (value) window.sessionStorage.setItem(key, "1");
      else window.sessionStorage.removeItem(key);
    } catch (_error) {
      // sessionStorage puede estar bloqueado por el navegador; el aviso sigue
      // funcionando con estado React durante la sesión actual.
    }
  }, [revisionId]);

  const details = useMemo(() => {
    if (!revision) return [];
    const rows = [
      { label: "Período", value: periodLabel(revision.periodo) },
      { label: "Movimientos acumulados", value: String(Number(revision.cantidad_cambios || 0)) },
      {
        label: "Coeficiente",
        value: `${coefficient(revision.coeficiente_base)} → ${coefficient(revision.coeficiente_actual)}`,
      },
      { label: "Compras netas", value: money(revision.compras_mercaderia) },
      { label: "Gastos fijos", value: money(revision.gastos_fijos) },
      { label: "Gastos variables", value: money(revision.gastos_variables) },
      { label: "Utilidad deseada", value: percent(revision.utilidad_deseada_pct) },
    ];
    if (Number(payload?.pendientes_total || 0) > 1) {
      rows.push({ label: "Revisiones pendientes", value: String(payload.pendientes_total) });
    }
    return rows;
  }, [payload?.pendientes_total, revision]);

  const handleApply = useCallback(async () => {
    if (!revisionId || busy || revision?.disponible === false) return;
    setBusy(true);
    try {
      const response = await aplicarRevisionPreciosStock({ id_revision: revisionId });
      try {
        window.sessionStorage.removeItem(`balto:stock:revision-precios:${revisionId}:collapsed`);
      } catch (_error) {}
      setPayload((prev) => ({ ...prev, revision: null }));
      setCollapsed(false);
      if (typeof onApplied === "function") await onApplied(response?.data || response);
      await loadPending();
    } catch (error) {
      if (typeof onApplied === "function") {
        await onApplied(null, error);
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [busy, loadPending, onApplied, revision?.disponible, revisionId]);

  const handleReject = useCallback(async () => {
    if (!revisionId || busy) return;
    setBusy(true);
    try {
      const response = await rechazarRevisionPreciosStock({ id_revision: revisionId });
      try {
        window.sessionStorage.removeItem(`balto:stock:revision-precios:${revisionId}:collapsed`);
      } catch (_error) {}
      setPayload((prev) => ({ ...prev, revision: null }));
      setCollapsed(false);
      setRejectConfirmOpen(false);
      if (typeof onRejected === "function") await onRejected(response?.data || response);
      await loadPending();
    } catch (error) {
      if (typeof onRejected === "function") {
        await onRejected(null, error);
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [busy, loadPending, onRejected, revisionId]);

  if (!revision || hidden) return null;

  const changes = Number(revision.cantidad_cambios || 0);
  const canApply = revision.disponible !== false && Number(revision.coeficiente_actual || 0) > 0;
  const warning = revision.advertencia
    ? revision.advertencia
    : "Al aplicar, BALTO actualiza sólo los PRECIOS DE VENTA existentes con costo × coeficiente. Promocional, mayorista, distribuidor, lista y la herencia de variantes se conservan.";

  return (
    <>
      <GlobalFloatingNotice
        key={revisionId}
        open
        ariaLabel="Revisión pendiente de precios de Stock"
        brand="BALTO · Stock"
        brandShort="$"
        title="Hay cambios pendientes en tus precios"
        message="Compras y/o egresos modificaron el coeficiente ponderado. Los precios de venta no cambian hasta que decidas."
        details={details}
        detailsCollapsible
        detailsCollapsedDefault
        status={canApply ? "Pendiente de revisión" : "Revisión pendiente sin coeficiente aplicable"}
        statusTone={canApply ? "warning" : "danger"}
        amount={`Coef. ${coefficient(revision.coeficiente_actual)}`}
        extraText={warning}
        actionLabel={busy ? "Aplicando…" : "Aplicar cambios"}
        actionDisabled={busy || !canApply}
        onAction={handleApply}
        onClose={() => setCollapsedPersisted(true)}
        collapsed={collapsed}
        collapsedLabel={`${changes || 1} cambio${changes === 1 ? "" : "s"} de precios pendiente${changes === 1 ? "" : "s"}`}
        onRestore={() => setCollapsedPersisted(false)}
        dismissLabel={busy ? "Procesando…" : "No aplicar"}
        dismissDisabled={busy}
        dismissRequiresConfirmation={false}
        onDismiss={() => setRejectConfirmOpen(true)}
      />

      <ModalEliminarStock
        open={rejectConfirmOpen}
        loading={busy}
        confirmDisabled={busy}
        title="¿No aplicar este reajuste?"
        message="Esta revisión quedará rechazada y no volverá a mostrarse. Si luego se cargan nuevas compras o egresos que afecten el coeficiente, BALTO generará una revisión nueva."
        warning=""
        confirmLabel="Sí, no aplicar"
        cancelLabel="Cancelar"
        entidadLabel="revisión de precios"
        onClose={() => {
          if (!busy) setRejectConfirmOpen(false);
        }}
        onConfirm={handleReject}
      />
    </>
  );
}
