import { Router } from 'express';
import { loginController } from './auth.controller';
import { sendError } from '../../shared/errors';

export const authRoutes = Router();

authRoutes.post('/login', (req, res) =>
  loginController(req, res).catch((e: unknown) => sendError(res, e, 'auth/login'))
);
