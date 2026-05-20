import { Router } from 'express';
import { getCatalogos } from './catalogo.controller';

const router = Router();
const w = (fn: Function) => (req: any, res: any) => fn(req, res).catch((e: Error) => res.status(500).json({ error: e.message }));

router.get('/', w(getCatalogos));

export const catalogosRoutes = router;
