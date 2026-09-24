import { ApiError } from "./http";

/**
 * Backend endpoints the UI already uses but that don't exist yet. The UI stays
 * visible; using it shows which endpoint is missing. When an endpoint ships,
 * set its entry to null. See docs/frontend-backend-gaps.md.
 */
export const missingEndpoints = {
  // All three shipped in identity: GET /username/get, GET /username/available,
  // DELETE /me/avatar. Add an entry here when the UI needs an endpoint that doesn't exist yet.
};

export function isAvailable(feature) {
  return !missingEndpoints[feature];
}

/** Throws a readable "not available yet" error when the endpoint is missing. */
export function requireEndpoint(feature) {
  const needs = missingEndpoints[feature];
  if (needs) {
    throw new ApiError(`Not available yet: needs ${needs}`, 501, null);
  }
}
