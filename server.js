/**
 * Entrada para cPanel / producción.
 * cPanel usa este archivo como "Application startup file".
 * Antes de arrancar, ejecuta "npm run build" para generar dist/
 */
require('./dist/index.js');
