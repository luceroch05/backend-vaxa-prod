import { Router } from 'express';
import { w } from './shared/router.helper';

import { getCatalogos }                                              from './catalogos/catalogo.controller';
import { listProgramas, getPrograma, createPrograma, updatePrograma } from './programas/programa.controller';
import { listGrupos, getGrupo, createGrupo }                         from './grupos/grupo.controller';
import { listParticipantes, getParticipante, createParticipante }    from './participantes/participante.controller';
import { listInscripciones, createInscripcion, cambiarEstado }       from './inscripciones/inscripcion.controller';
import { listLogos, createLogo, deleteLogo }                         from './logos/logo.controller';
import { listFirmas, createFirma, deleteFirma }                      from './firmas/firma.controller';
import { getConfig, upsertConfig }                                   from './config/config.controller';
import { listCertificados, generarCertificado, anularCertificado }   from './emision/emision.controller';

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
router.get('/participantes/:id',                w(getParticipante));
router.post('/participantes',                   w(createParticipante));

// Inscripciones
router.get('/inscripciones',                    w(listInscripciones));
router.post('/inscripciones',                   w(createInscripcion));
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
router.get('/config/:programaId',               w(getConfig));
router.put('/config/:programaId',               w(upsertConfig));

// Emision
router.get('/emision',                          w(listCertificados));
router.post('/emision/generar/:inscripcionId',  w(generarCertificado));
router.patch('/emision/:id/anular',             w(anularCertificado));

export const certificadosRoutes = router;
