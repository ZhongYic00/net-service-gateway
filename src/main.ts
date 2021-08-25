import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WsIOAdapter } from './ws-adapter';

export const PORT:number = Number(process.env.PORT || 3000);

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new WsIOAdapter(app));
  console.log(PORT);
  await app.listen(3000);
}
bootstrap();