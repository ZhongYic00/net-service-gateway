import * as WebSocket from 'ws';
import { INestApplicationContext } from '@nestjs/common';
import { MessageMappingProperties } from '@nestjs/websockets';
import { WsAdapter } from '@nestjs/platform-ws'
import { Observable, fromEvent, EMPTY, observable, Subscriber, of, map, from, merge, Subscription, Subject } from 'rxjs';
import { mergeMap, filter, mergeAll, buffer, takeUntil } from 'rxjs/operators';
import { connect as nconnect, Socket } from 'net';
import {serialize,deserialize} from 'bson';
import { Encryptor } from 'src/encrypt.service';
import { AppService } from './app.service';
import { write } from 'fs';

const config = {
    timeout: 600,
    password: "`try*(^^$some^$%^complex>:<>?~password/",
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
const inetNtoa = buf => buf[0] + '.' + buf[1] + '.' + buf[2] + '.' + buf[3];
const stage = new Map<number,number>()
const remotes = new Map<number,Socket>()
const cachedPieces = new Map()
const client2remote$ = new Map<number,Observable<any>>()
const remote2client = new Map<number,Subscription>()
var cnt:number = 0

const clearAll = (id) => {
    if(!client2remote$.has(id)) return
    remote2client.get(id).unsubscribe()
    remote2client.delete(id)
    client2remote$.delete(id)
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

    private clientmsg$:Subject<any>
    private clientrsp$:Subject<any>
    private encryptor:Encryptor
    private wrap = o => {
        const d=this.encryptor.encrypt(serialize(o))
        writeLog('wrapped',d)
        return d
    }
    private unwrap = o => {
        const d=deserialize(this.encryptor.decrypt(o))
        writeLog('unwrapped',d,'raw',o)
        return d
    }
    bindMessageHandlers(
        client: WebSocket,
        handlers: MessageMappingProperties[],
        process: (data: any) => Observable<any>,
    ) {
        this.clientrsp$=new Subject()
        this.clientrsp$.subscribe(resp => {
            writeLog('clientrsp$ observes',resp)
            client.send(resp)
        })

        let cnt=0
        this.clientmsg$=new Subject()
        fromEvent(client, 'message').subscribe((msg:MessageEvent)=>{
            writeLog('receive',msg.data,++cnt)
            this.clientmsg$.next(this.unwrap(msg.data))
        });
        
        this.clientmsg$
            .subscribe(req => {
                if(!client2remote$.has(req.i))
                    this.initRemote(req)
                else if(req.c!==null)
                    this.handleCtrl(req)
            })
        // this.clientmsg$.pipe(filter(req=>req.c!==null))
        //     .subscribe(req=>{
        //         this.handleCtrl(req)
        //     })
        // this.clientmsg$.pipe(
        //     mergeMap((req) => this.resolveRequest(req))
        // ).subscribe(
        //     response => client.send(response)
        // );
    }
    private initRemote(req){
        writeLog('initRemote',req)
        try{
        const reqId:number = req.i
        let data:Buffer = (req.d || req.h).buffer
        let {remoteAddr,remotePort,headerLength} = parseHeader(data)

        writeLog(reqId,remoteAddr,remotePort,'on connecting')
        let remote = nconnect(remotePort, remoteAddr)
        remote.setTimeout(timeout)
        remote.on('data',(d)=>{console.log('remote data',d)})
        
        const connect$=fromEvent(remote,'connect')
        
        let restdata:Buffer=null;
        if (data.length > headerLength) {
            // make sure no data is lost
            restdata = Buffer.alloc(data.length - headerLength);
            data.copy(restdata, 0, headerLength);
        }
        client2remote$.set(reqId,merge(of(restdata),this.clientmsg$.pipe(filter(req=>req.i===reqId&&!req.c),map(req=>(req.d||req.h).buffer))))
        client2remote$.get(reqId).subscribe(d=>console.log('client2remote$',reqId,'uobserves',d))
        console.log('client2remote$ created',reqId)

        const buffered = new Array()
        client2remote$.get(reqId).pipe(takeUntil(connect$))// buffer/block? data before connected
            .subscribe(d => {
                writeLog('client2remote$',reqId,'bobserve',d)
                buffered.push(d)
            })
        
        client2remote$.get(reqId).subscribe(o=>{
            if(!o)return
            writeLog('client2remote$',reqId,'observes',typeof o,remote.writable,
            remote.write(o,(err)=>{console.warn('remote write ERR!',err)}))
        })
        connect$.subscribe(()=>{
            writeLog(reqId,remoteAddr,'connected')
            // console.log(buffered)
            // for(let d in buffered)
            //     remote.write(d)
        }) // resolve data after connected


        remote2client.set(reqId,from([
            fromEvent(remote,'data').pipe(
                map(rsp => {
                    writeLog('remote received data',reqId)
                    return this.wrap({i:reqId,d:rsp,t:cnt++})
                })
            ),
            fromEvent(remote,'close').pipe(
                map((hadError)=>{
                    writeLog(`remote disconnected ${hadError?'with':'without'} error`,reqId)
                    clearAll(reqId)
                    return this.wrap({i:reqId,e:'remote disconnected',t:cnt++})
                })
            ),
            fromEvent(remote,'error').pipe(
                map(e => {
                    writeLog(`remote: ${e}`,reqId);
                    clearAll(reqId)
                    return ((this.wrap({i:reqId,e:'error',d:e,t:cnt++})))
                })
            ),
            fromEvent(remote,'timeout').pipe(
                map(()=>{
                    writeLog('remote timeout');
                    clearAll(reqId)
                    return (this.wrap({i:reqId,e:'timeout',t:cnt++}))
                })
            )
        ])
        .pipe(mergeAll())
        .subscribe(d=>{
            writeLog('remote2client',d)
            this.clientrsp$.next(d)
        }))
        }catch(err){
            console.warn('ERR!',err)
        }
    }
    private handleCtrl(req){
        if(req.c === 'giveup'){
            clearAll(req.i)
            return of(this.wrap({i:req.i,a:'giveup ack',t:cnt++}))
        }
        else if(req.c) return of(this.wrap({i:req.i,e:'unknown command',t:cnt++}))
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
            this.encryptor = new Encryptor(KEY,METHOD)
            cnt = 0
            callback(client,request)
        })
    }
}