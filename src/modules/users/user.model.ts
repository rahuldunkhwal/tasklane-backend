import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 50 },

    // unique: true creates a unique index, so the database itself rejects duplicate emails.
    // lowercase: Rahul@Test.com and rahul@test.com become the same account.
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },

    // select: false = never loaded by queries unless explicitly asked for with .select('+passwordHash')
    passwordHash: { type: String, required: true, select: false },
  },
  { timestamps: true }, // adds createdAt and updatedAt automatically
);

export type User = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<User>;

export const UserModel = model('User', userSchema);
