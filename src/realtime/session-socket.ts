import type { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from '../modules/auth/auth.types';
import { JWT_SECRET } from '../config/jwt.config';

/**
 * Canal en tiempo real para sesión única.
 *
 * Cada cliente del panel abre un WebSocket autenticado (token en el query).
 * Guardamos las conexiones por usuario junto a su `sid`. Cuando el mismo usuario
 * inicia sesión en otro dispositivo, el login llama a `revokeOtherSessions()` con
 * el `sid` nuevo; aquí cerramos al instante las conexiones cuyo `sid` no coincide,
 * avisándoles con un mensaje SESSION_REVOKED para que muestren el modal y salgan.
 */

interface Client {
  ws: WebSocket;
  sid: string;
  producto: string | null;   // producto de esta sesión (null = legacy)
  alive: boolean;
}

// userId -> conjunto de conexiones activas
const clientsByUser = new Map<number, Set<Client>>();

const BASE_PATH = (process.env.BASE_PATH ?? '').replace(/\/$/, '');
const WS_PATH = `${BASE_PATH}/ws`;

export function initSessionSocket(server: Server): void {
  const wss = new WebSocketServer({ server, path: WS_PATH });

  wss.on('connection', (ws, req) => {
    // Token por query: wss://host/ws?token=JWT
    const url = new URL(req.url ?? '', 'http://localhost');
    const token = url.searchParams.get('token') ?? '';

    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, JWT_SECRET) as unknown as JwtPayload;
    } catch {
      ws.close(4001, 'Token inválido');
      return;
    }

    const userId = payload.sub;
    const sid = payload.sid ?? '';
    if (!sid) {
      // Token viejo sin sid: no podemos distinguir sesiones, cerramos.
      ws.close(4002, 'Sesión no identificable');
      return;
    }

    const client: Client = { ws, sid, producto: payload.producto ?? null, alive: true };
    let set = clientsByUser.get(userId);
    if (!set) { set = new Set(); clientsByUser.set(userId, set); }
    set.add(client);

    ws.on('pong', () => { client.alive = true; });

    ws.on('close', () => {
      const s = clientsByUser.get(userId);
      if (s) { s.delete(client); if (s.size === 0) clientsByUser.delete(userId); }
    });

    ws.on('error', () => { /* la limpieza la hace 'close' */ });
  });

  // Heartbeat: cada 30s pingeamos; en VPS/LiteSpeed evita que mueran conexiones
  // ociosas y limpia las que ya no responden.
  const interval = setInterval(() => {
    for (const set of clientsByUser.values()) {
      for (const client of set) {
        if (!client.alive) { client.ws.terminate(); continue; }
        client.alive = false;
        try { client.ws.ping(); } catch { /* ignore */ }
      }
    }
  }, 30_000);

  wss.on('close', () => clearInterval(interval));

  // eslint-disable-next-line no-console
  console.log(`  WS:      sesión única en ${WS_PATH}`);
}

/**
 * Cierra las conexiones del usuario cuyo `sid` no sea el indicado, ACOTADO al
 * mismo producto. Si `producto` es null (cuenta legacy), afecta todas. Así entrar
 * a un producto no cierra la sesión del mismo usuario en OTRO producto.
 * Lo llama el login tras generar la sesión nueva.
 */
export function revokeOtherSessions(userId: number, producto: string | null, keepSid: string): void {
  const set = clientsByUser.get(userId);
  if (!set) return;

  for (const client of set) {
    if (client.sid === keepSid) continue;
    // Solo cerramos sesiones del MISMO producto (cuando se especifica uno).
    if (producto && client.producto !== producto) continue;
    try {
      client.ws.send(JSON.stringify({ type: 'SESSION_REVOKED' }));
    } catch { /* ignore */ }
    // Pequeño margen para que el mensaje salga antes de cerrar.
    setTimeout(() => { try { client.ws.close(4003, 'SESSION_REVOKED'); } catch { /* ignore */ } }, 100);
  }
}
