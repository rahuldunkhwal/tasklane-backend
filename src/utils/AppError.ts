export type ErrorDetail = { path: string; message: string };

// An error we throw on purpose: it carries the HTTP status and a stable code
// that the frontend can check (e.g. 'EMAIL_TAKEN'), not just a human message.
export class AppError extends Error {
  statusCode: number;
  code: string;
  details?: ErrorDetail[];

  constructor(statusCode: number, code: string, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
