import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserModel } from '../src/modules/users/user.model.js';
import { sendEmail } from '../src/utils/email.js';
import {
  client,
  createBoard,
  createTask,
  errorCode,
  INVITE_TOKEN,
  lastEmail,
  sentEmails,
  shareBoard,
  signUp,
  tokenFromEmail,
  UNKNOWN_ID,
  type Client,
  type TestUser,
} from './helpers.js';

const CLIENT_ORIGIN = 'http://localhost:5173'; // set in tests/setup.ts
const OWN_BOARD_KEYS = ['createdAt', 'id', 'role', 'title', 'updatedAt'];
const SHARED_BOARD_KEYS = [...OWN_BOARD_KEYS, 'ownerName'].sort();
const TOKEN = /^[A-Za-z0-9_-]{32}$/; // crypto.randomBytes(24) as base64url
const INVITE_LINK = new RegExp(`^${CLIENT_ORIGIN}/invite/([A-Za-z0-9_-]{32})$`);

let owner: TestUser;
let board: { id: string; title: string };

beforeEach(async () => {
  owner = await signUp({ name: 'Olivia Owner' });
  board = await createBoard(owner.client, 'Launch plan');
});

async function makeViewer(): Promise<TestUser> {
  const viewer = await signUp();
  await shareBoard(owner.client, board.id, viewer.email);
  return viewer;
}

// The board's invite token, created lazily by the first request that needs it
async function inviteToken(c: Client, boardId: string): Promise<string> {
  const res = await c.get(`/api/boards/${boardId}/shares`);
  expect(res.status).toBe(200);
  const token = res.body.inviteLink.match(INVITE_LINK)?.[1];
  if (!token) throw new Error(`unexpected invite link: ${res.body.inviteLink}`);
  return token;
}

async function listBoards(c: Client) {
  const res = await c.get('/api/boards');
  expect(res.status).toBe(200);
  return res.body.boards as Array<{ id: string; title: string; role: string; ownerName?: string }>;
}

describe('GET /api/boards', () => {
  it('requires login', async () => {
    const res = await client().get('/api/boards');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: 'UNAUTHORIZED', message: 'Please log in to continue' } });
  });

  it('returns an empty list for a brand-new user', async () => {
    const fresh = await signUp();

    const res = await fresh.client.get('/api/boards');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ boards: [] });
  });

  it('lists my own boards oldest first, marked as owner', async () => {
    await createBoard(owner.client, 'Second');

    const boards = await listBoards(owner.client);

    expect(boards.map((b) => b.title)).toEqual(['Launch plan', 'Second']);
    for (const b of boards) {
      expect(Object.keys(b).sort()).toEqual(OWN_BOARD_KEYS);
      expect(b.role).toBe('owner');
    }
  });

  it('lists boards shared with me after my own, as viewer with the owner name', async () => {
    const viewer = await signUp();
    const mine = await createBoard(viewer.client, 'My own');
    await shareBoard(owner.client, board.id, viewer.email);

    const boards = await listBoards(viewer.client);

    expect(boards.map((b) => b.id)).toEqual([mine.id, board.id]);
    expect(Object.keys(boards[1]!).sort()).toEqual(SHARED_BOARD_KEYS);
    expect(boards[1]).toMatchObject({ role: 'viewer', ownerName: 'Olivia Owner' });
  });

  it('orders shared boards by when the board was created, not when it was shared', async () => {
    const later = await createBoard(owner.client, 'Created later');
    const viewer = await signUp();
    await shareBoard(owner.client, later.id, viewer.email); // shared first
    await shareBoard(owner.client, board.id, viewer.email); // shared second, but older board

    const boards = await listBoards(viewer.client);

    expect(boards.map((b) => b.id)).toEqual([board.id, later.id]);
  });

  it("never includes other people's boards", async () => {
    const stranger = await signUp();

    expect(await listBoards(stranger.client)).toEqual([]);
  });

  it("still lists a shared board when the owner's account no longer exists", async () => {
    const viewer = await makeViewer();
    const token = await inviteToken(owner.client, board.id);
    await UserModel.deleteOne({ _id: owner.id }); // e.g. removed directly in the database

    const boards = await listBoards(viewer.client);

    expect(boards).toHaveLength(1);
    expect(boards[0]).toMatchObject({ id: board.id, role: 'viewer', ownerName: 'Unknown' });
    expect((await viewer.client.get(`/api/boards/${board.id}`)).body.board.ownerName).toBe('Unknown');
    const info = await client().get(`/api/invites/${token}`);
    expect(info.status).toBe(200);
    expect(info.body).toEqual({ boardTitle: 'Launch plan', inviterName: 'Unknown' });
  });
});

describe('POST /api/boards', () => {
  it('requires login', async () => {
    const res = await client().post('/api/boards').send({ title: 'x' });

    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('UNAUTHORIZED');
  });

  it('creates a board owned by me with a trimmed title', async () => {
    const res = await owner.client.post('/api/boards').send({ title: '  Roadmap  ' });

    expect(res.status).toBe(201);
    expect(Object.keys(res.body.board).sort()).toEqual(OWN_BOARD_KEYS);
    expect(res.body.board).toMatchObject({ title: 'Roadmap', role: 'owner' });
    expect(res.body.board.id).toMatch(/^[a-f\d]{24}$/i);
  });

  it('ignores fields the client may not set (owner, sharedWith)', async () => {
    const stranger = await signUp();

    const res = await owner.client.post('/api/boards').send({
      title: 'Sneaky',
      owner: stranger.id,
      sharedWith: [{ user: stranger.id, role: 'viewer' }],
      extra: true,
    });

    expect(res.status).toBe(201);
    expect(res.body.board.role).toBe('owner');
    const asStranger = await stranger.client.get(`/api/boards/${res.body.board.id}`);
    expect(asStranger.status).toBe(404);
  });

  it.each([
    [{}, 'Title is required'],
    [{ title: null }, 'Title is required'],
    [{ title: '   ' }, 'Title is required'],
    [{ title: 123 }, 'Title must be text'],
    [{ title: 'x'.repeat(101) }, 'Title must be at most 100 characters'],
  ])('rejects %j', async (body, message) => {
    const res = await owner.client.post('/api/boards').send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Invalid request data',
      details: [{ path: 'title', message }],
    });
  });

  it('trims before checking the length', async () => {
    const res = await owner.client.post('/api/boards').send({ title: ` ${'x'.repeat(100)} ` });

    expect(res.status).toBe(201);
  });

  it('rejects a missing, non-object, malformed or oversized body', async () => {
    const none = await owner.client.post('/api/boards');
    expect(none.status).toBe(400);
    expect(none.body.error).toEqual({ code: 'INVALID_BODY', message: 'Request body must be a JSON object' });

    const array = await owner.client.post('/api/boards').send([{ title: 'x' }]);
    expect(errorCode(array)).toBe('INVALID_BODY');

    const broken = await owner.client.post('/api/boards').set('Content-Type', 'application/json').send('{"title":');
    expect(broken.status).toBe(400);
    expect(broken.body.error).toEqual({ code: 'INVALID_JSON', message: 'Request body is not valid JSON' });

    const huge = await owner.client.post('/api/boards').send({ title: 'x'.repeat(120_000) });
    expect(huge.status).toBe(413);
    expect(errorCode(huge)).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('GET /api/boards/:id', () => {
  it('requires login', async () => {
    const res = await client().get(`/api/boards/${board.id}`);

    expect(res.status).toBe(401);
  });

  it('returns my board as owner, without an owner name', async () => {
    const res = await owner.client.get(`/api/boards/${board.id}`);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.board).sort()).toEqual(OWN_BOARD_KEYS);
    expect(res.body.board).toMatchObject({ id: board.id, title: 'Launch plan', role: 'owner' });
  });

  it('returns a shared board to a viewer with the owner name', async () => {
    const viewer = await makeViewer();

    const res = await viewer.client.get(`/api/boards/${board.id}`);

    expect(res.status).toBe(200);
    expect(res.body.board).toMatchObject({ id: board.id, role: 'viewer', ownerName: 'Olivia Owner' });
  });

  it('hides boards from strangers (404, not 403) and answers 404 for unknown ids', async () => {
    const stranger = await signUp();

    const hidden = await stranger.client.get(`/api/boards/${board.id}`);
    expect(hidden.status).toBe(404);
    expect(hidden.body.error).toEqual({ code: 'BOARD_NOT_FOUND', message: 'Board not found' });

    const unknown = await owner.client.get(`/api/boards/${UNKNOWN_ID}`);
    expect(unknown.status).toBe(404);
    expect(errorCode(unknown)).toBe('BOARD_NOT_FOUND');
  });

  it('rejects an id that is not a valid ObjectId', async () => {
    const res = await owner.client.get('/api/boards/not-an-id');

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({ code: 'INVALID_ID', message: 'Invalid id' });
  });
});

describe('PATCH /api/boards/:id', () => {
  it('requires login', async () => {
    const res = await client().patch(`/api/boards/${board.id}`).send({ title: 'x' });

    expect(res.status).toBe(401);
  });

  it('renames my board', async () => {
    const res = await owner.client.patch(`/api/boards/${board.id}`).send({ title: '  Renamed  ' });

    expect(res.status).toBe(200);
    expect(res.body.board).toMatchObject({ id: board.id, title: 'Renamed', role: 'owner' });
    expect((await listBoards(owner.client))[0]!.title).toBe('Renamed');
  });

  it('requires a title (the update is not partial) and ignores other fields', async () => {
    const empty = await owner.client.patch(`/api/boards/${board.id}`).send({});
    expect(empty.status).toBe(400);
    expect(empty.body.error.details).toEqual([{ path: 'title', message: 'Title is required' }]);

    const stranger = await signUp();
    const sneaky = await owner.client.patch(`/api/boards/${board.id}`).send({ title: 'Ok', owner: stranger.id });
    expect(sneaky.status).toBe(200);
    expect((await stranger.client.get(`/api/boards/${board.id}`)).status).toBe(404);
  });

  it('validates the body before the id', async () => {
    const badBody = await owner.client.patch('/api/boards/not-an-id').send({});
    expect(errorCode(badBody)).toBe('VALIDATION_ERROR');

    const badId = await owner.client.patch('/api/boards/not-an-id').send({ title: 'x' });
    expect(badId.status).toBe(400);
    expect(errorCode(badId)).toBe('INVALID_ID');
  });

  it('refuses viewers (403) and strangers (404), leaving the title unchanged', async () => {
    const viewer = await makeViewer();
    const stranger = await signUp();

    const asViewer = await viewer.client.patch(`/api/boards/${board.id}`).send({ title: 'Hijacked' });
    expect(asViewer.status).toBe(403);
    expect(asViewer.body.error).toEqual({ code: 'READ_ONLY', message: 'You have view-only access to this board' });

    const asStranger = await stranger.client.patch(`/api/boards/${board.id}`).send({ title: 'Hijacked' });
    expect(asStranger.status).toBe(404);
    expect(errorCode(asStranger)).toBe('BOARD_NOT_FOUND');

    expect((await owner.client.get(`/api/boards/${board.id}`)).body.board.title).toBe('Launch plan');
  });
});

describe('DELETE /api/boards/:id', () => {
  it('requires login', async () => {
    const res = await client().delete(`/api/boards/${board.id}`);

    expect(res.status).toBe(401);
  });

  it('deletes the board and all of its tasks, but nothing else', async () => {
    const other = await createBoard(owner.client, 'Other');
    await createTask(owner.client, board.id, { title: 'gone 1' });
    await createTask(owner.client, board.id, { title: 'gone 2' });
    await createTask(owner.client, other.id, { title: 'stays' });

    const res = await owner.client.delete(`/api/boards/${board.id}`);

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect((await listBoards(owner.client)).map((b) => b.id)).toEqual([other.id]);
    const tasks = await owner.client.get('/api/tasks');
    expect(tasks.body.tasks.map((t: { title: string }) => t.title)).toEqual(['stays']);

    const again = await owner.client.delete(`/api/boards/${board.id}`);
    expect(again.status).toBe(404);
    expect(errorCode(again)).toBe('BOARD_NOT_FOUND');
  });

  it('removes the board from viewers and kills its invite link', async () => {
    const viewer = await makeViewer();
    const token = await inviteToken(owner.client, board.id);

    await owner.client.delete(`/api/boards/${board.id}`);

    expect((await viewer.client.get(`/api/boards/${board.id}`)).status).toBe(404);
    expect(await listBoards(viewer.client)).toEqual([]);
    const invite = await client().get(`/api/invites/${token}`);
    expect(invite.status).toBe(404);
    expect(errorCode(invite)).toBe('INVALID_INVITE');
  });

  it('refuses viewers (403) and strangers (404) and rejects a bad id', async () => {
    const viewer = await makeViewer();
    const stranger = await signUp();

    expect(errorCode(await viewer.client.delete(`/api/boards/${board.id}`))).toBe('READ_ONLY');
    expect(errorCode(await stranger.client.delete(`/api/boards/${board.id}`))).toBe('BOARD_NOT_FOUND');
    expect(errorCode(await owner.client.delete('/api/boards/nope'))).toBe('INVALID_ID');
    expect((await owner.client.get(`/api/boards/${board.id}`)).status).toBe(200);
  });
});

describe('GET /api/boards/:id/shares', () => {
  it('requires login', async () => {
    expect((await client().get(`/api/boards/${board.id}/shares`)).status).toBe(401);
  });

  it('returns the share list and a stable invite link (created on first request)', async () => {
    const first = await owner.client.get(`/api/boards/${board.id}/shares`);

    expect(first.status).toBe(200);
    expect(first.body.shares).toEqual([]);
    expect(first.body.inviteLink).toMatch(INVITE_LINK);

    const second = await owner.client.get(`/api/boards/${board.id}/shares`);
    expect(second.body.inviteLink).toBe(first.body.inviteLink);
  });

  it('hands out one and the same link when the dialog is opened in several tabs at once', async () => {
    // Several requests race to create the token on a board that has none yet
    const results = await Promise.all(
      Array.from({ length: 5 }, () => owner.client.get(`/api/boards/${board.id}/shares`)),
    );

    const links = results.map((res) => res.body.inviteLink as string);
    expect(new Set(links).size).toBe(1);
    const token = links[0]?.match(INVITE_LINK)?.[1];
    expect((await client().get(`/api/invites/${token}`)).status).toBe(200);
  });

  it('lists shared users in the order they were added, never the owner', async () => {
    const bob = await signUp({ name: 'Bob', email: 'bob@example.com' });
    const amy = await signUp({ name: 'Amy', email: 'amy@example.com' });
    await shareBoard(owner.client, board.id, bob.email);
    await shareBoard(owner.client, board.id, amy.email);

    const res = await owner.client.get(`/api/boards/${board.id}/shares`);

    expect(res.body.shares).toEqual([
      { userId: bob.id, name: 'Bob', email: 'bob@example.com' },
      { userId: amy.id, name: 'Amy', email: 'amy@example.com' },
    ]);
  });

  it('is owner-only: viewers get 403, strangers 404', async () => {
    const viewer = await makeViewer();
    const stranger = await signUp();

    expect(errorCode(await viewer.client.get(`/api/boards/${board.id}/shares`))).toBe('READ_ONLY');
    expect(errorCode(await stranger.client.get(`/api/boards/${board.id}/shares`))).toBe('BOARD_NOT_FOUND');
    expect(errorCode(await owner.client.get(`/api/boards/${UNKNOWN_ID}/shares`))).toBe('BOARD_NOT_FOUND');
    expect(errorCode(await owner.client.get('/api/boards/bad/shares'))).toBe('INVALID_ID');
  });
});

describe('POST /api/boards/:id/shares (share by email)', () => {
  it('requires login', async () => {
    expect((await client().post(`/api/boards/${board.id}/shares`).send({ email: 'a@b.co' })).status).toBe(401);
  });

  it('gives the user view-only access and returns the full share list', async () => {
    const viewer = await signUp({ name: 'Vera', email: 'vera@example.com' });

    const res = await owner.client.post(`/api/boards/${board.id}/shares`).send({ email: 'vera@example.com' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ shares: [{ userId: viewer.id, name: 'Vera', email: 'vera@example.com' }] });
    const asViewer = await viewer.client.get(`/api/boards/${board.id}`);
    expect(asViewer.body.board).toMatchObject({ role: 'viewer', ownerName: 'Olivia Owner' });
    expect(sentEmails()).toEqual([]); // sharing with an existing account sends no email
  });

  it('matches the email case-insensitively and ignores surrounding spaces', async () => {
    const viewer = await signUp({ email: 'case@example.com' });

    const res = await owner.client.post(`/api/boards/${board.id}/shares`).send({ email: '  CASE@Example.COM  ' });

    expect(res.status).toBe(201);
    expect(res.body.shares[0].userId).toBe(viewer.id);
  });

  it.each([
    [{}, 'Email is required'],
    [{ email: '   ' }, 'Email is required'],
    [{ email: 'nope' }, 'Enter a valid email address'],
    [{ email: 123 }, 'Email must be text'],
  ])('rejects %j', async (body, message) => {
    const res = await owner.client.post(`/api/boards/${board.id}/shares`).send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: 'email', message }]);
  });

  it('answers 404 when no account has that email', async () => {
    const res = await owner.client.post(`/api/boards/${board.id}/shares`).send({ email: 'nobody@example.com' });

    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: 'USER_NOT_FOUND', message: 'No account with this email' });
  });

  it('refuses sharing with yourself', async () => {
    const res = await owner.client.post(`/api/boards/${board.id}/shares`).send({ email: owner.email });

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({
      code: 'CANNOT_SHARE_WITH_SELF',
      message: "You can't share a board with yourself",
    });
  });

  it('refuses sharing twice with the same person', async () => {
    const viewer = await makeViewer();

    const res = await owner.client.post(`/api/boards/${board.id}/shares`).send({ email: viewer.email });

    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({
      code: 'ALREADY_SHARED',
      message: 'This board is already shared with this person',
    });
    expect((await owner.client.get(`/api/boards/${board.id}/shares`)).body.shares).toHaveLength(1);
  });

  it('is owner-only: viewers get 403, strangers 404', async () => {
    const viewer = await makeViewer();
    const stranger = await signUp();
    const third = await signUp();

    const asViewer = await viewer.client.post(`/api/boards/${board.id}/shares`).send({ email: third.email });
    expect(asViewer.status).toBe(403);
    expect(errorCode(asViewer)).toBe('READ_ONLY');

    const asStranger = await stranger.client.post(`/api/boards/${board.id}/shares`).send({ email: third.email });
    expect(asStranger.status).toBe(404);
    expect(errorCode(asStranger)).toBe('BOARD_NOT_FOUND');
  });
});

describe('DELETE /api/boards/:id/shares/:userId (remove access)', () => {
  it('requires login', async () => {
    expect((await client().delete(`/api/boards/${board.id}/shares/${UNKNOWN_ID}`)).status).toBe(401);
  });

  it('removes the viewer, who immediately loses access', async () => {
    const viewer = await makeViewer();

    const res = await owner.client.delete(`/api/boards/${board.id}/shares/${viewer.id}`);

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect((await viewer.client.get(`/api/boards/${board.id}`)).status).toBe(404);
    expect((await owner.client.get(`/api/boards/${board.id}/shares`)).body.shares).toEqual([]);

    const again = await owner.client.delete(`/api/boards/${board.id}/shares/${viewer.id}`);
    expect(again.status).toBe(404);
    expect(again.body.error).toEqual({
      code: 'SHARE_NOT_FOUND',
      message: "This person doesn't have access to this board",
    });
  });

  it('answers 404 for users who were never shared with, including the owner', async () => {
    for (const userId of [owner.id, UNKNOWN_ID]) {
      const res = await owner.client.delete(`/api/boards/${board.id}/shares/${userId}`);
      expect(res.status).toBe(404);
      expect(errorCode(res)).toBe('SHARE_NOT_FOUND');
    }
  });

  it('rejects malformed ids, checking the board id first', async () => {
    const badUser = await owner.client.delete(`/api/boards/${board.id}/shares/not-a-user`);
    expect(badUser.status).toBe(400);
    expect(badUser.body.error).toEqual({ code: 'INVALID_ID', message: 'Invalid user' });

    const badBoard = await owner.client.delete('/api/boards/not-a-board/shares/not-a-user');
    expect(badBoard.body.error).toEqual({ code: 'INVALID_ID', message: 'Invalid id' });
  });

  it('is owner-only: a viewer cannot even remove themselves', async () => {
    const viewer = await makeViewer();
    const stranger = await signUp();

    expect(errorCode(await viewer.client.delete(`/api/boards/${board.id}/shares/${viewer.id}`))).toBe('READ_ONLY');
    expect(errorCode(await stranger.client.delete(`/api/boards/${board.id}/shares/${viewer.id}`))).toBe(
      'BOARD_NOT_FOUND',
    );
    expect((await viewer.client.get(`/api/boards/${board.id}`)).status).toBe(200);
  });

  it('does not revoke the invite link: a removed viewer who still has it can rejoin', async () => {
    const viewer = await makeViewer();
    const token = await inviteToken(owner.client, board.id);
    await owner.client.delete(`/api/boards/${board.id}/shares/${viewer.id}`);

    const rejoin = await viewer.client.post(`/api/invites/${token}/accept`);

    expect(rejoin.status).toBe(200);
    expect((await viewer.client.get(`/api/boards/${board.id}`)).status).toBe(200);
  });
});

describe('POST /api/boards/:id/invites (email the invite link)', () => {
  it('requires login', async () => {
    expect((await client().post(`/api/boards/${board.id}/invites`).send({ email: 'a@b.co' })).status).toBe(401);
  });

  it('emails an invite bound to that address when it has no account yet', async () => {
    const res = await owner.client
      .post(`/api/boards/${board.id}/invites`)
      .send({ email: '  New.Person+tag@Example.com ' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('invited');
    expect(res.body.shares).toEqual([]);
    expect(res.body.invites).toEqual([{ email: 'new.person+tag@example.com', createdAt: expect.any(String) }]);
    expect(res.body.inviteLink).toMatch(INVITE_LINK);

    const email = lastEmail();
    expect(email.to).toBe('new.person+tag@example.com');
    expect(email.subject).toBe('Olivia Owner shared "Launch plan" with you on Tasklane');
    const token = tokenFromEmail(email, INVITE_TOKEN);
    expect(token).toMatch(TOKEN);
    expect(email.text).toContain(`${CLIENT_ORIGIN}/invite/${token}?email=new.person%2Btag%40example.com`);
    expect(email.html).toContain(`${CLIENT_ORIGIN}/invite/${token}?email=new.person%2Btag%40example.com`);
    // it is NOT the board-wide link: this token belongs to that one email
    expect(token).not.toBe(await inviteToken(owner.client, board.id));
    // the landing page learns who it was sent to (to pre-fill the form / warn the wrong account)
    const info = await client().get(`/api/invites/${token}`);
    expect(info.status).toBe(200);
    expect(info.body).toEqual({
      boardTitle: 'Launch plan',
      inviterName: 'Olivia Owner',
      invitedEmail: 'new.person+tag@example.com',
    });
    // and the Share dialog lists it as pending
    const sharing = await owner.client.get(`/api/boards/${board.id}/shares`);
    expect(sharing.body.invites.map((i: { email: string }) => i.email)).toEqual(['new.person+tag@example.com']);
  });

  it('gives an existing account access right away and emails them a heads-up', async () => {
    const friend = await signUp({ name: 'Fay', email: 'fay@example.com' });

    const res = await owner.client.post(`/api/boards/${board.id}/invites`).send({ email: 'FAY@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('shared');
    expect(res.body.shares).toEqual([{ userId: friend.id, name: 'Fay', email: 'fay@example.com' }]);
    expect(res.body.invites).toEqual([]);
    expect((await friend.client.get(`/api/boards/${board.id}`)).body.board.role).toBe('viewer');
    const email = lastEmail();
    expect(email.to).toBe('fay@example.com');
    expect(email.subject).toBe('Olivia Owner shared "Launch plan" with you on Tasklane');
    expect(email.text).toContain(`${CLIENT_ORIGIN}/boards`);
    expect(email.text).not.toContain('/invite/'); // no token: they already have access
  });

  it('refuses your own address and people who already have access', async () => {
    const self = await owner.client.post(`/api/boards/${board.id}/invites`).send({ email: owner.email });
    expect(self.status).toBe(400);
    expect(errorCode(self)).toBe('CANNOT_SHARE_WITH_SELF');

    const viewer = await makeViewer();
    const again = await owner.client.post(`/api/boards/${board.id}/invites`).send({ email: viewer.email });
    expect(again.status).toBe(409);
    expect(errorCode(again)).toBe('ALREADY_SHARED');
    expect(sentEmails()).toEqual([]);
  });

  it('sending again replaces the earlier invite, so only the latest link works', async () => {
    await owner.client.post(`/api/boards/${board.id}/invites`).send({ email: 'late@example.com' });
    const first = tokenFromEmail(lastEmail(), INVITE_TOKEN);
    await owner.client.post(`/api/boards/${board.id}/invites`).send({ email: 'late@example.com' });
    const second = tokenFromEmail(lastEmail(), INVITE_TOKEN);

    expect(second).not.toBe(first);
    expect((await client().get(`/api/invites/${first}`)).status).toBe(404);
    expect((await client().get(`/api/invites/${second}`)).status).toBe(200);
    expect((await owner.client.get(`/api/boards/${board.id}/shares`)).body.invites).toHaveLength(1);
  });

  it('lets the owner withdraw a pending invite, which kills its link', async () => {
    await owner.client.post(`/api/boards/${board.id}/invites`).send({ email: 'Pending@Example.com' });
    const token = tokenFromEmail(lastEmail(), INVITE_TOKEN);

    const res = await owner.client.delete(`/api/boards/${board.id}/invites/${encodeURIComponent('PENDING@example.com')}`);

    expect(res.status).toBe(204);
    expect((await client().get(`/api/invites/${token}`)).status).toBe(404);
    expect((await owner.client.get(`/api/boards/${board.id}/shares`)).body.invites).toEqual([]);
    const again = await owner.client.delete(`/api/boards/${board.id}/invites/pending%40example.com`);
    expect(again.status).toBe(404);
    expect(errorCode(again)).toBe('INVITE_NOT_FOUND');
  });

  it('answers 502 EMAIL_FAILED when the email cannot be sent, so the UI never claims success', async () => {
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('SendGrid failed to send email: sender not verified'));

    const res = await owner.client.post(`/api/boards/${board.id}/invites`).send({ email: 'friend@example.com' });

    expect(res.status).toBe(502);
    expect(res.body.error).toMatchObject({ code: 'EMAIL_FAILED' });
    // nothing was delivered, so nothing is left pending
    expect((await owner.client.get(`/api/boards/${board.id}/shares`)).body.invites).toEqual([]);
  });

  it('escapes the board title and inviter name in the HTML email', async () => {
    const sneaky = await createBoard(owner.client, 'Q3 <b>bold</b> & "quotes"');

    await owner.client.post(`/api/boards/${sneaky.id}/invites`).send({ email: 'friend@example.com' });

    const { html, text } = lastEmail();
    expect(html).not.toContain('<b>bold</b>');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt; &amp; &quot;quotes&quot;');
    expect(text).toContain('Q3 <b>bold</b> & "quotes"'); // plain text needs no escaping
  });

  it('validates the email', async () => {
    const res = await owner.client.post(`/api/boards/${board.id}/invites`).send({ email: 'nope' });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: 'email', message: 'Enter a valid email address' }]);
    expect(sentEmails()).toEqual([]);
  });

  it('is owner-only: viewers get 403, strangers 404, and no email goes out', async () => {
    const viewer = await makeViewer();
    const stranger = await signUp();

    expect(errorCode(await viewer.client.post(`/api/boards/${board.id}/invites`).send({ email: 'x@y.co' }))).toBe(
      'READ_ONLY',
    );
    expect(
      errorCode(await stranger.client.post(`/api/boards/${board.id}/invites`).send({ email: 'x@y.co' })),
    ).toBe('BOARD_NOT_FOUND');
    expect(sentEmails()).toEqual([]);
  });
});

describe('POST /api/boards/:id/invite-link/reset', () => {
  it('requires login', async () => {
    expect((await client().post(`/api/boards/${board.id}/invite-link/reset`)).status).toBe(401);
  });

  it('issues a new link and makes the old one stop working, keeping existing viewers', async () => {
    const viewer = await makeViewer();
    const oldToken = await inviteToken(owner.client, board.id);

    const res = await owner.client.post(`/api/boards/${board.id}/invite-link/reset`);

    expect(res.status).toBe(200);
    const newToken = res.body.inviteLink.match(INVITE_LINK)?.[1];
    expect(newToken).toMatch(TOKEN);
    expect(newToken).not.toBe(oldToken);
    expect(await inviteToken(owner.client, board.id)).toBe(newToken);

    expect(errorCode(await client().get(`/api/invites/${oldToken}`))).toBe('INVALID_INVITE');
    const joiner = await signUp();
    expect(errorCode(await joiner.client.post(`/api/invites/${oldToken}/accept`))).toBe('INVALID_INVITE');
    expect((await client().get(`/api/invites/${newToken}`)).status).toBe(200);
    expect((await viewer.client.get(`/api/boards/${board.id}`)).status).toBe(200);
  });

  it('works on a board that never had a link yet', async () => {
    const fresh = await createBoard(owner.client, 'Fresh');

    const res = await owner.client.post(`/api/boards/${fresh.id}/invite-link/reset`);

    expect(res.status).toBe(200);
    expect(res.body.inviteLink).toMatch(INVITE_LINK);
  });

  it('is owner-only', async () => {
    const viewer = await makeViewer();
    const stranger = await signUp();

    expect(errorCode(await viewer.client.post(`/api/boards/${board.id}/invite-link/reset`))).toBe('READ_ONLY');
    expect(errorCode(await stranger.client.post(`/api/boards/${board.id}/invite-link/reset`))).toBe(
      'BOARD_NOT_FOUND',
    );
    expect(errorCode(await owner.client.post(`/api/boards/${UNKNOWN_ID}/invite-link/reset`))).toBe('BOARD_NOT_FOUND');
    expect(errorCode(await owner.client.post('/api/boards/bad/invite-link/reset'))).toBe('INVALID_ID');
  });
});

describe('GET /api/invites/:token (public)', () => {
  it('tells a logged-out visitor which board and who invited them', async () => {
    const token = await inviteToken(owner.client, board.id);

    const res = await client().get(`/api/invites/${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ boardTitle: 'Launch plan', inviterName: 'Olivia Owner' });
  });

  it('reflects a later rename', async () => {
    const token = await inviteToken(owner.client, board.id);
    await owner.client.patch(`/api/boards/${board.id}`).send({ title: 'Renamed' });

    expect((await client().get(`/api/invites/${token}`)).body.boardTitle).toBe('Renamed');
  });

  it('answers 404 for unknown or almost-right tokens without leaking anything', async () => {
    const token = await inviteToken(owner.client, board.id);

    for (const bad of ['nope', `${token}x`, token.slice(0, -1), token.toUpperCase()]) {
      const res = await client().get(`/api/invites/${bad}`);
      expect(res.status).toBe(404);
      expect(res.body.error).toEqual({
        code: 'INVALID_INVITE',
        message: 'This invite link is invalid or no longer works',
      });
    }
  });
});

describe('POST /api/invites/:token/accept', () => {
  it('requires login', async () => {
    const token = await inviteToken(owner.client, board.id);

    const res = await client().post(`/api/invites/${token}/accept`);

    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('UNAUTHORIZED');
  });

  it('makes the caller a viewer of the board', async () => {
    const token = await inviteToken(owner.client, board.id);
    const joiner = await signUp({ name: 'Jo' });

    const res = await joiner.client.post(`/api/invites/${token}/accept`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ boardId: board.id });
    const view = await joiner.client.get(`/api/boards/${board.id}`);
    expect(view.body.board).toMatchObject({ role: 'viewer', ownerName: 'Olivia Owner' });
    expect((await owner.client.get(`/api/boards/${board.id}/shares`)).body.shares).toEqual([
      { userId: joiner.id, name: 'Jo', email: joiner.email },
    ]);
  });

  it('is idempotent: accepting twice does not add the viewer twice', async () => {
    const token = await inviteToken(owner.client, board.id);
    const joiner = await signUp();

    await joiner.client.post(`/api/invites/${token}/accept`);
    const again = await joiner.client.post(`/api/invites/${token}/accept`);

    expect(again.status).toBe(200);
    expect(again.body).toEqual({ boardId: board.id });
    expect((await owner.client.get(`/api/boards/${board.id}/shares`)).body.shares).toHaveLength(1);
  });

  it('is a no-op for the owner, who is never added to the share list', async () => {
    const token = await inviteToken(owner.client, board.id);

    const res = await owner.client.post(`/api/invites/${token}/accept`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ boardId: board.id });
    expect((await owner.client.get(`/api/boards/${board.id}/shares`)).body.shares).toEqual([]);
    expect((await owner.client.get(`/api/boards/${board.id}`)).body.board.role).toBe('owner');
  });

  it('accepts an emailed invite from the invited account, once only', async () => {
    await owner.client.post(`/api/boards/${board.id}/invites`).send({ email: 'invitee@example.com' });
    const token = tokenFromEmail(lastEmail(), INVITE_TOKEN);
    const invitee = await signUp({ name: 'Ivy', email: 'invitee@example.com' });

    const res = await invitee.client.post(`/api/invites/${token}/accept`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ boardId: board.id });
    expect((await invitee.client.get(`/api/boards/${board.id}`)).body.board.role).toBe('viewer');
    const sharing = await owner.client.get(`/api/boards/${board.id}/shares`);
    expect(sharing.body.shares.map((s: { email: string }) => s.email)).toEqual(['invitee@example.com']);
    expect(sharing.body.invites).toEqual([]); // no longer pending
    // used up: the same link opened again (another browser, another account) is dead
    const another = await signUp();
    const reuse = await another.client.post(`/api/invites/${token}/accept`);
    expect(reuse.status).toBe(404);
    expect(errorCode(reuse)).toBe('INVALID_INVITE');
  });

  it('refuses an emailed invite from a different account, without granting access', async () => {
    await owner.client.post(`/api/boards/${board.id}/invites`).send({ email: 'right@example.com' });
    const token = tokenFromEmail(lastEmail(), INVITE_TOKEN);
    const wrong = await signUp({ email: 'wrong@example.com' }); // e.g. changed the email on the sign-up form

    const res = await wrong.client.post(`/api/invites/${token}/accept`);

    expect(res.status).toBe(403);
    expect(res.body.error).toEqual({
      code: 'INVITE_EMAIL_MISMATCH',
      message: 'This invite was sent to r•••t@example.com. Log in with that account to join.',
    });
    expect((await wrong.client.get(`/api/boards/${board.id}`)).status).toBe(404);
    expect((await owner.client.get(`/api/boards/${board.id}/shares`)).body.invites).toHaveLength(1); // still pending
  });

  it('answers 404 for an unknown token', async () => {
    const joiner = await signUp();

    const res = await joiner.client.post('/api/invites/not-a-real-token/accept');

    expect(res.status).toBe(404);
    expect(errorCode(res)).toBe('INVALID_INVITE');
    expect(await listBoards(joiner.client)).toEqual([]);
  });
});

describe('routes that do not exist under /api/boards', () => {
  it('answers 404 NOT_FOUND when logged in and 401 when logged out', async () => {
    const loggedIn = await owner.client.get(`/api/boards/${board.id}/nothing/here`);
    expect(loggedIn.status).toBe(404);
    expect(errorCode(loggedIn)).toBe('NOT_FOUND');

    expect((await client().get(`/api/boards/${board.id}/nothing/here`)).status).toBe(401);
  });
});
