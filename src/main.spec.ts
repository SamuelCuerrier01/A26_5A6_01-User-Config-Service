const listen = jest.fn().mockResolvedValue(undefined);
const app = {
  setGlobalPrefix: jest.fn(),
  enableCors: jest.fn(),
  useGlobalPipes: jest.fn(),
  enableShutdownHooks: jest.fn(),
  listen,
};

const create = jest.fn().mockResolvedValue(app);

jest.mock('@nestjs/core', () => ({
  NestFactory: { create },
}));

const build = jest.fn().mockReturnValue({});
const builder = {
  setTitle: jest.fn().mockReturnThis(),
  setDescription: jest.fn().mockReturnThis(),
  setVersion: jest.fn().mockReturnThis(),
  addApiKey: jest.fn().mockReturnThis(),
  build,
};

const decorator = () => () => undefined;

jest.mock('@nestjs/swagger', () => ({
  DocumentBuilder: jest.fn(() => builder),
  SwaggerModule: {
    createDocument: jest.fn().mockReturnValue({}),
    setup: jest.fn(),
  },
  ApiTags: decorator,
  ApiOperation: decorator,
  ApiHeader: decorator,
  ApiProperty: decorator,
  ApiPropertyOptional: decorator,
}));

import { bootstrap } from './main';

describe('bootstrap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.PORT;
    delete process.env.CORS_ORIGINS;
  });

  it('configure et démarre sur PORT', async () => {
    process.env.PORT = '3999';
    process.env.CORS_ORIGINS = 'http://exemple.test, , http://autre.test ,, ';
    await bootstrap();

    expect(app.setGlobalPrefix).toHaveBeenCalledWith('api');
    expect(app.enableCors).toHaveBeenCalledWith({
      origin: ['http://exemple.test', 'http://autre.test'],
    });
    expect(app.useGlobalPipes).toHaveBeenCalled();
    expect(app.enableShutdownHooks).toHaveBeenCalled();
    expect(builder.setTitle).toHaveBeenCalledWith(
      'Chatvardage User Config Service',
    );
    expect(builder.setDescription).toHaveBeenCalled();
    expect(builder.setVersion).toHaveBeenCalledWith('1.0.1');
    expect(builder.addApiKey).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalled();
    expect(listen).toHaveBeenCalledWith(3999, '0.0.0.0');
  });

  it('utilise 3005 et localhost:5173 par défaut', async () => {
    await bootstrap();

    expect(app.enableCors).toHaveBeenCalledWith({
      origin: ['http://localhost:5173'],
    });
    expect(listen).toHaveBeenCalledWith(3005, '0.0.0.0');
  });

  it('utilise 3005 si PORT est une chaîne vide', async () => {
    process.env.PORT = '';
    await bootstrap();

    expect(listen).toHaveBeenCalledWith(3005, '0.0.0.0');
  });

  it('rejette un PORT non numérique sans créer l’application ni démarrer le serveur', async () => {
    process.env.PORT = 'abc';
    await expect(bootstrap()).rejects.toThrow(
      'Variable d\'environnement PORT invalide : "abc"',
    );
    expect(create).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
  });

  it('rejette un PORT hors intervalle', async () => {
    process.env.PORT = '70000';
    await expect(bootstrap()).rejects.toThrow(/PORT invalide/);
    expect(create).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
  });
});
