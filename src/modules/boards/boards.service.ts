import { AppError } from '../../utils/AppError.js';
import { BoardModel } from './board.model.js';
import type { CreateBoardInput, UpdateBoardInput } from './boards.schema.js';

// Every function takes the logged-in user's id, and every query includes it.
// That's how "users only see their own boards" is enforced: there is no query without an owner.

export function listBoards(ownerId: string) {
  return BoardModel.find({ owner: ownerId }).sort({ createdAt: 1 }); // oldest first: new boards appear last
}

// The ONE place that decides whether a user may access a board. Someone else's board is simply
// "not found": 404 instead of 403, so the response doesn't even reveal that the board exists.
export async function getOwnBoard(ownerId: string, boardId: string) {
  const board = await BoardModel.findOne({ _id: boardId, owner: ownerId });
  if (!board) {
    throw new AppError(404, 'BOARD_NOT_FOUND', 'Board not found');
  }
  return board;
}

export function createBoard(ownerId: string, input: CreateBoardInput) {
  return BoardModel.create({ owner: ownerId, title: input.title });
}

export async function renameBoard(ownerId: string, boardId: string, input: UpdateBoardInput) {
  const board = await getOwnBoard(ownerId, boardId);
  board.title = input.title;
  return board.save(); // save() also runs the schema rules (required, maxlength)
}

export async function deleteBoard(ownerId: string, boardId: string) {
  const board = await getOwnBoard(ownerId, boardId);
  // Tasks phase: this board's tasks will be deleted here too
  await board.deleteOne();
}
