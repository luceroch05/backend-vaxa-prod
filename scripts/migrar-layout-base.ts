/**
 * Migración ÚNICA: saca las imágenes en base64 que quedaron EMBEBIDAS dentro del JSON
 * de los diseños personalizados (columnas que guardan un layout en JSON) y las pasa a
 * ARCHIVO en /uploads/personalizado/, dejando en el JSON solo la RUTA.
 *
 * Regla del proyecto: las imágenes van como archivo en el servidor, NUNCA base64 en la
 * BD. Esto además libera las columnas que reventaban con "Data too long" por un base64.
 *
 * Es IDEMPOTENTE: recorre solo las filas cuyo JSON contiene 'data:image'; las que ya
 * están en ruta se saltan. Se puede correr de nuevo sin problema. NO toca certificados
 * ya emitidos (sus PDFs ya están en disco).
 *
 * Uso (desde backend-vaxa-prod):  npx tsx scripts/migrar-layout-base.ts
 * ⚠ HAZ UN BACKUP DE LA BD ANTES DE CORRERLO.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { guardarImagen } from '../src/shared/imagenes';

/** Columnas que guardan un diseño en JSON (pueden traer imágenes embebidas). */
const OBJETIVOS: Array<{ tabla: string; col: string; pk: string }> = [
  { tabla: 'empresas',                    col: 'layout_base',          pk: 'id' },
  { tabla: 'configuraciones_certificado', col: 'layout_personalizado', pk: 'id' },
];

const SUBCARPETA = 'personalizado';

/** Recorre el JSON y reemplaza cada data URL base64 por la ruta del archivo guardado. */
function externalizarBase64(valor: any): any {
  if (typeof valor === 'string') {
    return valor.startsWith('data:image') ? (guardarImagen(valor, SUBCARPETA) ?? valor) : valor;
  }
  if (Array.isArray(valor)) return valor.map(externalizarBase64);
  if (valor && typeof valor === 'object') {
    for (const k of Object.keys(valor)) valor[k] = externalizarBase64(valor[k]);
    return valor;
  }
  return valor;
}

async function main() {
  if (!process.env.MYSQL_DATABASE) { console.error('Falta MYSQL_DATABASE en el .env'); process.exit(1); }
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST ?? 'localhost',
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER ?? 'root',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE,
  });

  let totalMigradas = 0, totalSaltadas = 0, totalErrores = 0;
  for (const t of OBJETIVOS) {
    let rows: any[];
    try {
      // Solo las filas cuyo JSON trae al menos un base64 embebido.
      [rows] = await conn.query<any[]>(
        `SELECT ${t.pk} AS pk, ${t.col} AS json FROM ${t.tabla}
          WHERE ${t.col} IS NOT NULL AND ${t.col} LIKE '%data:image%'`,
      );
    } catch (e) {
      console.warn(`· ${t.tabla}.${t.col}: no se pudo leer (¿tabla/columna no existe?) — se salta. ${(e as Error).message}`);
      continue;
    }
    let migr = 0;
    for (const r of rows) {
      try {
        const limpio = JSON.stringify(externalizarBase64(JSON.parse(r.json)));
        if (limpio !== r.json) {
          await conn.query(`UPDATE ${t.tabla} SET ${t.col} = ? WHERE ${t.pk} = ?`, [limpio, r.pk]);
          migr++;
        } else {
          totalSaltadas++;
        }
      } catch (e) {
        totalErrores++;
        console.error(`  ! ${t.tabla}#${r.pk}: ${(e as Error).message}`);
      }
    }
    totalMigradas += migr;
    console.log(`· ${t.tabla}.${t.col}: ${migr}/${rows.length} migradas a archivo.`);
  }

  console.log(`\nListo. Migradas: ${totalMigradas} · saltadas: ${totalSaltadas} · errores: ${totalErrores}.`);
  await conn.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
