import { timingSafeEqual } from "node:crypto";
import { status } from "@grpc/grpc-js";
import type { Metadata } from "@grpc/grpc-js";
import type { CallerService } from "../media/media-policy.js";

export class ServiceAuthenticationError extends Error {
  readonly code = status.UNAUTHENTICATED;

  constructor() {
    super("Invalid service credentials");
    this.name = "ServiceAuthenticationError";
  }
}

export function createServiceAuthenticator(
  identityToken: string,
  chatToken: string,
) {
  const tokenPattern = /^[a-f0-9]{64}$/;

  if (
    !tokenPattern.test(identityToken) ||
    !tokenPattern.test(chatToken)
  ) {
    throw new Error("Media service tokens must be 64 lowercase hex characters");
  }

  if (identityToken === chatToken) {
    throw new Error("Identity and Chat must use different Media tokens");
  }

  const identitySecret = Buffer.from(identityToken, "hex");
  const chatSecret = Buffer.from(chatToken, "hex");

  return function authenticateService(
    metadata: Metadata,
  ): CallerService {
    const values = metadata.get("authorization");

    if (values.length !== 1 || typeof values[0] !== "string") {
      throw new ServiceAuthenticationError();
    }

    const match = /^Bearer ([a-f0-9]{64})$/.exec(values[0]);

    if (!match?.[1]) {
      throw new ServiceAuthenticationError();
    }

    const provided = Buffer.from(match[1], "hex");

    // Both comparisons run, regardless of which token matches.
    const isIdentity = timingSafeEqual(provided, identitySecret);
    const isChat = timingSafeEqual(provided, chatSecret);

    if (isIdentity) {
      return "IDENTITY";
    }

    if (isChat) {
      return "CHAT";
    }

    throw new ServiceAuthenticationError();
  };
}