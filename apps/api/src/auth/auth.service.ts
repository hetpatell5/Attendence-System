import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import * as crypto from 'node:crypto';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import type { JwtPayload } from './types/jwt-payload.type';

export interface AuthTokensResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const REFRESH_TOKEN_BYTES = 64;

function parseExpiryToSeconds(expiry: string): number {
  const match = /^(\d+)([smhd])$/.exec(expiry);
  if (!match) {
    throw new Error(`Invalid expiry format: ${expiry}`);
  }
  const value = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400 } as const;
  return value * multipliers[unit];
}

@Injectable()
export class AuthService {
  private readonly accessExpiry = process.env.JWT_ACCESS_EXPIRY ?? '15m';
  private readonly refreshExpirySeconds = parseExpiryToSeconds(
    process.env.JWT_REFRESH_EXPIRY ?? '7d',
  );
  private readonly refreshPepper = process.env.JWT_REFRESH_SECRET ?? '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
    private readonly jwtService: JwtService,
  ) {}

  private hashRefreshToken(rawToken: string): string {
    return crypto
      .createHash('sha256')
      .update(rawToken + this.refreshPepper)
      .digest('hex');
  }

  private signAccessToken(user: User): string {
    const payload: JwtPayload = { sub: user.id, email: user.email || user.username, role: user.role };
    return this.jwtService.sign(payload, {
      secret: process.env.JWT_SECRET,
      expiresIn: this.accessExpiry,
    });
  }

  private async issueRefreshToken(
    userId: string,
    familyId: string,
    ip?: string,
  ): Promise<string> {
    const rawToken = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    const expiresAt = new Date(Date.now() + this.refreshExpirySeconds * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashRefreshToken(rawToken),
        familyId,
        expiresAt,
        createdByIp: ip,
      },
    });

    return rawToken;
  }

  async login(username: string, password: string, ip?: string): Promise<AuthTokensResult> {
    const identifier = username?.trim() || '';
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: identifier },
          { email: identifier },
        ],
      },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    if (!user || !user.isActive) {
      await this.auditService.log({ eventType: 'LOGIN_FAILURE', email: identifier, ipAddress: ip });
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await argon2.verify(user.passwordHash, password);
    if (!passwordValid) {
      await this.auditService.log({
        eventType: 'LOGIN_FAILURE',
        userId: user.id,
        email: username,
        ipAddress: ip,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const familyId = crypto.randomUUID();
    const accessToken = this.signAccessToken(user);
    const refreshToken = await this.issueRefreshToken(user.id, familyId, ip);

    await this.auditService.log({ eventType: 'LOGIN_SUCCESS', userId: user.id, ipAddress: ip });

    return {
      accessToken,
      refreshToken,
      expiresIn: parseExpiryToSeconds(this.accessExpiry),
    };
  }

  async refresh(rawToken: string, ip?: string): Promise<AuthTokensResult> {
    const tokenHash = this.hashRefreshToken(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!existing) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const isExpired = existing.expiresAt.getTime() < Date.now();
    const isRevoked = existing.revokedAt !== null;

    if (isRevoked || isExpired) {
      if (isRevoked) {
        // A previously-rotated (or already-revoked) token is being replayed — treat the whole
        // rotation chain as compromised and revoke it, forcing re-authentication.
        await this.prisma.refreshToken.updateMany({
          where: { familyId: existing.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await this.auditService.log({
          eventType: 'TOKEN_REUSE_DETECTED',
          userId: existing.userId,
          ipAddress: ip,
        });
      }
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.usersService.findById(existing.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const newRawToken = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    const newExpiresAt = new Date(Date.now() + this.refreshExpirySeconds * 1000);

    await this.prisma.$transaction(async (tx) => {
      const newRow = await tx.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: this.hashRefreshToken(newRawToken),
          familyId: existing.familyId,
          expiresAt: newExpiresAt,
          createdByIp: ip,
        },
      });

      await tx.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date(), replacedBy: newRow.id },
      });
    });

    const accessToken = this.signAccessToken(user);
    await this.auditService.log({ eventType: 'TOKEN_REFRESH', userId: user.id, ipAddress: ip });

    return {
      accessToken,
      refreshToken: newRawToken,
      expiresIn: parseExpiryToSeconds(this.accessExpiry),
    };
  }

  async logout(rawToken: string, userId: string, ip?: string): Promise<void> {
    const tokenHash = this.hashRefreshToken(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (existing && existing.revokedAt === null) {
      await this.prisma.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      });
    }

    await this.auditService.log({ eventType: 'LOGOUT', userId, ipAddress: ip });
  }
}
