import type { Request } from 'express';
import type { JwtPayload } from './jwt-payload.type';

export interface RequestWithUser extends Request {
  user: JwtPayload;
}
