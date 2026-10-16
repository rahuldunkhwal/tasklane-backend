import crypto from 'node:crypto';
import type { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { sendEmail } from '../../utils/email.js';
import { TaskModel } from '../tasks/task.model.js';
import { UserModel } from '../users/user.model.js';
import { boardInviteEmail, boardSharedEmail } from './boards.emails.js';
import { BoardModel, type BoardDocument } from './board.model.js';
import { toBoardDto, type BoardRole, type InviteDto, type ShareDto } from './board.dto.js';
import type { CreateBoardInput, ShareBoardInput, UpdateBoardInput } from './boards.schema.js';

// Every function takes the logged-in user's id, and every query includes it.
// A user may SEE a board they own or that is shared with them; only the OWNER may change it.

// "Owner, or in the sharedWith list" as a MongoDB condition
const visibleTo = (userId: string) => ({
  $or: [{ owner: userId }, { 'sharedWith.user': userId }],
});

// Shown as the owner's name when their account no longer exists (e.g. removed in the database
// while the board was still shared). populate() then gives null, which must not crash the list.
const UNKNOWN_OWNER = 'Unknown';
type PopulatedOwner = { owner: { name: string } | null };

// My own boards first (oldest first), then boards shared with me, each with my role on it
export async function listBoards(userId: string) {
  const [own, shared] = await Promise.all([
    BoardModel.find({ owner: userId }).sort({ createdAt: 1 }),
    BoardModel.find({ 'sharedWith.user': userId })
      .sort({ createdAt: 1 })
      .populate<PopulatedOwner>('owner', 'name'), // for "Shared by Alice"
  ]);
  return [
    ...own.map((board) => toBoardDto(board, 'owner')),
    ...shared.map((board) => toBoardDto(board, 'viewer', board.owner?.name ?? UNKNOWN_OWNER)),
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
  return toBoardDto(board, 'viewer', owner?.name ?? UNKNOWN_OWNER);
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

// Pending emailed invites, oldest first. The token stays server-side.
function invitesForBoard(board: BoardDocument): InviteDto[] {
  return board.invites.map((invite) => ({ email: invite.email, createdAt: invite.createdAt }));
}

// "c•••y@mail.com": enough for someone to recognise their own address, not enough to learn
// someone else's from an error message
function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  const visible = local.length > 2 ? `${local[0]}•••${local[local.length - 1]}` : `${local[0] ?? ''}•••`;
  return `${visible}@${domain}`;
}

// Adds a user to a board's viewers in ONE atomic update (only if they're not in the list yet),
// so two clicks at the same moment can't add them twice. Returns false if they already had access.
// (matchedCount, not modifiedCount: timestamps make Mongoose also set updatedAt on every update.)
async function addViewer(boardId: Types.ObjectId, userId: Types.ObjectId | string): Promise<boolean> {
  const result = await BoardModel.updateOne(
    { _id: boardId, 'sharedWith.user': { $ne: userId } },
    { $push: { sharedWith: { user: userId, role: 'viewer' } } },
  );
  return result.matchedCount > 0;
}

// ---------- Invite link ----------

// The bearer token behind a board's invite link, created the first time it's needed
async function ensureInviteToken(board: BoardDocument): Promise<string> {
  if (board.inviteToken) return board.inviteToken;

  // ONE atomic update: set a token only if the board still has none. When two requests race
  // (Share opened in two tabs), the loser's filter no longer matches, so it reads back the
  // winner's token instead of overwriting it, and both tabs hand out the same, live link.
  const token = crypto.randomBytes(24).toString('base64url');
  const updated = await BoardModel.findOneAndUpdate(
    { _id: board._id, inviteToken: null }, // null also matches "field absent"
    { $set: { inviteToken: token } },
    { returnDocument: 'after' },
  ).select('inviteToken');
  const current = updated ?? (await BoardModel.findById(board._id).select('inviteToken'));
  if (!current?.inviteToken) {
    throw new AppError(404, 'BOARD_NOT_FOUND', 'Board not found'); // deleted in the meantime
  }
  board.inviteToken = current.inviteToken;
  return current.inviteToken;
}

function inviteLinkFor(token: string): string {
  return `${env.CLIENT_ORIGIN}/invite/${token}`;
}

// For the Share dialog: current viewers, pending emailed invites, and the board's invite link
export async function getSharing(userId: string, boardId: string) {
  const board = await getOwnBoard(userId, boardId);
  const token = await ensureInviteToken(board);
  return {
    shares: await sharesForBoard(board),
    invites: invitesForBoard(board),
    inviteLink: inviteLinkFor(token),
  };
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

// Owner shares a board with an email address (like "Share with people" in Google Docs):
//  - the email already has an account → they get access right away (+ a heads-up email)
//  - no account yet → a pending invite BOUND to that email; the emailed link only works for a user
//    logged in with that exact address, and stops working once used
export async function sendInvite(userId: string, boardId: string, email: string) {
  const board = await getOwnBoard(userId, boardId);
  const inviter = await UserModel.findById(userId).select('name email');
  const inviterName = inviter?.name ?? 'Someone';
  if (inviter?.email === email) {
    throw new AppError(400, 'CANNOT_SHARE_WITH_SELF', "You can't share a board with yourself");
  }

  const target = await UserModel.findOne({ email }).select('_id');
  if (target) {
    const added = await addViewer(board._id, target._id);
    if (!added) {
      throw new AppError(409, 'ALREADY_SHARED', 'This board is already shared with this person');
    }
    // A pending invite for this address (sent before they signed up) is now pointless
    await BoardModel.updateOne({ _id: board._id }, { $pull: { invites: { email } } });
    // Access is already granted, so a failed heads-up email isn't worth failing the request over
    sendEmail(boardSharedEmail(email, `${env.CLIENT_ORIGIN}/boards`, inviterName, board.title)).catch(
      (error: unknown) => console.error('Failed to send board shared email:', error),
    );
    return { status: 'shared' as const, ...(await getSharing(userId, boardId)) };
  }

  // No account yet: (re)issue an invite for this email with a fresh token. Sending again replaces
  // the earlier one, so only the latest emailed link works. (One update per operator: MongoDB
  // doesn't allow $pull and $push on the same field in a single update.)
  const token = crypto.randomBytes(24).toString('base64url');
  await BoardModel.updateOne({ _id: board._id }, { $pull: { invites: { email } } });
  await BoardModel.updateOne(
    { _id: board._id },
    { $push: { invites: { email, token, createdAt: new Date() } } },
  );

  // The link carries the email so the sign-up / log-in form can pre-fill it.
  const link = `${env.CLIENT_ORIGIN}/invite/${token}?email=${encodeURIComponent(email)}`;
  // Awaited on purpose (unlike the password-reset email): the owner must be told when the invite
  // did NOT go out. Nothing to hide here: the reply says nothing about the recipient.
  try {
    await sendEmail(boardInviteEmail(email, link, inviterName, board.title));
  } catch (error) {
    console.error('Failed to send board invite email:', error);
    await BoardModel.updateOne({ _id: board._id }, { $pull: { invites: { token } } }); // nothing was delivered
    throw new AppError(
      502,
      'EMAIL_FAILED',
      "Couldn't send the invite email. Copy the invite link and share it instead.",
    );
  }
  return { status: 'invited' as const, ...(await getSharing(userId, boardId)) };
}

// Owner withdraws a pending emailed invite; its link stops working
export async function removeInvite(userId: string, boardId: string, email: string) {
  const board = await getOwnBoard(userId, boardId);
  const result = await BoardModel.updateOne(
    { _id: board._id, 'invites.email': email },
    { $pull: { invites: { email } } },
  );
  if (result.matchedCount === 0) {
    throw new AppError(404, 'INVITE_NOT_FOUND', 'There is no pending invite for this email');
  }
}

// A token is either the board-wide link (anyone with it may join) or an emailed invite (bound to
// one address). This finds the board for either kind, or null.
function findBoardByToken(token: string) {
  return BoardModel.findOne({ $or: [{ inviteToken: token }, { 'invites.token': token }] });
}

// PUBLIC (no login): what the invite landing page shows before anyone signs in.
// For an emailed invite it also says which address it was sent to, so the page can pre-fill the
// form and warn someone logged in with a different account.
export async function getInviteInfo(token: string) {
  const board = await findBoardByToken(token).populate<PopulatedOwner>('owner', 'name');
  if (!board) {
    throw new AppError(404, 'INVALID_INVITE', 'This invite link is invalid or no longer works');
  }
  const invite = board.invites.find((entry) => entry.token === token);
  return {
    boardTitle: board.title,
    inviterName: board.owner?.name ?? UNKNOWN_OWNER,
    ...(invite && { invitedEmail: invite.email }),
  };
}

// Logged-in user joins the board the link points to (as a viewer). Idempotent for the board-wide
// link; an emailed invite additionally requires the matching account and works only once.
export async function acceptInvite(userId: string, token: string) {
  const board = await findBoardByToken(token);
  if (!board) {
    throw new AppError(404, 'INVALID_INVITE', 'This invite link is invalid or no longer works');
  }

  // null for the board-wide link; the pending entry for an emailed invite
  const invite = board.inviteToken === token ? null : board.invites.find((e) => e.token === token);
  if (invite) {
    const user = await UserModel.findById(userId).select('email');
    if (user?.email !== invite.email) {
      throw new AppError(
        403,
        'INVITE_EMAIL_MISMATCH',
        `This invite was sent to ${maskEmail(invite.email)}. Log in with that account to join.`,
      );
    }
  }

  // The owner opening their own link just goes to the board; no share to add.
  if (!board.owner.equals(userId)) {
    await addViewer(board._id, userId); // already a viewer → no change, still a success
  }
  if (invite) {
    // Used up: the same link can't be opened again from another browser or account
    await BoardModel.updateOne({ _id: board._id }, { $pull: { invites: { token } } });
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

  const added = await addViewer(board._id, target._id);
  if (!added) {
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
