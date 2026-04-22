export class AppError extends Error {
  public readonly code: string;
  public readonly httpStatus: number;
  public readonly details?: unknown;

  constructor(code: string, httpStatus: number, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export const errorFactory = {
  unauthorized: (message = 'Unauthorized') =>
    new AppError('UNAUTHORIZED', 401, message),
  forbidden: (message = 'Forbidden', details?: unknown) =>
    new AppError('FORBIDDEN', 403, message, details),
  badRequest: (code: string, message: string, details?: unknown) =>
    new AppError(code, 400, message, details),
  notFound: (code: string, message: string, details?: unknown) =>
    new AppError(code, 404, message, details),
  conflict: (code: string, message: string, details?: unknown) =>
    new AppError(code, 409, message, details),
  unprocessable: (code: string, message: string, details?: unknown) =>
    new AppError(code, 422, message, details),
  internal: (message = 'Internal Server Error') =>
    new AppError('INTERNAL_ERROR', 500, message)
};
