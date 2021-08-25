import { Injectable } from '@nestjs/common';
import { PORT } from './main'

let logs:any[] = []
const ipRecords = new Map<string,any>()
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
  updateIP(name:string,record:any) {
    ipRecords.set(name,record)
  }
  getIPs() {
    console.log(ipRecords)
    let rt = []
    ipRecords.forEach((v,k)=> rt.push({name:v,record:k}))
    return rt
  }
}
