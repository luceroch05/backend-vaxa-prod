/* Copia la carpeta assets/ (fuentes .ttf, etc.) dentro de dist/ tras `tsc`.
 * tsc solo compila TS→JS y NO copia assets estáticos; sin esto, en producción
 * (que corre `node dist/index.js`) el PDFKit no encuentra las fuentes del lienzo
 * (Barlow/Bebas) y el certificado sale con Helvetica. Con esta copia, las fuentes
 * viajan dentro de dist/ y basta con desplegar dist/. */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'assets');
const dest = path.join(__dirname, '..', 'dist', 'assets');

if (!fs.existsSync(src)) {
  console.warn('[postbuild] No existe assets/, nada que copiar.');
  process.exit(0);
}
fs.cpSync(src, dest, { recursive: true });
console.log('[postbuild] assets/ copiado a dist/assets/');
