/**
 * Convierte un monto a su representación en letras para la leyenda SUNAT.
 * Ej: 118.5 -> "CIENTO DIECIOCHO CON 50/100"
 * El sufijo de moneda (SOLES / DÓLARES) lo agrega quien lo llama.
 */

const UNIDADES = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
const ESPECIALES: Record<number, string> = {
  10: 'DIEZ', 11: 'ONCE', 12: 'DOCE', 13: 'TRECE', 14: 'CATORCE', 15: 'QUINCE',
  16: 'DIECISÉIS', 17: 'DIECISIETE', 18: 'DIECIOCHO', 19: 'DIECINUEVE',
  20: 'VEINTE', 21: 'VEINTIUNO', 22: 'VEINTIDÓS', 23: 'VEINTITRÉS', 24: 'VEINTICUATRO',
  25: 'VEINTICINCO', 26: 'VEINTISÉIS', 27: 'VEINTISIETE', 28: 'VEINTIOCHO', 29: 'VEINTINUEVE',
};
const DECENAS = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS',
  'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

function menorMil(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';
  let txt = '';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  if (c > 0) txt += CENTENAS[c] + ' ';
  if (resto > 0) {
    if (resto < 10) txt += UNIDADES[resto];
    else if (ESPECIALES[resto]) txt += ESPECIALES[resto];
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      txt += DECENAS[d] + (u > 0 ? ' Y ' + UNIDADES[u] : '');
    }
  }
  return txt.trim();
}

/** Parte entera a letras (soporta hasta millones). */
function enteroALetras(n: number): string {
  if (n === 0) return 'CERO';
  let txt = '';
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;

  if (millones > 0) txt += (millones === 1 ? 'UN MILLÓN' : menorMil(millones) + ' MILLONES') + ' ';
  if (miles > 0) txt += (miles === 1 ? 'MIL' : menorMil(miles) + ' MIL') + ' ';
  if (resto > 0) txt += menorMil(resto);
  return txt.trim();
}

/** Monto a letras con los céntimos como XX/100. */
export function numeroALetras(monto: number): string {
  const entero = Math.floor(monto);
  const centimos = Math.round((monto - entero) * 100);
  return `${enteroALetras(entero)} CON ${String(centimos).padStart(2, '0')}/100`;
}

/** Leyenda completa para el cbc:Note (cat.52 '1000'). */
export function leyendaMonto(monto: number, moneda = 'PEN'): string {
  const sufijo = moneda === 'USD' ? 'DÓLARES AMERICANOS' : 'SOLES';
  return `SON ${numeroALetras(monto)} ${sufijo}`;
}
