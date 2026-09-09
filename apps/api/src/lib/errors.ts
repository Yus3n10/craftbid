import type { ApiErrorDto } from "@craftbid/shared";

/**
 * Every failure the API returns deliberately is an AppError. Anything else that
 * reaches the error handler is a bug and becomes a generic 500, so an
 * unexpected stack trace or driver message can never reach a client.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    if (fields) this.fields = fields;
  }

  toResponse(): ApiErrorDto {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.fields ? { fields: this.fields } : {}),
      },
    };
  }
}

export const badRequest = (
  message: string,
  fields?: Record<string, string>,
): AppError => new AppError(400, "bad_request", message, fields);

export const unauthorized = (message = "You need to sign in to do that."): AppError =>
  new AppError(401, "unauthorized", message);

export const forbidden = (message = "You do not have access to this."): AppError =>
  new AppError(403, "forbidden", message);

export const notFound = (message = "Not found."): AppError =>
  new AppError(404, "not_found", message);

export const conflict = (
  message: string,
  fields?: Record<string, string>,
): AppError => new AppError(409, "conflict", message, fields);

export const tooManyRequests = (message = "Too many attempts. Try again shortly."): AppError =>
  new AppError(429, "rate_limited", message);

/**
 * Used where revealing that a record exists would itself leak information.
 * Fetching someone else's application by id returns 404, not 403: a 403 would
 * confirm the id is real.
 */
export const hiddenResource = (): AppError => notFound();
