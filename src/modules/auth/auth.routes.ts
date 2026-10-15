import { Router } from 'express';
import { validateBody } from '../../middleware/validate.js';
import * as authController from './auth.controller.js';
import { signupSchema } from './auth.schema.js';

export const authRouter = Router();

// Each route reads left to right: URL → checks → controller
authRouter.post('/signup', validateBody(signupSchema), authController.signup);
