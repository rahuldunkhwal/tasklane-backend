import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

// One entry per person the board is shared with. Stored INSIDE the board: the list is small and is
// needed every time the board is loaded (to answer "may this user see it?"). Only "viewer" exists.
const shareSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['viewer'], default: 'viewer' },
  },
  { _id: false }, // entries are identified by their user, they don't need their own id
);

// A pending invite for ONE email address (someone without an account yet, or who hasn't joined
// yet). The emailed link carries this token, and only a user logged in with this exact email can
// accept it; the entry is removed once used, so the link works exactly once.
const inviteSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    token: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }, // identified by email (one pending invite per email)
);

const boardSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    sharedWith: { type: [shareSchema], default: [] },
    invites: { type: [inviteSchema], default: [] },
  },
  { timestamps: true },
);

// Accepting an emailed invite looks the board up by the token inside the invites list
boardSchema.index({ 'invites.token': 1 }, { sparse: true });

// "My boards, oldest first" is the most common query: this one index serves both the filter
// (owner) and the sort (createdAt), so MongoDB never has to sort in memory.
boardSchema.index({ owner: 1, createdAt: 1 });
// "Boards shared with me": finds boards whose sharedWith list contains this user
boardSchema.index({ 'sharedWith.user': 1 });

export type Board = InferSchemaType<typeof boardSchema>;
export type BoardDocument = HydratedDocument<Board>;

export const BoardModel = model('Board', boardSchema);
