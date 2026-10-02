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

    const user = await getCurrentUser(request.userId);
    return reply.code(200).send(user);
}