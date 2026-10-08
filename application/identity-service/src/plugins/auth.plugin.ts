import type {
  FastifyReply,
  FastifyRequest,
} from "fastify";

import {
  validateAccessToken,
} from "../services/jwt.service.js";

export async function authenticate(
    request: FastifyRequest,
    reply: FastifyReply
){
    const authorization = request.headers.authorization;

    if (!authorization)
        return reply.code(401).send({
            error: "Unauthorized"
        });

    const [scheme, token] = authorization.split(" ");

    if (scheme !== "Bearer" || !token)
        return reply.code(401).send({
            error: "Unauthorized"
        });
    
    const userId = validateAccessToken(token);

    if (!userId)
        return reply.code(401).send({
            error: "Unauthorized"
        });
    
    request.userId = userId;
}