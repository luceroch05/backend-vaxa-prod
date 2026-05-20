import { Router } from 'express';
import { listFirmas, createFirma, deleteFirma } from './firma.controller';

const router = Router();
const w = (fn: Function) => (req: any, res: any) => fn(req, res).catch((e: Error) => res.status(500).json({ error: e.message }));

router.get('/',       w(listFirmas));
router.post('/',      w(createFirma));
router.delete('/:id', w(deleteFirma));

export const firmasRoutes = router;
