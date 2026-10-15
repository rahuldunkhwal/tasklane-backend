import type { UserDocument } from './user.model.js';

// DTO (Data Transfer Object) = the shape we SEND to the client.
// Picking fields one by one means a new secret field added to the model can never leak by accident.
export type PublicUser = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  createdAt: Date;
};

export function toPublicUser(user: UserDocument): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl ?? null,
    createdAt: user.createdAt,
  };
}
