import { AppError } from '../../utils/AppError.js';
import { getOwnBoard, listOwnBoardIds, ownsBoard } from '../boards/boards.service.js';
import { TaskModel } from './task.model.js';
import type { CreateTaskInput, MoveTaskInput, UpdateTaskInput } from './tasks.schema.js';

// Tasks have no owner field: a task is yours if its BOARD is yours.
// So every function here goes through the boards service to check access.

// Space between neighbouring tasks' order numbers (1000, 2000, 3000...). The gaps let a task be
// placed between two others by changing only that one task (e.g. 1500).
const ORDER_GAP = 1000;
// When two neighbours are closer than this, there's no reliable room left between them
// (computer numbers have limited precision), so the board gets renumbered first.
const MIN_GAP = 1e-6;

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
