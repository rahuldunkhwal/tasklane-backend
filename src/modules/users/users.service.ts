import type { UploadApiResponse } from 'cloudinary';
import { cloudinary, cloudinaryEnabled } from '../../config/cloudinary.js';
import { AppError } from '../../utils/AppError.js';
import { toPublicUser } from './user.dto.js';
import { UserModel } from './user.model.js';
import type { UpdateNameInput } from './users.schema.js';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Load the user WITH the hidden avatarPublicId (needed to delete/overwrite the old image).
async function loadUser(userId: string) {
  const user = await UserModel.findById(userId).select('+avatarPublicId');
  if (!user) throw new AppError(401, 'UNAUTHORIZED', 'Please log in to continue');
  return user;
}

export async function updateName(userId: string, input: UpdateNameInput) {
  const user = await loadUser(userId);
  user.name = input.name;
  await user.save();
  return toPublicUser(user);
}

export async function uploadAvatar(userId: string, file: { buffer: Buffer; mimetype: string }) {
  if (!cloudinaryEnabled) {
    throw new AppError(503, 'AVATAR_UNAVAILABLE', 'Avatar uploads are not configured on the server');
  }
  if (!ALLOWED_TYPES.includes(file.mimetype)) {
    throw new AppError(400, 'INVALID_IMAGE', 'Please upload a JPG, PNG or WEBP image');
  }

  const user = await loadUser(userId);

  // One image per user (public_id = the user id), overwritten on re-upload so no orphans pile up.
  // Cropped to a 256×256 square centred on the face and delivered as WEBP.
  const result = await new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: `tasklane/avatars/${userId}`,
        overwrite: true,
        invalidate: true,
        resource_type: 'image',
        format: 'webp',
        transformation: [{ width: 256, height: 256, crop: 'fill', gravity: 'face' }],
      },
      (error, uploaded) =>
        uploaded ? resolve(uploaded) : reject(error ?? new Error('Cloudinary returned no result')),
    );
    stream.end(file.buffer);
  });

  user.avatarUrl = result.secure_url;
  user.avatarPublicId = result.public_id;
  await user.save();
  return toPublicUser(user);
}

export async function removeAvatar(userId: string) {
  const user = await loadUser(userId);
  if (user.avatarPublicId && cloudinaryEnabled) {
    // Best-effort delete: if it's already gone we still clear our own fields.
    await cloudinary.uploader
      .destroy(user.avatarPublicId, { invalidate: true })
      .catch((error: unknown) => console.error('Failed to delete avatar from Cloudinary:', error));
  }
  user.avatarUrl = null;
  user.avatarPublicId = null;
  await user.save();
  return toPublicUser(user);
}
