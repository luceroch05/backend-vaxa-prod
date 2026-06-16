import { Router } from 'express';
import { w } from './shared/router.helper';

import { getCatalogos }                                              from './catalogos/catalogo.controller';
import { listProgramas, getPrograma, createPrograma, updatePrograma } from './programas/programa.controller';
import { listGrupos, getGrupo, createGrupo }                         from './grupos/grupo.controller';
import { listParticipantes, getParticipante, createParticipante, buscarParticipante } from './participantes/participante.controller';
import { listInscripciones, createInscripcion, cambiarEstado, inscribir } from './inscripciones/inscripcion.controller';
import { listLogos, createLogo, deleteLogo }                         from './logos/logo.controller';
import { listFirmas, createFirma, deleteFirma }                      from './firmas/firma.controller';
import { getConfig, upsertConfig, listGruposConConfig, congelarGrupo, eliminarConfigGrupo } from './config/config.controller';
import { listCertificados, generarCertificado, anularCertificado, eliminarCertificado, regenerarPDF, previewCertificado } from './emision/emision.controller';
import { listUnidades, createUnidad, updateUnidad, deleteUnidad } from './unidades/unidad.controller';
import { getNotasGrupo, guardarNotas } from './notas/nota.controller';
import { getCreditos, getMovimientos } from './creditos/credito.controller';

const router = Router();

// Catalogos
router.get('/catalogos',                        w(getCatalogos));

// Programas
router.get('/programas',                        w(listProgramas));
router.get('/programas/:id',                    w(getPrograma));
router.post('/programas',                       w(createPrograma));
router.patch('/programas/:id',                  w(updatePrograma));

// Grupos
router.get('/grupos',                           w(listGrupos));
router.get('/grupos/:id',                       w(getGrupo));
router.post('/grupos',                          w(createGrupo));

// Participantes
router.get('/participantes',                    w(listParticipantes));
router.get('/participantes/buscar',             w(buscarParticipante));      // ?documento=XXXX (autocompletar)
router.get('/participantes/:id',                w(getParticipante));
router.post('/participantes',                   w(createParticipante));

// Inscripciones
router.get('/inscripciones',                    w(listInscripciones));
router.post('/inscripciones',                   w(createInscripcion));
router.post('/inscripciones/inscribir',         w(inscribir));               // find-or-create por documento + valida duplicado
router.patch('/inscripciones/:id/estado',       w(cambiarEstado));

// Logos
router.get('/logos',                            w(listLogos));
router.post('/logos',                           w(createLogo));
router.delete('/logos/:id',                     w(deleteLogo));

// Firmas
router.get('/firmas',                           w(listFirmas));
router.post('/firmas',                          w(createFirma));
router.delete('/firmas/:id',                    w(deleteFirma));

// Config
router.get('/config/:programaId',                          w(getConfig));               // ?grupo_id=N (opcional)
router.put('/config/:programaId',                          w(upsertConfig));            // body.grupo_id (opcional, default 0)
router.get('/config/:programaId/grupos',                   w(listGruposConConfig));     // lista grupos con config propia
router.post('/config/:programaId/congelar/:grupoId',       w(congelarGrupo));           // congela config actual para un grupo
router.delete('/config/:programaId/grupo/:grupoId',        w(eliminarConfigGrupo));     // elimina override del grupo

// Unidades (plan del programa)
router.get('/unidades',                         w(listUnidades));            // ?programa_id=N
router.post('/unidades',                        w(createUnidad));
router.patch('/unidades/:id',                   w(updateUnidad));
router.delete('/unidades/:id',                  w(deleteUnidad));

// Notas
router.get('/notas/grupo/:grupoId',             w(getNotasGrupo));           // matriz del grupo
router.put('/notas/inscripcion/:inscripcionId', w(guardarNotas));           // guardar notas + recalcular aprobación
// El acta de notas ya NO es archivo aparte: se genera como 2ª página del certificado.

// Emision
router.get('/emision',                          w(listCertificados));
router.get('/emision/preview/:inscripcionId',   w(previewCertificado));      // vista previa PDF (no emite)
router.post('/emision/generar/:inscripcionId',  w(generarCertificado));
router.patch('/emision/:id/anular',             w(anularCertificado));
router.delete('/emision/:id',                   w(eliminarCertificado));     // elimina y DEVUELVE crédito
router.post('/emision/:id/regenerar-pdf',       w(regenerarPDF));

// Creditos (saldo de la propia empresa)
router.get('/creditos',                         w(getCreditos));
router.get('/creditos/movimientos',             w(getMovimientos));

export const certificadosRoutes = router;
