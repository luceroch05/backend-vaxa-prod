/**
 * Migración ÚNICA: pasa las imágenes guardadas como base64 en la BD a ARCHIVOS
 * en /uploads y deja en la columna solo la RUTA (`/uploads/<sub>/<hash>.<ext>`).
 *
 * Es IDEMPOTENTE: las filas que ya son ruta (no base64) se saltan. Se puede correr
 * de nuevo sin problema. NO toca los certificados ya emitidos.
 *
 * Uso (desde backend-vaxa-prod):  npx tsx scripts/migrar-imagenes.ts
 * ⚠ HAZ UN BACKUP DE LA BD ANTES DE CORRERLO.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { guardarImagen } from '../src/shared/imagenes';

/** Tabla, columna de imagen, subcarpeta y PK. */
const OBJETIVOS: Array<{ tabla: string; col: string; sub: string; pk: string }> = [
  { tabla: 'empresas',                     col: 'logo_url',      sub: 'empresas',   pk: 'id' },
  { tabla: 'logos',                        col: 'imagen_logo',   sub: 'logos',      pk: 'id' },
  { tabla: 'firmas',                       col: 'imagen_firma',  sub: 'firmas',     pk: 'id' },
  { tabla: 'configuraciones_certificado',  col: 'plantilla_url', sub: 'plantillas', pk: 'id' },
];

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
      // Solo las que son data URL base64 (LIKE 'data:image%').
      [rows] = await conn.query<any[]>(
        `SELECT ${t.pk} AS pk, ${t.col} AS img FROM ${t.tabla} WHERE ${t.col} LIKE 'data:image%'`,
      );
    } catch (e) {
      console.warn(`· ${t.tabla}.${t.col}: no se pudo leer (¿tabla/columna no existe?) — se salta. ${(e as Error).message}`);
      continue;
    }
    let migr = 0;
    for (const r of rows) {
      try {
        const ruta = guardarImagen(r.img, t.sub);
        if (ruta && ruta !== r.img) {
          await conn.query(`UPDATE ${t.tabla} SET ${t.col} = ? WHERE ${t.pk} = ?`, [ruta, r.pk]);
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
