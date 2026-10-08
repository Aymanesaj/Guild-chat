import { AppError } from "./app.error.js";

export class ForbiddenError extends AppError {
  constructor(message = "ForbiddenError") {
    super(message, 403);
  }
}
