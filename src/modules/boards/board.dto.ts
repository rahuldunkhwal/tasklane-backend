import type { BoardDocument } from './board.model.js';

// What we send to the client about a board (the owner id isn't needed: it's always the current user)
export type BoardDto = {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
};

export function toBoardDto(board: BoardDocument): BoardDto {
  return {
    id: board.id,
    title: board.title,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
  };
}
