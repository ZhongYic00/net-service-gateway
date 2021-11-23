import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { Wsgateway } from './wsgateway';

@Module({
  imports: [ServeStaticModule.forRoot({
    rootPath: join(__dirname, '..', 'static'),   // <-- path to the static files
  })],
  controllers: [AppController],
  providers: [AppService,Wsgateway],
})
export class AppModule {}
