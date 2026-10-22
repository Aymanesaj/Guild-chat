import { prisma } from "../database/prisma.js";
import { UpdateUserData } from "../types/user.types.js";


export function findUserAvatarById(userId: string) {
  return prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      avatarMediaId: true,
    },
  });
}

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

export function findUserById(
    id: string
) {
    return prisma.user.findUnique({
        where: {
            id
        }
    });
}

export function updateUserData(
  userId: string,
  data: UpdateUserData
) {
  return prisma.user.update({
    where: {
      id: userId
    },
    data
  })
}

export function updateUserAvatar(
  userId: string,
  avatarUrl: string | null
) {
  return prisma.user.update({
    where: {
      id: userId
    },
    data: {
      avatarUrl
    }
  });
}