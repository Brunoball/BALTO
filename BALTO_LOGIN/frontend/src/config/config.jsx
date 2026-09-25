const configured = String(process.env.REACT_APP_API_URL || "").trim();

// En builds desplegados usamos same-origin para que staging/producción no queden
// compilados con el dominio del otro entorno. En localhost se configura
// REACT_APP_API_URL explícitamente.
const BASE_URL = configured
  ? configured.replace(/\/+$/, "")
  : "/BALTO_LOGIN/api/routes";

export default BASE_URL;
