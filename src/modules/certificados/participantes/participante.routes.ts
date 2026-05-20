import { Router } from 'express';
import { listParticipantes, getParticipante, createParticipante } from './participante.controller';

const router = Router();
const w = (fn: Function) => (req: any, res: any) => fn(req, res).catch((e: Error) => res.status(500).json({ error: e.message }));

router.get('/',     w(listParticipantes));
router.get('/:id',  w(getParticipante));
router.post('/',    w(createParticipante));

export const participantesRoutes = router;
