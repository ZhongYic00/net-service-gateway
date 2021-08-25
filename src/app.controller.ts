import { Body } from '@nestjs/common';
import { Controller, Get, Post } from '@nestjs/common';
import { AppService } from './app.service';

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
}
