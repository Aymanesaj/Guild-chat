import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const {
  mockRegisterUser,
  mockLoginUser,
  mockRefreshSession,
  mockValidateAccessToken,
  mockGetCurrentUser,
} = vi.hoisted(() => ({
  mockRegisterUser: vi.fn(),
  mockLoginUser: vi.fn(),
  mockRefreshSession: vi.fn(),
  mockValidateAccessToken: vi.fn(),
  mockGetCurrentUser: vi.fn(),
}));

vi.mock("../services/auth.service.js", () => ({
  registerUser: mockRegisterUser,
  loginUser: mockLoginUser,
  refreshSession: mockRefreshSession,
}));

vi.mock("../services/jwt.service.js", () => ({
  validateAccessToken: mockValidateAccessToken,
}));

vi.mock("../services/user.service.js", () => ({
  getCurrentUser: mockGetCurrentUser,
}));

import { buildApp } from "../app.js";

const app = buildApp();

beforeEach(() => {
  mockRegisterUser.mockReset();
  mockLoginUser.mockReset();
  mockRefreshSession.mockReset();
  mockValidateAccessToken.mockReset();
  mockGetCurrentUser.mockReset();
});

afterAll(async () => {
  await app.close();
});


/* =========================================================
   REGISTER
   ========================================================= */

describe("POST /register", () => {
  it("should register a new user", async () => {
    mockRegisterUser.mockResolvedValue({
      tokenType: "Bearer",
      accessToken: "fake-access-token",
      refreshToken: "fake-refresh-token",

      user: {
        id: "123e4567-e89b-12d3-a456-426614174000",
        username: "obendaou",
        email: "oumaima@example.com",
        displayName: "Oumaima",
        bio: null,
        avatarUrl: null,
        authProvider: "LOCAL",
        createdAt: new Date(
          "2026-09-30T10:00:00.000Z"
        ),
        updatedAt: new Date(
          "2026-09-30T10:00:00.000Z"
        ),
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/register",

      payload: {
        username: "obendaou",
        email: "oumaima@example.com",
        password: "strongpassword123",
        displayName: "Oumaima",
      },
    });

    expect(response.statusCode).toBe(201);

    const body = response.json();

    expect(body.tokenType).toBe("Bearer");

    expect(body.accessToken).toBe(
      "fake-access-token"
    );

    expect(body.refreshToken).toBe(
      "fake-refresh-token"
    );

    expect(body.user.username).toBe(
      "obendaou"
    );

    expect(body.user.email).toBe(
      "oumaima@example.com"
    );
  });

  it("should return 400 when username is too short", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/register",

      payload: {
        username: "ab",
        email: "oumaima@example.com",
        password: "strongpassword123",
      },
    });

    expect(response.statusCode).toBe(400);

    expect(
      mockRegisterUser
    ).not.toHaveBeenCalled();
  });

  it("should return 400 when email is invalid", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/register",

      payload: {
        username: "obendaou",
        email: "not-an-email",
        password: "strongpassword123",
      },
    });

    expect(response.statusCode).toBe(400);

    expect(
      mockRegisterUser
    ).not.toHaveBeenCalled();
  });

  it("should return 400 when password is too short", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/register",

      payload: {
        username: "obendaou",
        email: "oumaima@example.com",
        password: "123",
      },
    });

    expect(response.statusCode).toBe(400);

    expect(
      mockRegisterUser
    ).not.toHaveBeenCalled();
  });

  it("should return 409 when username already exists", async () => {
    mockRegisterUser.mockRejectedValue(
      new Error("Username is already taken")
    );

    const response = await app.inject({
      method: "POST",
      url: "/register",

      payload: {
        username: "obendaou",
        email: "oumaima@example.com",
        password: "strongpassword123",
      },
    });

    expect(response.statusCode).toBe(409);

    const body = response.json();

    expect(body.error).toBe(
      "Username is already taken"
    );
  });

  it("should return 409 when email already exists", async () => {
    mockRegisterUser.mockRejectedValue(
      new Error("Email is already registered")
    );

    const response = await app.inject({
      method: "POST",
      url: "/register",

      payload: {
        username: "different_user",
        email: "oumaima@example.com",
        password: "strongpassword123",
      },
    });

    expect(response.statusCode).toBe(409);

    const body = response.json();

    expect(body.error).toBe(
      "Email is already registered"
    );
  });

  it("should not expose password hash", async () => {
    mockRegisterUser.mockResolvedValue({
      tokenType: "Bearer",
      accessToken: "fake-access-token",
      refreshToken: "fake-refresh-token",

      user: {
        id: "123e4567-e89b-12d3-a456-426614174000",
        username: "obendaou",
        email: "oumaima@example.com",
        displayName: "Oumaima",
        bio: null,
        avatarUrl: null,
        authProvider: "LOCAL",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/register",

      payload: {
        username: "obendaou",
        email: "oumaima@example.com",
        password: "strongpassword123",
      },
    });

    expect(response.statusCode).toBe(201);

    const body = response.json();

    expect(
      body.user.passwordHash
    ).toBeUndefined();

    expect(
      body.user.password
    ).toBeUndefined();
  });
});


/* =========================================================
   LOGIN
   ========================================================= */

describe("POST /login", () => {
  it("should login successfully with valid credentials", async () => {
    mockLoginUser.mockResolvedValue({
      tokenType: "Bearer",
      accessToken: "fake-access-token",
      refreshToken: "fake-refresh-token",

      user: {
        id: "123e4567-e89b-12d3-a456-426614174000",
        username: "obendaou",
        email: "oumaima@example.com",
        displayName: "Oumaima",
        bio: null,
        avatarUrl: null,
        authProvider: "LOCAL",
        createdAt: new Date(
          "2026-10-01T10:00:00.000Z"
        ),
        updatedAt: new Date(
          "2026-10-01T10:00:00.000Z"
        ),
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/login",

      payload: {
        identifier: "obendaou",
        password: "strongpassword123",
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.tokenType).toBe("Bearer");

    expect(body.accessToken).toBe(
      "fake-access-token"
    );

    expect(body.refreshToken).toBe(
      "fake-refresh-token"
    );

    expect(body.user.username).toBe(
      "obendaou"
    );

    expect(
      mockLoginUser
    ).toHaveBeenCalledOnce();

    expect(
      mockLoginUser
    ).toHaveBeenCalledWith({
      identifier: "obendaou",
      password: "strongpassword123",
    });
  });

  it("should accept an email as identifier", async () => {
    mockLoginUser.mockResolvedValue({
      tokenType: "Bearer",
      accessToken: "fake-access-token",
      refreshToken: "fake-refresh-token",

      user: {
        id: "123e4567-e89b-12d3-a456-426614174000",
        username: "obendaou",
        email: "oumaima@example.com",
        displayName: "Oumaima",
        bio: null,
        avatarUrl: null,
        authProvider: "LOCAL",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/login",

      payload: {
        identifier: "oumaima@example.com",
        password: "strongpassword123",
      },
    });

    expect(response.statusCode).toBe(200);

    expect(
      mockLoginUser
    ).toHaveBeenCalledWith({
      identifier: "oumaima@example.com",
      password: "strongpassword123",
    });
  });

  it("should return 400 when identifier is missing", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/login",

      payload: {
        password: "strongpassword123",
      },
    });

    expect(response.statusCode).toBe(400);

    expect(
      mockLoginUser
    ).not.toHaveBeenCalled();
  });

  it("should return 400 when password is missing", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/login",

      payload: {
        identifier: "obendaou",
      },
    });

    expect(response.statusCode).toBe(400);

    expect(
      mockLoginUser
    ).not.toHaveBeenCalled();
  });

  it("should return 401 for invalid credentials", async () => {
    mockLoginUser.mockRejectedValue(
      new Error("Invalid credentials")
    );

    const response = await app.inject({
      method: "POST",
      url: "/login",

      payload: {
        identifier: "obendaou",
        password: "wrongpassword",
      },
    });

    expect(response.statusCode).toBe(401);

    const body = response.json();

    expect(body.error).toBe(
      "Invalid credentials"
    );
  });

  it("should not expose the password hash", async () => {
    mockLoginUser.mockResolvedValue({
      tokenType: "Bearer",
      accessToken: "fake-access-token",
      refreshToken: "fake-refresh-token",

      user: {
        id: "123e4567-e89b-12d3-a456-426614174000",
        username: "obendaou",
        email: "oumaima@example.com",
        displayName: "Oumaima",
        bio: null,
        avatarUrl: null,
        authProvider: "LOCAL",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/login",

      payload: {
        identifier: "obendaou",
        password: "strongpassword123",
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(
      body.user.passwordHash
    ).toBeUndefined();

    expect(
      body.user.password
    ).toBeUndefined();
  });
});


/* =========================================================
   ME
   ========================================================= */

describe("GET /me", () => {
  const userId =
    "123e4567-e89b-12d3-a456-426614174000";

  const publicUser = {
    id: userId,
    username: "obendaou",
    email: "oumaima@example.com",
    displayName: "Oumaima",
    bio: null,
    avatarUrl: null,
    authProvider: "LOCAL",
    createdAt: new Date(
      "2026-10-01T10:00:00.000Z"
    ),
    updatedAt: new Date(
      "2026-10-01T10:00:00.000Z"
    ),
  };

  it("should return the authenticated user", async () => {
    mockValidateAccessToken.mockReturnValue(
      userId
    );

    mockGetCurrentUser.mockResolvedValue(
      publicUser
    );

    const response = await app.inject({
      method: "GET",
      url: "/me",

      headers: {
        authorization:
          "Bearer fake-access-token",
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.id).toBe(userId);

    expect(body.username).toBe(
      "obendaou"
    );

    expect(body.email).toBe(
      "oumaima@example.com"
    );

    expect(
      mockValidateAccessToken
    ).toHaveBeenCalledWith(
      "fake-access-token"
    );

    expect(
      mockGetCurrentUser
    ).toHaveBeenCalledWith(userId);
  });

  it("should return 401 when authorization header is missing", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/me",
    });

    expect(response.statusCode).toBe(401);

    expect(
      mockValidateAccessToken
    ).not.toHaveBeenCalled();

    expect(
      mockGetCurrentUser
    ).not.toHaveBeenCalled();
  });

  it("should return 401 when authorization scheme is invalid", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/me",

      headers: {
        authorization:
          "Basic fake-access-token",
      },
    });

    expect(response.statusCode).toBe(401);

    expect(
      mockValidateAccessToken
    ).not.toHaveBeenCalled();

    expect(
      mockGetCurrentUser
    ).not.toHaveBeenCalled();
  });

  it("should return 401 when access token is invalid", async () => {
    mockValidateAccessToken.mockReturnValue(
      null
    );

    const response = await app.inject({
      method: "GET",
      url: "/me",

      headers: {
        authorization:
          "Bearer invalid-token",
      },
    });

    expect(response.statusCode).toBe(401);

    expect(
      mockValidateAccessToken
    ).toHaveBeenCalledWith(
      "invalid-token"
    );

    expect(
      mockGetCurrentUser
    ).not.toHaveBeenCalled();
  });

  it("should return 404 when authenticated user no longer exists", async () => {
    mockValidateAccessToken.mockReturnValue(
      userId
    );

    mockGetCurrentUser.mockRejectedValue(
      new Error("User not found")
    );

    const response = await app.inject({
      method: "GET",
      url: "/me",

      headers: {
        authorization:
          "Bearer fake-access-token",
      },
    });

    expect(response.statusCode).toBe(404);

    const body = response.json();

    expect(body.error).toBe(
      "User not found"
    );
  });

  it("should not expose sensitive user fields", async () => {
    mockValidateAccessToken.mockReturnValue(
      userId
    );

    mockGetCurrentUser.mockResolvedValue(
      publicUser
    );

    const response = await app.inject({
      method: "GET",
      url: "/me",

      headers: {
        authorization:
          "Bearer fake-access-token",
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(
      body.passwordHash
    ).toBeUndefined();

    expect(
      body.oauthProviderId
    ).toBeUndefined();

    expect(
      body.password
    ).toBeUndefined();
  });

  describe("POST /auth/refresh", () => {
    const userId =
      "123e4567-e89b-12d3-a456-426614174000";

    it("should refresh the session successfully", async () => {
      mockRefreshSession.mockResolvedValue({
        tokenType: "Bearer",
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",

        user: {
          id: userId,
          username: "obendaou",
          email: "oumaima@example.com",
          displayName: "Oumaima",
          bio: null,
          avatarUrl: null,
          authProvider: "LOCAL",
          createdAt: new Date(
            "2026-10-02T10:00:00.000Z"
          ),
          updatedAt: new Date(
            "2026-10-02T10:00:00.000Z"
          ),
        },
      });

      const response = await app.inject({
        method: "POST",
        url: "/auth/refresh",

        payload: {
          refreshToken: "old-refresh-token",
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();

      expect(body.tokenType).toBe("Bearer");

      expect(body.accessToken).toBe(
        "new-access-token"
      );

      expect(body.refreshToken).toBe(
        "new-refresh-token"
      );

      expect(body.user.id).toBe(userId);

      expect(
        mockRefreshSession
      ).toHaveBeenCalledOnce();

      expect(
        mockRefreshSession
      ).toHaveBeenCalledWith({
        refreshToken: "old-refresh-token",
      });
    });

    it("should return 400 when refresh token is missing", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/refresh",

        payload: {},
      });

      expect(response.statusCode).toBe(400);

      expect(
        mockRefreshSession
      ).not.toHaveBeenCalled();
    });

    it("should return 400 when refresh token is empty", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/refresh",

        payload: {
          refreshToken: "   ",
        },
      });

      expect(response.statusCode).toBe(400);

      expect(
        mockRefreshSession
      ).not.toHaveBeenCalled();
    });

    it("should return 401 when refresh token is invalid", async () => {
      mockRefreshSession.mockRejectedValue(
        new Error("Invalid refresh token")
      );

      const response = await app.inject({
        method: "POST",
        url: "/auth/refresh",

        payload: {
          refreshToken: "invalid-token",
        },
      });

      expect(response.statusCode).toBe(401);

      const body = response.json();

      expect(body.error).toBe(
        "Invalid refresh token"
      );
    });

    it("should return 401 when refresh token is expired", async () => {
      mockRefreshSession.mockRejectedValue(
        new Error("Refresh token expired")
      );

      const response = await app.inject({
        method: "POST",
        url: "/auth/refresh",

        payload: {
          refreshToken: "expired-token",
        },
      });

      expect(response.statusCode).toBe(401);

      const body = response.json();

      expect(body.error).toBe(
        "Invalid refresh token"
      );
    });

    it("should return 401 when refresh token reuse is detected", async () => {
      mockRefreshSession.mockRejectedValue(
        new Error(
          "Refresh token reuse detected; sessions revoked"
        )
      );

      const response = await app.inject({
        method: "POST",
        url: "/auth/refresh",

        payload: {
          refreshToken: "already-used-token",
        },
      });

      expect(response.statusCode).toBe(401);

      const body = response.json();

      expect(body.error).toBe(
        "Invalid refresh token"
      );
    });

    it("should return a different refresh token after rotation", async () => {
      const oldRefreshToken =
        "old-refresh-token";

      mockRefreshSession.mockResolvedValue({
        tokenType: "Bearer",
        accessToken: "new-access-token",
        refreshToken: "rotated-refresh-token",

        user: {
          id: userId,
          username: "obendaou",
          email: "oumaima@example.com",
          displayName: "Oumaima",
          bio: null,
          avatarUrl: null,
          authProvider: "LOCAL",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const response = await app.inject({
        method: "POST",
        url: "/auth/refresh",

        payload: {
          refreshToken: oldRefreshToken,
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();

      expect(body.refreshToken).not.toBe(
        oldRefreshToken
      );

      expect(body.refreshToken).toBe(
        "rotated-refresh-token"
      );
    });
  });
});