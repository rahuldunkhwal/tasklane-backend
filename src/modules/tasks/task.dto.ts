import type { TaskDocument } from './task.model.js';

// What we send to the client about a task
export type TaskDto = {
  id: string;
  boardId: string;
  title: string;
  description: string;
  priority: string;
  dueDate: Date | null;
  completed: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
};

export function toTaskDto(task: TaskDocument): TaskDto {
  return {
    id: task.id,
    boardId: task.board.toString(),
    title: task.title,
    description: task.description,
    priority: task.priority,
    dueDate: task.dueDate ?? null,
    completed: task.completed,
    order: task.order,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}
