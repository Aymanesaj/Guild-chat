import type { FastifyRequest , FastifyReply } from "fastify";
import { getCurrentUser } from "../services/user.service.js";
import { updateProfileSchema } from "../schemas/user.schema.js";
import { updateCurrentUser } from "../services/user.service.js";

export async function meController(
    request: FastifyRequest,
    reply: FastifyReply
) {
    if (!request.userId)
        return reply.status(401).send({
            error: "Unauthorized",
        });

    const user = await getCurrentUser(request.userId);
    return reply.code(200).send(user);
}

export async function updateMeController(
    request: FastifyRequest,
    reply: FastifyReply
) {
    const result = updateProfileSchema.safeParse(request.body);

    if (!result.success)
        return reply.status(400).send({
            error: "Invalid request",
            details: result.error.issues,
        });

    if (!request.userId) {
        return reply.status(401).send({
            error: "Unauthorized",
        });
    }

    const user = await updateCurrentUser(request.userId, result.data);

    return reply.code(200).send(user);
}
