import { Injectable } from '@nestjs/common';
import { PORT } from './main'

let logs:any[] = []
@Injectable()
export class AppService {
  getHello(): string {
    return `Hello World!
    Server listening ${PORT}
    `;
  }
  webLog(log:any[]): void{
    logs.push(log)
  }
  webLogger(): any[] {
    return logs.reduce(
      (p,v,i) => p+`<li>${i}:${v}</li>`,'<ul>'
    )
  }
}
