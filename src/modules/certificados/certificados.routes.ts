import { Router } from 'express';
import { w } from './shared/router.helper';

import { getCatalogos }                                              from './catalogos/catalogo.controller';
import { listCalidades, createCalidad, updateCalidad }               from './calidades/calidad.controller';
import { listProgramas, getPrograma, createPrograma, updatePrograma, setActivoPrograma, eliminarPrograma } from './programas/programa.controller';
import { listGrupos, getGrupo, createGrupo, updateGrupo, setActivoGrupo, eliminarGrupo } from './grupos/grupo.controller';
import { listParticipantes, getParticipante, createParticipante, buscarParticipante, setActivoParticipante, eliminarParticipante, actualizarParticipante } from './participantes/participante.controller';
import { listInscripciones, createInscripcion, cambiarEstado, cambiarCalidad, cambiarEstadoMasivo, eliminarInscripcion, inscribir, importarMasivo } from './inscripciones/inscripcion.controller';
import { listLogos, createLogo, updateLogo, deleteLogo }             from './logos/logo.controller';
import { listFirmas, createFirma, updateFirma, deleteFirma }         from './firmas/firma.controller';
import { getConfig, upsertConfig, listGruposConConfig, congelarGrupo, eliminarConfigGrupo, getLayoutBase, saveLayoutBase } from './config/config.controller';
import { listCertificados, generarCertificado, generarLote, anularCertificado, eliminarCertificado, regenerarPDF, previewCertificado,descargarZipGrupo, descargarZipPorIds, } from './emision/emision.controller';
import { listUnidades, createUnidad, updateUnidad, deleteUnidad } from './unidades/unidad.controller';
import { getNotasGrupo, guardarNotas } from './notas/nota.controller';
import { getCreditos, getMovimientos } from './creditos/credito.controller';
import { listPlanes, getEstadoPlan } from './planes/plan.controller';
import { getAuditoria } from './auditoria/auditoria.controller';
import { getReportes, getReporteCertificados } from './reportes/reportes.controller';
import { soloAdmin } from './shared/rol.guard';

const router = Router();

// Catalogos
router.get('/catalogos',                        w(getCatalogos));

// Calidades de participación (catálogo por empresa; reemplaza el hardcode del front)
router.get('/calidades',                        w(listCalidades));
router.post('/calidades',                       w(createCalidad));
router.patch('/calidades/:id',                  w(updateCalidad));

// Programas
router.get('/programas',                        w(listProgramas));
router.get('/programas/:id',                    w(getPrograma));
router.post('/programas',                       w(createPrograma));
router.patch('/programas/:id/activo', soloAdmin, w(setActivoPrograma));      // archivar/reactivar
router.delete('/programas/:id',       soloAdmin, w(eliminarPrograma));       // borrar (con protección)
router.patch('/programas/:id',        soloAdmin, w(updatePrograma));         // editar

// Grupos
router.get('/grupos',                           w(listGrupos));
router.get('/grupos/:id',                       w(getGrupo));
router.post('/grupos',                          w(createGrupo));
router.patch('/grupos/:id/activo',    soloAdmin, w(setActivoGrupo));         // archivar/reactivar aula
router.patch('/grupos/:id',           soloAdmin, w(updateGrupo));            // editar aula
router.delete('/grupos/:id',          soloAdmin, w(eliminarGrupo));          // borrar aula (con protección)

// Participantes
router.get('/participantes',                    w(listParticipantes));
router.get('/participantes/buscar',             w(buscarParticipante));      // ?documento=XXXX (autocompletar)
router.get('/participantes/:id',                w(getParticipante));
router.post('/participantes',                   w(createParticipante));
router.patch('/participantes/:id/activo', soloAdmin, w(setActivoParticipante));  // archivar/reactivar estudiante (solo admin)
router.patch('/participantes/:id',                  w(actualizarParticipante)); // editar datos del estudiante (admision SÍ)
router.delete('/participantes/:id',       soloAdmin, w(eliminarParticipante));   // borrar estudiante (solo admin)

// Inscripciones
router.get('/inscripciones',                    w(listInscripciones));
router.post('/inscripciones',                   w(createInscripcion));
router.post('/inscripciones/inscribir',         w(inscribir));               // find-or-create por documento + valida duplicado
router.post('/inscripciones/importar',          w(importarMasivo));          // carga masiva por Excel (inscribe / opcional emite)
router.patch('/inscripciones/estado-masivo',    w(cambiarEstadoMasivo));      // aprobar/cambiar varias a la vez
router.patch('/inscripciones/:id/estado',       w(cambiarEstado));
router.patch('/inscripciones/:id/calidad',      w(cambiarCalidad));           // corregir calidad (Ponente/Participante…)
router.delete('/inscripciones/:id',   soloAdmin, w(eliminarInscripcion));    // borrar inscripción (con protección)

// Logos (admision SÍ puede crear, editar y eliminar logos)
router.get('/logos',                            w(listLogos));
router.post('/logos',                           w(createLogo));
router.put('/logos/:id',                        w(updateLogo));
router.delete('/logos/:id',                     w(deleteLogo));

// Firmas (admision SÍ puede crear, editar y eliminar firmas)
router.get('/firmas',                           w(listFirmas));
router.post('/firmas',                          w(createFirma));
router.put('/firmas/:id',                       w(updateFirma));
router.delete('/firmas/:id',                    w(deleteFirma));

// Config / diseño del certificado (admision SÍ puede configurar plantilla/logos/firmas)
// Plantilla base del diseño personalizado (por empresa). Va ANTES de /config/:programaId
// para que "config-base" no colisione con el patrón con parámetro.
router.get('/config-base',                                 w(getLayoutBase));           // plantilla base de la empresa
router.put('/config-base',                                 w(saveLayoutBase));          // guarda la plantilla base
router.get('/config/:programaId',                          w(getConfig));               // ?grupo_id=N (opcional)
router.put('/config/:programaId',                          w(upsertConfig));            // body.grupo_id (opcional, default 0)
router.get('/config/:programaId/grupos',                   w(listGruposConConfig));     // lista grupos con config propia
router.post('/config/:programaId/congelar/:grupoId',       w(congelarGrupo));           // congela config actual para un grupo
router.delete('/config/:programaId/grupo/:grupoId',        w(eliminarConfigGrupo));     // elimina override del grupo

// Unidades (admision SÍ puede crear y editar; borrar solo admin)
router.get('/unidades',                         w(listUnidades));            // ?programa_id=N
router.post('/unidades',                        w(createUnidad));
router.patch('/unidades/:id',                   w(updateUnidad));            // editar
router.delete('/unidades/:id',        soloAdmin, w(deleteUnidad));           // borrar (solo admin)

// Notas
router.get('/notas/grupo/:grupoId',             w(getNotasGrupo));           // matriz del grupo
router.put('/notas/inscripcion/:inscripcionId', w(guardarNotas));           // guardar notas + recalcular aprobación
// El acta de notas ya NO es archivo aparte: se genera como 2ª página del certificado.

// Emision
router.get('/emision',                          w(listCertificados));
router.get('/emision/preview/:inscripcionId',   w(previewCertificado));      // vista previa PDF (no emite)
router.post('/emision/generar/:inscripcionId',  w(generarCertificado));
router.post('/emision/lote',                    w(generarLote));             // emite varias → UN solo movimiento de crédito
router.patch('/emision/:id/anular',              w(anularCertificado));      // ADMISION y ADMINISTRADOR pueden anular
router.delete('/emision/:id',                    w(eliminarCertificado));    // ADMINISTRADOR sin límite; ADMISION solo ≤24h (candado en el controller)
router.post('/emision/:id/regenerar-pdf',       w(regenerarPDF));
router.get('/emision/grupo/:grupoId/zip',w(descargarZipGrupo),
);
router.post('/emision/zip',                     w(descargarZipPorIds));       // ZIP de una lista de IDs (lo filtrado)
// Creditos (saldo de la propia empresa) — LEGACY, en proceso de retiro hacia planes.
router.get('/creditos',                         w(getCreditos));
router.get('/creditos/movimientos',             w(getMovimientos));

// Planes (suscripción + cupo mensual de la propia empresa)
router.get('/planes',                           w(listPlanes));              // catálogo
router.get('/planes/estado',                    w(getEstadoPlan));           // plan vigente + consumo del mes

// Auditoría (solo ADMINISTRADOR de la empresa; gateada a planes Profesional+)
router.get('/auditoria',                        w(getAuditoria));

// Reportes / métricas (solo ADMINISTRADOR; gateados a planes Profesional+)
router.get('/reportes',               soloAdmin, w(getReportes));
router.get('/reportes/certificados',  soloAdmin, w(getReporteCertificados));

export const certificadosRoutes = router;
