import request from 'supertest';
import { vi } from 'vitest';
import { createApp } from '../src/app.js';
import { sendEmail, type Email } from '../src/utils/email.js';

// One app per test file is enough: createApp() keeps no per-request state.
export const app = createApp();

// A supertest "agent" remembers cookies between requests, so one agent behaves like one browser.
export type Client = ReturnType<typeof request.agent>;
export type ApiResponse = Awaited<ReturnType<Client['get']>>;

export function client(): Client {
  return request.agent(app);
}

export const PASSWORD = 'Password123'; // passes the rule: 8–72 chars, at least a letter and a number

export type TestUser = {
  client: Client;
  id: string;
  name: string;
  email: string;
  password: string;
};

let userCounter = 0;

// Signs up a brand-new user and returns a client that is logged in as them.
export async function signUp(
  overrides: Partial<Pick<TestUser, 'name' | 'email' | 'password'>> = {},
): Promise<TestUser> {
  userCounter += 1;
  const name = overrides.name ?? `User ${userCounter}`;
  const email = overrides.email ?? `user${userCounter}@example.com`;
  const password = overrides.password ?? PASSWORD;
  const c = client();
  const res = await c.post('/api/auth/signup').send({ name, email, password });
  if (res.status !== 201) {
    throw new Error(`signUp helper failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { client: c, id: res.body.user.id, name, email, password };
}

export async function createBoard(c: Client, title = 'My board') {
  const res = await c.post('/api/boards').send({ title });
  if (res.status !== 201) {
    throw new Error(`createBoard helper failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.board as { id: string; title: string };
}

export async function createTask(c: Client, boardId: string, fields: Record<string, unknown> = {}) {
  const res = await c.post('/api/tasks').send({ boardId, title: 'A task', ...fields });
  if (res.status !== 201) {
    throw new Error(`createTask helper failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.task as {
    id: string;
    boardId: string;
    title: string;
    description: string;
    priority: string;
    dueDate: string | null;
    completed: boolean;
    order: number;
  };
}

// Makes `user` a viewer of the board the only way there is: the owner invites their email and
// they accept the emailed invite (the mocked sender records the email, so we can read the link).
export async function joinViaInvite(ownerClient: Client, boardId: string, user: TestUser) {
  const invite = await ownerClient
    .post(`/api/boards/${boardId}/invites`)
    .send({ email: user.email });
  if (invite.status !== 200) {
    throw new Error(
      `joinViaInvite: invite failed: ${invite.status} ${JSON.stringify(invite.body)}`,
    );
  }
  const token = tokenFromEmail(lastEmail(), INVITE_TOKEN);
  const accept = await user.client.post(`/api/invites/${token}/accept`);
  if (accept.status !== 200) {
    throw new Error(
      `joinViaInvite: accept failed: ${accept.status} ${JSON.stringify(accept.body)}`,
    );
  }
}

// Emails "sent" during the current test (the real sender is mocked in tests/setup.ts)
export function sentEmails(): Email[] {
  return vi.mocked(sendEmail).mock.calls.map(([email]) => email);
}

export function lastEmail(): Email {
  const all = sentEmails();
  const last = all[all.length - 1];
  if (!last) throw new Error('expected an email to have been sent, but none was');
  return last;
}

// The links our emails contain: /reset-password?token=<token> and /invite/<token>
export const RESET_TOKEN = /reset-password\?token=([^\s&"'<>]+)/;
export const INVITE_TOKEN = /\/invite\/([^\s?"'<>]+)/;

export function tokenFromEmail(email: Email, pattern: RegExp): string {
  const token = email.text.match(pattern)?.[1];
  if (!token) throw new Error(`no token matched ${pattern} in email text:\n${email.text}`);
  return token;
}

// Every failed response uses the same envelope: { error: { code, message, details? } }
export function errorCode(res: ApiResponse): string | undefined {
  return res.body?.error?.code;
}

// A valid-looking ObjectId that is not in the database
export const UNKNOWN_ID = '507f1f77bcf86cd799439011';
