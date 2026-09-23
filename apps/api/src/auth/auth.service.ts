import {
  BadRequestException,
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
import { EmailService } from '../email/email.service';
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

  // Pepper for OTP / reset-token hashing. Deliberately reuses JWT_SECRET rather than adding
  // a new required env var — both exist purely to make the stored hash unrecoverable from a
  // DB leak alone, not as an independent secret.
  private readonly recoveryPepper = process.env.JWT_SECRET ?? '';
  private readonly OTP_TTL_MS = 10 * 60 * 1000;
  private readonly OTP_MAX_ATTEMPTS = 5;
  private readonly RESET_TOKEN_TTL_MS = 10 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
  ) {}

  private hashRefreshToken(rawToken: string): string {
    return crypto
      .createHash('sha256')
      .update(rawToken + this.refreshPepper)
      .digest('hex');
  }

  private hashRecoverySecret(raw: string): string {
    return crypto
      .createHash('sha256')
      .update(raw + this.recoveryPepper)
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

  // ---------------------------------------------------------------------------
  // Hidden admin password recovery (Ctrl+F on the login page).
  //
  // Mirrors the old system's forgot_password.php: one company-wide recovery
  // email (CompanySettings.recoveryEmail), OTP-gated, resets the password of
  // whichever admin username the caller typed in. Every response is worded
  // identically regardless of whether that username exists, so this endpoint
  // can't be used to enumerate admin accounts.
  // ---------------------------------------------------------------------------

  /**
   * Step 1: generate and email a 6-digit OTP for the given admin username.
   * Always resolves — never reveals whether the username matched an admin
   * account. Only genuine operational problems (no recovery email configured,
   * SMTP not set up, email send failure) are surfaced, since those are visible
   * system state, not information about a specific account.
   */
  async requestPasswordResetOtp(usernameOrEmail: string, ip?: string): Promise<void> {
    const identifier = usernameOrEmail?.trim() || '';
    const settings = await this.prisma.companySettings.findFirst();
    const recoveryEmail = settings?.recoveryEmail?.trim();
    if (!recoveryEmail) {
      throw new BadRequestException(
        'Recovery email is not configured. Set it in Settings → Company Profile → Admin Profile Update.',
      );
    }
    // Defense in depth: the settings DTO now validates this on save, but a value saved
    // before that validation existed would otherwise fail later with nodemailer's opaque
    // "No recipients defined" once it reaches sendMail().
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recoveryEmail)) {
      throw new BadRequestException(
        `The configured recovery email "${recoveryEmail}" isn't valid. Fix it in Settings → Company Profile → Admin Profile Update.`,
      );
    }

    const user = identifier ? await this.usersService.findAdminByUsernameOrEmail(identifier) : null;
    if (!user) {
      // Same shape as the success path, just skip generating/sending anything —
      // the caller can't distinguish this from "OTP sent" (see doc comment above).
      void this.auditService.log({ eventType: 'PASSWORD_RESET_REQUESTED', email: identifier, ipAddress: ip })
        .catch((e: unknown) => console.error('[AuthService] audit log error:', e));
      return;
    }

    // Invalidate any still-usable OTPs for this user before issuing a new one, so only the
    // most recent code/reset-token can ever be redeemed.
    await this.prisma.passwordResetOtp.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.prisma.passwordResetOtp.create({
      data: {
        userId: user.id,
        codeHash: this.hashRecoverySecret(`${user.id}:${code}`),
        codeExpiresAt: new Date(Date.now() + this.OTP_TTL_MS),
      },
    });

    await this.emailService.sendPasswordResetOtpEmail(
      recoveryEmail,
      code,
      settings?.companyName || 'Attendance System',
    );

    void this.auditService.log({ eventType: 'PASSWORD_RESET_REQUESTED', userId: user.id, ipAddress: ip })
      .catch((e: unknown) => console.error('[AuthService] audit log error:', e));
  }

  /**
   * Step 2: verify the OTP and issue a short-lived, single-use reset token.
   */
  async verifyPasswordResetOtp(usernameOrEmail: string, code: string): Promise<{ resetToken: string }> {
    const identifier = usernameOrEmail?.trim() || '';
    const user = identifier ? await this.usersService.findAdminByUsernameOrEmail(identifier) : null;
    // Generic message throughout — never distinguishes "no such user" from "wrong code".
    const invalid = () => new UnauthorizedException('Invalid or expired code.');
    if (!user) throw invalid();

    const otp = await this.prisma.passwordResetOtp.findFirst({
      where: { userId: user.id, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp || otp.codeExpiresAt.getTime() < Date.now()) throw invalid();
    if (otp.attempts >= this.OTP_MAX_ATTEMPTS) {
      await this.prisma.passwordResetOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
      throw invalid();
    }

    const providedHash = this.hashRecoverySecret(`${user.id}:${code?.trim() ?? ''}`);
    if (providedHash !== otp.codeHash) {
      await this.prisma.passwordResetOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw invalid();
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    await this.prisma.passwordResetOtp.update({
      where: { id: otp.id },
      data: {
        consumedAt: new Date(),
        resetTokenHash: this.hashRecoverySecret(resetToken),
        resetTokenExpiresAt: new Date(Date.now() + this.RESET_TOKEN_TTL_MS),
      },
    });

    return { resetToken };
  }

  /**
   * Step 3: spend the one-time reset token to set a new password.
   */
  async resetPasswordWithToken(resetToken: string, newPassword: string, ip?: string): Promise<void> {
    const invalid = () => new UnauthorizedException('This reset link has expired. Please request a new code.');
    const tokenHash = this.hashRecoverySecret(resetToken?.trim() ?? '');
    const otp = await this.prisma.passwordResetOtp.findFirst({ where: { resetTokenHash: tokenHash } });
    if (!otp || !otp.resetTokenExpiresAt || otp.resetTokenExpiresAt.getTime() < Date.now()) {
      throw invalid();
    }

    await this.usersService.updatePassword(otp.userId, newPassword);
    // Single-use: clear the token hash so this same reset link can't be replayed.
    await this.prisma.passwordResetOtp.update({
      where: { id: otp.id },
      data: { resetTokenHash: null, resetTokenExpiresAt: null },
    });
    // A recovered account may have been compromised — force re-login everywhere.
    await this.prisma.refreshToken.updateMany({
      where: { userId: otp.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    void this.auditService.log({ eventType: 'PASSWORD_RESET_COMPLETED', userId: otp.userId, ipAddress: ip })
      .catch((e: unknown) => console.error('[AuthService] audit log error:', e));
  }
}
