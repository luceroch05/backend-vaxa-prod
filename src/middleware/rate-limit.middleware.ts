import type { Request, Response, NextFunction } from 'express';

/**
 * Rate limiter en memoria, sin dependencias externas (para no añadir paquetes
 * al deploy de cPanel). Limita las peticiones por IP en una ventana de tiempo.
 *
 * Suficiente para frenar la enumeración masiva de los endpoints públicos
 * (p.ej. iterar DNIs en /participante). En un despliegue de un solo proceso
 * LiteSpeed/Passenger funciona bien; si algún día escalas a varios procesos,
 * conviene mover esto a Redis.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

export function rateLimit(opts: { windowMs: number; max: number; message?: string }) {
  const { windowMs, max, message = 'Demasiadas peticiones, intenta más tarde.' } = opts;
  const hits = new Map<string, Bucket>();

  // Limpieza periódica para que el Map no crezca sin control.
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of hits) {
      if (bucket.resetAt <= now) hits.delete(key);
    }
  }, windowMs);
  // No mantener vivo el proceso solo por este timer.
  if (typeof cleanup.unref === 'function') cleanup.unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown';

    const now = Date.now();
    const bucket = hits.get(ip);

    if (!bucket || bucket.resetAt <= now) {
      hits.set(ip, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: message });
      return;
    }

    next();
  };
}
