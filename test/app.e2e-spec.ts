import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('TasksController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    configureApp(app);

    await app.init();

    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error('DATABASE_URL is not defined');
    }

    const databaseName = new URL(databaseUrl).pathname.slice(1);

    if (process.env.NODE_ENV !== 'test' || databaseName !== 'task_api_test') {
      throw new Error('Refusing to clean non-test database');
    }

    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /tasks', () => {
    it('POST /tasks without Authorization → 401', async () => {
      const response = await request(app.getHttpServer())
        .post('/tasks')
        .send({
          title: 'Learn NestJS',
        })
        .expect(401);

      expect(response.body.statusCode).toBe(401);
    });
  });
});
