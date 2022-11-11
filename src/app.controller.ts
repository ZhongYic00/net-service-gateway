import { Body, Header, Param, Req } from '@nestjs/common';
import { Controller, Get, Post } from '@nestjs/common';
import { readFileSync } from 'fs';
import { AppService } from './app.service';

const staticStoragePath = 'static'

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
  @Get('/logs')
  getLogs(): string[] {
    return this.appService.webLogger()
  }
  @Post('/device/register')
  registerIP(@Body() req) {
    try {
      this.appService.updateIP(req.name,req.record)
      console.log('register device',req)
    } catch(e){
      console.log(e)
    }
  }
  @Get('/device/list')
  getIP() {
    return this.appService.getIPs()
  }
  @Post('/sparql')
  getSparql(@Req() req) {
    //console.log('sparql1',req)
    var fs = require('fs')
    return fs.readFileSync('result').toString()
  }
  @Get('/static/:path')
  getStatic(@Param('path') path:string) {
      let file = readFileSync(staticStoragePath+'/'+path);
      return file.toString()
  }
  @Get('/ws')
  getWS() {
    return this.appService.newWSChannel()
  }
}
