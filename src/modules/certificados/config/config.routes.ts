import { Router } from 'express';
import { getConfig, upsertConfig } from './config.controller';

const router = Router();
const w = (fn: Function) => (req: any, res: any) => fn(req, res).catch((e: Error) => res.status(500).json({ error: e.message }));

router.get('/:programaId',  w(getConfig));
router.put('/:programaId',  w(upsertConfig));

export const configRoutes = router;
