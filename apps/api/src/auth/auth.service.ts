import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
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

// ---------------------------------------------------------------------------
// Argon2 concurrency limiter — prevents CPU/memory exhaustion when many
// wrong-password requests come in simultaneously. Argon2 is intentionally
// slow and memory-hard; without a limit, concurrent calls will starve the
// Node.js event loop and crash the process.
// ---------------------------------------------------------------------------
const MAX_CONCURRENT_ARGON2 = 3;
let activeArgon2 = 0;

async function safeArgon2Verify(hash: string, plain: string): Promise<boolean> {
  if (activeArgon2 >= MAX_CONCURRENT_ARGON2) {
    // Too many in-flight verification calls — reject early.
    // This manifests to the caller as a login failure, which is safe.
    return false;
  }
  activeArgon2++;
  try {
    return await argon2.verify(hash, plain);
  } catch (err) {
    // argon2.verify can throw on malformed hashes or native module errors.
    // Log and treat as a failed verification rather than a server crash.
    console.error('[AuthService] argon2.verify threw unexpectedly:', err instanceof Error ? err.message : String(err));
    return false;
  } finally {
    activeArgon2--;
  }
}

// A fixed argon2id hash used for dummy verification when the user does not
// exist in the database. This prevents:
//   1. Timing attacks that reveal whether a username is valid.
//   2. CPU stacking from repeated calls on non-existent usernames — the dummy
//      verify still runs but counts against the concurrency pool so it's
//      bounded by MAX_CONCURRENT_ARGON2.
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$dHVuaXQteHh4' +
  'eHh4eHh4eA$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

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

    let user: (User & { employee?: { id: string; firstName: string; lastName: string } | null }) | null = null;
    try {
      user = await this.prisma.user.findFirst({
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
    } catch (err) {
      console.error('[AuthService] DB error during login lookup:', err instanceof Error ? err.message : String(err));
      throw new InternalServerErrorException('Service temporarily unavailable');
    }

    if (!user || !user.isActive) {
      // Log the failure first (fire-and-forget, don't await to avoid stalling).
      void this.auditService.log({ eventType: 'LOGIN_FAILURE', email: identifier, ipAddress: ip })
        .catch((e: unknown) => console.error('[AuthService] audit log error:', e));

      // Run a dummy argon2 verify to maintain consistent response timing
      // (prevents timing-based username enumeration) but bounded by the
      // concurrency limiter above so we don't stack CPU work.
      await safeArgon2Verify(DUMMY_HASH, password).catch(() => {/* intentionally ignored */});

      throw new UnauthorizedException('Invalid credentials');
    }

    // Real password check — protected by the concurrency limiter.
    const passwordValid = await safeArgon2Verify(user.passwordHash, password);

    if (!passwordValid) {
      void this.auditService.log({
        eventType: 'LOGIN_FAILURE',
        userId: user.id,
        email: username,
        ipAddress: ip,
      }).catch((e: unknown) => console.error('[AuthService] audit log error:', e));

      throw new UnauthorizedException('Invalid credentials');
    }

    const familyId = crypto.randomUUID();
    const accessToken = this.signAccessToken(user);
    const refreshToken = await this.issueRefreshToken(user.id, familyId, ip);

    void this.auditService.log({ eventType: 'LOGIN_SUCCESS', userId: user.id, ipAddress: ip })
      .catch((e: unknown) => console.error('[AuthService] audit log error:', e));

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
        void this.auditService.log({
          eventType: 'TOKEN_REUSE_DETECTED',
          userId: existing.userId,
          ipAddress: ip,
        }).catch((e: unknown) => console.error('[AuthService] audit log error:', e));
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
    void this.auditService.log({ eventType: 'TOKEN_REFRESH', userId: user.id, ipAddress: ip })
      .catch((e: unknown) => console.error('[AuthService] audit log error:', e));

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

    void this.auditService.log({ eventType: 'LOGOUT', userId, ipAddress: ip })
      .catch((e: unknown) => console.error('[AuthService] audit log error:', e));
  }
}
