import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { sendEmail } from '../../utils/email.js';
import { TaskModel } from '../tasks/task.model.js';
import { UserModel } from '../users/user.model.js';
import { boardInviteEmail } from './boards.emails.js';
import { BoardModel, type BoardDocument } from './board.model.js';
import { toBoardDto, type BoardRole, type ShareDto } from './board.dto.js';
import type { CreateBoardInput, ShareBoardInput, UpdateBoardInput } from './boards.schema.js';

// Every function takes the logged-in user's id, and every query includes it.
// A user may SEE a board they own or that is shared with them; only the OWNER may change it.

// "Owner, or in the sharedWith list" as a MongoDB condition
const visibleTo = (userId: string) => ({
  $or: [{ owner: userId }, { 'sharedWith.user': userId }],
});

// My own boards first (oldest first), then boards shared with me, each with my role on it
export async function listBoards(userId: string) {
  const [own, shared] = await Promise.all([
    BoardModel.find({ owner: userId }).sort({ createdAt: 1 }),
    BoardModel.find({ 'sharedWith.user': userId })
      .sort({ createdAt: 1 })
      .populate<{ owner: { name: string } }>('owner', 'name'), // for "Shared by Alice"
  ]);
  return [
    ...own.map((board) => toBoardDto(board, 'owner')),
    ...shared.map((board) => toBoardDto(board, 'viewer', board.owner.name)),
  ];
}

// The user's role on a board, or null if they can't see it at all
export async function boardRoleFor(userId: string, boardId: unknown): Promise<BoardRole | null> {
  const board = await BoardModel.findOne({ _id: boardId, ...visibleTo(userId) }).select('owner');
  if (!board) return null;
  return board.owner.equals(userId) ? 'owner' : 'viewer';
}

// READ access: owner or viewer. A board the user can't see is "not found" (404),
// so the response doesn't even reveal that it exists.
export async function getVisibleBoard(userId: string, boardId: string) {
  const board = await BoardModel.findOne({ _id: boardId, ...visibleTo(userId) });
  if (!board) {
    throw new AppError(404, 'BOARD_NOT_FOUND', 'Board not found');
  }
  const role: BoardRole = board.owner.equals(userId) ? 'owner' : 'viewer';
  return { board, role };
}

// WRITE access: owner only. Every change to a board or its tasks goes through here.
// A viewer already knows the board exists, so they get a clear 403 instead of a 404.
export async function getOwnBoard(userId: string, boardId: string) {
  const { board, role } = await getVisibleBoard(userId, boardId);
  if (role !== 'owner') {
    throw new AppError(403, 'READ_ONLY', 'You have view-only access to this board');
  }
  return board;
}

// One board for the client, with the owner's name if it's shared with this user
export async function getBoardDto(userId: string, boardId: string) {
  const { board, role } = await getVisibleBoard(userId, boardId);
  if (role === 'owner') return toBoardDto(board, 'owner');
  const owner = await UserModel.findById(board.owner).select('name');
  return toBoardDto(board, 'viewer', owner?.name ?? '');
}

// Ids of the boards whose tasks the user may SEE (task list, search and filters)
export function listVisibleBoardIds(userId: string) {
  return BoardModel.find(visibleTo(userId)).distinct('_id');
}

// Ids of the user's OWN boards only (the dashboard counts your own work, not shared boards)
export function listOwnBoardIds(userId: string) {
  return BoardModel.find({ owner: userId }).distinct('_id');
}

export async function createBoard(userId: string, input: CreateBoardInput) {
  const board = await BoardModel.create({ owner: userId, title: input.title });
  return toBoardDto(board, 'owner');
}

export async function renameBoard(userId: string, boardId: string, input: UpdateBoardInput) {
  const board = await getOwnBoard(userId, boardId);
  board.title = input.title;
  await board.save(); // save() also runs the schema rules (required, maxlength)
  return toBoardDto(board, 'owner');
}

export async function deleteBoard(userId: string, boardId: string) {
  const board = await getOwnBoard(userId, boardId);

  // Board first, then its tasks. If the second step ever failed, the leftover tasks would be
  // invisible (their board is gone), which is harmless. The other order could leave a board
  // with its tasks missing. (A transaction would do both at once, but MongoDB transactions
  // need a replica set, and the local Docker MongoDB is a single server.)
  // Its sharedWith list goes with it, so viewers lose access at the same moment.
  await board.deleteOne();
  await TaskModel.deleteMany({ board: board._id });
}

// ---------- Sharing (owner only) ----------

// Name + email of each person a board is shared with, in the order they were added
async function sharesForBoard(board: BoardDocument): Promise<ShareDto[]> {
  const users = await UserModel.find({ _id: { $in: board.sharedWith.map((s) => s.user) } }).select(
    'name email',
  );
  const usersById = new Map(users.map((user) => [user.id, user]));

  // flatMap: a share whose account no longer exists is simply left out
  return board.sharedWith.flatMap((share) => {
    const user = usersById.get(share.user.toString());
    return user ? [{ userId: user.id, name: user.name, email: user.email }] : [];
  });
}

export async function listShares(userId: string, boardId: string): Promise<ShareDto[]> {
  const board = await getOwnBoard(userId, boardId);
  return sharesForBoard(board);
}

// ---------- Invite link ----------

// The bearer token behind a board's invite link, created the first time it's needed
async function ensureInviteToken(board: BoardDocument): Promise<string> {
  if (board.inviteToken) return board.inviteToken;
  const token = crypto.randomBytes(24).toString('base64url');
  board.inviteToken = token;
  await board.save();
  return token;
}

function inviteLinkFor(token: string): string {
  return `${env.CLIENT_ORIGIN}/invite/${token}`;
}

// For the Share dialog: the current viewers + a ready-to-copy invite link (owner only)
export async function getSharing(userId: string, boardId: string) {
  const board = await getOwnBoard(userId, boardId);
  const token = await ensureInviteToken(board);
  return { shares: await sharesForBoard(board), inviteLink: inviteLinkFor(token) };
}

// Owner regenerates the invite link. The old link stops working immediately, which is how you
// cut off access via a link that leaked or that a removed viewer still holds (the link is a
// shared bearer token, so removing one person can't block them from it on its own).
export async function resetInviteLink(userId: string, boardId: string) {
  const board = await getOwnBoard(userId, boardId);
  board.inviteToken = crypto.randomBytes(24).toString('base64url');
  await board.save();
  return { inviteLink: inviteLinkFor(board.inviteToken) };
}

// Owner emails the invite link to an address (typically someone without an account yet).
// The link carries the email so the sign-up / log-in form can pre-fill it.
export async function sendInvite(userId: string, boardId: string, email: string) {
  const board = await getOwnBoard(userId, boardId);
  const token = await ensureInviteToken(board);
  const inviter = await UserModel.findById(userId).select('name');
  const link = `${inviteLinkFor(token)}?email=${encodeURIComponent(email)}`;

  // Un-awaited, like the password-reset email: the request shouldn't wait on the mail provider.
  sendEmail(boardInviteEmail(email, link, inviter?.name ?? 'Someone', board.title)).catch(
    (error: unknown) => console.error('Failed to send board invite email:', error),
  );
  return { message: 'Invitation sent' };
}

// PUBLIC (no login): what the invite landing page shows before anyone signs in
export async function getInviteInfo(token: string) {
  const board = await BoardModel.findOne({ inviteToken: token }).populate<{
    owner: { name: string };
  }>('owner', 'name');
  if (!board) {
    throw new AppError(404, 'INVALID_INVITE', 'This invite link is invalid or no longer works');
  }
  return { boardTitle: board.title, inviterName: board.owner.name };
}

// Logged-in user joins the board the link points to (as a viewer). Idempotent.
export async function acceptInvite(userId: string, token: string) {
  const board = await BoardModel.findOne({ inviteToken: token });
  if (!board) {
    throw new AppError(404, 'INVALID_INVITE', 'This invite link is invalid or no longer works');
  }
  // The owner opening their own link just goes to the board; no share to add.
  if (!board.owner.equals(userId)) {
    // Add as a viewer only if not already in the list (atomic → two clicks can't double-add).
    await BoardModel.updateOne(
      { _id: board._id, 'sharedWith.user': { $ne: userId } },
      { $push: { sharedWith: { user: userId, role: 'viewer' } } },
    );
  }
  return { boardId: board.id };
}

export async function shareBoard(userId: string, boardId: string, input: ShareBoardInput) {
  const board = await getOwnBoard(userId, boardId);

  const target = await UserModel.findOne({ email: input.email });
  if (!target) {
    throw new AppError(404, 'USER_NOT_FOUND', 'No account with this email');
  }
  if (target._id.equals(userId)) {
    throw new AppError(400, 'CANNOT_SHARE_WITH_SELF', "You can't share a board with yourself");
  }

  // ONE atomic update: add the person only if they're not in the list yet. Even two clicks at
  // the same moment can't add them twice; if no board matched, they were already there.
  // (matchedCount, not modifiedCount: timestamps make Mongoose also set updatedAt on every update.)
  const result = await BoardModel.updateOne(
    { _id: board._id, 'sharedWith.user': { $ne: target._id } },
    { $push: { sharedWith: { user: target._id, role: 'viewer' } } },
  );
  if (result.matchedCount === 0) {
    throw new AppError(409, 'ALREADY_SHARED', 'This board is already shared with this person');
  }

  return listShares(userId, boardId);
}

export async function unshareBoard(userId: string, boardId: string, targetUserId: string) {
  const board = await getOwnBoard(userId, boardId);
  // The condition is in the FILTER ("the board where this person is in the list"), so if they
  // don't have access nothing matches. (Checking modifiedCount wouldn't work: timestamps make
  // Mongoose set updatedAt on every update, so a document always counts as "modified".)
  const result = await BoardModel.updateOne(
    { _id: board._id, 'sharedWith.user': targetUserId },
    { $pull: { sharedWith: { user: targetUserId } } },
  );
  if (result.matchedCount === 0) {
    throw new AppError(404, 'SHARE_NOT_FOUND', "This person doesn't have access to this board");
  }
}
