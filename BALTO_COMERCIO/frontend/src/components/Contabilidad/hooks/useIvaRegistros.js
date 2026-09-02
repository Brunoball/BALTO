import { useEffect, useState } from "react";
import { fetchContabilidadJson } from "../api/contabilidadApi";

export default function useIvaRegistros({ action, aliases, errorMessage }) {
  const [registros, setRegistros] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    const cargar = async () => {
      try {
        if (!mounted) return;
        setLoading(true);
        setError("");

        const data = await fetchContabilidadJson(action, {}, aliases);

        if (!mounted) return;
        setRegistros(Array.isArray(data?.registros) ? data.registros : []);
      } catch (err) {
        if (!mounted) return;
        setError(err?.message || errorMessage || "Error cargando Contabilidad.");
        setRegistros([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    cargar();

    return () => {
      mounted = false;
    };
  }, [action, aliases, errorMessage]);

  return { registros, loading, error };
}
