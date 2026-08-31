import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';

describe('AuthService', () => {
  let authService: AuthService;
  let prisma: {
    refreshToken: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let usersService: { findByEmail: jest.Mock; findById: jest.Mock };
  let auditService: { log: jest.Mock };

  const activeUser = {
    id: 'user-1',
    email: 'user@example.com',
    passwordHash: '',
    name: 'Test User',
    role: 'EMPLOYEE' as const,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeAll(async () => {
    activeUser.passwordHash = await argon2.hash('correct-password', { type: argon2.argon2id });
  });

  beforeEach(async () => {
    prisma = {
      refreshToken: {
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'new-token-id' }),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
    };
    usersService = { findByEmail: jest.fn(), findById: jest.fn() };
    auditService = { log: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
        { provide: AuditService, useValue: auditService },
        JwtService,
      ],
    }).compile();

    authService = moduleRef.get(AuthService);
  });

  describe('login', () => {
    it('returns tokens and logs LOGIN_SUCCESS for valid credentials', async () => {
      usersService.findByEmail.mockResolvedValue(activeUser);

      const result = await authService.login('user@example.com', 'correct-password', '127.0.0.1');

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'LOGIN_SUCCESS', userId: activeUser.id }),
      );
    });

    it('throws and logs LOGIN_FAILURE for an unknown email', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        authService.login('nobody@example.com', 'whatever', '127.0.0.1'),
      ).rejects.toThrow(UnauthorizedException);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'LOGIN_FAILURE', email: 'nobody@example.com' }),
      );
    });

    it('throws and logs LOGIN_FAILURE for a wrong password', async () => {
      usersService.findByEmail.mockResolvedValue(activeUser);

      await expect(
        authService.login('user@example.com', 'wrong-password', '127.0.0.1'),
      ).rejects.toThrow(UnauthorizedException);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'LOGIN_FAILURE', userId: activeUser.id }),
      );
    });

    it('throws for an inactive user without checking the password', async () => {
      usersService.findByEmail.mockResolvedValue({ ...activeUser, isActive: false });

      await expect(
        authService.login('user@example.com', 'correct-password', '127.0.0.1'),
      ).rejects.toThrow(UnauthorizedException);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'LOGIN_FAILURE' }),
      );
    });
  });

  describe('refresh', () => {
    const validRow = {
      id: 'token-row-1',
      userId: activeUser.id,
      tokenHash: 'irrelevant',
      familyId: 'family-1',
      replacedBy: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      createdAt: new Date(),
      createdByIp: null,
    };

    it('rotates a valid token: revokes the old row and issues a new one in the same family', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(validRow);
      usersService.findById.mockResolvedValue(activeUser);

      const result = await authService.refresh('raw-token', '127.0.0.1');

      expect(result.accessToken).toBeDefined();
      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: validRow.id },
          data: expect.objectContaining({ replacedBy: 'new-token-id' }),
        }),
      );
      expect(prisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ familyId: validRow.familyId }),
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'TOKEN_REFRESH', userId: activeUser.id }),
      );
    });

    it('revokes the whole family and logs TOKEN_REUSE_DETECTED when a revoked token is replayed', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...validRow,
        revokedAt: new Date(),
      });

      await expect(authService.refresh('raw-token', '127.0.0.1')).rejects.toThrow(
        UnauthorizedException,
      );

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { familyId: validRow.familyId, revokedAt: null } }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'TOKEN_REUSE_DETECTED' }),
      );
    });

    it('throws for an expired token without reuse-detection side effects', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...validRow,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(authService.refresh('raw-token', '127.0.0.1')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('throws for a token that does not exist', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(authService.refresh('unknown-token', '127.0.0.1')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('revokes only the single token, not the whole family', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'token-row-1',
        revokedAt: null,
      });

      await authService.logout('raw-token', activeUser.id, '127.0.0.1');

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'token-row-1' },
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      });
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'LOGOUT', userId: activeUser.id }),
      );
    });

    it('is idempotent when the token does not exist', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(
        authService.logout('unknown-token', activeUser.id, '127.0.0.1'),
      ).resolves.toBeUndefined();
      expect(prisma.refreshToken.update).not.toHaveBeenCalled();
    });
  });
});
