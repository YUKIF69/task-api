import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { JwtUser } from '../types/jwt-user.type.js';

export const GetUser = createParamDecorator(
  (
    data: keyof JwtUser | undefined,
    ctx: ExecutionContext,
  ): JwtUser | JwtUser[keyof JwtUser] => {
    const request = ctx.switchToHttp().getRequest<{ user: JwtUser }>();

    if (data) {
      return request.user[data];
    }

    return request.user;
  },
);
