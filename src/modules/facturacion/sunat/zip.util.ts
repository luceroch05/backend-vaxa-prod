/**
 * Utilidades ZIP para SUNAT. El comprobante se envía como un .zip que contiene
 * el .xml firmado, ambos con el nombre estándar:
 *   {RUC}-{tipo}-{serie}-{correlativo}.xml  dentro de  ...{...}.zip
 */
import AdmZip from 'adm-zip';

/** Nombre base del comprobante para SUNAT (sin extensión). */
export function nombreComprobante(ruc: string, tipoSunat: string, serie: string, correlativo: number): string {
  return `${ruc}-${tipoSunat}-${serie}-${correlativo}`;
}

/** Crea el .zip (en memoria) con el XML firmado adentro. */
export function zipearXml(nombreBase: string, xml: string): Buffer {
  const zip = new AdmZip();
  zip.addFile(`${nombreBase}.xml`, Buffer.from(xml, 'utf8'));
  return zip.toBuffer();
}

/** Lee el primer XML dentro de un .zip (lo usamos para el CDR de SUNAT). */
export function leerPrimerXmlDeZip(buffer: Buffer): { nombre: string; xml: string } | null {
  const zip = new AdmZip(buffer);
  const entry = zip.getEntries().find((e) => /\.xml$/i.test(e.entryName) && !e.isDirectory);
  if (!entry) return null;
  return { nombre: entry.entryName, xml: entry.getData().toString('utf8') };
}
