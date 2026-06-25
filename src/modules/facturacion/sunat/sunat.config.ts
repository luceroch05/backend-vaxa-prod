/**
 * Configuración de Facturación Electrónica (SUNAT — SEE Del Contribuyente).
 * Toda la data sensible viene de variables de entorno (.env). Ver .env.example.
 */

export type ModoSunat = 'beta' | 'produccion';

export interface EmisorConfig {
  ruc: string;
  razonSocial: string;
  nombreComercial: string;
  ubigeo: string;
  direccion: string;
  distrito: string;
  provincia: string;
  departamento: string;
  codLocal: string;
}

export interface SunatConfig {
  modo: ModoSunat;
  ruc: string;
  usuarioSol: string;
  claveSol: string;
  /** Usuario del web service = RUC + usuario secundario SOL (ej. 20615047954VAXASYST). */
  wsUsuario: string;
  certPath: string;
  certPassword: string;
  igvPct: number;            // 18
  emisor: EmisorConfig;
  /** Endpoint SOAP del servicio de comprobantes (facturas/boletas/notas/resúmenes). */
  billServiceUrl: string;
}

/** Endpoints del billService (CPE) según el ambiente. */
const BILL_SERVICE: Record<ModoSunat, string> = {
  beta:       'https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService',
  produccion: 'https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService',
};

function req(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Falta la variable de entorno ${name} (facturación electrónica)`);
  return v.trim();
}

let cache: SunatConfig | null = null;

/** Lee y valida la configuración de SUNAT desde el entorno (cacheada). */
export function getSunatConfig(): SunatConfig {
  if (cache) return cache;

  const modo = (process.env.SUNAT_MODO ?? 'beta').trim() as ModoSunat;
  if (modo !== 'beta' && modo !== 'produccion') {
    throw new Error(`SUNAT_MODO inválido: "${modo}". Usa 'beta' o 'produccion'.`);
  }

  const ruc = req('SUNAT_RUC');
  const usuarioSol = req('SUNAT_USUARIO_SOL');

  cache = {
    modo,
    ruc,
    usuarioSol,
    claveSol: req('SUNAT_CLAVE_SOL'),
    wsUsuario: `${ruc}${usuarioSol}`,
    certPath: req('SUNAT_CERT_PATH'),
    certPassword: process.env.SUNAT_CERT_PASSWORD ?? '',
    igvPct: Number(process.env.SUNAT_IGV_PCT ?? 18),
    billServiceUrl: BILL_SERVICE[modo],
    emisor: {
      ruc,
      razonSocial:   req('SUNAT_RAZON_SOCIAL'),
      nombreComercial: process.env.SUNAT_NOMBRE_COMERCIAL?.trim() || req('SUNAT_RAZON_SOCIAL'),
      ubigeo:        process.env.SUNAT_UBIGEO?.trim() || '000000',
      direccion:     process.env.SUNAT_DIRECCION?.trim() || '-',
      distrito:      process.env.SUNAT_DISTRITO?.trim() || '-',
      provincia:     process.env.SUNAT_PROVINCIA?.trim() || '-',
      departamento:  process.env.SUNAT_DEPARTAMENTO?.trim() || '-',
      codLocal:      process.env.SUNAT_COD_LOCAL?.trim() || '0000',
    },
  };
  return cache;
}

/** Para tests: limpia el cache (por si se cambian variables en runtime). */
export function resetSunatConfig(): void { cache = null; }
