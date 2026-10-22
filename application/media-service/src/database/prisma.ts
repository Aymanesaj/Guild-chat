import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const connectionString = process.env.MEDIA_DATABASE_URL;

if (!connectionString) {
  throw new Error("MEDIA_DATABASE_URL is missing");
}

const adapter = new PrismaPg({ connectionString });

export const prisma = new PrismaClient({ adapter });