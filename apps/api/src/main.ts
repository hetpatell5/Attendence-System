import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    // Allow large SQL file imports (up to 50 MB as JSON body)
    bodyParser: true,
  });
  app.use(require('express').json({ limit: '50mb' }));
  app.use(require('express').urlencoded({ extended: true, limit: '50mb' }));

  app.use(helmet());

  const corsOrigins = (process.env.CORS_ORIGINS ?? '*')
    .split(',')
    .map((origin) => origin.trim());
  // In dev allow all origins so other LAN PCs can connect
  const isDev = process.env.NODE_ENV !== 'production';
  app.enableCors({ origin: isDev ? true : corsOrigins });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT ?? 3000;
  // Listen on all interfaces so LAN devices can reach this API
  await app.listen(port, '0.0.0.0');
  console.log(`API listening on http://0.0.0.0:${port} (LAN: http://192.168.1.39:${port})`);
}

void bootstrap();
