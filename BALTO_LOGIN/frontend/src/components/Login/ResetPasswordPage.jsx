import React, { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { resetPassword } from "../../services/authApi";
import Toast from "../Global/Toast";
import "./inicio.css";

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = useMemo(() => String(params.get("token") || "").trim(), [params]);
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!token) return setToast({ tipo: "error", mensaje: "El enlace no contiene token." });
    if (pass.length < 6) return setToast({ tipo: "advertencia", mensaje: "La contraseña debe tener al menos 6 caracteres." });
    if (pass !== pass2) return setToast({ tipo: "advertencia", mensaje: "Las contraseñas no coinciden." });
    setLoading(true);
    try {
      const r = await resetPassword(token, pass);
      if (!r.ok || r.data?.exito === false) {
        setToast({ tipo: "error", mensaje: r.data?.mensaje || "No se pudo restablecer la contraseña." });
        return;
      }
      setToast({ tipo: "exito", mensaje: r.data?.mensaje || "Contraseña actualizada." });
      setTimeout(() => navigate("/", { replace: true }), 900);
    } catch {
      setToast({ tipo: "error", mensaje: "No se pudo conectar al servidor." });
    } finally { setLoading(false); }
  };

  return (
    <div className="ini_page">
      <main className="ini_card">
        <div className="ini_brand"><div className="ini_brandMark">B</div><div><div className="ini_brandName">BALTO</div><div className="ini_brandSub">GESTIÓN EMPRESARIAL</div></div></div>
        <h1 className="ini_title">NUEVA CONTRASEÑA</h1>
        <p className="ini_subtitle">Definí una nueva contraseña para tu cuenta.</p>
        <form className="ini_form" onSubmit={submit}>
          <label className="ini_label">Nueva contraseña</label>
          <input className="ini_input" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
          <label className="ini_label">Repetir contraseña</label>
          <input className="ini_input" type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" />
          <button className="ini_btn" type="submit" disabled={loading}>{loading ? "GUARDANDO..." : "GUARDAR"}</button>
        </form>
      </main>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  );
}
