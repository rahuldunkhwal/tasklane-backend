import type { RequestHandler } from 'express';
import { toPublicUser } from '../users/user.dto.js';
import type { SignupInput } from './auth.schema.js';
import * as authService from './auth.service.js';

// Controllers only deal with HTTP: read the request, call the service, send the response.

export const signup: RequestHandler = async (req, res) => {
  // Safe to cast: validateBody(signupSchema) already checked and cleaned req.body
  const user = await authService.signup(req.body as SignupInput);
  res.status(201).json({ user: toPublicUser(user) });
};
