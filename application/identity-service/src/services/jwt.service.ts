import "dotenv/config";
import jwt from "jsonwebtoken";

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not defined`);
  }

  return value;
}

const JWT_SECRET = requiredEnv("JWT_SECRET");

const JWT_ISSUER = process.env.JWT_ISSUER ?? "ft-transcendence";

const JWT_TTL_SECONDS = Number(process.env.JWT_TTL_SECONDS ?? 900);

interface JwtUser {
  id: string;
  username: string;
  email: string;
}

export function issueAccessToken(user: JwtUser): string {
  return jwt.sign(
    {
      username: user.username,
      email: user.email,
    },
    JWT_SECRET,
    {
      algorithm: "HS256",
      issuer: JWT_ISSUER,
      subject: user.id,
      expiresIn: JWT_TTL_SECONDS,
    },
  );
}

export interface ValidatedAccessToken {
  userId: string;
  expiresAt: number;
}

export function validateAccessTokenDetails(
  token: string,
): ValidatedAccessToken | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
    });

    if (
      typeof payload === "string" ||
      typeof payload.sub !== "string" ||
      typeof payload.exp !== "number"
    ) {
      return null;
    }

    return {
      userId: payload.sub,
      expiresAt: payload.exp,
    };
  } catch {
    return null;
  }
}

export function validateAccessToken(token: string): string | null {
  return validateAccessTokenDetails(token)?.userId ?? null;
}
