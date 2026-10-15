import type { BoardDocument } from './board.model.js';

export type BoardRole = 'owner' | 'viewer';

// What we send to the client about a board. `role` tells the frontend whether to show edit
// controls; `ownerName` is only included on boards shared WITH the user ("Shared by Alice").
export type BoardDto = {
  id: string;
  title: string;
  role: BoardRole;
  ownerName?: string;
  createdAt: Date;
  updatedAt: Date;
};

type BoardFields = Pick<BoardDocument, 'id' | 'title' | 'createdAt' | 'updatedAt'>;

export function toBoardDto(board: BoardFields, role: BoardRole, ownerName?: string): BoardDto {
  return {
    id: board.id,
    title: board.title,
    role,
    ...(ownerName !== undefined && { ownerName }),
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
  };
}

// One person a board is shared with, as shown in the owner's "People with access" list
export type ShareDto = { userId: string; name: string; email: string };
