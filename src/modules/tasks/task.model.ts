import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;

// No "owner" field on purpose: a task belongs to whoever owns its board.
// (Duplicating the owner here could get out of sync with the board.)
const taskSchema = new Schema(
  {
    board: { type: Schema.Types.ObjectId, ref: 'Board', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    priority: { type: String, enum: TASK_PRIORITIES, default: 'medium' },
    // The exact moment the task is due: the END of the chosen day in the user's time zone
    // (calculated by the frontend), so "overdue = dueDate < now" is right in every time zone.
    dueDate: { type: Date, default: null },
    completed: { type: Boolean, default: false },
    // Position inside the board, lowest first. New tasks get (last order + 1000): the gaps let
    // drag & drop place a task between two others by changing only that one task.
    order: { type: Number, required: true },
  },
  { timestamps: true },
);

// "Tasks of these boards, in order": serves both the filter (board) and the sort (order)
taskSchema.index({ board: 1, order: 1 });

export type Task = InferSchemaType<typeof taskSchema>;
export type TaskDocument = HydratedDocument<Task>;

export const TaskModel = model('Task', taskSchema);
