import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validateBody } from '../../middleware/validate.js';
import * as authController from './auth.controller.js';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
} from './auth.schema.js';

export const authRouter = Router();

// Each route reads left to right: URL → checks → controller
authRouter.post('/signup', validateBody(signupSchema), authController.signup);
authRouter.post('/login', validateBody(loginSchema), authController.login);
authRouter.get('/me', requireAuth, authController.me);
// Not behind requireAuth on purpose: logging out must work even with an expired or broken cookie
authRouter.post('/logout', authController.logout);
authRouter.post(
  '/forgot-password',
  validateBody(forgotPasswordSchema),
  authController.forgotPassword,
);
authRouter.post('/reset-password', validateBody(resetPasswordSchema), authController.resetPassword);
// Logged in: requireAuth runs first, so a logged-out request gets 401 before any validation
authRouter.post(
  '/change-password',
  requireAuth,
  validateBody(changePasswordSchema),
  authController.changePassword,
);
