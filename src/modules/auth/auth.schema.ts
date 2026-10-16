import { z } from 'zod';
import { emailRule, requiredString } from '../../utils/zod.js';

const nameRule = requiredString('Name')
  .trim()
  .min(1, 'Name is required')
  .max(50, 'Name must be at most 50 characters');

// Exported: reset password and change password must use the same rules
export const passwordRule = requiredString('Password')
  .min(1, { error: 'Password is required', abort: true })
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters') // bcrypt ignores anything after 72 bytes
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

export const signupSchema = z.object({
  name: nameRule,
  email: emailRule,
  password: passwordRule,
});

// Login only checks that a password was typed: strength rules apply when a password is
// created, not when it's used (otherwise users with older, weaker passwords couldn't log in).
export const loginSchema = z.object({
  email: emailRule,
  password: requiredString('Password').min(1, 'Password is required'),
});

export const forgotPasswordSchema = z.object({
  email: emailRule,
});

// The new password follows the same rules as signup (shared passwordRule)
export const resetPasswordSchema = z.object({
  token: requiredString('Reset token').min(1, 'Reset token is required'),
  password: passwordRule,
});

// Change password while logged in. The current password proves it's really the account owner
// (not someone using a laptop that was left logged in); the new one follows the signup rules.
export const changePasswordSchema = z
  .object({
    currentPassword: requiredString('Current password').min(1, 'Current password is required'),
    newPassword: passwordRule,
  })
  .refine((values) => values.currentPassword !== values.newPassword, {
    message: 'New password must be different from the current one',
    path: ['newPassword'],
  });

export type SignupInput = z.infer<typeof signupSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
