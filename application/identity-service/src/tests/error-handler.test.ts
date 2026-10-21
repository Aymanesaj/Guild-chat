
import {
  describe,
  expect,
  it,
} from "vitest";

import Fastify from "fastify";

import { registerErrorHandler } from
  "../plugins/error-handler.plugin.js";

function createTestApp() {
  const app = Fastify({ logger: false });

  registerErrorHandler(app);

  app.post("/test", async () => ({
    ok: true,
  }));

  app.get("/client-error", async () => {
    throw Object.assign(
      new Error("Request entity too large"),
      { statusCode: 413 },
    );
  });

  app.get("/server-error", async () => {
    throw new Error("Database password is secret");
  });

  return app;
}

describe("Identity error handler", () => {
  it("returns 400 for malformed JSON", async () => {
    const app = createTestApp();

    try {
      const response = await app.inject({
        method: "POST",
        url: "/test",
        headers: {
          "content-type": "application/json",
        },
        payload: '{"invalid":',
      });

      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("preserves framework client error status", async () => {
    const app = createTestApp();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/client-error",
      });

      expect(response.statusCode).toBe(413);
    } finally {
      await app.close();
    }
  });

  it("does not expose internal server errors", async () => {
    const app = createTestApp();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/server-error",
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        error: "Internal Server Error",
      });

      expect(response.body).not.toContain(
        "Database password is secret",
      );
    } finally {
      await app.close();
    }
  });
});
