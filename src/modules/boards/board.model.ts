import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const boardSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 100 },
  },
  { timestamps: true },
);

// "My boards, oldest first" is the most common query: this one index serves both the filter
// (owner) and the sort (createdAt), so MongoDB never has to sort in memory.
boardSchema.index({ owner: 1, createdAt: 1 });

export type Board = InferSchemaType<typeof boardSchema>;
export type BoardDocument = HydratedDocument<Board>;

export const BoardModel = model('Board', boardSchema);
