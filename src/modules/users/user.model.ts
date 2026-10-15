import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 50 },

    // unique: true creates a unique index, so the database itself rejects duplicate emails.
    // lowercase: Rahul@Test.com and rahul@test.com become the same account.
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },

    // Profile photo: the delivered Cloudinary URL (sent to the client) and the public_id used to
    // delete/overwrite it (kept server-side via select:false, so it never leaks).
    avatarUrl: { type: String, default: null },
    avatarPublicId: { type: String, select: false, default: null },

    // select: false = never loaded by queries unless explicitly asked for with .select('+passwordHash')
    passwordHash: { type: String, required: true, select: false },

    // Forgot password: we store only a SHA-256 hash of the emailed token (never the token itself),
    // so a leaked database can't be used to reset anyone's password. Removed once used.
    // sparse index: only users with an active reset request are in it.
    passwordResetTokenHash: { type: String, select: false, index: true, sparse: true },
    passwordResetExpires: { type: Date, select: false },
  },
  { timestamps: true }, // adds createdAt and updatedAt automatically
);

export type User = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<User>;

export const UserModel = model('User', userSchema);
