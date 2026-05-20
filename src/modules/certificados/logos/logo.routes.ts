import { Router } from 'express';
import { listLogos, createLogo, deleteLogo } from './logo.controller';

const router = Router();
const w = (fn: Function) => (req: any, res: any) => fn(req, res).catch((e: Error) => res.status(500).json({ error: e.message }));

router.get('/',     w(listLogos));
router.post('/',    w(createLogo));
router.delete('/:id', w(deleteLogo));

export const logosRoutes = router;
