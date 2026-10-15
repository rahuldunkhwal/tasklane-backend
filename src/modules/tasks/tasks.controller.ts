import type { RequestHandler } from 'express';
import { getAuthUser } from '../../middleware/requireAuth.js';
import { toTaskDto } from './task.dto.js';
import {
  taskFiltersSchema,
  type CreateTaskInput,
  type MoveTaskInput,
  type UpdateTaskInput,
} from './tasks.schema.js';
import * as tasksService from './tasks.service.js';

export const list: RequestHandler = async (req, res) => {
  // Express 5 makes req.query read-only, so the checked filters go into a variable instead.
  // Invalid values throw a ZodError → the error handler answers 400 with a message per field.
  const filters = taskFiltersSchema.parse(req.query);
  const tasks = await tasksService.listTasks(getAuthUser(req).id, filters);
  res.json({ tasks: tasks.map(toTaskDto) });
};

export const create: RequestHandler = async (req, res) => {
  const task = await tasksService.createTask(getAuthUser(req).id, req.body as CreateTaskInput);
  res.status(201).json({ task: toTaskDto(task) });
};

export const update: RequestHandler<{ id: string }> = async (req, res) => {
  const task = await tasksService.updateTask(
    getAuthUser(req).id,
    req.params.id,
    req.body as UpdateTaskInput,
  );
  res.json({ task: toTaskDto(task) });
};

export const move: RequestHandler<{ id: string }> = async (req, res) => {
  const task = await tasksService.moveTask(
    getAuthUser(req).id,
    req.params.id,
    req.body as MoveTaskInput,
  );
  res.json({ task: toTaskDto(task) });
};

export const remove: RequestHandler<{ id: string }> = async (req, res) => {
  await tasksService.deleteTask(getAuthUser(req).id, req.params.id);
  res.status(204).end();
};
