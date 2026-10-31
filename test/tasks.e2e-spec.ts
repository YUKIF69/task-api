import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import request from 'supertest';

describe('TasksController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const password = 'password123';

  const registerAndLogin = async (email: string): Promise<string> => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    const accessToken = response.body.accessToken;

    expect(typeof accessToken).toBe('string');

    return accessToken;
  };

  const createTask = async (token: string, title: string) => {
    const response = await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title })
      .expect(201);

    return response.body;
  };

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
    if (!databaseUrl) throw new Error('DATABASE_URL is not defined');

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
    it('POST /tasks → 201 and creates task for current user', async () => {
      const email = 'test@example.com';
      const password = 'password123';

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);

      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);

      const accessToken: string = loginResponse.body.accessToken;
      expect(typeof accessToken).toBe('string');

      const response = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: 'Learn NestJS' })
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.title).toBe('Learn NestJS');
      expect(response.body.isDone).toBe(false);
      expect(response.body.createdAt).toBeDefined();
      expect(response.body.userId).toBeDefined();

      const dbUser = await prisma.user.findUnique({ where: { email } });
      expect(dbUser).not.toBeNull();

      const dbTask = await prisma.task.findUnique({
        where: { id: response.body.id },
      });

      expect(dbTask).not.toBeNull();
      expect(dbTask!.title).toBe('Learn NestJS');
      expect(dbTask!.userId).toBe(dbUser!.id);
      expect(dbTask!.isDone).toBe(false);

      expect(response.body.userId).toBe(dbUser!.id);
    });
    describe('validation', () => {
      let accessToken: string;

      beforeEach(async () => {
        const email = 'test@example.com';
        const password = 'password123';

        await request(app.getHttpServer())
          .post('/auth/register')
          .send({ email, password })
          .expect(201);

        const loginResponse = await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email, password })
          .expect(200);

        accessToken = loginResponse.body.accessToken;
        expect(typeof accessToken).toBe('string');
      });

      it.each([
        {
          name: 'empty title',
          body: { title: '' },
        },
        {
          name: 'title is not a string',
          body: { title: 123 },
        },
        {
          name: 'extra unknown field',
          body: { title: 'Learn NestJS', isAdmin: true },
        },
      ])('POST /tasks with $name → 400', async ({ body }) => {
        const response = await request(app.getHttpServer())
          .post('/tasks')
          .set('Authorization', `Bearer ${accessToken}`)
          .send(body)
          .expect(400);

        expect(response.body.statusCode).toBe(400);

        const count = await prisma.task.count();
        expect(count).toBe(0);
      });
    });
  });

  describe('GET /tasks', () => {
    const password = 'password123';

    const registerAndLogin = async (email: string): Promise<string> => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);

      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);

      const accessToken = loginResponse.body.accessToken;

      expect(typeof accessToken).toBe('string');

      return accessToken;
    };

    const createTask = async (token: string, title: string) => {
      const response = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${token}`)
        .send({ title })
        .expect(201);

      return response.body;
    };

    it('GET /tasks returns only current user tasks', async () => {
      const emailA = 'user-a@example.com';
      const emailB = 'user-b@example.com';

      const tokenA = await registerAndLogin(emailA);
      const tokenB = await registerAndLogin(emailB);

      await createTask(tokenA, 'A task 1');
      await createTask(tokenA, 'A task 2');
      await createTask(tokenB, 'B task 1');

      const response = await request(app.getHttpServer())
        .get('/tasks')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const { items, meta } = response.body;

      const userA = await prisma.user.findUnique({
        where: { email: emailA },
      });

      expect(userA).not.toBeNull();

      expect(items).toHaveLength(2);

      for (const item of items) {
        expect(item.userId).toBe(userA!.id);
      }

      const titles = items.map((item: { title: string }) => item.title);

      expect(titles).toContain('A task 1');
      expect(titles).toContain('A task 2');
      expect(titles).not.toContain('B task 1');

      expect(meta).toEqual({
        page: 1,
        limit: 10,
        total: 2,
        totalPages: 1,
      });
    });
    it('GET /tasks?page=2&limit=2&sortBy=title&order=asc returns the second page', async () => {
      const token = await registerAndLogin('test@example.com');

      for (let i = 1; i <= 5; i++) {
        await createTask(token, `Task ${i}`);
      }

      const response = await request(app.getHttpServer())
        .get('/tasks')
        .query({ page: 2, limit: 2, sortBy: 'title', order: 'asc' })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const { items, meta } = response.body;

      expect(meta.page).toBe(2);
      expect(meta.limit).toBe(2);
      expect(meta.total).toBe(5);
      expect(meta.totalPages).toBe(3);

      expect(items).toHaveLength(2);
      const titles = items.map((item: { title: string }) => item.title);
      expect(titles).toEqual(['Task 3', 'Task 4']);
    });
    it('GET /tasks filters by isDone', async () => {
      const token = await registerAndLogin('test@example.com');

      const task1 = await createTask(token, 'Task 1');
      const task2 = await createTask(token, 'Task 2');
      await createTask(token, 'Task 3');

      await request(app.getHttpServer())
        .patch(`/tasks/${task1.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ isDone: true })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/tasks/${task2.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ isDone: true })
        .expect(200);

      const completedResponse = await request(app.getHttpServer())
        .get('/tasks')
        .query({ isDone: true })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(completedResponse.body.items).toHaveLength(2);
      expect(completedResponse.body.meta.total).toBe(2);

      for (const task of completedResponse.body.items) {
        expect(task.isDone).toBe(true);
      }

      const activeResponse = await request(app.getHttpServer())
        .get('/tasks')
        .query({ isDone: false })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(activeResponse.body.items).toHaveLength(1);
      expect(activeResponse.body.meta.total).toBe(1);

      for (const task of activeResponse.body.items) {
        expect(task.isDone).toBe(false);
      }
    });

    it('GET /tasks searches tasks by title', async () => {
      const token = await registerAndLogin('test@example.com');

      await createTask(token, 'Learn NestJS');
      await createTask(token, 'Learn Prisma');
      await createTask(token, 'Buy milk');

      const response = await request(app.getHttpServer())
        .get('/tasks')
        .query({ search: 'learn' })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const titles = response.body.items.map(
        (task: { title: string }) => task.title,
      );

      expect(response.body.meta.total).toBe(2);
      expect(titles).toContain('Learn NestJS');
      expect(titles).toContain('Learn Prisma');
      expect(titles).not.toContain('Buy milk');
    });

    it('GET /tasks sorts tasks by title asc', async () => {
      const token = await registerAndLogin('test@example.com');

      await createTask(token, 'Task C');
      await createTask(token, 'Task A');
      await createTask(token, 'Task B');

      const response = await request(app.getHttpServer())
        .get('/tasks')
        .query({
          sortBy: 'title',
          order: 'asc',
        })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const titles = response.body.items.map(
        (task: { title: string }) => task.title,
      );

      expect(titles).toEqual(['Task A', 'Task B', 'Task C']);
    });

    it.each([
      {
        name: 'page less than 1',
        query: { page: 0 },
      },
      {
        name: 'limit greater than 100',
        query: { limit: 101 },
      },
      {
        name: 'invalid isDone',
        query: { isDone: 'abc' },
      },
      {
        name: 'invalid sortBy',
        query: { sortBy: 'invalid' },
      },
      {
        name: 'invalid order',
        query: { order: 'invalid' },
      },
    ])('GET /tasks with $name → 400', async ({ query }) => {
      const token = await registerAndLogin('test@example.com');

      const response = await request(app.getHttpServer())
        .get('/tasks')
        .query(query)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);

      expect(response.body.statusCode).toBe(400);
    });
  });
  describe('GET /tasks/:id', () => {
    it('GET /tasks/:id → 200', async () => {
      const token = await registerAndLogin('test@example.com');

      const task = await createTask(token, 'Learn NestJS');

      const response = await request(app.getHttpServer())
        .get(`/tasks/${task.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.id).toBe(task.id);
      expect(response.body.title).toBe('Learn NestJS');
      expect(response.body.isDone).toBe(false);
    });

    it('GET /tasks/:id for another user task → 404', async () => {
      const tokenA = await registerAndLogin('user-a@example.com');
      const tokenB = await registerAndLogin('user-b@example.com');

      const taskB = await createTask(tokenB, 'User B task');

      const response = await request(app.getHttpServer())
        .get(`/tasks/${taskB.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);

      expect(response.body.statusCode).toBe(404);
    });

    it('GET /tasks/:id for nonexistent task → 404', async () => {
      const token = await registerAndLogin('test@example.com');

      const nonexistentId = '00000000-0000-4000-8000-000000000000';

      const response = await request(app.getHttpServer())
        .get(`/tasks/${nonexistentId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      expect(response.body.statusCode).toBe(404);
    });
  });
  describe('PATCH /tasks/:id', () => {
    it('PATCH /tasks/:id → 200 and updates task', async () => {
      const token = await registerAndLogin('test@example.com');

      const task = await createTask(token, 'Old title');

      const response = await request(app.getHttpServer())
        .patch(`/tasks/${task.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'New title',
          isDone: true,
        })
        .expect(200);

      expect(response.body.id).toBe(task.id);
      expect(response.body.title).toBe('New title');
      expect(response.body.isDone).toBe(true);

      const dbTask = await prisma.task.findUnique({
        where: { id: task.id },
      });

      expect(dbTask).not.toBeNull();
      expect(dbTask!.title).toBe('New title');
      expect(dbTask!.isDone).toBe(true);
    });

    it('PATCH /tasks/:id for another user task → 404', async () => {
      const tokenA = await registerAndLogin('user-a@example.com');
      const tokenB = await registerAndLogin('user-b@example.com');

      const taskB = await createTask(tokenB, 'User B task');

      const response = await request(app.getHttpServer())
        .patch(`/tasks/${taskB.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          title: 'Hacked title',
        })
        .expect(404);

      expect(response.body.statusCode).toBe(404);

      const dbTask = await prisma.task.findUnique({
        where: { id: taskB.id },
      });

      expect(dbTask).not.toBeNull();
      expect(dbTask!.title).toBe('User B task');
    });

    it.each([
      {
        name: 'empty title',
        body: {
          title: '',
        },
      },
      {
        name: 'invalid isDone',
        body: {
          isDone: 'true',
        },
      },
      {
        name: 'extra field',
        body: {
          admin: true,
        },
      },
    ])('PATCH /tasks/:id with $name → 400', async ({ body }) => {
      const token = await registerAndLogin('test@example.com');

      const task = await createTask(token, 'Original title');

      const response = await request(app.getHttpServer())
        .patch(`/tasks/${task.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(400);

      expect(response.body.statusCode).toBe(400);

      const dbTask = await prisma.task.findUnique({
        where: { id: task.id },
      });

      expect(dbTask).not.toBeNull();
      expect(dbTask!.title).toBe('Original title');
      expect(dbTask!.isDone).toBe(false);
    });
  });
  describe('DELETE /tasks/:id', () => {
    it('DELETE /tasks/:id → 200 and deletes task', async () => {
      const token = await registerAndLogin('test@example.com');

      const task = await createTask(token, 'Task to delete');

      await request(app.getHttpServer())
        .delete(`/tasks/${task.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const dbTask = await prisma.task.findUnique({
        where: { id: task.id },
      });

      expect(dbTask).toBeNull();
    });

    it('DELETE /tasks/:id for another user task → 404', async () => {
      const tokenA = await registerAndLogin('user-a@example.com');
      const tokenB = await registerAndLogin('user-b@example.com');

      const taskB = await createTask(tokenB, 'User B task');

      const response = await request(app.getHttpServer())
        .delete(`/tasks/${taskB.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);

      expect(response.body.statusCode).toBe(404);

      const dbTask = await prisma.task.findUnique({
        where: { id: taskB.id },
      });

      expect(dbTask).not.toBeNull();
      expect(dbTask!.title).toBe('User B task');
    });
  });
});
