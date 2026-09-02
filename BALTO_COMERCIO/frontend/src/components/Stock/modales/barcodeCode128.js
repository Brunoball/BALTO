/*
 * CODE 128-B puro, sin dependencias externas.
 * Balto usa este renderer para los códigos internos BL-P-* / BL-V-* y para
 * previsualizar códigos existentes compatibles con ASCII imprimible.
 */

const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

const START_CODE_B = 104;
const STOP_CODE = 106;
const QUIET_ZONE_MODULES = 10;

export function isCode128BText(value) {
  const text = String(value ?? "");
  if (!text) return false;

  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 32 || code > 126) return false;
  }

  return true;
}

export function normalizeBarcodeText(value) {
  return String(value ?? "")
    .replace(/[\r\n\t]/g, "")
    .trim();
}

function encodeCode128BValues(value) {
  const text = normalizeBarcodeText(value);
  if (!isCode128BText(text)) {
    throw new Error("El código debe usar caracteres ASCII imprimibles.");
  }

  const values = Array.from(text).map((char) => char.charCodeAt(0) - 32);
  let checksum = START_CODE_B;
  values.forEach((code, index) => {
    checksum += code * (index + 1);
  });

  return [START_CODE_B, ...values, checksum % 103, STOP_CODE];
}

export function buildCode128Geometry(value) {
  const codes = encodeCode128BValues(value);
  const bars = [];
  let x = QUIET_ZONE_MODULES;

  codes.forEach((code) => {
    const pattern = CODE128_PATTERNS[code];
    if (!pattern) throw new Error("No se pudo generar el patrón CODE 128.");

    let isBar = true;
    for (const widthChar of pattern) {
      const width = Number(widthChar);
      if (isBar) bars.push({ x, width });
      x += width;
      isBar = !isBar;
    }
  });

  const width = x + QUIET_ZONE_MODULES;
  return { bars, width };
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderCode128SvgMarkup(value, { height = 58, includeText = false } = {}) {
  const text = normalizeBarcodeText(value);
  const { bars, width } = buildCode128Geometry(text);
  const textHeight = includeText ? 16 : 0;
  const totalHeight = height + textHeight;
  const rects = bars
    .map((bar) => `<rect x="${bar.x}" y="0" width="${bar.width}" height="${height}" fill="#000"/>`)
    .join("");
  const caption = includeText
    ? `<text x="${width / 2}" y="${height + 12}" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" fill="#000">${escapeXml(text)}</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${totalHeight}" role="img" aria-label="Código de barra ${escapeXml(text)}" preserveAspectRatio="none">${rects}${caption}</svg>`;
}
