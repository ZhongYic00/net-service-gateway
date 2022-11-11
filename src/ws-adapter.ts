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
class Tunnel {
    private clientmsg$:Subject<any>
    private clientrsp$:Subject<any>
    private encryptor:Encryptor
    private client2remote$ = new Map<number,[Socket,Array<Buffer>]>()
    private remote2client = new Map<number,Subscription>()
    public client2remoteCnt = 0
    public proxy2remoteCnt = 0
    public remote2proxyCnt = 0
    public proxy2clientCnt = 0
    private clearAll = (id?) => {
        if(!id){
            this.client2remote$.clear()
            this.remote2client.forEach((v)=>v.unsubscribe())
            this.remote2client.clear()
        }
        if(!this.client2remote$.has(id)) return
        this.remote2client.get(id).unsubscribe()
        this.remote2client.delete(id)
        this.client2remote$.delete(id)
    }
    private wrap = o => {
        const d=this.encryptor.encrypt(serialize(o))
        // writeLog('wrapped',d)
        return d
    }
    private unwrap = o => {
        const d=deserialize(this.encryptor.decrypt(o))
        // writeLog('unwrapped',d,'raw',o)
        return d
    }
    private send2remote(reqId:number,o:Buffer){
        const [remote,buffer]=this.client2remote$.get(reqId)
        if(!remote.connecting){
            const seqNum = this.proxy2remoteCnt++
            remote.write(o,(err)=>{console.warn(reqId,'remote write ERR!',`id=${seqNum}`,err,o.length,remote.connecting,remote.writable,remote.writableLength)})
            console.log(reqId,'write result',`id=${seqNum}`,remote.bytesWritten,remote.bytesRead)
        }
        else
            buffer.push(o)
    }
    constructor(client:WebSocket){
        this.encryptor = new Encryptor(KEY,METHOD)
        this.clientrsp$=new Subject()
        this.clientrsp$.subscribe(resp => {
            writeLog('clientrsp$ observes',resp)
            client.send(resp)
        })

        let cnt=0
        this.clientmsg$=new Subject()
        fromEvent(client, 'message').subscribe((msg:MessageEvent)=>{
            writeLog('receive',msg.data,++cnt)
            const req=this.unwrap(msg.data)
            const reqId = req.i
            if(!this.client2remote$.has(reqId)){
                if(req.h)this.initRemote(req)
            }
            else if(req.c)
                this.handleCtrl(req)
            else if(req.d){
                const o = req.d.buffer
                this.send2remote(reqId,o)
                writeLog(reqId,'this.client2remote$ observes',o)
                    // 'write result',remote.bytesWritten,remote.bytesRead)
            }
        })
    }
    private initRemote(req){
        writeLog('initRemote',req)
        try{
        const reqId:number = req.i
        let {remoteAddr,remotePort,headerLength} = req.h

        writeLog(reqId,remoteAddr,remotePort,'on connecting')
        let remote:Socket = nconnect(remotePort, remoteAddr)
        
        // must be here, or else callbackfn below are called first
        this.client2remote$.set(reqId,[remote,[]])
        console.log(reqId,'this.client2remote$ created',this.client2remote$.get(reqId))

        remote.on('ready',()=>{
            try{
                let [,buffer]=this.client2remote$.get(reqId)
            console.log(reqId,'ready','client,buffer=',this.client2remote$.get(reqId))
            buffer.forEach(o => this.send2remote(reqId,o))
            buffer=null
            console.log(this.client2remote$.get(reqId)[1].length)
            } catch(e){
                throw reqId + `unrecoverable error! ${e}`
            }
        })
        remote.on('data',(d)=>console.log(reqId,'remote data',d))
        remote.on('lookup',(err,addr,family,host)=>console.log(reqId,'lookup',err,addr,host))
        remote.setTimeout(timeout)
        
        const connect$=fromEvent(remote,'connect')
        
        // if (data.length > headerLength) {
        //     // make sure no data is lost
        //     restdata = Buffer.alloc(data.length - headerLength);
        //     data.copy(restdata, 0, headerLength);
        // }

        // const buffered = new Array()
        // this.client2remote$.get(reqId).pipe(takeUntil(connect$))// buffer/block? data before connected
        //     .subscribe(d => {
        //         writeLog(reqId,'this.client2remote$ buffered',d)
        //         buffered.push(d)
        //     })
        
        // this.client2remote$.get(reqId).subscribe(o=>{
        //     if(!o)return
        //     writeLog(reqId,'this.client2remote$ observes',o,
        //     'write result',remote.write(o,(err)=>{console.warn('remote write ERR!',err)}),remote.bytesWritten,remote.bytesRead)
        // })
        connect$.subscribe(()=>{
            writeLog(reqId,remoteAddr,'connected')
        })

        this.remote2client.set(reqId,from([
            fromEvent(remote,'data').pipe(
                map(rsp => {
                    writeLog(reqId,'remote received data')
                    return this.wrap({i:reqId,d:rsp,t:this.proxy2clientCnt++})
                })
            ),
            fromEvent(remote,'close').pipe(
                map((hadError)=>{
                    writeLog(reqId,`remote disconnected ${hadError?'with':'without'} error`)
                    this.clearAll(reqId)
                    return this.wrap({i:reqId,e:'remote disconnected',t:this.proxy2clientCnt++})
                })
            ),
            fromEvent(remote,'error').pipe(
                map(e => {
                    writeLog(reqId,`remote: ${e}`);
                    this.clearAll(reqId)
                    return ((this.wrap({i:reqId,e:'error',d:e,t:this.proxy2clientCnt++})))
                })
            ),
            fromEvent(remote,'timeout').pipe(
                map(()=>{
                    writeLog(reqId,'remote timeout');
                    this.clearAll(reqId)
                    return (this.wrap({i:reqId,e:'timeout',t:this.proxy2clientCnt++}))
                })
            )
        ])
        .pipe(mergeAll())
        .subscribe(d=>{
            writeLog('this.remote2client',d)
            this.clientrsp$.next(d)
        }))
        }catch(err){
            console.warn('ERR!',err)
        }
    }
    private handleCtrl(req){
        if(req.c === 'giveup'){
            this.clearAll(req.i)
            return of(this.wrap({i:req.i,a:'giveup ack',t:this.proxy2clientCnt++}))
        }
        else if(req.c) return of(this.wrap({i:req.i,e:'unknown command',t:this.proxy2clientCnt++}))
    }
}

if (['', 'null', 'table'].includes(METHOD.toLowerCase())) {
  METHOD = null;
}
export class WsIOAdapter extends WsAdapter {
    private clients = new Map<WebSocket,Tunnel>()
    bindMessageHandlers(
        client: WebSocket,
        handlers: MessageMappingProperties[],
        process: (data: any) => Observable<any>,
    ) {
        writeLog(`bindMessgaeHandlers on ${client} uniq:${this.clients.has(client)}`)
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
            bindClientDisconnect(client: any, callback: Function): void {
                client.on('close', () => {
                    writeLog('client disconnected')
                    this.clients.delete(client)
                    callback(client)
                });
            }
            bindClientConnect(server:WebSocket.Server,callback){
                server.on('connection',(client:WebSocket,request)=>{
                    writeLog('client connected')
                    this.clients.set(client,new Tunnel(client))
                    callback(client,request)
                })
            }
        }