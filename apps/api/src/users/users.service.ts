import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';

export interface PublicUserProfile {
  id: string;
  email: string;
  name: string;
  role: User['role'];
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: {
        OR: [{ email }, { name: email }],
      },
    });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async updatePassword(id: string, newPassword: string): Promise<void> {
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
  }

  async updateName(id: string, name: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { name } });
  }

  async updateEmail(id: string, email: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { email } });
  }

  toPublicProfile(user: User): PublicUserProfile {
    return {
      id: user.id,
      email: user.email || user.username,
      name: user.name,
      role: user.role,
    };
  }
}
