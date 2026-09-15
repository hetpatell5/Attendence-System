import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import type { AuthTokens, AuthUser } from '@attendance/shared';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { RequestWithUser } from './types/request-with-user.type';

class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(6)
  newPassword!: string;
}

/**
 * Extracts the real client IP even when the server is behind a reverse proxy
 * (nginx, Cloudflare, etc.). Falls back gracefully to Express's req.ip.
 *
 * This is critical for rate-limiting: without it, all users behind the same
 * proxy appear to share one IP and a single throttle bucket, making the
 * per-IP limit useless.
 */
function getClientIp(req: RequestWithUser): string {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded) {
    // x-forwarded-for can be a comma-separated list: "client, proxy1, proxy2"
    // The first entry is the real client IP.
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const ip = first?.split(',')[0]?.trim();
    if (ip) return ip;
  }
  // Fallback: Express native IP
  return req.ip ?? 'unknown';
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Login endpoint is rate-limited to 5 attempts per 30 seconds per IP.
   * Combined with the argon2 concurrency limiter in AuthService, this
   * prevents brute-force attacks from crashing the server.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 30_000 } })
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: RequestWithUser): Promise<AuthTokens> {
    const ip = getClientIp(req);
    return this.authService.login(dto.username, dto.password, ip);
  }

  @Public()
  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: RequestWithUser): Promise<AuthTokens> {
    const ip = getClientIp(req);
    return this.authService.refresh(dto.refreshToken, ip);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Body() dto: RefreshTokenDto,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<void> {
    const ip = getClientIp(req);
    await this.authService.logout(dto.refreshToken, user.sub, ip);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: RequestWithUser['user'],
  ): Promise<void> {
    const record = await this.usersService.findById(user.sub);
    if (!record) throw new NotFoundException('User not found');
    // Verify current password
    const argon2 = await import('argon2');
    const valid = await argon2.verify(record.passwordHash, dto.currentPassword);
    if (!valid) throw new BadRequestException('Current password is incorrect');
    await this.usersService.updatePassword(user.sub, dto.newPassword);
  }

  @Post('update-profile')
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateProfile(
    @Body() body: { name?: string; email?: string },
    @CurrentUser() user: RequestWithUser['user'],
  ): Promise<void> {
    if (body.name?.trim()) {
      await this.usersService.updateName(user.sub, body.name.trim());
    }
    if (body.email?.trim()) {
      await this.usersService.updateEmail(user.sub, body.email.trim());
    }
  }

  @Get('me')
  async me(@CurrentUser() user: RequestWithUser['user']): Promise<AuthUser> {
    const record = await this.usersService.findById(user.sub);
    if (!record) {
      throw new NotFoundException('User not found');
    }
    return this.usersService.toPublicProfile(record);
  }
}
