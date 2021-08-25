const net = require('net');
const url = require('url');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const parseArgs = require('minimist');
const HttpsProxyAgent = require('https-proxy-agent');
const { Encryptor } = require('./encrypt');
const BSON = require('bson');

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
    config_file: path.resolve(__dirname, 'config.json')
  }
};

const inetNtoa = buf => buf[0] + '.' + buf[1] + '.' + buf[2] + '.' + buf[3];

const configFromArgs = parseArgs(process.argv.slice(2), options);
const configContent = fs.readFileSync(configFromArgs.config_file);
const config = JSON.parse(configContent);
for (let k in configFromArgs) {
  const v = configFromArgs[k];
  config[k] = v;
}

const SCHEME = config.scheme;
let SERVER = config.server;
const REMOTE_PORT = config.remote_port;
const LOCAL_ADDRESS = config.local_address;
const PORT = config.local_port;
const KEY = config.password;
let METHOD = config.method;
const timeout = Math.floor(config.timeout * 1000);

if (['', 'null', 'table'].includes(METHOD.toLowerCase())) {
  METHOD = null;
}

const HTTPPROXY = process.env.http_proxy;

if (HTTPPROXY) {
  console.log('http proxy:', HTTPPROXY);
}

const prepareServer = function(address) {
  const serverUrl = url.parse(address);
  serverUrl.slashes = true;
  if (!serverUrl.protocol) {
    serverUrl.protocol = SCHEME;
  }
  if (!serverUrl.hostname) {
    serverUrl.hostname = address;
    serverUrl.pathname = '/';
  }
  if (!serverUrl.port) {
    serverUrl.port = REMOTE_PORT;
  }
  return url.format(serverUrl);
};

if (SERVER instanceof Array) {
  SERVER = SERVER.map(s => prepareServer(s));
} else {
  SERVER = prepareServer(SERVER);
}

const getServer = function() {
  if (SERVER instanceof Array) {
    return SERVER[Math.floor(Math.random() * SERVER.length)];
  } else {
    return SERVER;
  }
};

var ws = null; //singleton websocket connection
console.log(KEY,METHOD)
let encryptor = new Encryptor(KEY, METHOD);
const wrap = data => encryptor.encrypt(BSON.serialize(data))
const unwrap = data => BSON.deserialize(encryptor.decrypt(data))
const singleshot = setTimeout(()=>{
  if(ws){
    ws.terminate()
    ws = null
  }
},1000*3) //timeout to close ws conn
const conns = new Map(); //connection pool
const idPool = [];
var idCnt = 0;
//const getId = ()=> idPool.length ? idPool.pop() : (idPool.push(++idCnt),idCnt);
const getId = () => ++idCnt;
let sendCache = [];
const aServer = getServer();

const startWs = ()=>{
  if(ws) return
  console.log('initiating ws')
  encryptor = new Encryptor(KEY,METHOD)
  if (HTTPPROXY) {
    // WebSocket endpoint for the proxy to connect to
    const endpoint = aServer;
    const parsed = url.parse(endpoint);
    //console.log('attempting to connect to WebSocket %j', endpoint);

    // create an instance of the `HttpsProxyAgent` class with the proxy server information
    const opts = url.parse(HTTPPROXY);

    // IMPORTANT! Set the `secureEndpoint` option to `false` when connecting
    //            over "ws://", but `true` when connecting over "wss://"
    opts.secureEndpoint = parsed.protocol
      ? parsed.protocol == 'wss:'
      : false;

    const agent = new HttpsProxyAgent(opts);

    ws = new WebSocket(aServer, {
      protocol: 'binary',
      agent
    });
  } else {
    ws = new WebSocket(aServer, {
      protocol: 'binary'
    });
  }
  let ping = null
  singleshot.refresh()
  ws.on('open',(socket) => {
    console.log('remote connected')
    while(sendCache.length){
      //console.log('sending cached')
      ws.send(wrap(sendCache.shift()),{binary:true});
    }
    ping = setInterval(()=>ws.ping(), 50*1000)
  })
  ws.on('message', function(buffer, flags) {
    //console.log('onmessage',buffer)
    let response = unwrap(buffer)
    try{
      if(response.d && conns[response.i]) conns[response.i].write(response.d.buffer);
      else if(response.a) {
        console.log(`giveup ${response.i} acknowledged`)
        idPool.push(response.i)
      }
      else if(response.e){
        console.log(`remote throw ${response.i}:${response.e}`)
        conns[response.i]?(conns[response.i].destroy(),conns[response.i] = null):null
      }
    } catch(e){
      console.log('Error',e)
    }
  });

  ws.on('close', function() {
    clearInterval(ping);
    ws = null
    console.log('remote disconnected');
    conns.forEach((conn,key,m)=>{
      idPool.push(key)
      conn.destroy()
    });
    conns.clear()
  });

  ws.on('error', function(e) {
    console.log(`remote error: ${e}`);
    ws.terminate()
    ws = null
  });
}
let cnt = 0
const send = (data) => {
  //console.log('content',data.d || data.h || data.e)
  data.t = ++cnt
  startWs()
  if(ws && ws.readyState == WebSocket.OPEN) ws.send(wrap(data),{binary:true})
  else sendCache.push(data)
}
const giveUp = (id) => {
  console.log('give up connection',id)
  if(conns[id]) conns[id].destroy()
  conns[id] = null
  sendCache = sendCache.filter((item)=> item.i != id)
  if(ws) {
    send({i:id,c:'giveup'})
  }
  server.getConnections((e,n) => n == 0 ? singleshot.refresh() : null)
}

var server = net.createServer(function(connection) {
  clearTimeout(singleshot);
  let connId = getId();
  console.log('local connected',connId);
  conns[connId]=connection;
  server.getConnections(function(err, count) {
    console.log('concurrent connections:', count);
  });
  
  let stage = 0;
  let headerLength = 0;
  let addrLen = 0;
  let remoteAddr = null;
  let remotePort = null;
  let addrToSend = '';
  connection.on('data', function(data) {
    //console.log('receive',data)
    if (stage === 0) {
      const tempBuf = Buffer.alloc(2);
      tempBuf.write('\u0005\u0000', 0);
      connection.write(tempBuf);
      startWs();
      stage = 1;
      return;
    }
    if (stage === 1) {
      try {
        // +----+-----+-------+------+----------+----------+
        // |VER | CMD |  RSV  | ATYP | DST.ADDR | DST.PORT |
        // +----+-----+-------+------+----------+----------+
        // | 1  |  1  | X'00' |  1   | Variable |    2     |
        // +----+-----+-------+------+----------+----------+

        //cmd and addrtype
        const cmd = data[1];
        const addrtype = data[3];
        if (cmd !== 1) {
          console.warn('unsupported cmd:', cmd);
          const reply = Buffer.from('\u0005\u0007\u0000\u0001', 'binary');
          connection.end(reply);
          return;
        }
        if (addrtype === 3) {
          addrLen = data[4];
        } else if (addrtype !== 1) {
          console.warn('unsupported addrtype:', addrtype);
          connection.end();
          return;
        }
        addrToSend = data.slice(3, 4).toString('binary');
        // read address and port
        if (addrtype === 1) {
          remoteAddr = inetNtoa(data.slice(4, 8));
          addrToSend += data.slice(4, 10).toString('binary');
          remotePort = data.readUInt16BE(8);
          headerLength = 10;
        } else {
          remoteAddr = data.slice(5, 5 + addrLen).toString('binary');
          addrToSend += data.slice(4, 5 + addrLen + 2).toString('binary');
          remotePort = data.readUInt16BE(5 + addrLen);
          headerLength = 5 + addrLen + 2;
        }
        let buf = new Buffer.alloc(10);
        buf.write('\u0005\u0000\u0000\u0001', 0, 4, 'binary');
        buf.write('\u0000\u0000\u0000\u0000', 4, 4, 'binary');
        buf.writeUInt16BE(remotePort, 8);
        connection.write(buf);
        // connect to remote server
        // ws = new WebSocket aServer, protocol: "binary"
        
        console.log(`connecting ${remoteAddr} via ${aServer}`);
        let addrToSendBuf = new Buffer.from(addrToSend,'binary');
        send({i:connId,h:addrToSendBuf});

        if (data.length > headerLength) {
          buf = new Buffer.alloc(data.length - headerLength);
          data.copy(buf, 0, headerLength);
          send({i:connId,d:buf});
          buf = null;
        }
        stage = 4;
      } catch (error) {
        // may encounter index out of range
        const e = error;
        console.log(e);
        connection.destroy();
      }
    } else if (stage === 4) {
      // remote server not connected
      // cache received buffers
      // make sure no data is lost
      send({i:connId,d:data});
    }
  });

  connection.on('close',()=>console.log('local destroyed',connId))
  connection.on('end', function() {
    console.log('local disconnected',connId);
    giveUp(connId)
    server.getConnections(function(err, count) {
      console.log('concurrent connections:', count);
    });
  });

  connection.on('error', function(e) {
    console.log(`local error: ${e}`);
    giveUp(connId)
    server.getConnections(function(err, count) {
      console.log('concurrent connections:', count);
    });
  });

  connection.setTimeout(timeout, function() {
    console.log('local timeout');
    giveUp(connId)
  });
});

server.listen(PORT, LOCAL_ADDRESS, function() {
  const address = server.address();
  console.log('server listening at', address);
});

server.on('error', function(e) {
  if (e.code === 'EADDRINUSE') {
    console.log('address in use, aborting');
  }
  process.exit(1);
});
