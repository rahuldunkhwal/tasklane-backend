import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

// One document per login (per device/browser). The JWT carries this session's id,
// so deleting the document logs that device out immediately, even if the JWT itself hasn't expired.
const sessionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// TTL index: MongoDB automatically deletes a session once its expiresAt time has passed
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type Session = InferSchemaType<typeof sessionSchema>;
export type SessionDocument = HydratedDocument<Session>;

export const SessionModel = model('Session', sessionSchema);
