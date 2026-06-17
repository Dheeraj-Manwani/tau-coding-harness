export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace?.(this, AppError);
  }
}

export const Errors = {
  badRequest: (msg = "Bad request") => new AppError(msg, 400),
  unauthorized: (msg = "Unauthorized") => new AppError(msg, 401),
  forbidden: (msg = "Forbidden") => new AppError(msg, 403),
  notFound: (msg = "Not found") => new AppError(msg, 404),
  conflict: (msg = "Conflict") => new AppError(msg, 409),
  tooMany: (msg = "Too many requests") => new AppError(msg, 429),
};
