import type { RequestHandler } from 'express';
import { getAuthUser } from '../../middleware/requireAuth.js';
import type { CreateBoardInput, ShareBoardInput, UpdateBoardInput } from './boards.schema.js';
import * as boardsService from './boards.service.js';

// Controllers only deal with HTTP. The current user always comes from the session (getAuthUser),
// never from the request body or URL, so a user can't act on someone else's behalf.

export const list: RequestHandler = async (req, res) => {
  res.json({ boards: await boardsService.listBoards(getAuthUser(req).id) });
};

export const create: RequestHandler = async (req, res) => {
  const board = await boardsService.createBoard(getAuthUser(req).id, req.body as CreateBoardInput);
  res.status(201).json({ board });
};

export const getOne: RequestHandler<{ id: string }> = async (req, res) => {
  res.json({ board: await boardsService.getBoardDto(getAuthUser(req).id, req.params.id) });
};

export const update: RequestHandler<{ id: string }> = async (req, res) => {
  const board = await boardsService.renameBoard(
    getAuthUser(req).id,
    req.params.id,
    req.body as UpdateBoardInput,
  );
  res.json({ board });
};

export const remove: RequestHandler<{ id: string }> = async (req, res) => {
  await boardsService.deleteBoard(getAuthUser(req).id, req.params.id);
  res.status(204).end();
};

// ---------- Sharing ----------

// The viewers list + the board's invite link (owner only)
export const sharing: RequestHandler<{ id: string }> = async (req, res) => {
  res.json(await boardsService.getSharing(getAuthUser(req).id, req.params.id));
};

// Regenerate the invite link (the old one stops working)
export const resetInviteLink: RequestHandler<{ id: string }> = async (req, res) => {
  res.json(await boardsService.resetInviteLink(getAuthUser(req).id, req.params.id));
};

// Email the invite link to an address (used when that email has no account yet)
export const sendInvite: RequestHandler<{ id: string }> = async (req, res) => {
  const result = await boardsService.sendInvite(
    getAuthUser(req).id,
    req.params.id,
    (req.body as ShareBoardInput).email,
  );
  res.json(result);
};

export const share: RequestHandler<{ id: string }> = async (req, res) => {
  const shares = await boardsService.shareBoard(
    getAuthUser(req).id,
    req.params.id,
    req.body as ShareBoardInput,
  );
  res.status(201).json({ shares });
};

export const unshare: RequestHandler<{ id: string; userId: string }> = async (req, res) => {
  await boardsService.unshareBoard(getAuthUser(req).id, req.params.id, req.params.userId);
  res.status(204).end();
};
