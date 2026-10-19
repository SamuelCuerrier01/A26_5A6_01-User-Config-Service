import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { verifierSecretsProduction } from './partage/secrets-production';

export async function bootstrap(): Promise<void> {
  verifierSecretsProduction({
    jetonInterne: true,
    urlsAvecMotDePasse: ['DATABASE_URL'],
  });
  const port = Number(process.env.PORT || '3005');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Variable d'environnement PORT invalide : "${process.env.PORT}"`,
    );
  }

  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: (process.env.CORS_ORIGINS || 'http://localhost:5173')
      .split(',')
      .map((origine) => origine.trim())
      .filter((origine) => origine.length > 0),
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Chatvardage User Config Service')
    .setDescription(
      'API de gestion de la configuration utilisateur de Chatvardage (alias, thème, langue, présence, notifications)',
    )
    .setVersion('1.0.0')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-user-id' }, 'x-user-id')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  await app.listen(port, '0.0.0.0');
}

/* istanbul ignore next */
if (require.main === module) {
  bootstrap().catch((erreur: unknown) => {
    console.error(erreur);
    process.exit(1);
  });
}
