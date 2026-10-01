import { prisma } from "../database/prisma.js";

export async function usernameExists(
  username: string
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: {
      username,
    },
    select: {
      id: true,
    },
  });

  return user !== null;
}

export async function emailExists(
  email: string
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: {
      email,
    },
    select: {
      id: true,
    },
  });

  return user !== null;
}

interface CreateLocalUserData {
  username: string;
  email: string;
  passwordHash: string;
  displayName: string;
}

export function createLocalUser(
  data: CreateLocalUserData
) {
  return prisma.user.create({
    data: {
      username: data.username,
      email: data.email,
      passwordHash: data.passwordHash,
      displayName: data.displayName,
    },
  });
}

export function findUserByEmail(
    email: string
){
    return prisma.user.findUnique({
        where: {
            email
        }
    });
}

export function findUserByUsername(
    username: string
){
    return prisma.user.findUnique({
        where: {
            username
        }
    });
}