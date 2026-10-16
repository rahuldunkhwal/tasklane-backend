import { describe, expect, it } from 'vitest';
import { UserModel } from '../src/modules/users/user.model.js';
import {
  client,
  errorCode,
  lastEmail,
  PASSWORD,
  RESET_TOKEN,
  sentEmails,
  signUp,
  tokenFromEmail,
  type ApiResponse,
} from './helpers.js';

const CLIENT_ORIGIN = 'http://localhost:5173'; // set in tests/setup.ts
// Every user the API returns has exactly these keys — never passwordHash or reset fields
const USER_KEYS = ['avatarUrl', 'createdAt', 'email', 'id', 'name'];
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const FORGOT_MESSAGE = 'If an account exists for this email, we sent a link to reset the password.';
const INVALID_CREDENTIALS = {
  error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
};
const UNAUTHORIZED = { error: { code: 'UNAUTHORIZED', message: 'Please log in to continue' } };

// The auth cookie a response sets (or clears), if any
function authCookie(res: ApiResponse): string | undefined {
  return res.get('Set-Cookie')?.find((cookie) => cookie.startsWith('token='));
}

function expectLoginCookie(res: ApiResponse) {
  const cookie = authCookie(res);
  expect(cookie).toBeDefined();
  expect(cookie).toMatch(/^token=[\w-]+\.[\w-]+\.[\w-]+;/); // a JWT
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('SameSite=Lax');
  expect(cookie).toContain('Path=/');
  expect(cookie).toContain(`Max-Age=${WEEK_SECONDS}`);
  expect(cookie).not.toContain('Secure'); // only in production (HTTPS)
}

function expectClearedCookie(res: ApiResponse) {
  const cookie = authCookie(res);
  expect(cookie).toMatch(/^token=;/);
  expect(cookie).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('SameSite=Lax');
}

async function login(c = client(), email: string, password: string) {
  return c.post('/api/auth/login').send({ email, password });
}

describe('POST /api/auth/signup', () => {
  it('creates the account, logs the user in with a cookie and returns the public user', async () => {
    const c = client();

    const res = await c.post('/api/auth/signup').send({
      name: '  Alice  ',
      email: '  Alice@Example.COM ',
      password: PASSWORD,
    });

    expect(res.status).toBe(201);
    expect(Object.keys(res.body.user).sort()).toEqual(USER_KEYS);
    expect(res.body.user).toMatchObject({
      name: 'Alice',
      email: 'alice@example.com',
      avatarUrl: null,
    });
    expect(res.body.user.id).toMatch(/^[a-f\d]{24}$/i);
    expectLoginCookie(res);

    const me = await c.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(res.body.user.id);
  });

  it('ignores fields the client may not set', async () => {
    const res = await client().post('/api/auth/signup').send({
      name: 'Mallory',
      email: 'mallory@example.com',
      password: PASSWORD,
      role: 'admin',
      avatarUrl: 'https://evil.example/x.png',
    });

    expect(res.status).toBe(201);
    expect(res.body.user).not.toHaveProperty('role');
    expect(res.body.user.avatarUrl).toBeNull();
  });

  it('refuses an email that is already registered, whatever its casing', async () => {
    await signUp({ email: 'taken@example.com' });

    const res = await client().post('/api/auth/signup').send({
      name: 'Again',
      email: 'TAKEN@example.com',
      password: PASSWORD,
    });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: { code: 'EMAIL_TAKEN', message: 'An account with this email already exists' },
    });
    expect(authCookie(res)).toBeUndefined();
  });

  it('reports every missing field at once', async () => {
    const res = await client().post('/api/auth/signup').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Invalid request data',
      details: [
        { path: 'name', message: 'Name is required' },
        { path: 'email', message: 'Email is required' },
        { path: 'password', message: 'Password is required' },
      ],
    });
  });

  it.each([
    [{ name: '   ' }, [{ path: 'name', message: 'Name is required' }]],
    [{ name: 'n'.repeat(51) }, [{ path: 'name', message: 'Name must be at most 50 characters' }]],
    [{ email: 'a@b' }, [{ path: 'email', message: 'Enter a valid email address' }]],
    [{ email: 123 }, [{ path: 'email', message: 'Email must be text' }]],
    [
      { password: 'abc' },
      [
        { path: 'password', message: 'Password must be at least 8 characters' },
        { path: 'password', message: 'Password must contain at least one number' },
      ],
    ],
    [
      { password: 'abcdefgh' },
      [{ path: 'password', message: 'Password must contain at least one number' }],
    ],
    [
      { password: '12345678' },
      [{ path: 'password', message: 'Password must contain at least one letter' }],
    ],
    [
      { password: `a1${'x'.repeat(71)}` },
      [{ path: 'password', message: 'Password must be at most 72 characters' }],
    ],
  ])('rejects %j', async (override, details) => {
    const res = await client()
      .post('/api/auth/signup')
      .send({ name: 'Valid', email: 'valid@example.com', password: PASSWORD, ...override });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual(details);
  });

  it('keeps the password exactly as typed (no trimming)', async () => {
    const password = ' spaced1 ';
    const res = await client()
      .post('/api/auth/signup')
      .send({ name: 'Spacey', email: 'spacey@example.com', password });
    expect(res.status).toBe(201);

    expect((await login(client(), 'spacey@example.com', password)).status).toBe(200);
    expect((await login(client(), 'spacey@example.com', password.trim())).status).toBe(401);
  });

  it('rejects a missing or malformed body', async () => {
    const none = await client().post('/api/auth/signup');
    expect(none.status).toBe(400);
    expect(none.body.error).toEqual({
      code: 'INVALID_BODY',
      message: 'Request body must be a JSON object',
    });

    const broken = await client()
      .post('/api/auth/signup')
      .set('Content-Type', 'application/json')
      .send('{"name":');
    expect(broken.status).toBe(400);
    expect(errorCode(broken)).toBe('INVALID_JSON');
  });
});

describe('POST /api/auth/login', () => {
  it('logs in with the right password and sets a fresh cookie', async () => {
    const user = await signUp({ email: 'login@example.com' });
    const c = client();

    const res = await login(c, 'login@example.com', PASSWORD);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.user).sort()).toEqual(USER_KEYS);
    expect(res.body.user).toMatchObject({ id: user.id, email: 'login@example.com' });
    expectLoginCookie(res);
    expect((await c.get('/api/auth/me')).status).toBe(200);
  });

  it('matches the email case-insensitively and ignores surrounding spaces', async () => {
    await signUp({ email: 'casey@example.com' });

    expect((await login(client(), '  CASEY@Example.com ', PASSWORD)).status).toBe(200);
  });

  it('answers the same 401 for an unknown email and a wrong password, without a cookie', async () => {
    await signUp({ email: 'known@example.com' });

    const unknown = await login(client(), 'nobody@example.com', PASSWORD);
    const wrong = await login(client(), 'known@example.com', 'Wrong-password1');

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(INVALID_CREDENTIALS);
    expect(wrong.body).toEqual(INVALID_CREDENTIALS);
    expect(authCookie(unknown)).toBeUndefined();
    expect(authCookie(wrong)).toBeUndefined();
  });

  it('does not apply the password strength rule (a weak guess is just wrong, not invalid)', async () => {
    await signUp({ email: 'weak@example.com' });

    const res = await login(client(), 'weak@example.com', 'x');

    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('INVALID_CREDENTIALS');
  });

  it('validates the body', async () => {
    const res = await client().post('/api/auth/login').send({});

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { path: 'email', message: 'Email is required' },
      { path: 'password', message: 'Password is required' },
    ]);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the logged-in user', async () => {
    const user = await signUp({ name: 'Me', email: 'me@example.com' });

    const res = await user.client.get('/api/auth/me');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.user).sort()).toEqual(USER_KEYS);
    expect(res.body.user).toMatchObject({ id: user.id, name: 'Me', email: 'me@example.com' });
    expect(authCookie(res)).toBeUndefined(); // no new cookie on every request
  });

  it('answers 401 without a cookie or with a garbage cookie, and does not clear it', async () => {
    const none = await client().get('/api/auth/me');
    expect(none.status).toBe(401);
    expect(none.body).toEqual(UNAUTHORIZED);

    const garbage = await client().get('/api/auth/me').set('Cookie', 'token=not.a.jwt');
    expect(garbage.status).toBe(401);
    expect(garbage.body).toEqual(UNAUTHORIZED);
    expect(authCookie(garbage)).toBeUndefined();
  });

  it('answers 401 once the session has been logged out', async () => {
    const user = await signUp();
    await user.client.post('/api/auth/logout');

    const res = await user.client.get('/api/auth/me');

    expect(res.status).toBe(401);
  });

  it('is GET only', async () => {
    const user = await signUp();

    const res = await user.client.post('/api/auth/me');

    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({
      code: 'NOT_FOUND',
      message: 'Route not found: POST /api/auth/me',
    });
  });
});

describe('POST /api/auth/logout', () => {
  it('ends the session, clears the cookie and answers 204', async () => {
    const user = await signUp();

    const res = await user.client.post('/api/auth/logout');

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expectClearedCookie(res);
    expect((await user.client.get('/api/auth/me')).status).toBe(401);
  });

  it('only ends the current session; other devices stay logged in', async () => {
    const user = await signUp();
    const phone = client();
    expect((await login(phone, user.email, user.password)).status).toBe(200);

    await user.client.post('/api/auth/logout');

    expect((await user.client.get('/api/auth/me')).status).toBe(401);
    expect((await phone.get('/api/auth/me')).status).toBe(200);
  });

  it('succeeds even without a valid session (missing, garbage or already logged out)', async () => {
    expect((await client().post('/api/auth/logout')).status).toBe(204);
    expect((await client().post('/api/auth/logout').set('Cookie', 'token=garbage')).status).toBe(
      204,
    );

    const user = await signUp();
    await user.client.post('/api/auth/logout');
    expect((await user.client.post('/api/auth/logout')).status).toBe(204);
  });
});

describe('POST /api/auth/forgot-password', () => {
  it('emails a reset link to a registered address', async () => {
    await signUp({ email: 'forgot@example.com' });

    const res = await client()
      .post('/api/auth/forgot-password')
      .send({ email: '  FORGOT@example.com ' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: FORGOT_MESSAGE });
    const email = lastEmail();
    expect(email.to).toBe('forgot@example.com');
    expect(email.subject).toBe('Reset your Tasklane password');
    const token = tokenFromEmail(email, RESET_TOKEN);
    expect(token).toMatch(/^[a-f\d]{64}$/);
    expect(email.text).toContain(`${CLIENT_ORIGIN}/reset-password?token=${token}`);
    expect(email.html).toContain(`${CLIENT_ORIGIN}/reset-password?token=${token}`);
  });

  it('answers the identical message for an unknown address, and sends nothing', async () => {
    const res = await client()
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: FORGOT_MESSAGE });
    expect(sentEmails()).toEqual([]);
  });

  it('validates the email', async () => {
    const missing = await client().post('/api/auth/forgot-password').send({});
    expect(missing.status).toBe(400);
    expect(missing.body.error.details).toEqual([{ path: 'email', message: 'Email is required' }]);

    const bad = await client().post('/api/auth/forgot-password').send({ email: 'nope' });
    expect(bad.body.error.details).toEqual([
      { path: 'email', message: 'Enter a valid email address' },
    ]);
    expect(sentEmails()).toEqual([]);
  });
});

describe('POST /api/auth/reset-password', () => {
  const NEW_PASSWORD = 'Brand-new-2';

  // Requests a reset for the user and returns the raw token from the email
  async function requestReset(email: string): Promise<string> {
    const res = await client().post('/api/auth/forgot-password').send({ email });
    expect(res.status).toBe(200);
    return tokenFromEmail(lastEmail(), RESET_TOKEN);
  }

  it('sets the new password, logs every device out and clears the cookie', async () => {
    const user = await signUp({ email: 'reset@example.com' });
    const phone = client();
    await login(phone, user.email, user.password);
    const token = await requestReset(user.email);

    const res = await client()
      .post('/api/auth/reset-password')
      .send({ token, password: NEW_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: 'Your password has been reset. Please log in with your new password.',
    });
    expectClearedCookie(res);
    // every existing session is gone
    expect((await user.client.get('/api/auth/me')).status).toBe(401);
    expect((await phone.get('/api/auth/me')).status).toBe(401);
    // only the new password works now
    expect((await login(client(), user.email, user.password)).status).toBe(401);
    expect((await login(client(), user.email, NEW_PASSWORD)).status).toBe(200);
  });

  it('accepts each link only once', async () => {
    const user = await signUp({ email: 'once@example.com' });
    const token = await requestReset(user.email);
    await client().post('/api/auth/reset-password').send({ token, password: NEW_PASSWORD });

    const again = await client()
      .post('/api/auth/reset-password')
      .send({ token, password: 'Another-pw3' });

    expect(again.status).toBe(400);
    expect(again.body.error).toEqual({
      code: 'INVALID_RESET_TOKEN',
      message: 'This reset link is invalid or has expired',
    });
    expect((await login(client(), user.email, NEW_PASSWORD)).status).toBe(200);
  });

  it('rejects unknown and expired tokens', async () => {
    const unknown = await client()
      .post('/api/auth/reset-password')
      .send({ token: 'f'.repeat(64), password: NEW_PASSWORD });
    expect(unknown.status).toBe(400);
    expect(errorCode(unknown)).toBe('INVALID_RESET_TOKEN');

    const user = await signUp({ email: 'expired@example.com' });
    const token = await requestReset(user.email);
    // Fast-forward: pretend the 15-minute window has passed
    await UserModel.updateOne(
      { email: user.email },
      { passwordResetExpires: new Date(Date.now() - 1000) },
    );

    const expired = await client()
      .post('/api/auth/reset-password')
      .send({ token, password: NEW_PASSWORD });
    expect(expired.status).toBe(400);
    expect(errorCode(expired)).toBe('INVALID_RESET_TOKEN');
    expect((await login(client(), user.email, user.password)).status).toBe(200); // unchanged
  });

  it('only honours the most recent link', async () => {
    const user = await signUp({ email: 'latest@example.com' });
    const first = await requestReset(user.email);
    const second = await requestReset(user.email);

    const stale = await client()
      .post('/api/auth/reset-password')
      .send({ token: first, password: NEW_PASSWORD });
    expect(errorCode(stale)).toBe('INVALID_RESET_TOKEN');

    const fresh = await client()
      .post('/api/auth/reset-password')
      .send({ token: second, password: NEW_PASSWORD });
    expect(fresh.status).toBe(200);
  });

  it('does not use up the link when the new password is invalid', async () => {
    const user = await signUp({ email: 'weakreset@example.com' });
    const token = await requestReset(user.email);

    const weak = await client().post('/api/auth/reset-password').send({ token, password: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.details).toEqual([
      { path: 'password', message: 'Password must be at least 8 characters' },
      { path: 'password', message: 'Password must contain at least one number' },
    ]);

    const ok = await client()
      .post('/api/auth/reset-password')
      .send({ token, password: NEW_PASSWORD });
    expect(ok.status).toBe(200);
  });

  it('validates the body', async () => {
    const res = await client().post('/api/auth/reset-password').send({});

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { path: 'token', message: 'Reset token is required' },
      { path: 'password', message: 'Password is required' },
    ]);
  });
});

describe('POST /api/auth/change-password', () => {
  const NEW_PASSWORD = 'Changed-pw9';

  it('requires login, before even looking at the body', async () => {
    const res = await client().post('/api/auth/change-password').send({});

    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it('changes the password and logs out every other device, keeping this one', async () => {
    const user = await signUp({ email: 'change@example.com' });
    const phone = client();
    await login(phone, user.email, user.password);

    const res = await user.client
      .post('/api/auth/change-password')
      .send({ currentPassword: user.password, newPassword: NEW_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: 'Your password has been changed. Your other devices have been logged out.',
    });
    expect(authCookie(res)).toBeUndefined(); // this session continues
    expect((await user.client.get('/api/auth/me')).status).toBe(200);
    expect((await phone.get('/api/auth/me')).status).toBe(401);
    expect((await login(client(), user.email, user.password)).status).toBe(401);
    expect((await login(client(), user.email, NEW_PASSWORD)).status).toBe(200);
  });

  it('rejects a wrong current password with 400 (not 401) and changes nothing', async () => {
    const user = await signUp({ email: 'wrongcurrent@example.com' });
    const phone = client();
    await login(phone, user.email, user.password);

    const res = await user.client
      .post('/api/auth/change-password')
      .send({ currentPassword: 'Not-it-1', newPassword: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({
      code: 'INVALID_CURRENT_PASSWORD',
      message: 'Current password is incorrect',
    });
    expect((await phone.get('/api/auth/me')).status).toBe(200);
    expect((await login(client(), user.email, user.password)).status).toBe(200);
  });

  it('invalidates a pending reset link', async () => {
    const user = await signUp({ email: 'pending@example.com' });
    await client().post('/api/auth/forgot-password').send({ email: user.email });
    const token = tokenFromEmail(lastEmail(), RESET_TOKEN);
    await user.client
      .post('/api/auth/change-password')
      .send({ currentPassword: user.password, newPassword: NEW_PASSWORD });

    const res = await client()
      .post('/api/auth/reset-password')
      .send({ token, password: 'Another-pw3' });

    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('INVALID_RESET_TOKEN');
  });

  it('validates the body, including that the new password differs', async () => {
    const user = await signUp();

    const empty = await user.client.post('/api/auth/change-password').send({});
    expect(empty.status).toBe(400);
    expect(empty.body.error.details).toEqual([
      { path: 'currentPassword', message: 'Current password is required' },
      { path: 'newPassword', message: 'Password is required' },
    ]);

    const same = await user.client
      .post('/api/auth/change-password')
      .send({ currentPassword: user.password, newPassword: user.password });
    expect(same.status).toBe(400);
    expect(same.body.error.details).toEqual([
      { path: 'newPassword', message: 'New password must be different from the current one' },
    ]);

    const weak = await user.client
      .post('/api/auth/change-password')
      .send({ currentPassword: user.password, newPassword: 'abcdefgh' });
    expect(weak.body.error.details).toEqual([
      { path: 'newPassword', message: 'Password must contain at least one number' },
    ]);
  });
});

describe('routes that do not exist under /api/auth', () => {
  it('answers with the JSON 404 envelope', async () => {
    const res = await client().get('/api/auth/nope');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route not found: GET /api/auth/nope' },
    });
  });
});
