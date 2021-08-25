import { Injectable } from '@nestjs/common';
import { PORT } from './main'

@Injectable()
export class AppService {
  getHello(): string {
    return `Hello World!
    Server listening ${PORT}
    `;
  }
}
