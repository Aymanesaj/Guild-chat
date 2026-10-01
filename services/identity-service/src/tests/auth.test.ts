import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRegisterUser,
  mockLoginUser,
} = vi.hoisted(() => ({
  mockRegisterUser: vi.fn(),
  mockLoginUser: vi.fn(),
}));

vi.mock("../services/auth.service.js", () => ({
  registerUser: mockRegisterUser,
  loginUser: mockLoginUser,
}));


import { buildApp } from "../app.js";

const app = buildApp();

describe("POST /register", () => {
    beforeEach(() => {
    mockRegisterUser.mockReset();
    mockLoginUser.mockReset();
    });

  afterAll(async () => {
    await app.close();
  });

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
        createdAt: new Date("2026-09-30T10:00:00.000Z"),
        updatedAt: new Date("2026-09-30T10:00:00.000Z"),
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

    expect(mockRegisterUser).not.toHaveBeenCalled();
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

    expect(mockRegisterUser).not.toHaveBeenCalled();
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

    expect(mockRegisterUser).not.toHaveBeenCalled();
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

    expect(body.user.passwordHash).toBeUndefined();
    expect(body.user.password).toBeUndefined();
  });

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

    expect(mockLoginUser).toHaveBeenCalledOnce();

    expect(mockLoginUser).toHaveBeenCalledWith({
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

    expect(mockLoginUser).toHaveBeenCalledWith({
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

});