import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class UsersService {
  constructor(private readonly prismaService: PrismaService) {}

  async findByEmail(email: string) {
    return this.prismaService.user.findUnique({
      where: { email },
    });
  }

  async create(email: string, passwordHash: string) {
    return this.prismaService.user.create({
      data: {
        email,
        passwordHash,
      },
    });
  }
}
