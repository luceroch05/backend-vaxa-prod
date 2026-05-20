import { Router } from 'express';
import { listInscripciones, createInscripcion, cambiarEstado } from './inscripcion.controller';

const router = Router();
const w = (fn: Function) => (req: any, res: any) => fn(req, res).catch((e: Error) => res.status(500).json({ error: e.message }));

router.get('/',               w(listInscripciones));
router.post('/',              w(createInscripcion));
router.patch('/:id/estado',   w(cambiarEstado));

export const inscripcionesRoutes = router;
