import type { FastifyRequest , FastifyReply } from "fastify";
import { getCurrentUser } from "../services/user.service.js";

export async function meController(
    request: FastifyRequest,
    reply: FastifyReply
) {
    if (!request.userId)
        return reply.status(401).send({
            error: "Unauthorized",
        });

    try {
        const user = await getCurrentUser(request.userId);
        return reply.code(200).send(user);
    } catch(error) {
        if (error instanceof Error && error.message === "User not found")
            return reply.code(404).send({
                error: "User not found"
            });
        throw error;
    }
}