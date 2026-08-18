import { Router } from 'express';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { historiasRepo } from './historias.repository';
import { sendError } from '../../shared/errors';
import { guardarAdjunto, esRutaAdjuntoValida, ADJUNTO_MAX_BYTES } from '../../shared/archivos';

/** Subcarpeta de /uploads donde viven los adjuntos clínicos (aislados de reclamos). */
const HC_SUBCARPETA = 'hc';
/** Recibe el archivo como binario crudo (NO base64). Content-Type = MIME del archivo. */
const rawUpload = express.raw({ type: () => true, limit: ADJUNTO_MAX_BYTES + 4096 });

/**
 * Rutas del módulo Historias Clínicas (centros terapéuticos).
 * Se montan bajo /api/historias con jwtMiddleware + tenantMatchMiddleware
 * (ver index.ts), así que aquí ya llega `authUser` con { empresa, rol, sub }.
 *
 * Roles:
 *   ADMINISTRADOR -> todo.
 *   ADMISION      -> registra/edita pacientes, agenda; VE todo (incl. clínico).
 *   TERAPEUTA     -> abre historia y escribe evoluciones.
 */

// Helpers locales (aislados del módulo de certificados).
const w = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response) => fn(req, res).catch((e) => sendError(res, e, 'historias'));

const tid = (req: Request): string => {
  const slug = (req.headers['x-tenant-id'] as string)?.toLowerCase()?.trim();
  if (!slug) throw new Error('x-tenant-id header requerido');
  return slug;
};
const uid = (req: Request): number | undefined => (req as any).authUser?.sub;
const rol = (req: Request): string => String((req as any).authUser?.rol ?? '').toUpperCase();

/** Guard que exige uno de los roles dados. */
const requireRol = (...roles: string[]) =>
  (req: Request, res: Response, next: NextFunction): void => {
    if (roles.includes(rol(req))) return next();
    res.status(403).json({
      error: 'Tu rol no tiene permiso para esta acción.',
      code: 'ROL_SIN_PERMISO',
    });
  };

const soloAdmin       = requireRol('ADMINISTRADOR');
const gestionaPaciente = requireRol('ADMINISTRADOR', 'ADMISION');       // recepción
const escribeClinico   = requireRol('ADMINISTRADOR', 'TERAPEUTA');      // contenido clínico

const router = Router();

// ── Catálogos ────────────────────────────────────────────────────────────────
router.get('/catalogos', w(async (_req, res) => {
  res.json(await historiasRepo.catalogos());
}));

// ── Pacientes ────────────────────────────────────────────────────────────────
router.get('/pacientes', w(async (req, res) => {
  const incluirInactivos = req.query.todos === '1' || req.query.todos === 'true';
  res.json(await historiasRepo.listPacientes(tid(req), incluirInactivos));
}));

router.get('/pacientes/:id', w(async (req, res) => {
  const p = await historiasRepo.getPaciente(tid(req), Number(req.params.id));
  if (!p) { res.status(404).json({ error: 'Paciente no encontrado' }); return; }
  res.json(p);
}));

router.post('/pacientes', gestionaPaciente, w(async (req, res) => {
  const p = await historiasRepo.createPaciente(tid(req), req.body ?? {}, uid(req));
  res.status(201).json(p);
}));

router.patch('/pacientes/:id', gestionaPaciente, w(async (req, res) => {
  const p = await historiasRepo.updatePaciente(tid(req), Number(req.params.id), req.body ?? {}, uid(req));
  if (!p) { res.status(404).json({ error: 'Paciente no encontrado' }); return; }
  res.json(p);
}));

router.patch('/pacientes/:id/activo', soloAdmin, w(async (req, res) => {
  const activo = req.body?.activo !== false;
  const ok = await historiasRepo.setActivoPaciente(tid(req), Number(req.params.id), activo, uid(req));
  if (!ok) { res.status(404).json({ error: 'Paciente no encontrado' }); return; }
  res.status(204).send();
}));

// ── Asignación de terapeuta ───────────────────────────────────────────────────
router.get('/pacientes/:id/terapeutas', w(async (req, res) => {
  res.json(await historiasRepo.listAsignaciones(tid(req), Number(req.params.id)));
}));

router.post('/pacientes/:id/terapeutas', gestionaPaciente, w(async (req, res) => {
  const terapeutaId = Number(req.body?.terapeuta_id);
  const servicioId = req.body?.servicio_id ? Number(req.body.servicio_id) : null;
  if (!terapeutaId) { res.status(400).json({ error: 'terapeuta_id es requerido' }); return; }
  res.status(201).json(await historiasRepo.asignarTerapeuta(tid(req), Number(req.params.id), terapeutaId, servicioId, uid(req)));
}));

router.delete('/asignaciones/:asignacionId', gestionaPaciente, w(async (req, res) => {
  const ok = await historiasRepo.quitarAsignacion(tid(req), Number(req.params.asignacionId));
  if (!ok) { res.status(404).json({ error: 'Asignación no encontrada' }); return; }
  res.status(204).send();
}));

// ── Historia clínica (cabecera + anamnesis) ───────────────────────────────────
router.get('/pacientes/:id/historia', w(async (req, res) => {
  const h = await historiasRepo.getHistoriaByPaciente(tid(req), Number(req.params.id));
  if (!h) { res.status(404).json({ error: 'Historia no abierta' }); return; }
  res.json(h);
}));

router.post('/pacientes/:id/historia', escribeClinico, w(async (req, res) => {
  const h = await historiasRepo.abrirHistoria(tid(req), Number(req.params.id), req.body ?? {}, uid(req));
  res.status(201).json(h);
}));

router.patch('/historias/:id', escribeClinico, w(async (req, res) => {
  const h = await historiasRepo.updateHistoria(tid(req), Number(req.params.id), req.body ?? {}, uid(req));
  if (!h) { res.status(404).json({ error: 'Historia no encontrada' }); return; }
  res.json(h);
}));

// ── Diagnósticos ──────────────────────────────────────────────────────────────
router.get('/historias/:id/diagnosticos', w(async (req, res) => {
  res.json(await historiasRepo.listDiagnosticos(tid(req), Number(req.params.id)));
}));

router.post('/historias/:id/diagnosticos', escribeClinico, w(async (req, res) => {
  res.status(201).json(await historiasRepo.addDiagnostico(tid(req), Number(req.params.id), req.body ?? {}, uid(req)));
}));

// ── Objetivos terapéuticos + progreso ─────────────────────────────────────────
router.get('/historias/:id/objetivos', w(async (req, res) => {
  res.json(await historiasRepo.listObjetivos(tid(req), Number(req.params.id)));
}));

router.post('/historias/:id/objetivos', escribeClinico, w(async (req, res) => {
  res.status(201).json(await historiasRepo.createObjetivo(tid(req), Number(req.params.id), req.body ?? {}, uid(req)));
}));

router.patch('/objetivos/:id', escribeClinico, w(async (req, res) => {
  const o = await historiasRepo.updateObjetivo(tid(req), Number(req.params.id), req.body ?? {});
  if (!o) { res.status(404).json({ error: 'Objetivo no encontrado' }); return; }
  res.json(o);
}));

router.delete('/objetivos/:id', escribeClinico, w(async (req, res) => {
  const ok = await historiasRepo.deleteObjetivo(tid(req), Number(req.params.id));
  if (!ok) { res.status(404).json({ error: 'Objetivo no encontrado' }); return; }
  res.status(204).send();
}));

router.get('/objetivos/:id/avance', w(async (req, res) => {
  res.json(await historiasRepo.listAvance(tid(req), Number(req.params.id)));
}));

router.post('/objetivos/:id/avance', escribeClinico, w(async (req, res) => {
  res.status(201).json(await historiasRepo.addAvance(tid(req), Number(req.params.id), req.body ?? {}, uid(req)));
}));

// ── Acceso del apoderado al portal (enlace mágico) ────────────────────────────
router.get('/pacientes/:id/acceso', gestionaPaciente, w(async (req, res) => {
  res.json(await historiasRepo.getAccesoByPaciente(tid(req), Number(req.params.id)));
}));

router.post('/pacientes/:id/acceso', gestionaPaciente, w(async (req, res) => {
  res.status(201).json(await historiasRepo.crearAcceso(tid(req), Number(req.params.id), uid(req)));
}));

router.post('/pacientes/:id/acceso/regenerar', gestionaPaciente, w(async (req, res) => {
  res.status(201).json(await historiasRepo.regenerarAcceso(tid(req), Number(req.params.id), uid(req)));
}));

router.delete('/pacientes/:id/acceso', gestionaPaciente, w(async (req, res) => {
  await historiasRepo.revocarAcceso(tid(req), Number(req.params.id));
  res.status(204).send();
}));

// ── Tareas para casa ──────────────────────────────────────────────────────────
router.get('/historias/:id/tareas', w(async (req, res) => {
  res.json(await historiasRepo.listTareas(tid(req), Number(req.params.id)));
}));

router.post('/historias/:id/tareas', escribeClinico, w(async (req, res) => {
  res.status(201).json(await historiasRepo.createTarea(tid(req), Number(req.params.id), req.body ?? {}, uid(req)));
}));

router.patch('/tareas/:id', escribeClinico, w(async (req, res) => {
  const t = await historiasRepo.updateTarea(tid(req), Number(req.params.id), req.body ?? {});
  if (!t) { res.status(404).json({ error: 'Tarea no encontrada' }); return; }
  res.json(t);
}));

router.delete('/tareas/:id', escribeClinico, w(async (req, res) => {
  const ok = await historiasRepo.deleteTarea(tid(req), Number(req.params.id));
  if (!ok) { res.status(404).json({ error: 'Tarea no encontrada' }); return; }
  res.status(204).send();
}));

/** Adjunta un AUDIO (mp3) o imagen a la tarea. Binario crudo, igual que adjuntos. */
router.post('/tareas/:id/adjunto', escribeClinico, rawUpload, w(async (req, res) => {
  const mime = String(req.headers['content-type'] || '');
  let nombre = 'audio';
  try { nombre = decodeURIComponent(String(req.headers['x-file-name'] || 'audio')); } catch { /* deja 'audio' */ }
  const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? []);
  const guardado = guardarAdjunto(buffer, mime, nombre, HC_SUBCARPETA);
  if (!esRutaAdjuntoValida(guardado.ruta, HC_SUBCARPETA)) {
    res.status(400).json({ error: 'No se pudo guardar el archivo' }); return;
  }
  const t = await historiasRepo.setTareaAdjunto(tid(req), Number(req.params.id),
    { ruta: guardado.ruta, nombre: guardado.nombre, mime: guardado.mime });
  if (!t) { res.status(404).json({ error: 'Tarea no encontrada' }); return; }
  res.status(201).json(t);
}));

router.delete('/tareas/:id/adjunto', escribeClinico, w(async (req, res) => {
  const t = await historiasRepo.setTareaAdjunto(tid(req), Number(req.params.id), null);
  if (!t) { res.status(404).json({ error: 'Tarea no encontrada' }); return; }
  res.json(t);
}));

// ── Sesiones / evoluciones ────────────────────────────────────────────────────
router.get('/historias/:id/sesiones', w(async (req, res) => {
  res.json(await historiasRepo.listSesiones(tid(req), Number(req.params.id)));
}));

router.post('/historias/:id/sesiones', escribeClinico, w(async (req, res) => {
  const terapeutaId = uid(req);
  if (!terapeutaId) { res.status(401).json({ error: 'Usuario no identificado' }); return; }
  res.status(201).json(await historiasRepo.createSesion(tid(req), Number(req.params.id), req.body ?? {}, terapeutaId));
}));

router.patch('/sesiones/:id', escribeClinico, w(async (req, res) => {
  const s = await historiasRepo.updateSesion(tid(req), Number(req.params.id), req.body ?? {}, uid(req));
  if (!s) { res.status(404).json({ error: 'Sesión no encontrada' }); return; }
  res.json(s);
}));

// ── Servicios del centro (gestión: ADMIN + ADMISION) ──────────────────────────
router.get('/servicios', w(async (req, res) => {
  const todos = req.query.todos === '1' || req.query.todos === 'true';
  res.json(await historiasRepo.listServicios(tid(req), todos));
}));
router.post('/servicios', gestionaPaciente, w(async (req, res) => {
  res.status(201).json(await historiasRepo.createServicio(tid(req), req.body ?? {}, uid(req)));
}));
router.patch('/servicios/:id', gestionaPaciente, w(async (req, res) => {
  const s = await historiasRepo.updateServicio(tid(req), Number(req.params.id), req.body ?? {});
  if (!s) { res.status(404).json({ error: 'Servicio no encontrado' }); return; }
  res.json(s);
}));

// ── Servicios que brinda cada terapeuta ───────────────────────────────────────
router.get('/terapeutas/:id/servicios', w(async (req, res) => {
  res.json(await historiasRepo.getServiciosDeTerapeuta(tid(req), Number(req.params.id)));
}));
router.put('/terapeutas/:id/servicios', gestionaPaciente, w(async (req, res) => {
  const ids = Array.isArray(req.body?.servicio_ids) ? req.body.servicio_ids.map(Number) : [];
  res.json(await historiasRepo.setServiciosTerapeuta(tid(req), Number(req.params.id), ids));
}));

// ── Terapeutas del centro (para asignar / agendar). ?servicio_id filtra. ──────
router.get('/terapeutas', w(async (req, res) => {
  const servicioId = req.query.servicio_id ? Number(req.query.servicio_id) : undefined;
  res.json(await historiasRepo.listTerapeutas(tid(req), servicioId));
}));

// ── Citas / agenda ────────────────────────────────────────────────────────────
router.get('/citas', w(async (req, res) => {
  const filtros = {
    desde: req.query.desde as string | undefined,
    hasta: req.query.hasta as string | undefined,
    terapeutaId: req.query.terapeuta_id ? Number(req.query.terapeuta_id) : undefined,
    pacienteId: req.query.paciente_id ? Number(req.query.paciente_id) : undefined,
  };
  res.json(await historiasRepo.listCitas(tid(req), filtros));
}));

router.post('/citas', gestionaPaciente, w(async (req, res) => {
  res.status(201).json(await historiasRepo.createCita(tid(req), req.body ?? {}, uid(req)));
}));

router.patch('/citas/:id', gestionaPaciente, w(async (req, res) => {
  const c = await historiasRepo.updateCita(tid(req), Number(req.params.id), req.body ?? {}, uid(req));
  if (!c) { res.status(404).json({ error: 'Cita no encontrada' }); return; }
  res.json(c);
}));

// ── Adjuntos de la historia (informes, PDFs, exámenes) ────────────────────────
router.get('/historias/:id/adjuntos', w(async (req, res) => {
  res.json(await historiasRepo.listAdjuntos(tid(req), Number(req.params.id)));
}));

/** Sube UN archivo (binario) y lo registra en la historia en un solo paso.
 *  Headers: Content-Type = MIME · x-file-name = nombre original (URL-encoded). */
router.post('/historias/:id/adjuntos', escribeClinico, rawUpload, w(async (req, res) => {
  const mime = String(req.headers['content-type'] || '');
  let nombre = 'archivo';
  try { nombre = decodeURIComponent(String(req.headers['x-file-name'] || 'archivo')); } catch { /* deja 'archivo' */ }
  const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? []);
  const guardado = guardarAdjunto(buffer, mime, nombre, HC_SUBCARPETA);
  if (!esRutaAdjuntoValida(guardado.ruta, HC_SUBCARPETA)) {
    res.status(400).json({ error: 'No se pudo guardar el archivo' }); return;
  }
  const adj = await historiasRepo.addAdjunto(
    tid(req), Number(req.params.id),
    { nombre: guardado.nombre, ruta: guardado.ruta, mime: guardado.mime }, uid(req),
  );
  res.status(201).json(adj);
}));

router.delete('/adjuntos/:id', escribeClinico, w(async (req, res) => {
  const ok = await historiasRepo.deleteAdjunto(tid(req), Number(req.params.id));
  if (!ok) { res.status(404).json({ error: 'Adjunto no encontrado' }); return; }
  res.status(204).send();
}));

export const historiasRoutes = router;
