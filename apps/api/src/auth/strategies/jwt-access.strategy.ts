import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import type { JwtPayload } from '../types/jwt-payload.type';

/**
 * Extracts JWT from:
 * 1. Authorization: Bearer <token> header (standard API calls)
 * 2. ?token=<token> query parameter (SSE stream — EventSource cannot set headers)
 */
function fromHeaderOrQuery(req: Request): string | null {
  const authHeader = req.headers?.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  const qp = req.query?.token;
  if (typeof qp === 'string' && qp.length > 0) {
    return qp;
  }
  return null;
}

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is required');
    }

    super({
      jwtFromRequest: fromHeaderOrQuery,
      ignoreExpiration: false,
      secretOrKey: secret,
      passReqToCallback: false,
    });
  }

  validate(payload: JwtPayload): JwtPayload {
    return payload;
  }
}
