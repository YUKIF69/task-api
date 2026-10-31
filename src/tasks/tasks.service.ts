import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';
import { TasksQueryDto } from './dto/tasks-query.dto.js';
import { Prisma } from '../generated/prisma/client.js';

@Injectable()
export class TasksService {
  constructor(private readonly prismaService: PrismaService) {}

  async getAllTasks(query: TasksQueryDto, userId: string) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: Prisma.TaskWhereInput = {
      userId,

      ...(query.isDone !== undefined && {
        isDone: query.isDone,
      }),

      ...(!!query.search && {
        title: {
          contains: query.search,
          mode: 'insensitive',
        },
      }),
    };

    const [items, total] = await Promise.all([
      this.prismaService.task.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          [query.sortBy ?? 'createdAt']: query.order ?? 'desc',
        },
      }),
      this.prismaService.task.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  async createTask(dto: CreateTaskDto, userId: string) {
    return this.prismaService.task.create({
      data: {
        title: dto.title,
        user: {
          connect: {
            id: userId,
          },
        },
      },
    });
  }

  async getTaskById(id: string, userId: string) {
    const task = await this.prismaService.task.findUnique({
      where: {
        id,
        userId,
      },
    });
    if (!task) throw new NotFoundException(`Task with id ${id} not found`);
    return task;
  }

  async updateTask(id: string, dto: UpdateTaskDto, userId: string) {
    await this.getTaskById(id, userId);
    return this.prismaService.task.update({
      where: {
        id,
        userId,
      },
      data: dto,
    });
  }

  async deleteTask(id: string, userId: string) {
    await this.getTaskById(id, userId);
    return this.prismaService.task.delete({
      where: { id, userId },
    });
  }
}
