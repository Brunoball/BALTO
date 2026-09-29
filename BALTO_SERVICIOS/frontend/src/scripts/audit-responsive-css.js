/* eslint-disable no-console */
/**
 * BALTO · Auditor responsive CSS
 *
 * Fase 1: herramienta de medición. NO modifica archivos.
 * Uso:
 *   node src/scripts/audit-responsive-css.js
 *   node src/scripts/audit-responsive-css.js --json
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SRC_ROOT = path.resolve(__dirname, "..");
const COMPONENTS_ROOT = path.join(SRC_ROOT, "components");
const GLOBAL_ROOT = path.join(COMPONENTS_ROOT, "Global", "Global_css");

const GLOBAL_RESPONSIVE_FILES = [
  "GlobalViewport.css",
  "Global_Section.css",
  "GlobalTableScrollResponsive.css",
  "GlobalsModalsV2.css",
  "Global_responsive.css",
  "GlobalResponsiveV2.css",
].map((name) => path.join(GLOBAL_ROOT, name));

// Prefijos que revelan conocimiento de una sección concreta dentro de un global.
// No todos son errores hoy: varios son deuda legacy que se migrará por fases.
const SECTION_PREFIXES = [
  ".cc-",
  ".cfg-",
  ".doccom-",
  ".af-",
  ".flujo-",
  ".serv-",
  ".srv-",
  ".mi-em-",
  ".mi-cr-",
  ".pres-",
  ".ventas-",
  ".compras-",
  ".recibos-",
];

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function relative(file) {
  return path.relative(SRC_ROOT, file).replace(/\\/g, "/");
}

function lineCount(text) {
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

function countMatches(text, regex) {
  return (text.match(regex) || []).length;
}

function extractMediaConditions(text) {
  const conditions = [];
  const re = /@media\s*([^\{]+)\{/g;
  let match;
  while ((match = re.exec(text))) {
    conditions.push(match[1].trim().replace(/\s+/g, " "));
  }
  return conditions;
}

function extractMaxWidthBreakpoints(text) {
  const values = [];
  const re = /max-width\s*:\s*(\d+(?:\.\d+)?)px/g;
  let match;
  while ((match = re.exec(text))) values.push(Number(match[1]));
  return values;
}

function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ");
}

function analyzeCss(file) {
  const text = fs.readFileSync(file, "utf8");
  const code = stripCssComments(text);
  const prefixHits = {};

  for (const prefix of SECTION_PREFIXES) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const count = countMatches(code, new RegExp(escaped, "g"));
    if (count) prefixHits[prefix] = count;
  }

  return {
    file: relative(file),
    sha256: crypto.createHash("sha256").update(text).digest("hex"),
    lines: lineCount(text),
    mediaQueries: countMatches(code, /@media\b/g),
    important: countMatches(code, /!important\b/g),
    mediaConditions: extractMediaConditions(code),
    maxWidthBreakpoints: extractMaxWidthBreakpoints(code),
    sectionPrefixHits: prefixHits,
  };
}

function buildReport() {
  const cssFiles = walk(COMPONENTS_ROOT).filter((f) => f.endsWith(".css"));
  const analyzed = cssFiles.map(analyzeCss);

  const breakpointFrequency = {};
  for (const item of analyzed) {
    for (const bp of item.maxWidthBreakpoints) {
      breakpointFrequency[bp] = (breakpointFrequency[bp] || 0) + 1;
    }
  }

  const globals = GLOBAL_RESPONSIVE_FILES
    .filter(fs.existsSync)
    .map(analyzeCss);

  return {
    generatedAt: new Date().toISOString(),
    scope: "src/components/**/*.css",
    totals: {
      cssFiles: analyzed.length,
      cssLines: analyzed.reduce((acc, x) => acc + x.lines, 0),
      mediaQueries: analyzed.reduce((acc, x) => acc + x.mediaQueries, 0),
      important: analyzed.reduce((acc, x) => acc + x.important, 0),
      cssFilesWithMedia: analyzed.filter((x) => x.mediaQueries > 0).length,
    },
    breakpointFrequency: Object.entries(breakpointFrequency)
      .map(([px, count]) => ({ px: Number(px), count }))
      .sort((a, b) => b.count - a.count || b.px - a.px),
    globalResponsiveFiles: globals,
    largestResponsiveFiles: analyzed
      .filter((x) => x.mediaQueries > 0)
      .sort((a, b) => b.lines - a.lines)
      .slice(0, 15),
    mostImportantFiles: analyzed
      .filter((x) => x.important > 0)
      .sort((a, b) => b.important - a.important)
      .slice(0, 15),
  };
}

function printHuman(report) {
  const { totals } = report;
  console.log("BALTO · Auditoría responsive CSS");
  console.log("================================");
  console.log(`CSS analizados:       ${totals.cssFiles}`);
  console.log(`Líneas CSS:           ${totals.cssLines}`);
  console.log(`Archivos con @media:  ${totals.cssFilesWithMedia}`);
  console.log(`Bloques @media:       ${totals.mediaQueries}`);
  console.log(`!important:           ${totals.important}`);

  console.log("\nBreakpoints max-width más usados:");
  for (const item of report.breakpointFrequency.slice(0, 12)) {
    console.log(`  ${String(item.px).padStart(4)}px  ${item.count}`);
  }

  console.log("\nGlobales responsive / deuda por prefijos particulares:");
  for (const item of report.globalResponsiveFiles) {
    const hits = Object.entries(item.sectionPrefixHits)
      .map(([prefix, count]) => `${prefix}:${count}`)
      .join(", ");
    console.log(
      `  ${item.file} — ${item.lines} líneas | @media ${item.mediaQueries} | !important ${item.important}`
    );
    if (hits) console.log(`    prefijos particulares: ${hits}`);
  }

  console.log("\nArchivos responsive más grandes:");
  for (const item of report.largestResponsiveFiles.slice(0, 10)) {
    console.log(
      `  ${item.file} — ${item.lines} líneas | @media ${item.mediaQueries} | !important ${item.important}`
    );
  }
}

const report = buildReport();
if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  printHuman(report);
}
