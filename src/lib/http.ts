import type { Response } from 'express';
import { AppError } from './errors';

export function sendOk<T>(res: Response, data: T, meta?: Record<string, unknown>): Response {
  return res.status(200).json({ ok: true, data, meta });
}

export function sendCreated<T>(res: Response, data: T): Response {
  return res.status(201).json({ ok: true, data });
}

export function sendAppError(res: Response, error: unknown): Response {
  if (error instanceof AppError) {
    return res.status(error.httpStatus).json({
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details ?? null
      }
    });
  }

  return res.status(500).json({
    ok: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Unexpected server error',
      details: null
    }
  });
}
