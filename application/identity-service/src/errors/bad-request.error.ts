import { AppError } from "./app.error.js";

export class BadRequestError
  extends AppError {
  constructor(message = "Bad request") {
    super(message, 400);
  }
}