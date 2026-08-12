/**
 * Normaliza un nombre/apellido a un formato único: cada palabra con la primera
 * letra en mayúscula y el resto en minúscula. Colapsa espacios repetidos y
 * respeta separadores comunes en nombres (espacio, guion, apóstrofo).
 *
 * Ej: "jUAN  carlos PÉREZ-gómez" → "Juan Carlos Pérez-Gómez"
 */
export function aTituloNombre(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es')
    .replace(/(^|[\s\-'’])([a-zñáéíóúü])/g,
      (_m, sep: string, ch: string) => sep + ch.toLocaleUpperCase('es'));
}

/**
 * Normaliza los grados académicos (abreviaturas) que se anteponen al nombre del
 * participante. Recibe el arreglo del formulario y devuelve un CSV para guardar,
 * ej. ['Mag.','Lic.'] → "Mag.,Lic.". Limpia, quita vacíos y duplicados y acota
 * el largo total a 120 (ancho de la columna). Devuelve null si no hay ninguno.
 */
export function gradosACsv(grados: string[] | null | undefined): string | null {
  if (!Array.isArray(grados)) return null;
  const limpios: string[] = [];
  for (const g of grados) {
    const s = String(g ?? '').trim();
    if (s && !limpios.includes(s)) limpios.push(s);
  }
  const csv = limpios.join(',').slice(0, 120);
  return csv || null;
}

/**
 * Prefijo listo para anteponer al nombre a partir del CSV guardado. Une con
 * espacios y agrega uno final, ej. "Mag.,Lic." → "Mag. Lic. ". Si no hay grados
 * devuelve '' (no toca el nombre).
 */
export function gradosPrefijo(csv: string | null | undefined): string {
  const partes = String(csv ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return partes.length ? partes.join(' ') + ' ' : '';
}
