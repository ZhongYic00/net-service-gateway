import * as WebSocket from 'ws';
import { INestApplicationContext } from '@nestjs/common';
import { MessageMappingProperties } from '@nestjs/websockets';
import { WsAdapter } from '@nestjs/platform-ws'
import { Observable, fromEvent, EMPTY, observable, Subscriber, of, map, from, merge, Subscription, Subject } from 'rxjs';
import { mergeMap, filter, mergeAll, buffer } from 'rxjs/operators';
import { connect as nconnect, Socket } from 'net';
import {serialize,deserialize} from 'bson';
import { Encryptor } from '../encrypt';
import { AppService } from './app.service';
import { write } from 'fs';

const fs = require('fs');
const parseArgs = require('minimist');
const path = require('path');

const config = {
    timeout: 600,
    password: "`try*(^^$some^$%^complex>:<>?~password",
    method: 'aes-256-cfb'
}

const timeout = Math.floor(config.timeout * 1000);
const KEY = config.password;
let METHOD = config.method;
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
const client2remote$ = new Map<number,Observable<unknown>>()
const remote2client = new Map<number,Subscription>()
var cnt:number = 0

const clearAll = (id) => {
    if(!remotes[id]) return
    remotes[id].destroy()
    remotes[id] = null
    stage[id] = null
    cachedPieces[id] = null
}

const parseHeader=(data:Buffer) =>{
    let addrLen,remoteAddr,remotePort,headerLength
    const addrtype = data[0];
    if (addrtype === 3) {
        addrLen = data[1];
    } else if (addrtype !== 1) {
        throw new Error(`unsupported addrtype: ${addrtype}`);
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
    return {remoteAddr,remotePort,headerLength}
}

if (['', 'null', 'table'].includes(METHOD.toLowerCase())) {
  METHOD = null;
}
export class WsIOAdapter extends WsAdapter {

    private clientmsg$:Observable<any>
    private clientrsp$:Subject<any>
    bindMessageHandlers(
        client: WebSocket,
        handlers: MessageMappingProperties[],
        process: (data: any) => Observable<any>,
    ) {
        this.clientrsp$=new Subject()
        this.clientrsp$.subscribe(resp => client.send(resp))

        this.clientmsg$=fromEvent(client, 'message').pipe(map((msg:MessageEvent)=>unwrap(msg.data)));
        
        this.clientmsg$.pipe(filter(req=>!client2remote$.has(req.i)))
            .subscribe(req => {
                this.initRemote(req)
            })
        this.clientmsg$.pipe(filter(req=>req.c!==null))
            .subscribe(req=>{
                this.handleCtrl(req)
            })
        // this.clientmsg$.pipe(
        //     mergeMap((req) => this.resolveRequest(req))
        // ).subscribe(
        //     response => client.send(response)
        // );
    }
    private initRemote(req){
        const reqId:number = req.i
        let data:Buffer = (req.d || req.h).buffer
        let {remoteAddr,remotePort,headerLength} = parseHeader(data)

        writeLog(reqId,remoteAddr,'on connecting')
        let remote = nconnect(remotePort, remoteAddr)
        remote.setTimeout(timeout)
        
        const connect$=fromEvent(remote,'connect')

        const buffered = client2remote$[reqId].pipe(buffer(connect$)) // buffer/block? data before connected
        buffered.subscribe(d => remote.write(d))
        
        connect$.subscribe(()=>{
            writeLog(reqId,remoteAddr,'connected')
            client2remote$[reqId].subscribe(data=>remote.write(data))
        }) // resolve data after connected
        
        let restdata:Buffer=null;
        if (data.length > headerLength) {
            // make sure no data is lost
            restdata = Buffer.alloc(data.length - headerLength);
            data.copy(restdata, 0, headerLength);
        }
        client2remote$[reqId]=merge(of(restdata),this.clientmsg$.pipe(filter(req=>req.i===reqId)))

        remote2client[reqId]=from([
            fromEvent(remote,'data').pipe(
                map(rsp => wrap({i:reqId,d:rsp,t:cnt++}))
            ),
            fromEvent(remote,'close').pipe(
                map((hadError)=>{
                    writeLog(`remote disconnected ${hadError?'with':'without'} error`,reqId)
                    clearAll(reqId)
                    return wrap({i:reqId,e:'remote disconnected',t:cnt++})
                })
            ),
            fromEvent(remote,'error').pipe(
                map(e => {
                    writeLog(`remote: ${e}`,reqId);
                    clearAll(reqId)
                    return ((wrap({i:reqId,e:'error',d:e,t:cnt++})))
                })
            ),
            fromEvent(remote,'timeout').pipe(
                map(()=>{
                    writeLog('remote timeout');
                    clearAll(reqId)
                    return (wrap({i:reqId,e:'timeout',t:cnt++}))
                })
            )
        ])
        .pipe(mergeAll())
        .subscribe(d=>this.clientrsp$.next(d))
    }
    private handleCtrl(req){
        if(req.c === 'giveup'){
            clearAll(req.i)
            return of(wrap({i:req.i,a:'giveup ack',t:cnt++}))
        }
        else if(req.c) return of(wrap({i:req.i,e:'unknown command',t:cnt++}))
    }
    /*private resolveRequest(req):Observable<any> {
        try{
            writeLog('receive',(req.t))
            if(req.c === 'giveup'){
                clearAll(req.i)
                return of(wrap({i:req.i,a:'giveup ack',t:cnt++}))
            }
            else if(req.c) return of(wrap({i:req.i,e:'unknown command',t:cnt++}))
            
            const reqId:number = req.i
            stage[reqId] = stage[reqId] || 0
            //console.log('stage of',req.i,stage[req.i])
            if (stage[reqId] === 5) {
                remotes[reqId].write(data);
            } else if (stage[reqId] === 0) {
                if(req.d) return EMPTY
                try {
                    
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
                    const connect$=fromEvent(remote,'connect')
                    const buffered = client2remote$[reqId].pipe(buffer(connect$))
                    buffered.subscribe(d => remote.write(d))
                    let restdata:Buffer=null;
                    if (data.length > headerLength) {
                        // make sure no data is lost
                        restdata = Buffer.alloc(data.length - headerLength);
                        data.copy(restdata, 0, headerLength);
                    }
                    client2remote$[reqId]=merge(of(restdata),fromEvent())
                    stage[reqId] = 4;
                    return from([
                    fromEvent(remote,'data').pipe(
                        map(rsp => wrap({i:reqId,d:rsp,t:cnt++}))
                    ),
                    fromEvent(remote,'close').pipe(
                        map((hadError)=>{
                            writeLog(`remote disconnected ${hadError?'with':'without'} error`,reqId)
                            clearAll(reqId)
                            return wrap({i:reqId,e:'remote disconnected',t:cnt++})
                        })
                    ),
                    fromEvent(remote,'error').pipe(
                        map(e => {
                            writeLog(`remote: ${e}`,reqId);
                            clearAll(reqId)
                            return ((wrap({i:reqId,e:'error',d:e,t:cnt++})))
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
    }*/
    bindClientDisconnect(client: any, callback: Function): void {
        client.on('close', () => {
            remotes.forEach((r)=>r.destroy())
            remotes.clear()
            stage.clear()
            cachedPieces.clear()
            writeLog('client disconnected',client)
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