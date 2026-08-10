import type { Request, Response } from 'express';
import { configService } from './config.service';
import { tid, uid } from '../shared/router.helper';

export async function getConfig(req: Request, res: Response): Promise<void> {
  const grupoId = req.query.grupo_id ? Number(req.query.grupo_id) : 0;
  const cfg = await configService.findByPrograma(tid(req), Number(req.params.programaId), grupoId);
  if (!cfg) { res.status(404).json({ error: 'Configuración no encontrada' }); return; }
  res.json(cfg);
}

export async function upsertConfig(req: Request, res: Response): Promise<void> {
  const { plantilla_url, texto_personalizado, layout_personalizado, logo_ids, firma_ids, grupo_id } = req.body ?? {};
  res.json(await configService.upsert(tid(req), Number(req.params.programaId), {
    plantilla_url:      plantilla_url || null,
    texto_personalizado: texto_personalizado || null,
    layout_personalizado: layout_personalizado ?? null,   // JSON del modo lienzo
    grupo_id:           grupo_id ?? 0,
    logo_ids:  Array.isArray(logo_ids)  ? logo_ids  : [],
    firma_ids: Array.isArray(firma_ids) ? firma_ids : [],
  }, uid(req)));
}

/** Devuelve la lista de grupo_ids que tienen config propia para ese programa */
export async function listGruposConConfig(req: Request, res: Response): Promise<void> {
  const grupos = await configService.listGruposConConfig(tid(req), Number(req.params.programaId));
  res.json({ grupos });
}

/** Congela la config actual del programa para un grupo específico */
export async function congelarGrupo(req: Request, res: Response): Promise<void> {
  const cfg = await configService.congelarGrupo(
    tid(req),
    Number(req.params.programaId),
    Number(req.params.grupoId),
    uid(req),
  );
  if (!cfg) { res.status(404).json({ error: 'Programa sin configuración base' }); return; }
  res.json(cfg);
}

/** Plantilla base del diseño personalizado de la empresa (JSON del layout, o null). */
export async function getLayoutBase(req: Request, res: Response): Promise<void> {
  res.json({ layout_base: await configService.getLayoutBase(tid(req)) });
}

/** Guarda (o limpia con null) la plantilla base del diseño personalizado. */
export async function saveLayoutBase(req: Request, res: Response): Promise<void> {
  const { layout_base } = req.body ?? {};
  await configService.saveLayoutBase(tid(req), layout_base ?? null, uid(req));
  res.json({ ok: true });
}

/** Elimina la config específica del grupo (vuelve a heredar del programa) */
export async function eliminarConfigGrupo(req: Request, res: Response): Promise<void> {
  const ok = await configService.eliminarConfigGrupo(
    tid(req),
    Number(req.params.programaId),
    Number(req.params.grupoId),
    uid(req),
  );
  if (!ok) { res.status(404).json({ error: 'Configuración del grupo no encontrada' }); return; }
  res.status(204).send();
}
