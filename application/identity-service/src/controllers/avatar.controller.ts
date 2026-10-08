import type { FastifyReply , FastifyRequest } from "fastify";
import { createReadStream } from "node:fs";
import { getAvatarFile , deleteAvatar } from "../services/avatar.service.js";


interface AvatarParams {
  filename: string;
}


export async function getAvatarController(
  request: FastifyRequest<{
    Params: AvatarParams;
  }>,
  reply: FastifyReply
) {
    const { filename } = request.params;

    const { filepath, mimetype } = await getAvatarFile(filename);

    const stream = createReadStream(filepath);

    return reply.type(mimetype).send(stream);
}


export async function deleteAvatarController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!request.userId) {
    return reply.code(401).send({
      error: "Unauthorized",
    });
  }

  const user = await deleteAvatar(request.userId);

  return reply.code(200).send(user);
}
