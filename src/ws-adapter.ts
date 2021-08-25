import * as WebSocket from 'ws';
import { INestApplicationContext } from '@nestjs/common';
import { MessageMappingProperties } from '@nestjs/websockets';
import { WsAdapter } from '@nestjs/platform-ws'
import { Observable, fromEvent, EMPTY, observable, Subscriber, of, map, from } from 'rxjs';
import { mergeMap, filter, mergeAll } from 'rxjs/operators';
import { connect as nconnect, Socket } from 'net';
import {serialize,deserialize} from 'bson';
import { Encryptor } from '../encrypt';
import { AppService } from './app.service';

const fs = require('fs');
const parseArgs = require('minimist');
const path = require('path');

const options = {
    alias: {
      b: 'local_address',
      l: 'local_port',
      s: 'server',
      r: 'remote_port',
      k: 'password',
      c: 'config_file',
      m: 'method'
    },
    string: [
      'local_address',
      'server',
      'password',
      'config_file',
      'method',
      'scheme'
    ],
    default: {
      config_file: path.resolve(__dirname, '..', 'config.json')
    }
  };
const configFromArgs = parseArgs(process.argv.slice(2), options);
const configContent = fs.readFileSync(configFromArgs.config_file);
const config = JSON.parse(configContent);
for (let k in configFromArgs) {
    const v = configFromArgs[k];
    config[k] = v;
}

const timeout = Math.floor(config.timeout * 1000);
const KEY = config.password;
let METHOD = config.method;
console.log(KEY,METHOD)
const appService = new AppService
const writeLog = (...params) => {
    console.log(...params)
    appService.webLog(params)
}
let encryptor:Encryptor = new Encryptor(KEY, METHOD);
const inetNtoa = buf => buf[0] + '.' + buf[1] + '.' + buf[2] + '.' + buf[3];
const wrap = o => encryptor.encrypt(serialize(o))
const unwrap = o => deserialize(encryptor.decrypt(o))
const stage = new Map<number,number>()
const remotes = new Map<number,Socket>()
const cachedPieces = new Map()
var cnt:number = 0

const clearAll = (id) => {
    if(!remotes[id]) return
    remotes[id].destroy()
    remotes[id] = null
    stage[id] = null
    cachedPieces[id] = null
}

if (['', 'null', 'table'].includes(METHOD.toLowerCase())) {
  METHOD = null;
}
export class WsIOAdapter extends WsAdapter {

    bindMessageHandlers(
        client: WebSocket,
        handlers: MessageMappingProperties[],
        process: (data: any) => Observable<any>,
    ) {
        fromEvent(client, 'message')
        .pipe(
            mergeMap((msg:MessageEvent) => this.resolveRequest(msg))
        ).subscribe(
            response => client.send(response)
        );
    }
    resolveRequest(msg:MessageEvent):Observable<any> {
        try{
            let req = unwrap(msg.data)
            writeLog('receive',(req.t))
            if(req.c === 'giveup'){
                clearAll(req.i)
                return of(wrap({i:req.i,a:'giveup ack',t:cnt++}))
            }
            else if(req.c) return of(wrap({i:req.i,e:'unknown command',t:cnt++}))
            
            const reqId:number = req.i
            stage[req.i] = stage[req.i] || 0
            //console.log('stage of',req.i,stage[req.i])
            let data = (req.d || req.h).buffer
            let headerLength = 0;
            let addrLen = 0;
            let remoteAddr = null;
            let remotePort = null;
            if (stage[reqId] === 5) {
                remotes[reqId].write(data);
            } else if (stage[reqId] === 0) {
                if(req.d) return EMPTY
                try {
                    const addrtype = data[0];
                    if (addrtype === 3) {
                        addrLen = data[1];
                    } else if (addrtype !== 1) {
                        console.warn(`unsupported addrtype: ${addrtype}`);
                        return of(wrap({i:reqId,e:'unsupported addrtype',t:cnt++}));
                    }
                    // read address and port
                    if (addrtype === 1) {
                        remoteAddr = inetNtoa(data.slice(1, 5));
                        remotePort = data.readUInt16BE(5);
                        headerLength = 7;
                    } else {
                        remoteAddr = data.slice(2, 2 + addrLen).toString('binary');
                        remotePort = data.readUInt16BE(2 + addrLen);
                        headerLength = 2 + addrLen + 2;
                    }
                    
                    // connect remote server
                    cachedPieces[reqId] = []
                    let remote = remotes[reqId] = nconnect(remotePort, remoteAddr, function() {
                        writeLog('connecting', remoteAddr, reqId);
                        let i = 0;
                        while (i < cachedPieces[reqId].length) {
                            const piece = cachedPieces[reqId][i];
                            //console.log('sending cached',piece)
                            remote.write(piece);
                            i++;
                        }
                        //console.log('cache sent')
                        cachedPieces[reqId] = null; // save memory
                        stage[reqId] = 5;
                    });
                    remote.setTimeout(timeout)
                    
                    if (data.length > headerLength) {
                        // make sure no data is lost
                        let buf = Buffer.alloc(data.length - headerLength);
                        data.copy(buf, 0, headerLength);
                        cachedPieces[reqId].push(buf);
                        buf = null;
                    }
                    stage[reqId] = 4;
                    return from([
                    fromEvent(remote,'data').pipe(
                        map(rsp => wrap({i:reqId,d:rsp,t:cnt++}))
                    ),
                    fromEvent(remote,'end').pipe(
                        map(()=>{
                            writeLog('remote disconnected',reqId)
                            clearAll(reqId)
                            return wrap({i:reqId,e:'remote disconnected',t:cnt++})
                        })
                    ),
                    fromEvent(remote,'error').pipe(
                        map((e)=>{
                            writeLog(`remote: ${e}`,reqId);
                            clearAll(reqId)
                            return ((wrap({i:reqId,e:'error',t:cnt++})))
                        })
                    ),
                    fromEvent(remote,'timeout').pipe(
                        map(()=>{
                            writeLog('remote timeout');
                            clearAll(reqId)
                            return (wrap({i:reqId,e:'timeout',t:cnt++}))
                        })
                    )
                    ]).pipe(mergeAll())
                } catch (error) {
                    // may encouter index out of range
                    console.warn(error);
                    clearAll(reqId)
                    return of(wrap({i:reqId,e:`error:${error}`,t:cnt++}))
                }
            } else if (stage[reqId] === 4) {
                // remote server not connected
                // cache received buffers
                // make sure no data is lost
                cachedPieces[reqId].push(data);
            }
            return EMPTY
        }catch(e){
            writeLog(e)
            return EMPTY
        }
    }
    bindMessageHandler(
        buffer,
        handlers: MessageMappingProperties[],
        transform: (data: any) => Observable<any>,
    ): Observable<any> {
        return EMPTY
    }
    bindClientDisconnect(client, callback) {
        client.on('close', () => {
            remotes.forEach((r)=>r.destroy())
            remotes.clear()
            stage.clear()
            cachedPieces.clear()
            appService.webLog(['client disconnected'])
            callback(client)
        });
    }
    bindClientConnect(server,callback){
        server.on('connection',(client,request)=>{
            encryptor = new Encryptor(KEY,METHOD)
            cnt = 0
            callback(client,request)
        })
    }
}