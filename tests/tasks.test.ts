import { beforeEach, describe, expect, it } from 'vitest';
import { TaskModel } from '../src/modules/tasks/task.model.js';
import {
  client,
  createBoard,
  createTask,
  errorCode,
  joinViaInvite,
  signUp,
  UNKNOWN_ID,
  type Client,
  type TestUser,
} from './helpers.js';

// Every task the API returns has exactly these keys (see src/modules/tasks/task.dto.ts)
const TASK_KEYS = [
  'boardId',
  'completed',
  'createdAt',
  'description',
  'dueDate',
  'id',
  'order',
  'priority',
  'title',
  'updatedAt',
];

const DAY = 24 * 60 * 60 * 1000;
// The API only accepts full ISO date-times with an offset, e.g. 2026-10-20T10:00:00.000Z
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY).toISOString();

let owner: TestUser;
let board: { id: string; title: string };

beforeEach(async () => {
  owner = await signUp();
  board = await createBoard(owner.client, 'Owner board');
});

// A second user who can see the owner's board but not change it
async function makeViewer(): Promise<TestUser> {
  const viewer = await signUp();
  await joinViaInvite(owner.client, board.id, viewer);
  return viewer;
}

async function listTitles(c: Client, query = ''): Promise<string[]> {
  const res = await c.get(`/api/tasks${query}`);
  expect(res.status).toBe(200);
  return res.body.tasks.map((task: { title: string }) => task.title);
}

async function listOrders(c: Client): Promise<Array<{ title: string; order: number }>> {
  const res = await c.get('/api/tasks');
  expect(res.status).toBe(200);
  return res.body.tasks.map((t: { title: string; order: number }) => ({
    title: t.title,
    order: t.order,
  }));
}

describe('GET /api/tasks', () => {
  it('requires login', async () => {
    const res = await client().get('/api/tasks');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Please log in to continue' },
    });
  });

  it('returns an empty list for a user with no tasks', async () => {
    const res = await owner.client.get('/api/tasks');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tasks: [] });
  });

  it('lists my tasks across boards, grouped by board and sorted by order', async () => {
    const second = await createBoard(owner.client, 'Second board');
    await createTask(owner.client, board.id, { title: 'first' });
    await createTask(owner.client, board.id, { title: 'second' });
    await createTask(owner.client, second.id, { title: 'on second board' });

    const res = await owner.client.get('/api/tasks');

    expect(res.status).toBe(200);
    expect(res.body.tasks.map((t: { title: string }) => t.title)).toEqual([
      'first',
      'second',
      'on second board',
    ]);
    for (const task of res.body.tasks) expect(Object.keys(task).sort()).toEqual(TASK_KEYS);
  });

  it('keeps a stable order for tasks that ended up with the same order number', async () => {
    // Two "Add task" requests at the same instant can both compute the same order
    await TaskModel.create({ board: board.id, title: 'first', order: 1000 });
    await TaskModel.create({ board: board.id, title: 'second', order: 1000 });

    for (let i = 0; i < 5; i += 1) {
      expect(await listTitles(owner.client)).toEqual(['first', 'second']);
    }
  });

  it('includes tasks on boards shared with me, alongside my own', async () => {
    await createTask(owner.client, board.id, { title: "owner's task" });
    const viewer = await makeViewer();
    const mine = await createBoard(viewer.client, 'Viewer board');
    await createTask(viewer.client, mine.id, { title: "viewer's own task" });

    const titles = await listTitles(viewer.client);

    expect(titles).toHaveLength(2);
    expect(titles).toEqual(expect.arrayContaining(["owner's task", "viewer's own task"]));
  });

  it('never shows another user their tasks', async () => {
    await createTask(owner.client, board.id, { title: 'private' });
    const stranger = await signUp();

    expect(await listTitles(stranger.client)).toEqual([]);
  });

  describe('search', () => {
    beforeEach(async () => {
      await createTask(owner.client, board.id, { title: 'Buy milk' });
      await createTask(owner.client, board.id, { title: 'buy BREAD' });
      await createTask(owner.client, board.id, {
        title: 'Walk dog',
        description: 'buy milk first',
      });
    });

    it('matches the title only, case-insensitively, anywhere in the title', async () => {
      expect(await listTitles(owner.client, '?search=MILK')).toEqual(['Buy milk']);
      expect(await listTitles(owner.client, '?search=buy')).toEqual(['Buy milk', 'buy BREAD']);
    });

    it('treats regex characters literally', async () => {
      expect(await listTitles(owner.client, '?search=.*')).toEqual([]);
    });

    it('ignores a blank search', async () => {
      expect(await listTitles(owner.client, '?search=%20%20')).toHaveLength(3);
    });

    it('rejects a search longer than 100 characters', async () => {
      const res = await owner.client.get(`/api/tasks?search=${'a'.repeat(101)}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: [{ path: 'search', message: 'Search must be at most 100 characters' }],
      });
    });
  });

  describe('filters', () => {
    it('filters by exact priority and rejects unknown values', async () => {
      await createTask(owner.client, board.id, { title: 'urgent', priority: 'high' });
      await createTask(owner.client, board.id, { title: 'later', priority: 'low' });

      expect(await listTitles(owner.client, '?priority=high')).toEqual(['urgent']);
      for (const bad of ['urgent', 'HIGH', '']) {
        const res = await owner.client.get(`/api/tasks?priority=${bad}`);
        expect(res.status).toBe(400);
        expect(res.body.error.details).toEqual([
          { path: 'priority', message: 'Priority must be low, medium or high' },
        ]);
      }
    });

    it('filters by completed and only accepts "true"/"false"', async () => {
      const done = await createTask(owner.client, board.id, { title: 'done' });
      await createTask(owner.client, board.id, { title: 'open' });
      await owner.client.patch(`/api/tasks/${done.id}`).send({ completed: true });

      expect(await listTitles(owner.client, '?completed=true')).toEqual(['done']);
      expect(await listTitles(owner.client, '?completed=false')).toEqual(['open']);
      const res = await owner.client.get('/api/tasks?completed=1');
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([
        { path: 'completed', message: 'Must be true or false' },
      ]);
    });

    it('noDueDate=true keeps only tasks without a due date (false is a no-op)', async () => {
      await createTask(owner.client, board.id, { title: 'dated', dueDate: daysFromNow(1) });
      await createTask(owner.client, board.id, { title: 'undated' });

      expect(await listTitles(owner.client, '?noDueDate=true')).toEqual(['undated']);
      expect(await listTitles(owner.client, '?noDueDate=false')).toEqual(['dated', 'undated']);
    });

    it('filters by an inclusive dueFrom/dueTo range', async () => {
      const soon = daysFromNow(1);
      await createTask(owner.client, board.id, { title: 'soon', dueDate: soon });
      await createTask(owner.client, board.id, { title: 'later', dueDate: daysFromNow(5) });
      await createTask(owner.client, board.id, { title: 'undated' });

      expect(await listTitles(owner.client, `?dueFrom=${daysFromNow(2)}`)).toEqual(['later']);
      expect(await listTitles(owner.client, `?dueTo=${daysFromNow(2)}`)).toEqual(['soon']);
      // the boundary itself is included
      expect(await listTitles(owner.client, `?dueFrom=${soon}&dueTo=${soon}`)).toEqual(['soon']);
    });

    it('ignores the date range when noDueDate=true', async () => {
      await createTask(owner.client, board.id, { title: 'dated', dueDate: daysFromNow(1) });
      await createTask(owner.client, board.id, { title: 'undated' });

      expect(await listTitles(owner.client, `?noDueDate=true&dueFrom=${daysFromNow(0)}`)).toEqual([
        'undated',
      ]);
    });

    it('rejects a range whose dueFrom is after dueTo', async () => {
      const res = await owner.client.get(
        `/api/tasks?dueFrom=${daysFromNow(5)}&dueTo=${daysFromNow(1)}`,
      );

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([
        { path: 'dueFrom', message: 'dueFrom must be before dueTo' },
      ]);
    });

    it('rejects dates that are not full ISO date-times with an offset', async () => {
      for (const bad of ['2026-10-20', '2026-10-20T10:00:00', 'yesterday']) {
        const res = await owner.client.get(`/api/tasks?dueFrom=${bad}`);
        expect(res.status).toBe(400);
        expect(res.body.error.details).toEqual([
          { path: 'dueFrom', message: 'dueFrom must be a valid date' },
        ]);
      }
    });

    it('combines filters with AND', async () => {
      const match = await createTask(owner.client, board.id, {
        title: 'open high',
        priority: 'high',
      });
      const done = await createTask(owner.client, board.id, {
        title: 'done high',
        priority: 'high',
      });
      await createTask(owner.client, board.id, { title: 'open low', priority: 'low' });
      await owner.client.patch(`/api/tasks/${done.id}`).send({ completed: true });

      expect(await listTitles(owner.client, '?priority=high&completed=false')).toEqual([
        match.title,
      ]);
    });

    it('reports every invalid filter at once and ignores unknown parameters', async () => {
      const res = await owner.client.get('/api/tasks?priority=nope&completed=maybe');
      expect(res.status).toBe(400);
      expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
        'completed',
        'priority',
      ]);

      const ok = await owner.client.get('/api/tasks?foo=bar');
      expect(ok.status).toBe(200);
    });

    it('rejects a repeated filter parameter', async () => {
      const res = await owner.client.get('/api/tasks?search=a&search=b');

      expect(res.status).toBe(400);
      expect(errorCode(res)).toBe('VALIDATION_ERROR');
    });
  });
});

describe('GET /api/tasks/stats', () => {
  it('requires login', async () => {
    const res = await client().get('/api/tasks/stats');

    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('UNAUTHORIZED');
  });

  it('returns zeros for a user with no tasks', async () => {
    const res = await owner.client.get('/api/tasks/stats');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ total: 0, completed: 0, overdue: 0 });
  });

  it('counts total, completed and overdue (open + due date in the past)', async () => {
    await createTask(owner.client, board.id, { title: 'overdue', dueDate: daysFromNow(-1) });
    const done = await createTask(owner.client, board.id, {
      title: 'done late',
      dueDate: daysFromNow(-1),
    });
    await owner.client.patch(`/api/tasks/${done.id}`).send({ completed: true });
    await createTask(owner.client, board.id, { title: 'no due date' });
    await createTask(owner.client, board.id, { title: 'due later', dueDate: daysFromNow(3) });

    const res = await owner.client.get('/api/tasks/stats');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ total: 4, completed: 1, overdue: 1 });
  });

  it('only counts boards I own, not boards shared with me', async () => {
    await createTask(owner.client, board.id, { title: 'owner task', dueDate: daysFromNow(-1) });
    const viewer = await makeViewer();

    const res = await viewer.client.get('/api/tasks/stats');

    expect(res.body).toEqual({ total: 0, completed: 0, overdue: 0 });
  });
});

describe('POST /api/tasks', () => {
  it('requires login', async () => {
    const res = await client().post('/api/tasks').send({ boardId: board.id, title: 'x' });

    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('UNAUTHORIZED');
  });

  it('creates a task with defaults and puts it last on the board', async () => {
    const res = await owner.client
      .post('/api/tasks')
      .send({ boardId: board.id, title: '  Write tests  ' });

    expect(res.status).toBe(201);
    expect(Object.keys(res.body.task).sort()).toEqual(TASK_KEYS);
    expect(res.body.task).toMatchObject({
      boardId: board.id,
      title: 'Write tests', // trimmed
      description: '',
      priority: 'medium',
      dueDate: null,
      completed: false,
      order: 1000,
    });
    expect(res.body.task.id).toMatch(/^[a-f\d]{24}$/i);
    expect(new Date(res.body.task.createdAt).toISOString()).toBe(res.body.task.createdAt);

    const second = await createTask(owner.client, board.id, { title: 'second' });
    expect(second.order).toBe(2000);
  });

  it('stores every provided field', async () => {
    const dueDate = daysFromNow(2);
    const res = await owner.client.post('/api/tasks').send({
      boardId: board.id,
      title: 'Full task',
      description: '  details  ',
      priority: 'high',
      dueDate,
    });

    expect(res.status).toBe(201);
    expect(res.body.task).toMatchObject({ description: 'details', priority: 'high', dueDate });
  });

  it('ignores fields the client may not set (completed, order, board)', async () => {
    const res = await owner.client.post('/api/tasks').send({
      boardId: board.id,
      title: 'Sneaky',
      completed: true,
      order: 5,
      board: UNKNOWN_ID,
      extra: 'nope',
    });

    expect(res.status).toBe(201);
    expect(res.body.task).toMatchObject({ completed: false, order: 1000, boardId: board.id });
    expect(res.body.task).not.toHaveProperty('extra');
  });

  it('reports every missing or invalid field', async () => {
    const res = await owner.client.post('/api/tasks').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Invalid request data',
    });
    expect(res.body.error.details).toEqual([
      { path: 'boardId', message: 'Board is required' },
      { path: 'title', message: 'Title is required' },
    ]);
  });

  it.each([
    [{ boardId: 'not-an-id', title: 'x' }, 'boardId', 'Invalid board id'],
    [{ title: '   ' }, 'title', 'Title is required'],
    [{ title: 'x'.repeat(201) }, 'title', 'Title must be at most 200 characters'],
    [
      { title: 'x', description: 'd'.repeat(2001) },
      'description',
      'Description must be at most 2000 characters',
    ],
    [{ title: 'x', priority: 'urgent' }, 'priority', 'Priority must be low, medium or high'],
    [{ title: 'x', priority: 'High' }, 'priority', 'Priority must be low, medium or high'],
    [{ title: 'x', dueDate: '2026-10-20' }, 'dueDate', 'Due date must be a valid date'],
    [{ title: 'x', dueDate: '2026-10-20T10:00:00' }, 'dueDate', 'Due date must be a valid date'],
  ])('rejects %j with a clear message', async (body, path, message) => {
    const res = await owner.client.post('/api/tasks').send({ boardId: board.id, ...body });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path, message }]);
  });

  it('accepts an explicit null due date', async () => {
    const res = await owner.client
      .post('/api/tasks')
      .send({ boardId: board.id, title: 'x', dueDate: null });

    expect(res.status).toBe(201);
    expect(res.body.task.dueDate).toBeNull();
  });

  it('rejects a missing, non-object or malformed body', async () => {
    const none = await owner.client.post('/api/tasks');
    expect(none.status).toBe(400);
    expect(errorCode(none)).toBe('INVALID_BODY');

    const array = await owner.client.post('/api/tasks').send([{ boardId: board.id, title: 'x' }]);
    expect(array.status).toBe(400);
    expect(errorCode(array)).toBe('INVALID_BODY');

    const broken = await owner.client
      .post('/api/tasks')
      .set('Content-Type', 'application/json')
      .send('{"title":');
    expect(broken.status).toBe(400);
    expect(errorCode(broken)).toBe('INVALID_JSON');
  });

  it('answers 404 for a board that does not exist or belongs to someone else (no leak)', async () => {
    const stranger = await signUp();
    const theirs = await createBoard(stranger.client, 'Not yours');

    for (const boardId of [UNKNOWN_ID, theirs.id]) {
      const res = await owner.client.post('/api/tasks').send({ boardId, title: 'x' });
      expect(res.status).toBe(404);
      expect(res.body.error).toEqual({ code: 'BOARD_NOT_FOUND', message: 'Board not found' });
    }
  });

  it('refuses a viewer of a shared board with 403 READ_ONLY', async () => {
    const viewer = await makeViewer();

    const res = await viewer.client.post('/api/tasks').send({ boardId: board.id, title: 'x' });

    expect(res.status).toBe(403);
    expect(res.body.error).toEqual({
      code: 'READ_ONLY',
      message: 'You have view-only access to this board',
    });
  });
});

describe('PATCH /api/tasks/:id', () => {
  let task: Awaited<ReturnType<typeof createTask>>;

  beforeEach(async () => {
    task = await createTask(owner.client, board.id, {
      title: 'Original',
      description: 'Keep me',
      priority: 'low',
    });
  });

  it('requires login', async () => {
    const res = await client().patch(`/api/tasks/${task.id}`).send({ title: 'x' });

    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('UNAUTHORIZED');
  });

  it('changes only the fields that were sent', async () => {
    const res = await owner.client.patch(`/api/tasks/${task.id}`).send({ title: 'Renamed' });

    expect(res.status).toBe(200);
    expect(res.body.task).toMatchObject({
      id: task.id,
      title: 'Renamed',
      description: 'Keep me',
      priority: 'low',
      completed: false,
      order: task.order,
    });
    expect(Object.keys(res.body.task).sort()).toEqual(TASK_KEYS);
  });

  it('toggles completed and sets or clears the due date', async () => {
    const dueDate = daysFromNow(1);

    const set = await owner.client
      .patch(`/api/tasks/${task.id}`)
      .send({ completed: true, dueDate });
    expect(set.status).toBe(200);
    expect(set.body.task).toMatchObject({ completed: true, dueDate });

    const cleared = await owner.client
      .patch(`/api/tasks/${task.id}`)
      .send({ completed: false, dueDate: null });
    expect(cleared.body.task).toMatchObject({ completed: false, dueDate: null });
  });

  it('allows clearing the description with an empty string', async () => {
    const res = await owner.client.patch(`/api/tasks/${task.id}`).send({ description: '' });

    expect(res.status).toBe(200);
    expect(res.body.task.description).toBe('');
  });

  it('rejects an update with nothing to change (empty, unknown or forbidden fields only)', async () => {
    for (const body of [{}, { nonsense: 1 }, { boardId: UNKNOWN_ID, order: 1 }]) {
      const res = await owner.client.patch(`/api/tasks/${task.id}`).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ path: '', message: 'Nothing to update' }],
      });
    }
    // and the forbidden fields really were ignored, not applied
    const check = await owner.client.get('/api/tasks');
    expect(check.body.tasks[0]).toMatchObject({ boardId: board.id, order: task.order });
  });

  it.each([
    [{ completed: 'true' }, 'completed', 'Completed must be true or false'],
    [{ title: '' }, 'title', 'Title is required'],
    [{ priority: 'asap' }, 'priority', 'Priority must be low, medium or high'],
    [{ dueDate: 'tomorrow' }, 'dueDate', 'Due date must be a valid date'],
  ])('rejects %j', async (body, path, message) => {
    const res = await owner.client.patch(`/api/tasks/${task.id}`).send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path, message }]);
  });

  it('rejects an id that is not a valid ObjectId', async () => {
    const res = await owner.client.patch('/api/tasks/not-an-id').send({ title: 'x' });

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({ code: 'INVALID_ID', message: 'Invalid id' });
  });

  it('answers 404 for an unknown task', async () => {
    const res = await owner.client.patch(`/api/tasks/${UNKNOWN_ID}`).send({ title: 'x' });

    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: 'TASK_NOT_FOUND', message: 'Task not found' });
  });

  it('validates the body before looking up the task', async () => {
    const res = await owner.client.patch(`/api/tasks/${UNKNOWN_ID}`).send({});

    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('VALIDATION_ERROR');
  });

  it("answers 404 for another user's task and 403 for a viewer", async () => {
    const stranger = await signUp();
    const asStranger = await stranger.client
      .patch(`/api/tasks/${task.id}`)
      .send({ title: 'hijack' });
    expect(asStranger.status).toBe(404);
    expect(errorCode(asStranger)).toBe('TASK_NOT_FOUND');

    const viewer = await makeViewer();
    const asViewer = await viewer.client.patch(`/api/tasks/${task.id}`).send({ title: 'hijack' });
    expect(asViewer.status).toBe(403);
    expect(errorCode(asViewer)).toBe('READ_ONLY');

    expect(await listTitles(owner.client)).toEqual(['Original']);
  });
});

describe('DELETE /api/tasks/:id', () => {
  let task: Awaited<ReturnType<typeof createTask>>;

  beforeEach(async () => {
    task = await createTask(owner.client, board.id, { title: 'Doomed' });
  });

  it('requires login', async () => {
    const res = await client().delete(`/api/tasks/${task.id}`);

    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('UNAUTHORIZED');
  });

  it('deletes the task and answers 204 with no body; a second delete is 404', async () => {
    const res = await owner.client.delete(`/api/tasks/${task.id}`);

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    expect(res.text).toBe('');
    expect(await listTitles(owner.client)).toEqual([]);

    const again = await owner.client.delete(`/api/tasks/${task.id}`);
    expect(again.status).toBe(404);
    expect(errorCode(again)).toBe('TASK_NOT_FOUND');
  });

  it('rejects an invalid id', async () => {
    const res = await owner.client.delete('/api/tasks/nope');

    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('INVALID_ID');
  });

  it("answers 404 for another user's task and 403 for a viewer, leaving it intact", async () => {
    const stranger = await signUp();
    const asStranger = await stranger.client.delete(`/api/tasks/${task.id}`);
    expect(asStranger.status).toBe(404);
    expect(errorCode(asStranger)).toBe('TASK_NOT_FOUND');

    const viewer = await makeViewer();
    const asViewer = await viewer.client.delete(`/api/tasks/${task.id}`);
    expect(asViewer.status).toBe(403);
    expect(errorCode(asViewer)).toBe('READ_ONLY');

    expect(await listTitles(owner.client)).toEqual(['Doomed']);
  });
});

describe('PATCH /api/tasks/:id/move (drag and drop)', () => {
  let a: Awaited<ReturnType<typeof createTask>>;
  let b: Awaited<ReturnType<typeof createTask>>;
  let c: Awaited<ReturnType<typeof createTask>>;

  const move = (who: Client, taskId: string, boardId: string, index: number) =>
    who.patch(`/api/tasks/${taskId}/move`).send({ boardId, index });

  beforeEach(async () => {
    a = await createTask(owner.client, board.id, { title: 'A' }); // order 1000
    b = await createTask(owner.client, board.id, { title: 'B' }); // order 2000
    c = await createTask(owner.client, board.id, { title: 'C' }); // order 3000
  });

  it('requires login', async () => {
    const res = await client()
      .patch(`/api/tasks/${a.id}/move`)
      .send({ boardId: board.id, index: 0 });

    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('UNAUTHORIZED');
  });

  it.each([
    [{ boardId: 'x' }, 'index', 'Index must be a number'],
    [{ index: '0' }, 'index', 'Index must be a number'],
    [{ index: 1.5 }, 'index', 'Index must be a whole number'],
    [{ index: -1 }, 'index', 'Index cannot be negative'],
    [{ index: 0, boardId: undefined }, 'boardId', 'Board is required'],
    [{ index: 0, boardId: 'nope' }, 'boardId', 'Invalid board id'],
  ])('rejects %j', async (body, path, message) => {
    const res = await owner.client
      .patch(`/api/tasks/${a.id}/move`)
      .send({ boardId: board.id, ...body });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual({ path, message });
  });

  it('rejects an invalid task id', async () => {
    const res = await move(owner.client, 'bad-id', board.id, 0);

    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('INVALID_ID');
  });

  it('moves a task to the top, giving it an order below the current first task', async () => {
    const res = await move(owner.client, c.id, board.id, 0);

    expect(res.status).toBe(200);
    expect(res.body.task).toMatchObject({ id: c.id, boardId: board.id, order: 0 });
    expect(await listTitles(owner.client)).toEqual(['C', 'A', 'B']);
  });

  it('moves a task to the bottom, giving it an order above the current last task', async () => {
    const res = await move(owner.client, a.id, board.id, 2);

    expect(res.body.task.order).toBe(4000);
    expect(await listTitles(owner.client)).toEqual(['B', 'C', 'A']);
  });

  it('moves a task between two others using the midpoint', async () => {
    const res = await move(owner.client, c.id, board.id, 1);

    expect(res.body.task.order).toBe(1500);
    expect(await listTitles(owner.client)).toEqual(['A', 'C', 'B']);
  });

  it('clamps an index past the end to the last position', async () => {
    const res = await move(owner.client, a.id, board.id, 99);

    expect(res.status).toBe(200);
    expect(await listTitles(owner.client)).toEqual(['B', 'C', 'A']);
  });

  it('allows dropping a task back on its own position', async () => {
    const res = await move(owner.client, b.id, board.id, 1);

    expect(res.status).toBe(200);
    expect(await listTitles(owner.client)).toEqual(['A', 'B', 'C']);
  });

  it('moves a task to another board I own and keeps the change', async () => {
    const other = await createBoard(owner.client, 'Other board');

    const res = await move(owner.client, a.id, other.id, 0);

    expect(res.status).toBe(200);
    expect(res.body.task).toMatchObject({ id: a.id, boardId: other.id, order: 1000 });
    const all = await owner.client.get('/api/tasks');
    const byBoard = (id: string) =>
      all.body.tasks
        .filter((t: { boardId: string }) => t.boardId === id)
        .map((t: { title: string }) => t.title);
    expect(byBoard(board.id)).toEqual(['B', 'C']);
    expect(byBoard(other.id)).toEqual(['A']);
  });

  it('slots a task into a chosen position on a populated target board', async () => {
    const other = await createBoard(owner.client, 'Other board');
    await createTask(owner.client, other.id, { title: 'X' }); // order 1000

    const res = await move(owner.client, a.id, other.id, 1);

    expect(res.body.task).toMatchObject({ boardId: other.id, order: 2000 });
  });

  it('renumbers the board when the gap between neighbours is used up', async () => {
    // Alternately dropping B and C between A and the other one halves the gap every time.
    // After ~30 drops the gap is below the renumber threshold; without renumbering the final
    // gaps would be ~1e-9, so gaps above 1e-6 at the end prove the renumbering happened.
    for (let i = 0; i < 40; i += 1) {
      const res = await move(owner.client, i % 2 === 0 ? c.id : b.id, board.id, 1);
      expect(res.status).toBe(200);
    }

    const orders = await listOrders(owner.client);
    expect(orders.map((t) => t.title)).toEqual(['A', 'B', 'C']); // last move put B in the middle
    for (let i = 1; i < orders.length; i += 1) {
      expect(orders[i]!.order - orders[i - 1]!.order).toBeGreaterThan(1e-6);
    }
  });

  it("answers 404 for a target board I cannot see and 403 for one I'm only a viewer of", async () => {
    const stranger = await signUp();
    const theirs = await createBoard(stranger.client, 'Theirs');
    await joinViaInvite(stranger.client, theirs.id, owner); // owner becomes a viewer of it

    const hidden = await move(owner.client, a.id, UNKNOWN_ID, 0);
    expect(hidden.status).toBe(404);
    expect(errorCode(hidden)).toBe('BOARD_NOT_FOUND');

    const readOnly = await move(owner.client, a.id, theirs.id, 0);
    expect(readOnly.status).toBe(403);
    expect(errorCode(readOnly)).toBe('READ_ONLY');

    expect(await listTitles(owner.client, '?search=A')).toEqual(['A']); // still on my board
  });

  it("answers 404 for another user's task and 403 for a viewer of its board", async () => {
    const stranger = await signUp();
    const asStranger = await move(stranger.client, a.id, board.id, 0);
    expect(asStranger.status).toBe(404);
    expect(errorCode(asStranger)).toBe('TASK_NOT_FOUND');

    const viewer = await makeViewer();
    const viewersOwn = await createBoard(viewer.client, 'Mine');
    const asViewer = await move(viewer.client, a.id, viewersOwn.id, 0);
    expect(asViewer.status).toBe(403);
    expect(errorCode(asViewer)).toBe('READ_ONLY');

    expect(await listTitles(owner.client)).toEqual(['A', 'B', 'C']);
  });
});

describe('routes that do not exist under /api/tasks', () => {
  it('answers 404 NOT_FOUND when logged in and 401 when logged out', async () => {
    const loggedIn = await owner.client.get(`/api/tasks/${UNKNOWN_ID}`);
    expect(loggedIn.status).toBe(404);
    expect(loggedIn.body.error.code).toBe('NOT_FOUND');

    const loggedOut = await client().get(`/api/tasks/${UNKNOWN_ID}`);
    expect(loggedOut.status).toBe(401);
  });
});
