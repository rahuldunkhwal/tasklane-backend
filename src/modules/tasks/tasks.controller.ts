import type { RequestHandler } from 'express';
import { getAuthUser } from '../../middleware/requireAuth.js';
import { toTaskDto } from './task.dto.js';
import type { CreateTaskInput, UpdateTaskInput } from './tasks.schema.js';
import * as tasksService from './tasks.service.js';

export const list: RequestHandler = async (req, res) => {
  const tasks = await tasksService.listTasks(getAuthUser(req).id);
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

export const remove: RequestHandler<{ id: string }> = async (req, res) => {
  await tasksService.deleteTask(getAuthUser(req).id, req.params.id);
  res.status(204).end();
};
