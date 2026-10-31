import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { RegisterDto } from './dto/register.dto.js';
import * as argon2 from 'argon2';
import { UsersService } from '../users/users.service.js';
import { LoginDto } from './dto/login.dto.js';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SessionsService } from '../sessions/sessions.service.js';
import { RefreshTokenService } from './services/refresh-token.service.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly sessionsService: SessionsService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  async register(dto: RegisterDto) {
    const exists = await this.usersService.findByEmail(dto.email);

    if (exists) throw new ConflictException('Email already in use');

    const hash = await argon2.hash(dto.password);
    const user = await this.usersService.create(dto.email, hash);
    const { passwordHash, ...safeUser } = user;

    return safeUser;
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const isPasswordValid = await argon2.verify(
      user.passwordHash,
      dto.password,
    );
    if (!isPasswordValid)
      throw new UnauthorizedException('Invalid credentials');

    const refreshToken = this.refreshTokenService.generate();
    const refreshTokenHash = this.refreshTokenService.hash(refreshToken);
    const refreshTokenTtlDays = Number(
      this.configService.getOrThrow<string>('REFRESH_TOKEN_TTL_DAYS'),
    );
    const expiresAt = new Date(
      Date.now() + refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    );

    await this.sessionsService.create(user.id, refreshTokenHash, expiresAt);

    const { passwordHash, ...safeLogin } = user;
    const { accessToken } = await this.signToken(user.id, user.email);

    return {
      user: safeLogin,
      accessToken,
      refreshToken,
      refreshTokenExpiresAt: expiresAt,
    };
  }

  async logout(refreshToken: string) {
    const refreshTokenHash = this.refreshTokenService.hash(refreshToken);

    await this.sessionsService.deleteByRefreshTokenHash(refreshTokenHash);
  }

  async logoutAll(userId: string) {
    this.sessionsService.deleteAllByUserId(userId);
  }

  private async signToken(sub: string, email: string) {
    const expiresIn = this.configService.getOrThrow<string>(
      'JWT_EXPIRES_IN',
    ) as JwtSignOptions['expiresIn'];

    const accessToken = await this.jwtService.signAsync(
      {
        sub,
        email,
      },
      {
        expiresIn,
      },
    );

    return {
      accessToken,
    };
  }

  async refresh(refreshToken: string) {
    const refreshTokenHash = this.refreshTokenService.hash(refreshToken);
    const session =
      await this.sessionsService.findByRefreshTokenHash(refreshTokenHash);

    if (!session) throw new UnauthorizedException('Invalid refresh token');
    if (session.expiresAt <= new Date()) {
      await this.sessionsService.deleteById(session.id);
      throw new UnauthorizedException('Invalid refresh token');
    }

    const newRefreshToken = this.refreshTokenService.generate();
    const newRefreshTokenHash = this.refreshTokenService.hash(newRefreshToken);
    const refreshTokenTtlDays = Number(
      this.configService.getOrThrow<string>('REFRESH_TOKEN_TTL_DAYS'),
    );
    const expiresAt = new Date(
      Date.now() + refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    );

    const result = await this.sessionsService.updateRefreshToken(
      session.id,
      refreshTokenHash,
      newRefreshTokenHash,
      expiresAt,
    );

    if (result.count !== 1) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const { accessToken } = await this.signToken(
      session.user.id,
      session.user.email,
    );

    return {
      accessToken,
      refreshToken: newRefreshToken,
      refreshTokenExpiresAt: expiresAt,
    };
  }
}
