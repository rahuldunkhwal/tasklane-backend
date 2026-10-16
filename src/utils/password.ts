import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

// Cost factor: every +1 doubles the time to compute one hash.
// 12 makes each hash take a noticeable fraction of a second, so guessing millions of passwords is impractical.
// The test suite signs up hundreds of users, so it uses the minimum cost: still real bcrypt hashes,
// just ~1000x faster to compute (the slowness is a feature only against real attackers).
const SALT_ROUNDS = env.NODE_ENV === 'test' ? 4 : 12;

// bcrypt adds a random salt automatically, so two users with the same password get different hashes
export function hashPassword(plain: string) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}
