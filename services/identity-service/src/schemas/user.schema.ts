import { z } from "zod";

export const updateProfileSchema = z.object({
    username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores").toLowerCase().optional(),
    displayName: z.string().trim().min(1).max(80).optional(),
    bio: z.string().trim().max(280).nullable().optional() 
}).refine(
    (data) =>
    data.username !== undefined ||
    data.displayName !== undefined ||
    data.bio !== undefined,
    {
        message: "At least one profile field must be provided",
    }
)

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const userIdParamsSchema = z.object({
  id: z.uuid(),
});

export type UserIdParams = z.infer<typeof userIdParamsSchema>;