export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}
export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do that") {
    super(message, "FORBIDDEN", 403);
  }
}
export class NotFoundError extends AppError {
  constructor(what = "Record") {
    super(`${what} not found`, "NOT_FOUND", 404);
  }
}
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, "CONFLICT", 409);
  }
}
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, "VALIDATION", 422);
  }
}
