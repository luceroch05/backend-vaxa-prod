import { Router } from 'express';
import { listProgramas, getPrograma, createPrograma, updatePrograma } from './programa.controller';

const router = Router();
const w = (fn: Function) => (req: any, res: any) => fn(req, res).catch((e: Error) => res.status(500).json({ error: e.message }));

router.get('/',     w(listProgramas));
router.get('/:id',  w(getPrograma));
router.post('/',    w(createPrograma));
router.patch('/:id', w(updatePrograma));

export const programasRoutes = router;
