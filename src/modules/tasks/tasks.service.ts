import { AppError } from '../../utils/AppError.js';
import { getOwnBoard, listOwnBoardIds, ownsBoard } from '../boards/boards.service.js';
import { TaskModel } from './task.model.js';
import type { CreateTaskInput, UpdateTaskInput } from './tasks.schema.js';

// Tasks have no owner field: a task is yours if its BOARD is yours.
// So every function here goes through the boards service to check access.

// All tasks in all of this user's boards, in one query (the frontend groups them by board)
export async function listTasks(userId: string) {
  const boardIds = await listOwnBoardIds(userId);
  return TaskModel.find({ board: { $in: boardIds } }).sort({ board: 1, order: 1 });
}

// A task counts only if it exists AND its board belongs to this user.
// Otherwise "not found" (404), which doesn't reveal that the task exists.
async function getOwnTask(userId: string, taskId: string) {
  const task = await TaskModel.findById(taskId);
  if (!task || !(await ownsBoard(userId, task.board))) {
    throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
  }
  return task;
}

export async function createTask(userId: string, input: CreateTaskInput) {
  // 404 "Board not found" if the board isn't this user's
  const board = await getOwnBoard(userId, input.boardId);

  // New tasks go to the bottom of the board: last order + 1000 (the first task gets 1000)
  const last = await TaskModel.findOne({ board: board._id }).sort({ order: -1 }).select('order');
  const order = (last?.order ?? 0) + 1000;

  return TaskModel.create({
    board: board._id,
    title: input.title,
    description: input.description,
    priority: input.priority,
    dueDate: input.dueDate,
    order,
  });
}

export async function updateTask(userId: string, taskId: string, input: UpdateTaskInput) {
  const task = await getOwnTask(userId, taskId);
  task.set(input); // only the fields that were sent (zod leaves the others out)
  return task.save();
}

export async function deleteTask(userId: string, taskId: string) {
  const task = await getOwnTask(userId, taskId);
  await task.deleteOne();
}
