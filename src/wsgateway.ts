import { Param } from "@nestjs/common";
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { IncomingMessage } from "http";
import * as WebSocket from 'ws';
import {PORT} from './main'

@WebSocketGateway({path:'/ws/:path'})
export class Wsgateway {
    async handleConnection(@Param('path') path:string,client: WebSocket, request: IncomingMessage) {
        console.log(`gateway handle connection on ${path}`);
    }

    handleDisconnect(@Param('path') path:string,client: WebSocket) {
        console.log(`gateway handle disconnect on ${path}`);
    }
}
