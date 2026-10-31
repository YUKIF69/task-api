import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { GetUser } from './decorators/get-user.decorator.js';
import type { JwtUser } from './types/jwt-user.type.js';
import { Cookie } from '../common/decorators/cookie.decorator.js';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { LoginResponseDto } from './dto/responses/login.response.dto.js';
import { AccessTokenResponseDto } from './dto/responses/access-token.response.dto.js';
import { JwtUserResponseDto } from './dto/responses/jwt-user.response.dto.js';
import { AuthUserResponseDto } from './dto/responses/auth-user.response.dto.js';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @ApiCreatedResponse({ type: AuthUserResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid registration data' })
  @ApiConflictResponse({ description: 'Email already in use' })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @ApiOkResponse({ type: LoginResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid login data' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, accessToken, refreshToken, refreshTokenExpiresAt } =
      await this.authService.login(dto);

    this.setRefreshTokenCookie(res, refreshToken, refreshTokenExpiresAt);

    return {
      user,
      accessToken,
    };
  }
  @ApiNoContentResponse()
  @ApiCookieAuth()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Cookie('refreshToken') refreshToken: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }

    this.clearRefreshTokenCookie(res);
  }

  @ApiBearerAuth()
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout-all')
  async logoutAll(
    @GetUser('userId') userId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logoutAll(userId);
    this.clearRefreshTokenCookie(res);
  }

  @ApiOkResponse({ type: AccessTokenResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid refresh token' })
  @ApiCookieAuth()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Cookie('refreshToken') refreshToken: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is missing');
    }

    const {
      accessToken,
      refreshToken: newRefreshToken,
      refreshTokenExpiresAt,
    } = await this.authService.refresh(refreshToken);

    this.setRefreshTokenCookie(res, newRefreshToken, refreshTokenExpiresAt);

    return {
      accessToken,
    };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: JwtUserResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @Get('me')
  me(@GetUser() user: JwtUser) {
    return user;
  }

  private setRefreshTokenCookie(
    res: Response,
    refreshToken: string,
    expires: Date,
  ) {
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure:
        this.configService.getOrThrow<string>('NODE_ENV') === 'production',
      sameSite: 'strict',
      expires,
      path: '/auth',
    });
  }

  private clearRefreshTokenCookie(res: Response) {
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure:
        this.configService.getOrThrow<string>('NODE_ENV') === 'production',
      sameSite: 'strict',
      path: '/auth',
    });
  }
}
