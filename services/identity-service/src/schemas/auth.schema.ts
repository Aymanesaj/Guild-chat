import * as z from "zod";

export const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters")
    .max(32, "Username must be at most 32 characters")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Username can only contain letters, numbers and underscores"
    )
    .toLowerCase(),

  email: z
    .string()
    .trim()
    .email("Email is not valid")
    .max(255)
    .toLowerCase(),

  password: z
    .string()
    .min(8, "Password must be at least 8 characters long")
    .max(128, "Password must be at most 128 characters"),

  displayName: z
    .string()
    .max(80)
    .optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
    identifier: z
        .string()
        .trim()
        .min(1, "Username or email is required"),
    password: z
        .string()
        .min(1, "Password is required")
});

export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().trim().min(1, "Refresh token is required")
});

export type RefreshInput = z.infer<typeof refreshSchema>;