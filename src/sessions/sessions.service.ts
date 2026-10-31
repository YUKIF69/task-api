import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class SessionsService {
  constructor(private readonly prismaService: PrismaService) {}

  async create(userId: string, refreshTokenHash: string, expiresAt: Date) {
    return this.prismaService.session.create({
      data: { userId, refreshTokenHash, expiresAt },
    });
  }

  async findById(sessionId: string) {
    return this.prismaService.session.findUnique({ where: { id: sessionId } });
  }

  async findByRefreshTokenHash(refreshTokenHash: string) {
    return this.prismaService.session.findUnique({
      where: {
        refreshTokenHash,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });
  }

  async updateRefreshToken(
    sessionId: string,
    currentRefreshTokenHash: string,
    newRefreshTokenHash: string,
    expiresAt: Date,
  ) {
    return this.prismaService.session.updateMany({
      where: {
        id: sessionId,
        refreshTokenHash: currentRefreshTokenHash,
      },
      data: {
        refreshTokenHash: newRefreshTokenHash,
        expiresAt,
      },
    });
  }

  async deleteById(sessionId: string) {
    return this.prismaService.session.deleteMany({
      where: { id: sessionId },
    });
  }

  async deleteAllByUserId(userId: string) {
    return this.prismaService.session.deleteMany({
      where: { userId },
    });
  }

  async deleteByRefreshTokenHash(refreshTokenHash: string) {
    return this.prismaService.session.deleteMany({
      where: { refreshTokenHash },
    });
  }
}
