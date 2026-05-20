import { Router } from 'express';
import { catalogosRoutes }     from './catalogos/catalogo.routes';
import { programasRoutes }     from './programas/programa.routes';
import { gruposRoutes }        from './grupos/grupo.routes';
import { participantesRoutes } from './participantes/participante.routes';
import { inscripcionesRoutes } from './inscripciones/inscripcion.routes';
import { logosRoutes }         from './logos/logo.routes';
import { firmasRoutes }        from './firmas/firma.routes';
import { configRoutes }        from './config/config.routes';
import { emisionRoutes }       from './emision/emision.routes';

const router = Router();

router.use('/catalogos',     catalogosRoutes);
router.use('/programas',     programasRoutes);
router.use('/grupos',        gruposRoutes);
router.use('/participantes', participantesRoutes);
router.use('/inscripciones', inscripcionesRoutes);
router.use('/logos',         logosRoutes);
router.use('/firmas',        firmasRoutes);
router.use('/config',        configRoutes);
router.use('/emision',       emisionRoutes);

export const certificadosRoutes = router;
