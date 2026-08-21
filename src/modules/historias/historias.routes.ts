import { Router } from 'express';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { historiasRepo } from './historias.repository';
import { hcAuditoriaRepo, type HcAuditRef } from './hc-auditoria.repository';
import { sendError } from '../../shared/errors';
import { guardarAdjunto, esRutaAdjuntoValida, ADJUNTO_MAX_BYTES, TAREA_VIDEO_MAX_BYTES } from '../../shared/archivos';

/** Subcarpeta de /uploads donde viven los adjuntos clínicos (aislados de reclamos). */
const HC_SUBCARPETA = 'hc';
/** Recibe el archivo como binario crudo (NO base64). Content-Type = MIME del archivo. */
const rawUpload = express.raw({ type: () => true, limit: ADJUNTO_MAX_BYTES + 4096 });
/** Igual, pero con tope más alto: la tarea puede llevar un VIDEO propio corto (40 MB). */
const rawUploadTarea = express.raw({ type: () => true, limit: TAREA_VIDEO_MAX_BYTES + 4096 });

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

// ── Auditoría (bitácora de acciones sobre datos clínicos) ─────────────────────
const ipDe = (req: Request): string | null =>
  (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;

/** Deriva { accion, entidad, ref } desde el método + segmentos de la ruta + el body.
 *  `ref` lleva los ids/nombres para que el repo resuelva el NOMBRE del paciente y arme
 *  la frase específica. Devuelve null si esa ruta no se audita. */
function mapAuditoria(
  method: string, segs: string[], body: Record<string, any>,
): { accion: string; entidad: string; ref: HcAuditRef } | null {
  const M = method.toUpperCase();
  const n = segs.length;
  const idAt = (i: number) => { const v = Number(segs[i]); return Number.isFinite(v) ? v : undefined; };
  const numBody = (k: string) => { const v = Number(body?.[k]); return Number.isFinite(v) ? v : undefined; };
  const editEliminar = M === 'DELETE' ? 'eliminar' : 'editar';

  // pacientes / historia / acceso / asignación de terapeuta
  if (segs[0] === 'pacientes') {
    const id = idAt(1);
    if (n === 1) return { accion: 'crear', entidad: 'paciente', ref: { nombres: body?.nombres, apellidos: body?.apellidos } };
    if (n === 2) return { accion: 'editar', entidad: 'paciente', ref: { pacienteId: id } };
    const sub = segs[2];
    if (sub === 'activo')     return { accion: 'editar', entidad: 'paciente', ref: { pacienteId: id, activo: body?.activo !== false } };
    if (sub === 'terapeutas') return { accion: 'asignar', entidad: 'asignacion', ref: { pacienteId: id, terapeutaId: numBody('terapeuta_id') } };
    if (sub === 'historia')   return { accion: M === 'GET' ? 'ver' : 'crear', entidad: 'historia', ref: { pacienteId: id } };
    if (sub === 'acceso')     return { accion: M === 'DELETE' ? 'revocar' : 'crear', entidad: 'acceso', ref: { pacienteId: id } };
    return null;
  }
  if (segs[0] === 'asignaciones' && M === 'DELETE') return { accion: 'eliminar', entidad: 'asignacion', ref: { asignacionId: idAt(1) } };

  // historia (cabecera) + sus sub-colecciones (crear); el id de la ruta es el de la HISTORIA
  if (segs[0] === 'historias') {
    const historiaId = idAt(1);
    if (n === 2) return { accion: 'editar', entidad: 'historia', ref: { historiaId } };
    const ent: Record<string, string> = {
      diagnosticos: 'diagnostico', objetivos: 'objetivo', tareas: 'tarea',
      sesiones: 'sesion', tratamientos: 'tratamiento', adjuntos: 'adjunto',
    };
    if (segs[2] && ent[segs[2]]) return { accion: 'crear', entidad: ent[segs[2]], ref: { historiaId } };
    return null;
  }

  // objetivos / avance
  if (segs[0] === 'objetivos') {
    const objetivoId = idAt(1);
    if (segs[2] === 'avance') return { accion: 'crear', entidad: 'avance', ref: { objetivoId } };
    return { accion: editEliminar, entidad: 'objetivo', ref: { objetivoId } };
  }
  // tareas (+ adjunto)
  if (segs[0] === 'tareas') {
    const tareaId = idAt(1);
    if (segs[2] === 'adjunto') return { accion: M === 'DELETE' ? 'eliminar' : 'adjuntar', entidad: 'tarea', ref: { tareaId } };
    return { accion: editEliminar, entidad: 'tarea', ref: { tareaId } };
  }
  if (segs[0] === 'sesiones')      return { accion: editEliminar, entidad: 'sesion',      ref: { sesionId: idAt(1) } };
  if (segs[0] === 'tratamientos')  return { accion: editEliminar, entidad: 'tratamiento', ref: { tratamientoId: idAt(1) } };
  if (segs[0] === 'servicios')     return n === 1
    ? { accion: 'crear',  entidad: 'servicio', ref: { servicioNombre: body?.nombre } }
    : { accion: 'editar', entidad: 'servicio', ref: { servicioId: idAt(1) } };
  if (segs[0] === 'citas')         return n === 1
    ? { accion: 'crear',  entidad: 'cita', ref: { pacienteIdBody: numBody('paciente_id') } }
    : { accion: 'editar', entidad: 'cita', ref: { citaId: idAt(1) } };
  if (segs[0] === 'adjuntos' && M === 'DELETE') return { accion: 'eliminar', entidad: 'adjunto', ref: { adjuntoId: idAt(1) } };
  if (segs[0] === 'terapeutas' && segs[2] === 'servicios') return { accion: 'editar', entidad: 'terapeuta_servicio', ref: { terapeutaId: idAt(1) } };
  return null;
}

/** Middleware: tras una respuesta EXITOSA, registra la acción (fire-and-forget). Audita
 *  las mutaciones (POST/PATCH/PUT/DELETE) y el ACCESO a la historia clínica (GET). */
function auditar(req: Request, res: Response, next: NextFunction): void {
  const M = req.method.toUpperCase();
  const esMutacion = M === 'POST' || M === 'PATCH' || M === 'PUT' || M === 'DELETE';
  const esVerHistoria = M === 'GET' && /^\/pacientes\/\d+\/historia\/?$/.test(req.path);
  if (!esMutacion && !esVerHistoria) { next(); return; }

  // El body puede ser un Buffer en las subidas de archivos (adjuntos/tareas): ahí no hay campos.
  const body: Record<string, any> = (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) ? req.body : {};

  res.on('finish', () => {
    if (res.statusCode >= 400) return;   // solo acciones que salieron bien
    try {
      const segs = req.path.split('/').filter(Boolean);
      const info = mapAuditoria(M, segs, body);
      if (!info) return;
      const slug = (req.headers['x-tenant-id'] as string)?.toLowerCase()?.trim();
      if (!slug) return;
      // Fire-and-forget: nunca esperar ni romper por la auditoría.
      void hcAuditoriaRepo.registrar({
        tenant: slug,
        usuarioId: (req as any).authUser?.sub ?? null,
        accion: info.accion, entidad: info.entidad, ref: info.ref, ip: ipDe(req),
      });
    } catch { /* jamás romper por auditar */ }
  });
  next();
}
router.use(auditar);

// ── Catálogos ────────────────────────────────────────────────────────────────
router.get('/catalogos', w(async (_req, res) => {
  res.json(await historiasRepo.catalogos());
}));

// ── Auditoría: bitácora de acciones (solo ADMINISTRADOR) ──────────────────────
router.get('/auditoria', soloAdmin, w(async (req, res) => {
  res.json(await hcAuditoriaRepo.listar(tid(req), {
    accion:  (req.query.accion  as string | undefined)?.trim() || undefined,
    entidad: (req.query.entidad as string | undefined)?.trim() || undefined,
    limit:   req.query.limit  ? Number(req.query.limit)  : undefined,
    offset:  req.query.offset ? Number(req.query.offset) : undefined,
  }));
}));

// ── Pacientes ────────────────────────────────────────────────────────────────
router.get('/pacientes', w(async (req, res) => {
  const incluirInactivos = req.query.todos === '1' || req.query.todos === 'true';
  res.json(await historiasRepo.listPacientes(tid(req), incluirInactivos));
}));

// Verifica si un documento ya está registrado (para avisar al llenar el input).
// Va ANTES de '/pacientes/:id' para que ':id' no capture 'existe'.
router.get('/pacientes/existe', w(async (req, res) => {
  const p = await historiasRepo.buscarPorDoc(
    tid(req), String(req.query.tipo_doc || '1'), String(req.query.num_doc || ''),
    req.query.excluir_id ? Number(req.query.excluir_id) : undefined,
  );
  res.json({ existe: !!p, paciente: p ? { id: p.id, nombre: `${p.apellidos}, ${p.nombres}` } : null });
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

/** Adjunta un AUDIO, imagen o VIDEO corto a la tarea. Binario crudo, igual que adjuntos.
 *  Los videos usan un tope mayor (TAREA_VIDEO_MAX_BYTES); audio/imagen el normal. */
router.post('/tareas/:id/adjunto', escribeClinico, rawUploadTarea, w(async (req, res) => {
  const mime = String(req.headers['content-type'] || '');
  let nombre = 'audio';
  try { nombre = decodeURIComponent(String(req.headers['x-file-name'] || 'audio')); } catch { /* deja 'audio' */ }
  const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? []);
  const esVideo = mime.toLowerCase().startsWith('video');
  const guardado = guardarAdjunto(buffer, mime, nombre, HC_SUBCARPETA, esVideo ? TAREA_VIDEO_MAX_BYTES : ADJUNTO_MAX_BYTES);
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

// ── Tratamientos (etapas de atención; varios servicios a la vez) ──────────────
router.get('/historias/:id/tratamientos', w(async (req, res) => {
  res.json(await historiasRepo.listTratamientos(tid(req), Number(req.params.id)));
}));
router.post('/historias/:id/tratamientos', escribeClinico, w(async (req, res) => {
  res.status(201).json(await historiasRepo.createTratamiento(tid(req), Number(req.params.id), req.body ?? {}, uid(req)));
}));
router.patch('/tratamientos/:id', escribeClinico, w(async (req, res) => {
  const t = await historiasRepo.updateTratamiento(tid(req), Number(req.params.id), req.body ?? {}, uid(req));
  if (!t) { res.status(404).json({ error: 'Tratamiento no encontrado' }); return; }
  res.json(t);
}));
router.delete('/tratamientos/:id', escribeClinico, w(async (req, res) => {
  const ok = await historiasRepo.deleteTratamiento(tid(req), Number(req.params.id));
  if (!ok) { res.status(404).json({ error: 'Tratamiento no encontrado' }); return; }
  res.json({ ok: true });
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
