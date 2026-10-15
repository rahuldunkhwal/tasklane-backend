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

const boardSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    sharedWith: { type: [shareSchema], default: [] },
  },
  { timestamps: true },
);

// "My boards, oldest first" is the most common query: this one index serves both the filter
// (owner) and the sort (createdAt), so MongoDB never has to sort in memory.
boardSchema.index({ owner: 1, createdAt: 1 });
// "Boards shared with me": finds boards whose sharedWith list contains this user
boardSchema.index({ 'sharedWith.user': 1 });

export type Board = InferSchemaType<typeof boardSchema>;
export type BoardDocument = HydratedDocument<Board>;

export const BoardModel = model('Board', boardSchema);
