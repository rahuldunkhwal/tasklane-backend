import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validateBody } from '../../middleware/validate.js';
import { AppError } from '../../utils/AppError.js';
import * as usersController from './users.controller.js';
import { updateNameSchema } from './users.schema.js';

// Keep the uploaded image in memory (we forward it straight to Cloudinary, never to disk),
// cap it at 2 MB, and reject anything that isn't a JPG/PNG/WEBP before it's buffered.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError(400, 'INVALID_IMAGE', 'Please upload a JPG, PNG or WEBP image'));
    }
  },
});

export const usersRouter = Router();

usersRouter.use(requireAuth);
usersRouter.patch('/me', validateBody(updateNameSchema), usersController.updateMe);
usersRouter.post('/me/avatar', upload.single('avatar'), usersController.uploadAvatar);
usersRouter.delete('/me/avatar', usersController.removeAvatar);
