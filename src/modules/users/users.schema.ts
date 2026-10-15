import { z } from 'zod';
import { requiredString } from '../../utils/zod.js';

// Same rule as sign-up's name, used when updating the display name.
export const updateNameSchema = z.object({
  name: requiredString('Name')
    .trim()
    .min(1, 'Name is required')
    .max(50, 'Name must be at most 50 characters'),
});

export type UpdateNameInput = z.infer<typeof updateNameSchema>;
