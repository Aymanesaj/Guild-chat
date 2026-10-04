import { AppError } from "./app.error.js";

export class UnauthorizedError
  extends AppError {
  constructor(message = "Unauthorized") {
    super(message, 401);
  }
}