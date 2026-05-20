import { Router } from 'express';
import { listGrupos, getGrupo, createGrupo } from './grupo.controller';

const router = Router();
const w = (fn: Function) => (req: any, res: any) => fn(req, res).catch((e: Error) => res.status(500).json({ error: e.message }));

router.get('/',     w(listGrupos));
router.get('/:id',  w(getGrupo));
router.post('/',    w(createGrupo));

export const gruposRoutes = router;
