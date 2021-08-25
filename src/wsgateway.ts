import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { IncomingMessage } from "http";
import * as WebSocket from 'ws';
import {PORT} from './main'

@WebSocketGateway({path:'/ws'})
export class Wsgateway {

    async handleConnection(client: WebSocket, request: IncomingMessage) {
        console.log('handle connection');
    }

    handleDisconnect(client: WebSocket) {
        console.log('handle disconnect');
    }
}
