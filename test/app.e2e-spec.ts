import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const JETON = 'jeton-interne-de-test';

describe('User Config Service (e2e)', () => {
  let app: INestApplication;
  const ancienJeton = process.env.INTERNAL_SERVICE_TOKEN;
  const queryRaw = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
  const findUnique = jest.fn().mockResolvedValue({
    idUtilisateur: 'user-1',
    alias: null,
    theme: 'sombre',
    langue: 'fr',
    statutPresence: 'horsLigne',
    vuLaDerniereFois: null,
    modeNotification: 'systeme',
    avatar: null,
    creeLe: new Date(),
    misAJourLe: new Date(),
  });
  const create = jest.fn().mockImplementation(({ data }) =>
    Promise.resolve({
      idUtilisateur: data.idUtilisateur,
      alias: null,
      theme: 'sombre',
      langue: 'fr',
      statutPresence: 'horsLigne',
      vuLaDerniereFois: null,
      modeNotification: 'systeme',
      avatar: null,
      creeLe: new Date(),
      misAJourLe: new Date(),
      ...data,
    }),
  );
  const findMany = jest.fn().mockImplementation(({ where, select }) =>
    Promise.resolve(
      where.idUtilisateur.in
        .filter((id: string) => id !== 'inconnu')
        .map((id: string) => ({
          idUtilisateur: id,
          alias: null,
          ...(select.avatar ? { avatar: null } : {}),
          statutPresence: 'enLigne',
          vuLaDerniereFois: new Date(),
        })),
    ),
  );
  const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
  const upsert = jest.fn().mockImplementation(({ where, update }) =>
    Promise.resolve({
      idUtilisateur: where.idUtilisateur,
      alias: null,
      theme: 'sombre',
      langue: 'fr',
      statutPresence: 'horsLigne',
      vuLaDerniereFois: null,
      modeNotification: 'systeme',
      avatar: null,
      creeLe: new Date(),
      misAJourLe: new Date(),
      ...update,
    }),
  );

  beforeAll(async () => {
    process.env.INTERNAL_SERVICE_TOKEN = JETON;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $queryRaw: queryRaw,
        configUtilisateur: {
          findMany,
          findUnique,
          create,
          upsert,
          deleteMany,
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (ancienJeton === undefined) delete process.env.INTERNAL_SERVICE_TOKEN;
    else process.env.INTERNAL_SERVICE_TOKEN = ancienJeton;
  });

  it('refuse une identité x-user-id sans le jeton interne du Gateway', async () => {
    await request(app.getHttpServer())
      .get('/api/config-utilisateur')
      .set('x-user-id', 'user-1')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/config-utilisateur')
      .set('x-internal-token', 'faux-jeton-de-meme-taille')
      .set('x-user-id', 'user-1')
      .expect(401);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('DELETE /api/internal/users/:id efface la configuration d’un compte supprimé', async () => {
    await request(app.getHttpServer())
      .delete('/api/internal/users/user-1')
      .expect(401);
    const response = await request(app.getHttpServer())
      .delete('/api/internal/users/user-1')
      .set('x-internal-token', JETON)
      .expect(200);
    expect(response.body).toEqual({ supprime: true });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { idUtilisateur: 'user-1' },
    });
  });

  it('GET /api/health', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        status: 'ok',
        service: 'user-config-service',
        database: 'ok',
      }),
    );
  });

  it('GET /api/health retourne 503 si la base est indisponible', async () => {
    queryRaw.mockRejectedValueOnce(new Error('connexion refusée'));
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .expect(503);
    expect(response.body).toEqual(
      expect.objectContaining({
        status: 'erreur',
        service: 'user-config-service',
        database: 'erreur',
      }),
    );
  });

  it('GET /api/config-utilisateur exige une identité authentifiée', () =>
    request(app.getHttpServer())
      .get('/api/config-utilisateur')
      .set('x-internal-token', JETON)
      .expect(401));

  it('GET /api/config-utilisateur retourne la config par défaut', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/config-utilisateur')
      .set('x-internal-token', JETON)
      .set('x-user-id', 'user-1')
      .expect(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        type: 'configUtilisateur',
        idUtilisateur: 'user-1',
        theme: 'sombre',
      }),
    );
  });

  it('GET /api/config-utilisateur crée la config au premier appel', async () => {
    findUnique.mockResolvedValueOnce(null);
    const response = await request(app.getHttpServer())
      .get('/api/config-utilisateur')
      .set('x-internal-token', JETON)
      .set('x-user-id', 'user-nouveau')
      .expect(200);
    expect(create).toHaveBeenCalledWith({
      data: { idUtilisateur: 'user-nouveau' },
    });
    expect(response.body).toEqual(
      expect.objectContaining({
        type: 'configUtilisateur',
        idUtilisateur: 'user-nouveau',
        theme: 'sombre',
      }),
    );
  });

  it('PATCH /api/config-utilisateur retourne 200 avec la config mise à jour', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/config-utilisateur')
      .set('x-internal-token', JETON)
      .set('x-user-id', 'user-1')
      .send({ theme: 'clair', langue: 'en' })
      .expect(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        type: 'configUtilisateur',
        idUtilisateur: 'user-1',
        theme: 'clair',
        langue: 'en',
      }),
    );
  });

  it('PATCH /api/config-utilisateur exige une identité authentifiée', () =>
    request(app.getHttpServer())
      .patch('/api/config-utilisateur')
      .set('x-internal-token', JETON)
      .send({ alias: 'x' })
      .expect(401));

  it('PATCH /api/config-utilisateur accepte un avatar proche de la taille maximale', () => {
    const avatar = `data:image/webp;base64,${'A'.repeat(89_000)}`;
    return request(app.getHttpServer())
      .patch('/api/config-utilisateur')
      .set('x-internal-token', JETON)
      .set('x-user-id', 'user-1')
      .send({ avatar })
      .expect(200)
      .expect(({ body }) => expect(body.avatar).toBe(avatar));
  });

  it('PATCH /api/config-utilisateur rejette un avatar SVG', () =>
    request(app.getHttpServer())
      .patch('/api/config-utilisateur')
      .set('x-internal-token', JETON)
      .set('x-user-id', 'user-1')
      .send({ avatar: 'data:image/svg+xml;base64,PHN2Zz4=' })
      .expect(400));

  it('GET /api/config-utilisateur/publiques renvoie les profils connus', () =>
    request(app.getHttpServer())
      .get(
        '/api/config-utilisateur/publiques?ids=user-2, user-3,user-2,inconnu',
      )
      .set('x-internal-token', JETON)
      .set('x-user-id', 'user-1')
      .expect(200)
      .expect(({ body }) => {
        expect(findMany).toHaveBeenLastCalledWith(
          expect.objectContaining({
            where: { idUtilisateur: { in: ['user-2', 'user-3', 'inconnu'] } },
          }),
        );
        expect(
          body.map((p: { idUtilisateur: string }) => p.idUtilisateur),
        ).toEqual(['user-2', 'user-3']);
        expect(body[0]).toMatchObject({
          type: 'profilPublic',
          actif: true,
          avatar: null,
        });
      }));

  it('GET /api/config-utilisateur/publiques?inclureAvatar=false omet les avatars', () =>
    request(app.getHttpServer())
      .get('/api/config-utilisateur/publiques?ids=user-2&inclureAvatar=false')
      .set('x-internal-token', JETON)
      .set('x-user-id', 'user-1')
      .expect(200)
      .expect(({ body }) => expect(body[0]).not.toHaveProperty('avatar')));

  it('GET /api/config-utilisateur/publiques exige une identité authentifiée', () =>
    request(app.getHttpServer())
      .get('/api/config-utilisateur/publiques?ids=user-2')
      .set('x-internal-token', JETON)
      .expect(401));

  it.each([
    ['sans ids', ''],
    ['ids vides', '?ids=,,'],
    [
      'trop d’ids',
      `?ids=${Array.from({ length: 101 }, (_, i) => `u${i}`).join(',')}`,
    ],
  ])(
    'GET /api/config-utilisateur/publiques rejette une requête %s',
    (_cas, query) =>
      request(app.getHttpServer())
        .get(`/api/config-utilisateur/publiques${query}`)
        .set('x-internal-token', JETON)
        .set('x-user-id', 'user-1')
        .expect(400),
  );

  it('PATCH /api/config-utilisateur rejette un alias trop long', () =>
    request(app.getHttpServer())
      .patch('/api/config-utilisateur')
      .set('x-internal-token', JETON)
      .set('x-user-id', 'user-1')
      .send({ alias: 'a'.repeat(51) })
      .expect(400));

  it('PATCH /api/config-utilisateur rejette un thème inconnu', () =>
    request(app.getHttpServer())
      .patch('/api/config-utilisateur')
      .set('x-internal-token', JETON)
      .set('x-user-id', 'user-1')
      .send({ theme: 'bleu' })
      .expect(400));

  it('PATCH /api/config-utilisateur rejette un alias explicitement null', () =>
    request(app.getHttpServer())
      .patch('/api/config-utilisateur')
      .set('x-internal-token', JETON)
      .set('x-user-id', 'user-1')
      .send({ alias: null })
      .expect(400));

  it('PATCH /api/config-utilisateur rejette un thème explicitement null', () =>
    request(app.getHttpServer())
      .patch('/api/config-utilisateur')
      .set('x-internal-token', JETON)
      .set('x-user-id', 'user-1')
      .send({ theme: null })
      .expect(400));

  it('PUT /api/config-utilisateur/presence retourne 200 avec le nouveau statut', async () => {
    const response = await request(app.getHttpServer())
      .put('/api/config-utilisateur/presence')
      .set('x-internal-token', JETON)
      .set('x-user-id', 'user-1')
      .send({ statut: 'enLigne' })
      .expect(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        type: 'configUtilisateur',
        idUtilisateur: 'user-1',
        statutPresence: 'enLigne',
      }),
    );
    expect(response.body.vuLaDerniereFois).not.toBeNull();
  });

  it('PUT /api/config-utilisateur/presence exige une identité authentifiée', () =>
    request(app.getHttpServer())
      .put('/api/config-utilisateur/presence')
      .set('x-internal-token', JETON)
      .send({ statut: 'enLigne' })
      .expect(401));

  it('PUT /api/config-utilisateur/presence rejette un statut inconnu', () =>
    request(app.getHttpServer())
      .put('/api/config-utilisateur/presence')
      .set('x-internal-token', JETON)
      .set('x-user-id', 'user-1')
      .send({ statut: 'absent' })
      .expect(400));
});
