import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WsIOAdapter } from './ws-adapter';

export const PORT:number = Number(process.env.PORT || 3000);
export var _WsAdapter:WsIOAdapter;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const wsAdapter=new WsIOAdapter(app);
  _WsAdapter = wsAdapter;
  app.useWebSocketAdapter(wsAdapter);
  console.log('port',PORT);
  await app.listen(PORT);
}
bootstrap();