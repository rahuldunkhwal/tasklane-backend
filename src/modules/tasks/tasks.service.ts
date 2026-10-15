import type { QueryFilter } from 'mongoose';
import { AppError } from '../../utils/AppError.js';
import { getOwnBoard, listOwnBoardIds, ownsBoard } from '../boards/boards.service.js';
import { TaskModel, type Task } from './task.model.js';
import type {
  CreateTaskInput,
  MoveTaskInput,
  TaskFilters,
  UpdateTaskInput,
} from './tasks.schema.js';

// Tasks have no owner field: a task is yours if its BOARD is yours.
// So every function here goes through the boards service to check access.

// Space between neighbouring tasks' order numbers (1000, 2000, 3000...). The gaps let a task be
// placed between two others by changing only that one task (e.g. 1500).
const ORDER_GAP = 1000;
// When two neighbours are closer than this, there's no reliable room left between them
// (computer numbers have limited precision), so the board gets renumbered first.
const MIN_GAP = 1e-6;

// Makes user text match literally: "(" or ".*" are searched as plain characters.
// Without this, "(" would crash the query, and a crafted pattern could make MongoDB
// spend a very long time matching (a "ReDoS" attack).
function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The user's tasks (all of their boards, one query), optionally filtered.
// Every filter is ADDED to the "only my boards" condition, so filters can never widen access.
export async function listTasks(userId: string, filters: TaskFilters = {}) {
  const boardIds = await listOwnBoardIds(userId);
  const query: QueryFilter<Task> = { board: { $in: boardIds } };

  if (filters.search) {
    query.title = { $regex: escapeRegex(filters.search), $options: 'i' }; // "contains", any case
  }
  if (filters.priority) {
    query.priority = filters.priority;
  }
  if (filters.completed !== undefined) {
    query.completed = filters.completed;
  }
  if (filters.noDueDate) {
    query.dueDate = null; // matches tasks without a due date
  } else if (filters.dueFrom || filters.dueTo) {
    query.dueDate = {
      ...(filters.dueFrom && { $gte: filters.dueFrom }),
      ...(filters.dueTo && { $lte: filters.dueTo }),
    };
  }

  return TaskModel.find(query).sort({ board: 1, order: 1 });
}

export type TaskStats = { total: number; completed: number; overdue: number };

// Dashboard counts in ONE aggregation, i.e. one trip to the database, with MongoDB doing the
// counting (no task data is sent to Node). Only the user's OWN boards count: boards shared
// with them are someone else's work.
export async function getTaskStats(userId: string): Promise<TaskStats> {
  const boardIds = await listOwnBoardIds(userId); // already ObjectIds: aggregate() doesn't convert types
  const now = new Date();

  const [stats] = await TaskModel.aggregate<TaskStats>([
    // Stage 1: keep only this user's tasks (uses the { board, order } index)
    { $match: { board: { $in: boardIds } } },
    // Stage 2: squash all of them into ONE result, adding 1 or 0 per task
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        completed: { $sum: { $cond: ['$completed', 1, 0] } },
        overdue: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$completed', false] },
                  // In MongoDB comparisons null is "smaller" than every date, so without this
                  // check, tasks with NO due date would be counted as overdue
                  { $eq: [{ $type: '$dueDate' }, 'date'] },
                  { $lt: ['$dueDate', now] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
    { $project: { _id: 0, total: 1, completed: 1, overdue: 1 } },
  ]);

  // No tasks at all → no group is produced → report zeros
  return stats ?? { total: 0, completed: 0, overdue: 0 };
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
  const order = (last?.order ?? 0) + ORDER_GAP;

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

// ---------- Drag & drop ----------

// The order number that puts a task between two neighbours (either may be missing),
// or null when there's no room left between them
function orderBetween(before: number | undefined, after: number | undefined): number | null {
  if (before === undefined && after === undefined) return ORDER_GAP; // into an empty board
  if (before === undefined) return after! - ORDER_GAP; // to the top
  if (after === undefined) return before + ORDER_GAP; // to the bottom
  if (after - before < MIN_GAP) return null; // too close: renumber first
  return (before + after) / 2; // in between
}

// Moves a task to position `index` (0 = top) of a board: the same board (reorder) or another one.
// Only the moved task changes, except in the rare case where the board must be renumbered.
export async function moveTask(userId: string, taskId: string, input: MoveTaskInput) {
  const task = await getOwnTask(userId, taskId); // 404 if the task isn't this user's
  const targetBoard = await getOwnBoard(userId, input.boardId); // 404 if the board isn't theirs

  // The OTHER tasks in the target board, in order (the moving task is left out)
  const siblings = await TaskModel.find({ board: targetBoard._id, _id: { $ne: task._id } })
    .sort({ order: 1 })
    .select('order');

  const index = Math.min(input.index, siblings.length); // past the end = last place
  let order = orderBetween(siblings[index - 1]?.order, siblings[index]?.order);

  if (order === null) {
    // No room left between the neighbours (only after many drops into the same spot):
    // space the board out again as 1000, 2000, 3000... in one round trip, then retry.
    siblings.forEach((sibling, i) => (sibling.order = (i + 1) * ORDER_GAP));
    await TaskModel.bulkWrite(
      siblings.map((sibling) => ({
        updateOne: { filter: { _id: sibling._id }, update: { $set: { order: sibling.order } } },
      })),
    );
    order = orderBetween(siblings[index - 1]?.order, siblings[index]?.order) as number;
  }

  task.board = targetBoard._id;
  task.order = order;
  return task.save();
}
