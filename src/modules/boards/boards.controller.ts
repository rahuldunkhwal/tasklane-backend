import type { RequestHandler } from 'express';
import { getAuthUser } from '../../middleware/requireAuth.js';
import { toBoardDto } from './board.dto.js';
import type { CreateBoardInput, UpdateBoardInput } from './boards.schema.js';
import * as boardsService from './boards.service.js';

// Controllers only deal with HTTP. The owner always comes from the session (getAuthUser),
// never from the request body or URL, so a user can't act on someone else's behalf.

export const list: RequestHandler = async (req, res) => {
  const boards = await boardsService.listBoards(getAuthUser(req).id);
  res.json({ boards: boards.map(toBoardDto) });
};

export const create: RequestHandler = async (req, res) => {
  const board = await boardsService.createBoard(getAuthUser(req).id, req.body as CreateBoardInput);
  res.status(201).json({ board: toBoardDto(board) });
};

export const getOne: RequestHandler<{ id: string }> = async (req, res) => {
  const board = await boardsService.getOwnBoard(getAuthUser(req).id, req.params.id);
  res.json({ board: toBoardDto(board) });
};

export const update: RequestHandler<{ id: string }> = async (req, res) => {
  const board = await boardsService.renameBoard(
    getAuthUser(req).id,
    req.params.id,
    req.body as UpdateBoardInput,
  );
  res.json({ board: toBoardDto(board) });
};

export const remove: RequestHandler<{ id: string }> = async (req, res) => {
  await boardsService.deleteBoard(getAuthUser(req).id, req.params.id);
  res.status(204).end();
};
