import { z } from 'zod';
import { requiredString } from '../../utils/zod.js';
import { TASK_PRIORITIES } from './task.model.js';

const titleRule = requiredString('Title')
  .trim()
  .min(1, 'Title is required')
  .max(200, 'Title must be at most 200 characters');

const descriptionRule = z
  .string({ error: 'Description must be text' })
  .trim()
  .max(2000, 'Description must be at most 2000 characters');

const priorityRule = z.enum(TASK_PRIORITIES, {
  error: 'Priority must be low, medium or high',
});

// A full date-time with time zone, e.g. "2026-10-20T18:29:59.999Z" (end of 20 Oct in India).
// null = no due date. Past dates are allowed: the task simply shows as overdue.
const dueDateRule = z.iso
  .datetime({ offset: true, error: 'Due date must be a valid date' })
  .transform((value) => new Date(value))
  .nullable();

// A MongoDB id is 24 hexadecimal characters
const boardIdRule = requiredString('Board').regex(/^[a-f\d]{24}$/i, 'Invalid board id');

export const createTaskSchema = z.object({
  boardId: boardIdRule,
  title: titleRule,
  description: descriptionRule.optional(),
  priority: priorityRule.optional(),
  dueDate: dueDateRule.optional(),
});

// Every field is optional (send only what changes), but at least one is needed.
// Unknown fields such as "board" are dropped, so a task can't be moved into someone else's board.
export const updateTaskSchema = z
  .object({
    title: titleRule.optional(),
    description: descriptionRule.optional(),
    priority: priorityRule.optional(),
    dueDate: dueDateRule.optional(),
    completed: z.boolean({ error: 'Completed must be true or false' }).optional(),
  })
  .refine((values) => Object.values(values).some((value) => value !== undefined), {
    message: 'Nothing to update',
  });

// Drag & drop: "put this task in board X at position N" (0 = top). The client only says WHERE;
// the server works out the actual order number from the neighbours stored in the database.
export const moveTaskSchema = z.object({
  boardId: boardIdRule,
  index: z
    .number({ error: 'Index must be a number' })
    .int('Index must be a whole number')
    .min(0, 'Index cannot be negative'),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;
