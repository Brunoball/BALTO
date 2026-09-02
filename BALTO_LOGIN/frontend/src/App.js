import React from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Inicio from "./components/Login/Inicio";
import ResetPasswordPage from "./components/Login/ResetPasswordPage";

function routerBasename() {
  const raw = String(process.env.REACT_APP_ROUTER_BASENAME || "/").trim();
  if (!raw || raw === "/") return undefined;
  return `/${raw.replace(/^\/+|\/+$/g, "")}`;
}

export default function App() {
  return (
    <BrowserRouter basename={routerBasename()}>
      <Routes>
        <Route path="/" element={<Inicio />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
