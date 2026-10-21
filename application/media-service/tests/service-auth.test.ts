import { Metadata } from "@grpc/grpc-js";
import { describe, expect, it } from "vitest";
import {
  createServiceAuthenticator,
  ServiceAuthenticationError,
} from "../src/grpc/service-auth.js";

// Fixed test fixtures only. Never use these as real credentials.
const identityToken = "a".repeat(64);
const chatToken = "b".repeat(64);

const authenticate = createServiceAuthenticator(
  identityToken,
  chatToken,
);

function authorization(value: string) {
  const metadata = new Metadata();
  metadata.set("authorization", value);
  return metadata;
}

describe("service authentication", () => {
  it("identifies Identity", () => {
    expect(
      authenticate(authorization(`Bearer ${identityToken}`)),
    ).toBe("IDENTITY");
  });

  it("identifies Chat", () => {
    expect(
      authenticate(authorization(`Bearer ${chatToken}`)),
    ).toBe("CHAT");
  });

  it("rejects missing credentials", () => {
    expect(() => authenticate(new Metadata())).toThrow(
      ServiceAuthenticationError,
    );
  });

  it("rejects an unknown token", () => {
    expect(() =>
      authenticate(authorization(`Bearer ${"c".repeat(64)}`)),
    ).toThrow(ServiceAuthenticationError);
  });

  it("rejects malformed credentials", () => {
    expect(() =>
      authenticate(authorization("Bearer short-token")),
    ).toThrow(ServiceAuthenticationError);
  });

  it("rejects duplicate authorization values", () => {
    const metadata = authorization(`Bearer ${identityToken}`);
    metadata.add("authorization", `Bearer ${chatToken}`);

    expect(() => authenticate(metadata)).toThrow(
      ServiceAuthenticationError,
    );
  });

  it("rejects shared tokens during setup", () => {
    expect(() =>
      createServiceAuthenticator(identityToken, identityToken),
    ).toThrow("must use different");
  });

  it("rejects empty tokens during setup", () => {
    expect(() =>
      createServiceAuthenticator("", chatToken),
    ).toThrow("64 lowercase hex");
  });
});