import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from '../types/jwt-payload.type';
import type { RequestWithUser } from '../types/request-with-user.type';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    return request.user;
  },
);
