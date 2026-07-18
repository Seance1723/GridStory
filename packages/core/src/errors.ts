import type { ValidationIssue } from '@gridstory/schema';

export class GridStoryError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(message: string, code: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = 'GridStoryError';
    this.code = code;
    this.statusCode = statusCode;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export class NotFoundError extends GridStoryError {
  constructor(message = 'The requested resource was not found.') {
    super(message, 'not_found', 404);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends GridStoryError {
  constructor(message: string, details?: unknown) {
    super(message, 'revision_conflict', 409, details);
    this.name = 'ConflictError';
  }
}

export class ContentValidationError extends GridStoryError {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super('Content failed validation.', 'validation_failed', 422, { issues });
    this.name = 'ContentValidationError';
    this.issues = issues;
  }
}
