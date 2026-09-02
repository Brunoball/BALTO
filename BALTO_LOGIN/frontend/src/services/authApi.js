import BASE_URL from "../config/config";

function endpoint(action) {
  return `${BASE_URL}/api.php?action=${encodeURIComponent(action)}`;
}

async function jsonRequest(action, payload, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint(action), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
      cache: "no-store",
    });

    const text = await response.text();
    let data = null;

    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      data,
      text,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function loginGlobal(nombre, contrasena) {
  return jsonRequest("inicio", { nombre, contrasena });
}

export function requestPasswordReset(usuario) {
  return jsonRequest("recuperar_contrasena", {
    usuario,
    nombre: usuario,
  });
}

export function resetPassword(token, contrasena) {
  return jsonRequest("reset_contrasena", {
    token,
    contrasena,
    nueva_contrasena: contrasena,
  });
}
