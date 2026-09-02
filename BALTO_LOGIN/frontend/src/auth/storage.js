const SESSION_KEY = "session_key";
const USER_KEY = "usuario";
const SYSTEM_KEY = "balto_sistema";

const COOKIE_SESSION = "balto_session_key";
const COOKIE_USER = "balto_usuario";
const COOKIE_SYSTEM = "balto_sistema";

function cookieDomainPart() {
  const domain = String(process.env.REACT_APP_COOKIE_DOMAIN || "").trim();
  return domain ? `; Domain=${domain}` : "";
}

function cookieSecurePart() {
  return window.location.protocol === "https:" ? "; Secure" : "";
}

function setCookie(name, value, maxAgeSeconds = 60 * 60 * 8) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${cookieDomainPart()}${cookieSecurePart()}`;
}

function deleteCookie(name) {
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${cookieDomainPart()}${cookieSecurePart()}`;
}

export function persistGlobalSession({ sessionKey, usuario, sistema }) {
  const key = String(sessionKey || "").trim();
  if (!key) throw new Error("Falta session_key.");

  localStorage.setItem(SESSION_KEY, key);
  localStorage.setItem(USER_KEY, JSON.stringify(usuario || {}));
  localStorage.setItem(SYSTEM_KEY, JSON.stringify(sistema || {}));

  // Puente útil entre localhost:puerto y localhost:otro-puerto, y también entre
  // subcarpetas del mismo host. El backend sigue tomando identidad de la sesión,
  // nunca de estos metadatos de UI.
  setCookie(COOKIE_SESSION, key);
  setCookie(COOKIE_USER, JSON.stringify(usuario || {}));
  setCookie(COOKIE_SYSTEM, JSON.stringify(sistema || {}));
}

export function clearGlobalSession() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(SYSTEM_KEY);
  deleteCookie(COOKIE_SESSION);
  deleteCookie(COOKIE_USER);
  deleteCookie(COOKIE_SYSTEM);
}
