import { Router } from 'express';
import { listCertificados, generarCertificado, anularCertificado } from './emision.controller';

const router = Router();
const w = (fn: Function) => (req: any, res: any) => fn(req, res).catch((e: Error) => res.status(500).json({ error: e.message }));

router.get('/',                          w(listCertificados));
router.post('/generar/:inscripcionId',   w(generarCertificado));
router.patch('/:id/anular',             w(anularCertificado));

export const emisionRoutes = router;
