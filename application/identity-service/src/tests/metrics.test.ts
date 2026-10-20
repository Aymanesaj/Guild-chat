
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

const app = buildApp();

afterAll(async () => {
  await app.close();
});

describe("Identity metrics endpoint", () => {
  it("returns valid Prometheus metrics", async () => {
    await app.ready();

    // Generate one HTTP request for the metrics plugin.
    const health = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(health.statusCode).toBe(200);

    // Ask the application for its metrics.
    const response = await app.inject({
      method: "GET",
      url: "/metrics",
    });

    expect(response.statusCode).toBe(200);

    // The response must not be normal JSON.
    expect(response.headers["content-type"]).toMatch(
      /text\/plain|application\/openmetrics-text/
    );

    // Verify the HTTP duration metric exists.
    expect(response.body).toContain(
      "http_request_duration_seconds"
    );

    console.log(response.body.slice(0, 1500));
  });
});
