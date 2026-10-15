import { v2 as cloudinary } from 'cloudinary';
import { env } from './env.js';

// True only when all three credentials are present. Avatar uploads check this and return a clear
// error if it's false, so the app still runs for a reviewer who hasn't set up Cloudinary.
export const cloudinaryEnabled = Boolean(
  env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET,
);

if (cloudinaryEnabled) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true, // always return https URLs
  });
}

export { cloudinary };
