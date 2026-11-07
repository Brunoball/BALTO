// Identificadores únicos por corrida (como RUN_PREFIX de Comercio): todo lo que la suite
// escribe lleva este prefijo para poder reconocerlo y limpiarlo.
const semilla = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
const RUN_PREFIX = `PW-${semilla}`.slice(0, 16);

const nombreUnico = (tipo = 'DATO', max = 60) => `${RUN_PREFIX}-${String(tipo).toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`.slice(0, max);
/** Letras solamente (los nombres de persona no aceptan números ni guiones). */
const apellidoE2E = () => `Prueba${semilla.replace(/[^A-Z]/g, '').slice(0, 6) || 'Auto'}`;
const OBSERVACION_PEDIDO = `PEDIDO DE PRUEBA AUTOMATIZADO - NO PREPARAR - ${RUN_PREFIX}`;

module.exports = { RUN_PREFIX, nombreUnico, apellidoE2E, OBSERVACION_PEDIDO };
