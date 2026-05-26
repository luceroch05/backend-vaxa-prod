import { Router } from 'express';
import { loginController } from './auth.controller';

export const authRoutes = Router();

authRoutes.post('/login', (req, res) =>
  loginController(req, res).catch((e: Error) =>
    res.status(500).json({ error: e.message })
  )
);
