import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { Wsgateway } from './wsgateway';

@Module({
  providers: [Wsgateway],
})
export class AppModule {}
