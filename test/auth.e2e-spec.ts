import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { configureApp } from '../src/app.setup.js';
import { AppModule } from '../src/app.module.js';
import request from 'supertest';
import { createHash } from 'node:crypto';

describe('AuthController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const getRefreshCookie = (res: request.Response): string | undefined => {
    const cookies = res.headers['set-cookie'] as unknown as
      string[] | undefined;

    return cookies?.find((cookie) => cookie.startsWith('refreshToken='));
  };

  const getCookieValue = (cookie: string): string =>
    cookie.split(';')[0].split('=')[1];

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
    const dataBaseUrl = process.env.DATABASE_URL;
    if (!dataBaseUrl) throw new Error('DATABASE_URL is not defined');

    const databaseName = new URL(dataBaseUrl).pathname.slice(1);

    if (process.env.NODE_ENV !== 'test' || databaseName !== 'task_api_test') {
      throw new Error('Refusing to clean non-test database');
    }

    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  //========================================================================================================================================================

  it('POST /auth/register → 201', async () => {
    const email = 'test@example.com';
    const password = 'password123';

    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);

    // response body
    const user = response.body;

    expect(user.email).toBe(email);
    expect(user.id).toBeDefined();
    expect(user.createdAt).toBeDefined();
    expect(user.updatedAt).toBeDefined();

    expect(user).not.toHaveProperty('passwordHash');
    expect(user).not.toHaveProperty('password');
    expect(user).not.toHaveProperty('accessToken');

    // запис у PostgreSQL
    const dbUser = await prisma.user.findUnique({
      where: { email },
    });

    expect(dbUser).not.toBeNull();
    expect(dbUser!.passwordHash).not.toBe(password);
  });

  //========================================================================================================================================================

  it('POST /auth/register with existing email → 409', async () => {
    const email = 'test@example.com';
    const password = 'password123';

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(409);

    expect(response.body.statusCode).toBe(409);

    const count = await prisma.user.count({ where: { email } });
    expect(count).toBe(1);
  });

  //========================================================================================================================================================

  it.each([
    {
      name: 'invalid email',
      body: {
        email: 'not-email',
        password: 'password123',
      },
    },
    {
      name: 'short password',
      body: {
        email: 'test@example.com',
        password: '123',
      },
    },
    {
      name: 'extra field',
      body: {
        email: 'test@example.com',
        password: 'password123',
        admin: true,
      },
    },
  ])('$name → 400', async ({ body }) => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send(body)
      .expect(400);

    expect(response.body.statusCode).toBe(400);

    const count = await prisma.user.count();
    expect(count).toBe(0);
  });

  describe('POST /auth/login', () => {
    it('POST auth/login → 200', async () => {
      const email = 'test@example.com';
      const password = 'password123';

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);

      const { user, accessToken } = response.body;

      expect(user.email).toBe(email);
      expect(user.id).toBeDefined();
      expect(user).not.toHaveProperty('passwordHash');
      expect(user).not.toHaveProperty('password');

      expect(accessToken).toBeDefined();
      expect(typeof accessToken).toBe('string');

      const cookies = response.headers['set-cookie'] as unknown as string[];
      expect(cookies).toBeDefined();

      const refreshCookie = cookies.find((c) => c.startsWith('refreshToken='));
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie).toContain('HttpOnly');
      expect(refreshCookie).toContain('Path=/auth');
      expect(refreshCookie).toContain('SameSite=Strict');

      const refreshTokenValue = refreshCookie!.split(';')[0].split('=')[1];
      expect(refreshTokenValue.length).toBeGreaterThan(0);
      expect(response.body).not.toHaveProperty('refreshToken');
      expect(JSON.stringify(response.body)).not.toContain(refreshTokenValue);

      const dbUser = await prisma.user.findUnique({
        where: { email },
      });

      const session = await prisma.session.findFirst({
        where: { userId: dbUser!.id },
      });

      const expectedHash = createHash('sha256')
        .update(refreshTokenValue)
        .digest('hex');

      expect(session).not.toBeNull();
      expect(session!.refreshTokenHash).toBeDefined();
      expect(session!.refreshTokenHash).toBe(expectedHash);
      expect(session!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it.each([
      {
        name: 'wrong password',
        email: 'test@example.com',
        password: 'wrongpassword',
      },
      {
        name: 'unknown user',
        email: 'unknown@example.com',
        password: 'password123',
      },
    ])('$name → 401', async ({ email, password }) => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'test@example.com',
          password: 'password123',
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(401);

      expect(response.body.statusCode).toBe(401);
      expect(response.body.message).toBe('Invalid credentials');

      expect(response.body).not.toHaveProperty('accessToken');
      expect(response.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('POST /auth/refresh', () => {
    it('POST /auth/refresh → 200 and rotates refresh token', async () => {
      const email = 'test@example.com';
      const password = 'password123';

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);

      const agent = request.agent(app.getHttpServer());

      const loginResponse = await agent
        .post('/auth/login')
        .send({ email, password })
        .expect(200);

      const oldCookie = getRefreshCookie(loginResponse);
      expect(oldCookie).toBeDefined();
      const oldRefreshToken = getCookieValue(oldCookie!);

      const refreshResponse = await agent.post('/auth/refresh').expect(200);

      expect(typeof refreshResponse.body.accessToken).toBe('string');
      expect(refreshResponse.body).not.toHaveProperty('refreshToken');

      const newCookie = getRefreshCookie(refreshResponse);
      expect(newCookie).toBeDefined();
      expect(newCookie).toContain('HttpOnly');
      expect(newCookie).toContain('Path=/auth');
      expect(newCookie).toContain('SameSite=Strict');

      const newRefreshToken = getCookieValue(newCookie!);
      expect(newRefreshToken.length).toBeGreaterThan(0);
      expect(newRefreshToken).not.toBe(oldRefreshToken);

      expect(JSON.stringify(refreshResponse.body)).not.toContain(
        newRefreshToken,
      );

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user).not.toBeNull();

      const sessions = await prisma.session.findMany({
        where: { userId: user!.id },
      });
      expect(sessions).toHaveLength(1);

      const oldHash = createHash('sha256')
        .update(oldRefreshToken)
        .digest('hex');
      const newHash = createHash('sha256')
        .update(newRefreshToken)
        .digest('hex');

      expect(sessions[0].refreshTokenHash).not.toBe(oldHash);
      expect(sessions[0].refreshTokenHash).toBe(newHash);
    });

    it('rejects old refresh token after rotation → 401', async () => {
      const email = 'test@example.com';
      const password = 'password123';

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);

      const agent = request.agent(app.getHttpServer());

      const loginResponse = await agent
        .post('/auth/login')
        .send({ email, password })
        .expect(200);

      const oldCookie = getRefreshCookie(loginResponse);
      expect(oldCookie).toBeDefined();
      const oldRefreshToken = getCookieValue(oldCookie!);

      await agent.post('/auth/refresh').expect(200);

      const replayResponse = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `refreshToken=${oldRefreshToken}`)
        .expect(401);

      expect(replayResponse.body.statusCode).toBe(401);
      expect(replayResponse.body).not.toHaveProperty('accessToken');
      expect(replayResponse.headers['set-cookie']).toBeUndefined();
    });

    it.each([
      {
        name: 'missing refresh token',
        cookie: undefined,
      },
      {
        name: 'invalid refresh token',
        cookie: 'refreshToken=invalid-token',
      },
    ])('$name → 401', async ({ cookie }) => {
      let req = request(app.getHttpServer()).post('/auth/refresh');

      if (cookie) {
        req = req.set('Cookie', cookie);
      }

      const response = await req.expect(401);

      expect(response.body.statusCode).toBe(401);
      expect(response.body).not.toHaveProperty('accessToken');
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(response.body).not.toHaveProperty('refreshToken');
    });
  });

  describe('POST /auth/logout', () => {
    it('POST /auth/logout → 204 and deletes session', async () => {
      const email = 'test@example.com';
      const password = 'password123';

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);

      const agent = request.agent(app.getHttpServer());

      await agent.post('/auth/login').send({ email, password }).expect(200);

      const user = await prisma.user.findUnique({
        where: { email },
      });

      expect(user).not.toBeNull();

      const sessionsBefore = await prisma.session.count({
        where: { userId: user!.id },
      });

      expect(sessionsBefore).toBe(1);

      const response = await agent.post('/auth/logout').expect(204);

      expect(response.text).toBe('');

      const sessionsAfter = await prisma.session.count({
        where: { userId: user!.id },
      });

      expect(sessionsAfter).toBe(0);

      const clearedCookie = getRefreshCookie(response);

      expect(clearedCookie).toBeDefined();
      expect(getCookieValue(clearedCookie!)).toBe('');
      expect(clearedCookie).toContain('Expires=Thu, 01 Jan 1970');
      expect(clearedCookie).toContain('Path=/auth');
      expect(clearedCookie).toContain('HttpOnly');
      expect(clearedCookie).toContain('SameSite=Strict');
    });

    it('rejects refresh token after logout → 401', async () => {
      const email = 'test@example.com';
      const password = 'password123';

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);

      const agent = request.agent(app.getHttpServer());

      const loginResponse = await agent
        .post('/auth/login')
        .send({ email, password })
        .expect(200);

      const cookie = getRefreshCookie(loginResponse);
      expect(cookie).toBeDefined();
      const refreshToken = getCookieValue(cookie!);

      await agent.post('/auth/logout').expect(204);

      const response = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `refreshToken=${refreshToken}`)
        .expect(401);

      expect(response.body.statusCode).toBe(401);
      expect(response.body).not.toHaveProperty('accessToken');
      expect(response.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('POST /auth/logout-all', () => {
    it('POST /auth/logout-all → 204 and deletes all user sessions', async () => {
      const email = 'test@example.com';
      const password = 'password123';

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);

      const login1 = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);

      const accessToken: string = login1.body.accessToken;
      expect(typeof accessToken).toBe('string');

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user).not.toBeNull();

      const sessionsBefore = await prisma.session.count({
        where: { userId: user!.id },
      });
      expect(sessionsBefore).toBe(2);

      const response = await request(app.getHttpServer())
        .post('/auth/logout-all')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      expect(response.text).toBe('');
      expect(response.text).toBe('');

      const sessionsAfter = await prisma.session.count({
        where: { userId: user!.id },
      });
      expect(sessionsAfter).toBe(0);

      const clearedCookie = getRefreshCookie(response);

      expect(clearedCookie).toBeDefined();
      expect(getCookieValue(clearedCookie!)).toBe('');
      expect(clearedCookie).toContain('HttpOnly');
      expect(clearedCookie).toContain('SameSite=Strict');
      expect(clearedCookie).toContain('Expires=Thu, 01 Jan 1970');
      expect(clearedCookie).toContain('Path=/auth');
    });

    it('rejects all refresh tokens after logout-all → 401', async () => {
      const email = 'test@example.com';
      const password = 'password123';

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);

      const login1 = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);

      const login2 = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);

      const accessToken: string = login1.body.accessToken;
      expect(typeof accessToken).toBe('string');

      const cookie1 = getRefreshCookie(login1);
      const cookie2 = getRefreshCookie(login2);
      expect(cookie1).toBeDefined();
      expect(cookie2).toBeDefined();

      const refreshToken1 = getCookieValue(cookie1!);
      const refreshToken2 = getCookieValue(cookie2!);
      expect(refreshToken1).not.toBe(refreshToken2);

      await request(app.getHttpServer())
        .post('/auth/logout-all')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      const refresh1 = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `refreshToken=${refreshToken1}`)
        .expect(401);

      const refresh2 = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `refreshToken=${refreshToken2}`)
        .expect(401);

      for (const res of [refresh1, refresh2]) {
        expect(res.body.statusCode).toBe(401);
        expect(res.body).not.toHaveProperty('accessToken');
        expect(res.headers['set-cookie']).toBeUndefined();
      }
    });
  });

  describe('GET /auth/me', () => {
    it('GET /auth/me → 200', async () => {
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

      expect(typeof accessToken).toBe('string');

      const dbUser = await prisma.user.findUnique({
        where: { email },
      });

      expect(dbUser).not.toBeNull();

      const response = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.userId).toBe(dbUser!.id);
      expect(response.body.email).toBe(email);

      expect(response.body).not.toHaveProperty('passwordHash');
      expect(response.body).not.toHaveProperty('password');
    });

    it('GET /auth/me without Authorization → 401', async () => {
      const response = await request(app.getHttpServer())
        .get('/auth/me')
        .expect(401);

      expect(response.body.statusCode).toBe(401);
      expect(response.body).not.toHaveProperty('userId');
      expect(response.body).not.toHaveProperty('email');
    });
  });
});
