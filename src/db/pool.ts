import mysql from 'mysql2/promise';

let pool: mysql.Pool | null = null;

/**
 * Configuración MySQL desde variables de entorno:
 * MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
 * Si MYSQL_DATABASE no está definida, no se crea pool (getPool() devuelve null).
 */
export function getPool(): mysql.Pool | null {
  if (pool !== null) return pool;
  const database = process.env.MYSQL_DATABASE;
  if (!database) return null;

  pool = mysql.createPool({
    host: process.env.MYSQL_HOST ?? 'localhost',
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER ?? 'root',
    password: process.env.MYSQL_PASSWORD ?? '',
    database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4',
  });
  return pool;
}
