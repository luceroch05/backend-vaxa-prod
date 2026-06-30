import type { Request, Response } from 'express';
import { reportesService } from './reportes.service';
import { planRepo } from '../planes/plan.repository';
import { tid } from '../shared/router.helper';
import type { RangoFechas } from './reportes.repository';

const ISO = (d: Date) => d.toISOString().slice(0, 10);

/** Lee desde/hasta del query; default = mes en curso. Acepta solo YYYY-MM-DD. */
function rango(req: Request): RangoFechas {
  const hoy = new Date();
  const primeroMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const ok = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const desde = ok(req.query.desde) ? String(req.query.desde) : ISO(primeroMes);
  const hasta = ok(req.query.hasta) ? String(req.query.hasta) : ISO(hoy);
  return { desde, hasta };
}

/** El reporte es una función de plan (Profesional o superior). */
async function exigeMetricas(req: Request, res: Response): Promise<boolean> {
  if (await planRepo.permiteMetricas(tid(req))) return true;
  res.status(403).json({ error: 'Tu plan no incluye reportes. Actualiza a Profesional o superior.', code: 'PLAN_SIN_METRICAS' });
  return false;
}

/** GET /api/certificados/reportes — resumen + por programa + tendencia mensual. */
export async function getReportes(req: Request, res: Response): Promise<void> {
  if (!(await exigeMetricas(req, res))) return;
  const r = rango(req);
  const t = tid(req);
  const [resumen, porPrograma, tendencia, embudo, comparativo, aprobacionPorPrograma, productividad] = await Promise.all([
    reportesService.resumen(t, r),
    reportesService.porPrograma(t, r),
    reportesService.tendenciaMensual(t, r),
    reportesService.embudo(t, r),
    reportesService.comparativo(t, r),
    reportesService.aprobacionPorPrograma(t, r),
    reportesService.productividad(t, r),
  ]);
  res.json({ rango: r, resumen, porPrograma, tendencia, embudo, comparativo, aprobacionPorPrograma, productividad });
}

/** GET /api/certificados/reportes/certificados — detalle para la tabla y el Excel. */
export async function getReporteCertificados(req: Request, res: Response): Promise<void> {
  if (!(await exigeMetricas(req, res))) return;
  res.json(await reportesService.certificadosDetalle(tid(req), rango(req)));
}
