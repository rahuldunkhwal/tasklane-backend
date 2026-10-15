import bcrypt from 'bcryptjs';

// Cost factor: every +1 doubles the time to compute one hash.
// 12 makes each hash take a noticeable fraction of a second, so guessing millions of passwords is impractical.
const SALT_ROUNDS = 12;

// bcrypt adds a random salt automatically, so two users with the same password get different hashes
export function hashPassword(plain: string) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}
