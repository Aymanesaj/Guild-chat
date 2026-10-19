import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  ConflictError,
} from "../errors/conflict.error.js";

import {
  UnauthorizedError,
} from "../errors/unauthorized.error.js";

import {
  NotFoundError,
} from "../errors/not-found.error.js";


/* =========================================================
   MOCKS
   ========================================================= */

const {
  mockRegisterUser,
  mockLoginUser,
  mockRefreshSession,
  mockLogoutSession,
  mockValidateAccessToken,
  mockGetCurrentUser,
  mockUpdateCurrentUser,
  mockSaveAvatar,
  mockGetUserById,
  mockLogoutAllSessions,
} = vi.hoisted(() => ({
  mockRegisterUser: vi.fn(),
  mockLoginUser: vi.fn(),
  mockRefreshSession: vi.fn(),
  mockLogoutSession: vi.fn(),
  mockValidateAccessToken: vi.fn(),
  mockGetCurrentUser: vi.fn(),
  mockUpdateCurrentUser: vi.fn(),
  mockSaveAvatar: vi.fn(),
  mockGetUserById: vi.fn(),
  mockLogoutAllSessions: vi.fn(),
}));


vi.mock("../services/auth.service.js", () => ({
  registerUser: mockRegisterUser,
  loginUser: mockLoginUser,
  refreshSession: mockRefreshSession,
  logoutSession: mockLogoutSession,
  logoutAllSessions: mockLogoutAllSessions,
}));


vi.mock("../services/jwt.service.js", () => ({
  validateAccessToken:
    mockValidateAccessToken,
}));


vi.mock("../services/user.service.js", () => ({
  getCurrentUser: mockGetCurrentUser,
  updateCurrentUser: mockUpdateCurrentUser,
  getUserById: mockGetUserById,
}));

vi.mock(
  "../services/avatar.service.js",
  () => ({
    saveAvatar: mockSaveAvatar,
  })
);

import { buildApp } from "../app.js";

const app = buildApp();


/* =========================================================
   SHARED DATA
   ========================================================= */

const userId =
  "123e4567-e89b-12d3-a456-426614174000";


function createPublicUser() {
  return {
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
}


function createAuthResponse() {
  return {
    tokenType: "Bearer",
    accessToken: "fake-access-token",
    refreshToken: "fake-refresh-token",
    user: createPublicUser(),
  };
}


/* =========================================================
   SETUP
   ========================================================= */

beforeEach(() => {
  mockRegisterUser.mockReset();
  mockLoginUser.mockReset();
  mockRefreshSession.mockReset();
  mockLogoutSession.mockReset();
  mockValidateAccessToken.mockReset();
  mockGetCurrentUser.mockReset();
  mockUpdateCurrentUser.mockReset();
  mockSaveAvatar.mockReset();
  mockGetUserById.mockReset();
  mockLogoutAllSessions.mockReset();
});


function createMultipartFile(
  filename: string,
  mimetype: string,
  content: Buffer
) {
  const boundary =
    "----avatar-test-boundary";

  const start = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="avatar"; filename="${filename}"\r\n` +
      `Content-Type: ${mimetype}\r\n` +
      `\r\n`
  );

  const end = Buffer.from(
    `\r\n--${boundary}--\r\n`
  );

  return {
    body: Buffer.concat([
      start,
      content,
      end,
    ]),

    contentType:
      `multipart/form-data; boundary=${boundary}`,
  };
}


afterAll(async () => {
  await app.close();
});

describe(
  "GET /:id",
  () => {
    const authenticatedUserId =
      "123e4567-e89b-12d3-a456-426614174000";

    const targetUserId =
      "223e4567-e89b-12d3-a456-426614174000";

    const publicUser = {
      id: targetUserId,
      username: "sara",
      email: "sara@example.com",
      displayName: "Sara",
      bio: "Hello there",
      avatarUrl:
        "/avatars/sara.png",
      authProvider: "LOCAL",

      createdAt: new Date(
        "2026-10-01T10:00:00.000Z"
      ),

      updatedAt: new Date(
        "2026-10-02T10:00:00.000Z"
      ),
    };


    it(
      "should return another user by id",
      async () => {
        mockValidateAccessToken
          .mockReturnValue(
            authenticatedUserId
          );

        mockGetUserById
          .mockResolvedValue(
            publicUser
          );


        const response =
          await app.inject({
            method: "GET",

            url:
              `/${targetUserId}`,

            headers: {
              authorization:
                "Bearer fake-access-token",
            },
          });


        expect(
          response.statusCode
        ).toBe(200);


        const body =
          response.json();


        expect(body.id).toBe(
          targetUserId
        );

        expect(body.username).toBe(
          "sara"
        );

        expect(body.email).toBe(
          "sara@example.com"
        );

        expect(
          body.displayName
        ).toBe("Sara");

        expect(body.bio).toBe(
          "Hello there"
        );

        expect(
          body.avatarUrl
        ).toBe(
          "/avatars/sara.png"
        );


        expect(
          mockGetUserById
        ).toHaveBeenCalledWith(
          targetUserId
        );

        expect(
          mockGetUserById
        ).toHaveBeenCalledOnce();
      }
    );


    it(
      "should use the requested user id, not the authenticated user's id",
      async () => {
        mockValidateAccessToken
          .mockReturnValue(
            authenticatedUserId
          );

        mockGetUserById
          .mockResolvedValue(
            publicUser
          );


        await app.inject({
          method: "GET",

          url:
            `/${targetUserId}`,

          headers: {
            authorization:
              "Bearer fake-access-token",
          },
        });


        expect(
          mockGetUserById
        ).toHaveBeenCalledWith(
          targetUserId
        );

        expect(
          mockGetUserById
        ).not.toHaveBeenCalledWith(
          authenticatedUserId
        );
      }
    );


    it(
      "should allow a user to request their own profile",
      async () => {
        const ownUser = {
          ...publicUser,

          id:
            authenticatedUserId,
        };


        mockValidateAccessToken
          .mockReturnValue(
            authenticatedUserId
          );

        mockGetUserById
          .mockResolvedValue(
            ownUser
          );


        const response =
          await app.inject({
            method: "GET",

            url:
              `/${authenticatedUserId}`,

            headers: {
              authorization:
                "Bearer fake-access-token",
            },
          });


        expect(
          response.statusCode
        ).toBe(200);

        expect(
          response.json().id
        ).toBe(
          authenticatedUserId
        );
      }
    );


    it(
      "should preserve nullable public profile fields",
      async () => {
        mockValidateAccessToken
          .mockReturnValue(
            authenticatedUserId
          );

        mockGetUserById
          .mockResolvedValue({
            ...publicUser,

            displayName: null,
            bio: null,
            avatarUrl: null,
          });


        const response =
          await app.inject({
            method: "GET",

            url:
              `/${targetUserId}`,

            headers: {
              authorization:
                "Bearer fake-access-token",
            },
          });


        expect(
          response.statusCode
        ).toBe(200);


        const body =
          response.json();


        expect(
          body.displayName
        ).toBeNull();

        expect(
          body.bio
        ).toBeNull();

        expect(
          body.avatarUrl
        ).toBeNull();
      }
    );


    it(
      "should never expose sensitive user fields",
      async () => {
        mockValidateAccessToken
          .mockReturnValue(
            authenticatedUserId
          );

        mockGetUserById
          .mockResolvedValue(
            publicUser
          );


        const response =
          await app.inject({
            method: "GET",

            url:
              `/${targetUserId}`,

            headers: {
              authorization:
                "Bearer fake-access-token",
            },
          });


        expect(
          response.statusCode
        ).toBe(200);


        const body =
          response.json();


        expect(
          body.passwordHash
        ).toBeUndefined();

        expect(
          body.password
        ).toBeUndefined();

        expect(
          body.oauthProviderId
        ).toBeUndefined();
      }
    );


    it(
      "should return 401 without an access token",
      async () => {
        const response =
          await app.inject({
            method: "GET",

            url:
              `/${targetUserId}`,
          });


        expect(
          response.statusCode
        ).toBe(401);

        expect(
          mockGetUserById
        ).not.toHaveBeenCalled();
      }
    );


    it(
      "should return 401 for an invalid access token",
      async () => {
        mockValidateAccessToken
          .mockReturnValue(null);


        const response =
          await app.inject({
            method: "GET",

            url:
              `/${targetUserId}`,

            headers: {
              authorization:
                "Bearer invalid-token",
            },
          });


        expect(
          response.statusCode
        ).toBe(401);

        expect(
          mockGetUserById
        ).not.toHaveBeenCalled();
      }
    );


    it(
      "should return 400 for an invalid user id",
      async () => {
        mockValidateAccessToken
          .mockReturnValue(
            authenticatedUserId
          );


        const response =
          await app.inject({
            method: "GET",

            url:
              "/not-a-uuid",

            headers: {
              authorization:
                "Bearer fake-access-token",
            },
          });


        expect(
          response.statusCode
        ).toBe(400);


        expect(
          response.json().error
        ).toBe(
          "Invalid user id"
        );


        expect(
          mockGetUserById
        ).not.toHaveBeenCalled();
      }
    );


    it(
      "should authenticate before processing the user id",
      async () => {
        const response =
          await app.inject({
            method: "GET",

            url:
              "/not-a-uuid",
          });


        /*
         * Authentication runs as
         * preHandler before the
         * controller validates :id.
         */
        expect(
          response.statusCode
        ).toBe(401);


        expect(
          mockGetUserById
        ).not.toHaveBeenCalled();
      }
    );


    it(
      "should return 404 when the user does not exist",
      async () => {
        mockValidateAccessToken
          .mockReturnValue(
            authenticatedUserId
          );


        mockGetUserById
          .mockRejectedValue(
            new NotFoundError(
              "User not found"
            )
          );


        const response =
          await app.inject({
            method: "GET",

            url:
              `/${targetUserId}`,

            headers: {
              authorization:
                "Bearer fake-access-token",
            },
          });


        expect(
          response.statusCode
        ).toBe(404);


        expect(
          response.json().error
        ).toBe(
          "User not found"
        );
      }
    );


    it(
      "should hide unexpected internal errors",
      async () => {
        mockValidateAccessToken
          .mockReturnValue(
            authenticatedUserId
          );


        mockGetUserById
          .mockRejectedValue(
            new Error(
              "Database connection exploded"
            )
          );


        const response =
          await app.inject({
            method: "GET",

            url:
              `/${targetUserId}`,

            headers: {
              authorization:
                "Bearer fake-access-token",
            },
          });


        expect(
          response.statusCode
        ).toBe(500);


        expect(
          response.json().error
        ).toBe(
          "Internal Server Error"
        );


        expect(
          response.body
        ).not.toContain(
          "Database connection exploded"
        );
      }
    );
  }
);

describe("POST /auth/logout-all", () => {
  const userId =
    "123e4567-e89b-12d3-a456-426614174000";

  it("should logout all sessions successfully", async () => {
    mockValidateAccessToken.mockReturnValue(
      userId
    );

    mockLogoutAllSessions.mockResolvedValue(
      undefined
    );

    const response = await app.inject({
      method: "POST",
      url: "/auth/logout-all",

      headers: {
        authorization:
          "Bearer fake-access-token",
      },
    });

    expect(response.statusCode).toBe(204);

    expect(
      mockValidateAccessToken
    ).toHaveBeenCalledWith(
      "fake-access-token"
    );

    expect(
      mockLogoutAllSessions
    ).toHaveBeenCalledOnce();

    expect(
      mockLogoutAllSessions
    ).toHaveBeenCalledWith(
      userId
    );
  });

  it("should return 401 when authorization header is missing", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/logout-all",
    });

    expect(response.statusCode).toBe(401);

    expect(
      mockValidateAccessToken
    ).not.toHaveBeenCalled();

    expect(
      mockLogoutAllSessions
    ).not.toHaveBeenCalled();
  });

  it("should return 401 when access token is invalid", async () => {
    mockValidateAccessToken.mockReturnValue(
      null
    );

    const response = await app.inject({
      method: "POST",
      url: "/auth/logout-all",

      headers: {
        authorization:
          "Bearer invalid-access-token",
      },
    });

    expect(response.statusCode).toBe(401);

    expect(
      mockValidateAccessToken
    ).toHaveBeenCalledWith(
      "invalid-access-token"
    );

    expect(
      mockLogoutAllSessions
    ).not.toHaveBeenCalled();
  });

  it("should return 401 when authorization scheme is invalid", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/logout-all",

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
      mockLogoutAllSessions
    ).not.toHaveBeenCalled();
  });

  it("should return 500 when logout all sessions fails unexpectedly", async () => {
    mockValidateAccessToken.mockReturnValue(
      userId
    );

    mockLogoutAllSessions.mockRejectedValue(
      new Error("Database failure")
    );

    const response = await app.inject({
      method: "POST",
      url: "/auth/logout-all",

      headers: {
        authorization:
          "Bearer fake-access-token",
      },
    });

    expect(response.statusCode).toBe(500);

    expect(
      mockLogoutAllSessions
    ).toHaveBeenCalledWith(
      userId
    );
  });
});

/* =========================================================
   REGISTER
   ========================================================= */
describe("POST /register", () => {
  it("should register a new user", async () => {
    mockRegisterUser.mockResolvedValue(
      createAuthResponse()
    );

    const response = await app.inject({
      method: "POST",
      url: "/register",

      payload: {
        username: "obendaou",
        email: "oumaima@example.com",
        password: "Strongpassword123",
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

    expect(
      mockRegisterUser
    ).toHaveBeenCalledOnce();
  });

  it(
    "should return 400 when password has no uppercase letter",
    async () => {
      const response = await app.inject({
        method: "POST",
        url: "/register",

        payload: {
          username: "obendaou",
          email: "oumaima@example.com",
          password: "password123",
        },
      });

      expect(response.statusCode).toBe(400);

      expect(
        mockRegisterUser
      ).not.toHaveBeenCalled();
    }
  );

  it(
    "should return 400 when password has no lowercase letter",
    async () => {
      const response = await app.inject({
        method: "POST",
        url: "/register",

        payload: {
          username: "obendaou",
          email: "oumaima@example.com",
          password: "PASSWORD123",
        },
      });

      expect(response.statusCode).toBe(400);

      expect(
        mockRegisterUser
      ).not.toHaveBeenCalled();
    }
  );

  it(
    "should return 400 when password has no number",
    async () => {
      const response = await app.inject({
        method: "POST",
        url: "/register",

        payload: {
          username: "obendaou",
          email: "oumaima@example.com",
          password: "PasswordABC",
        },
      });

      expect(response.statusCode).toBe(400);

      expect(
        mockRegisterUser
      ).not.toHaveBeenCalled();
    }
  );
  it("should return 400 when username is too short", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/register",

      payload: {
        username: "ab",
        email: "oumaima@example.com",
        password: "Strongpassword123",
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
        password: "Strongpassword123",
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
      new ConflictError(
        "Username is already taken"
      )
    );

    const response = await app.inject({
      method: "POST",
      url: "/register",

      payload: {
        username: "obendaou",
        email: "oumaima@example.com",
        password: "Strongpassword123",
      },
    });

    expect(response.statusCode).toBe(409);

    const body = response.json();

    expect(body.error).toBe(
      "Username is already taken"
    );
  });

  it(
    "should accept a password meeting all complexity requirements",
    async () => {
      mockRegisterUser.mockResolvedValue(
        createAuthResponse()
      );

      const response = await app.inject({
        method: "POST",
        url: "/register",

        payload: {
          username: "obendaou",
          email: "oumaima@example.com",
          password: "Password1",
        },
      });

      expect(response.statusCode).toBe(201);

      expect(
        mockRegisterUser
      ).toHaveBeenCalledOnce();
    }
  );


  it("should return 409 when email already exists", async () => {
    mockRegisterUser.mockRejectedValue(
      new ConflictError(
        "Email is already registered"
      )
    );

    const response = await app.inject({
      method: "POST",
      url: "/register",

      payload: {
        username: "different_user",
        email: "oumaima@example.com",
        password: "Strongpassword123",
      },
    });

    expect(response.statusCode).toBe(409);

    const body = response.json();

    expect(body.error).toBe(
      "Email is already registered"
    );
  });


  it("should not expose password hash", async () => {
    mockRegisterUser.mockResolvedValue(
      createAuthResponse()
    );

    const response = await app.inject({
      method: "POST",
      url: "/register",

      payload: {
        username: "obendaou",
        email: "oumaima@example.com",
        password: "Strongpassword123",
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
    mockLoginUser.mockResolvedValue(
      createAuthResponse()
    );

    const response = await app.inject({
      method: "POST",
      url: "/login",

      payload: {
        identifier: "obendaou",
        password: "Strongpassword123",
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
      password: "Strongpassword123",
    });
  });


  it("should accept an email as identifier", async () => {
    mockLoginUser.mockResolvedValue(
      createAuthResponse()
    );

    const response = await app.inject({
      method: "POST",
      url: "/login",

      payload: {
        identifier: "oumaima@example.com",
        password: "Strongpassword123",
      },
    });

    expect(response.statusCode).toBe(200);

    expect(
      mockLoginUser
    ).toHaveBeenCalledWith({
      identifier: "oumaima@example.com",
      password: "Strongpassword123",
    });
  });


  it("should return 400 when identifier is missing", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/login",

      payload: {
        password: "Strongpassword123",
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
      new UnauthorizedError(
        "Invalid credentials"
      )
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


  it("should not expose password hash", async () => {
    mockLoginUser.mockResolvedValue(
      createAuthResponse()
    );

    const response = await app.inject({
      method: "POST",
      url: "/login",

      payload: {
        identifier: "obendaou",
        password: "Strongpassword123",
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
   GET /ME
   ========================================================= */

describe("GET /me", () => {
  it("should return authenticated user", async () => {
    mockValidateAccessToken.mockReturnValue(
      userId
    );

    mockGetCurrentUser.mockResolvedValue(
      createPublicUser()
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
    ).toHaveBeenCalledWith(
      userId
    );
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
      new NotFoundError(
        "User not found"
      )
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
      createPublicUser()
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
});

describe("PUT /me", () => {
  const updatedUser = {
    id: userId,
    username: "obendaou",
    email: "oumaima@example.com",
    displayName: "Oumaima B",
    bio: "Software engineering student",
    avatarUrl: null,
    authProvider: "LOCAL",
    createdAt: new Date(
      "2026-10-01T10:00:00.000Z"
    ),
    updatedAt: new Date(
      "2026-10-03T10:00:00.000Z"
    ),
  };


  it("should update the authenticated user's profile", async () => {
    mockValidateAccessToken.mockReturnValue(
      userId
    );

    mockUpdateCurrentUser.mockResolvedValue(
      updatedUser
    );

    const response = await app.inject({
      method: "PUT",
      url: "/me",

      headers: {
        authorization:
          "Bearer fake-access-token",
      },

      payload: {
        displayName: "Oumaima B",
        bio: "Software engineering student",
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.displayName).toBe(
      "Oumaima B"
    );

    expect(body.bio).toBe(
      "Software engineering student"
    );

    expect(
      mockUpdateCurrentUser
    ).toHaveBeenCalledWith(
      userId,
      {
        displayName: "Oumaima B",
        bio: "Software engineering student",
      }
    );
  });


  it("should update the username", async () => {
    mockValidateAccessToken.mockReturnValue(
      userId
    );

    mockUpdateCurrentUser.mockResolvedValue({
      ...updatedUser,
      username: "oumaima_dev",
    });

    const response = await app.inject({
      method: "PUT",
      url: "/me",

      headers: {
        authorization:
          "Bearer fake-access-token",
      },

      payload: {
        username: "oumaima_dev",
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.username).toBe(
      "oumaima_dev"
    );

    expect(
      mockUpdateCurrentUser
    ).toHaveBeenCalledWith(
      userId,
      {
        username: "oumaima_dev",
      }
    );
  });


  it("should allow bio to be cleared with null", async () => {
    mockValidateAccessToken.mockReturnValue(
      userId
    );

    mockUpdateCurrentUser.mockResolvedValue({
      ...updatedUser,
      bio: null,
    });

    const response = await app.inject({
      method: "PUT",
      url: "/me",

      headers: {
        authorization:
          "Bearer fake-access-token",
      },

      payload: {
        bio: null,
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.bio).toBeNull();

    expect(
      mockUpdateCurrentUser
    ).toHaveBeenCalledWith(
      userId,
      {
        bio: null,
      }
    );
  });


  it("should return 401 when authorization header is missing", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/me",

      payload: {
        displayName: "Oumaima B",
      },
    });

    expect(response.statusCode).toBe(401);

    expect(
      mockUpdateCurrentUser
    ).not.toHaveBeenCalled();
  });


  it("should return 401 when access token is invalid", async () => {
    mockValidateAccessToken.mockReturnValue(
      null
    );

    const response = await app.inject({
      method: "PUT",
      url: "/me",

      headers: {
        authorization:
          "Bearer invalid-token",
      },

      payload: {
        displayName: "Oumaima B",
      },
    });

    expect(response.statusCode).toBe(401);

    expect(
      mockUpdateCurrentUser
    ).not.toHaveBeenCalled();
  });


  it("should return 400 when body is empty", async () => {
    mockValidateAccessToken.mockReturnValue(
      userId
    );

    const response = await app.inject({
      method: "PUT",
      url: "/me",

      headers: {
        authorization:
          "Bearer fake-access-token",
      },

      payload: {},
    });

    expect(response.statusCode).toBe(400);

    expect(
      mockUpdateCurrentUser
    ).not.toHaveBeenCalled();
  });


  it("should return 400 when username is too short", async () => {
    mockValidateAccessToken.mockReturnValue(
      userId
    );

    const response = await app.inject({
      method: "PUT",
      url: "/me",

      headers: {
        authorization:
          "Bearer fake-access-token",
      },

      payload: {
        username: "ab",
      },
    });

    expect(response.statusCode).toBe(400);

    expect(
      mockUpdateCurrentUser
    ).not.toHaveBeenCalled();
  });


  it("should return 400 when username contains invalid characters", async () => {
    mockValidateAccessToken.mockReturnValue(
      userId
    );

    const response = await app.inject({
      method: "PUT",
      url: "/me",

      headers: {
        authorization:
          "Bearer fake-access-token",
      },

      payload: {
        username: "oumaima@dev",
      },
    });

    expect(response.statusCode).toBe(400);

    expect(
      mockUpdateCurrentUser
    ).not.toHaveBeenCalled();
  });


  it("should return 400 when display name is too long", async () => {
    mockValidateAccessToken.mockReturnValue(
      userId
    );

    const response = await app.inject({
      method: "PUT",
      url: "/me",

      headers: {
        authorization:
          "Bearer fake-access-token",
      },

      payload: {
        displayName: "a".repeat(81),
      },
    });

    expect(response.statusCode).toBe(400);

    expect(
      mockUpdateCurrentUser
    ).not.toHaveBeenCalled();
  });


  it("should return 400 when bio is too long", async () => {
    mockValidateAccessToken.mockReturnValue(
      userId
    );

    const response = await app.inject({
      method: "PUT",
      url: "/me",

      headers: {
        authorization:
          "Bearer fake-access-token",
      },

      payload: {
        bio: "a".repeat(281),
      },
    });

    expect(response.statusCode).toBe(400);

    expect(
      mockUpdateCurrentUser
    ).not.toHaveBeenCalled();
  });


  it("should return 409 when username is already taken", async () => {
    mockValidateAccessToken.mockReturnValue(
      userId
    );

    mockUpdateCurrentUser.mockRejectedValue(
      new ConflictError(
        "Username is already taken"
      )
    );

    const response = await app.inject({
      method: "PUT",
      url: "/me",

      headers: {
        authorization:
          "Bearer fake-access-token",
      },

      payload: {
        username: "existing_user",
      },
    });

    expect(response.statusCode).toBe(409);

    const body = response.json();

    expect(body.error).toBe(
      "Username is already taken"
    );
  });


  it("should return 404 when user no longer exists", async () => {
    mockValidateAccessToken.mockReturnValue(
      userId
    );

    mockUpdateCurrentUser.mockRejectedValue(
      new NotFoundError(
        "User not found"
      )
    );

    const response = await app.inject({
      method: "PUT",
      url: "/me",

      headers: {
        authorization:
          "Bearer fake-access-token",
      },

      payload: {
        displayName: "New Name",
      },
    });

    expect(response.statusCode).toBe(404);

    const body = response.json();

    expect(body.error).toBe(
      "User not found"
    );
  });


  it("should not expose sensitive fields", async () => {
    mockValidateAccessToken.mockReturnValue(
      userId
    );

    mockUpdateCurrentUser.mockResolvedValue(
      updatedUser
    );

    const response = await app.inject({
      method: "PUT",
      url: "/me",

      headers: {
        authorization:
          "Bearer fake-access-token",
      },

      payload: {
        displayName: "Oumaima B",
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(
      body.passwordHash
    ).toBeUndefined();

    expect(
      body.password
    ).toBeUndefined();

    expect(
      body.oauthProviderId
    ).toBeUndefined();
  });
});


/* =========================================================
   REFRESH
   ========================================================= */

describe("POST /auth/refresh", () => {
  it("should refresh session successfully", async () => {
    mockRefreshSession.mockResolvedValue({
      tokenType: "Bearer",
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      user: createPublicUser(),
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/refresh",

      payload: {
        refreshToken:
          "old-refresh-token",
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

    expect(
      mockRefreshSession
    ).toHaveBeenCalledWith({
      refreshToken:
        "old-refresh-token",
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
      new UnauthorizedError(
        "Invalid refresh token"
      )
    );

    const response = await app.inject({
      method: "POST",
      url: "/auth/refresh",

      payload: {
        refreshToken:
          "invalid-token",
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
      new UnauthorizedError(
        "Refresh token expired"
      )
    );

    const response = await app.inject({
      method: "POST",
      url: "/auth/refresh",

      payload: {
        refreshToken:
          "expired-token",
      },
    });

    expect(response.statusCode).toBe(401);

    const body = response.json();

    expect(body.error).toBe(
      "Refresh token expired"
    );
  });


  it("should return 401 when refresh token reuse is detected", async () => {
    mockRefreshSession.mockRejectedValue(
      new UnauthorizedError(
        "Refresh token reuse detected; sessions revoked"
      )
    );

    const response = await app.inject({
      method: "POST",
      url: "/auth/refresh",

      payload: {
        refreshToken:
          "already-used-token",
      },
    });

    expect(response.statusCode).toBe(401);

    const body = response.json();

    expect(body.error).toBe(
      "Refresh token reuse detected; sessions revoked"
    );
  });


  it("should return a different refresh token after rotation", async () => {
    const oldRefreshToken =
      "old-refresh-token";

    mockRefreshSession.mockResolvedValue({
      tokenType: "Bearer",
      accessToken: "new-access-token",
      refreshToken:
        "rotated-refresh-token",
      user: createPublicUser(),
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/refresh",

      payload: {
        refreshToken:
          oldRefreshToken,
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(
      body.refreshToken
    ).not.toBe(
      oldRefreshToken
    );

    expect(
      body.refreshToken
    ).toBe(
      "rotated-refresh-token"
    );
  });
});


/* =========================================================
   LOGOUT
   ========================================================= */

describe("POST /auth/logout", () => {
  it("should logout successfully", async () => {
    mockLogoutSession.mockResolvedValue(
      undefined
    );

    const response = await app.inject({
      method: "POST",
      url: "/auth/logout",

      payload: {
        refreshToken:
          "fake-refresh-token",
      },
    });

    expect(response.statusCode).toBe(204);

    expect(
      mockLogoutSession
    ).toHaveBeenCalledOnce();

    expect(
      mockLogoutSession
    ).toHaveBeenCalledWith({
      refreshToken:
        "fake-refresh-token",
    });
  });


  it("should return 400 when refresh token is missing", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/logout",

      payload: {},
    });

    expect(response.statusCode).toBe(400);

    expect(
      mockLogoutSession
    ).not.toHaveBeenCalled();
  });
});

describe(
  "POST /me/avatar",
  () => {
    it(
      "should upload an avatar",
      async () => {
        mockValidateAccessToken
          .mockReturnValue(userId);

        mockSaveAvatar
          .mockResolvedValue({
            ...createPublicUser(),

            avatarUrl:
              "/avatars/avatar-test.png",
          });

        const multipart =
          createMultipartFile(
            "avatar.png",
            "image/png",
            Buffer.from([
              0x89,
              0x50,
              0x4e,
              0x47,
            ])
          );

        const response =
          await app.inject({
            method: "POST",

            url:
              "/me/avatar",

            headers: {
              authorization:
                "Bearer fake-access-token",

              "content-type":
                multipart.contentType,
            },

            payload:
              multipart.body,
          });

        expect(
          response.statusCode
        ).toBe(200);

        const body =
          response.json();

        expect(
          body.avatarUrl
        ).toBe(
          "/avatars/avatar-test.png"
        );

        expect(
          mockSaveAvatar
        ).toHaveBeenCalledOnce();

        const [
          receivedUserId,
          file,
        ] =
          mockSaveAvatar.mock
            .calls[0];

        expect(
          receivedUserId
        ).toBe(userId);

        expect(
          file.mimetype
        ).toBe(
          "image/png"
        );

        expect(
          Buffer.isBuffer(
            file.buffer
          )
        ).toBe(true);
      }
    );


    it(
      "should return 401 without authentication",
      async () => {
        const multipart =
          createMultipartFile(
            "avatar.png",
            "image/png",
            Buffer.from("image")
          );

        const response =
          await app.inject({
            method: "POST",

            url:
              "/me/avatar",

            headers: {
              "content-type":
                multipart.contentType,
            },

            payload:
              multipart.body,
          });

        expect(
          response.statusCode
        ).toBe(401);

        expect(
          mockSaveAvatar
        ).not.toHaveBeenCalled();
      }
    );


    it(
      "should reject unsupported avatar formats",
      async () => {
        mockValidateAccessToken
          .mockReturnValue(userId);

        const multipart =
          createMultipartFile(
            "avatar.txt",
            "text/plain",
            Buffer.from(
              "not an image"
            )
          );

        const response =
          await app.inject({
            method: "POST",

            url:
              "/me/avatar",

            headers: {
              authorization:
                "Bearer fake-access-token",

              "content-type":
                multipart.contentType,
            },

            payload:
              multipart.body,
          });

        expect(
          response.statusCode
        ).toBe(400);

        const body =
          response.json();

        expect(
          body.error
        ).toBe(
          "Unsupported avatar format"
        );

        expect(
          mockSaveAvatar
        ).not.toHaveBeenCalled();
      }
    );


    it(
      "should return 400 when no avatar file is provided",
      async () => {
        mockValidateAccessToken
          .mockReturnValue(userId);

        const boundary =
          "----empty-boundary";

        const response =
          await app.inject({
            method: "POST",

            url:
              "/me/avatar",

            headers: {
              authorization:
                "Bearer fake-access-token",

              "content-type":
                `multipart/form-data; boundary=${boundary}`,
            },

            payload:
              Buffer.from(
                `--${boundary}--\r\n`
              ),
          });

        expect(
          response.statusCode
        ).toBe(400);

        expect(
          mockSaveAvatar
        ).not.toHaveBeenCalled();
      }
    );
  }
);


/* =========================================================
   GLOBAL ERROR HANDLER
   ========================================================= */

describe("Global error handler", () => {
  it("should hide unexpected internal errors", async () => {
    mockLoginUser.mockRejectedValue(
      new Error(
        "Something private went wrong"
      )
    );

    const response = await app.inject({
      method: "POST",
      url: "/login",

      payload: {
        identifier: "obendaou",
        password: "Strongpassword123",
      },
    });

    expect(response.statusCode).toBe(500);

    const body = response.json();

    expect(body.error).toBe(
      "Internal Server Error"
    );

    expect(
      JSON.stringify(body)
    ).not.toContain(
      "Something private went wrong"
    );
  });
});