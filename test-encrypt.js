const net = require('net');
const url = require('url');
const http = require('http');
const fs = require('fs');
const path = require('path');
const parseArgs = require('minimist');
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

const configFromArgs = parseArgs(process.argv.slice(2), options);
const configContent = fs.readFileSync(configFromArgs.config_file);
const config = JSON.parse(configContent);
for (let k in configFromArgs) {
  const v = configFromArgs[k];
  config[k] = v;
}

const KEY = config.password;
let METHOD = config.method;
if (['', 'null', 'table'].includes(METHOD.toLowerCase())) {
  METHOD = null;
}

var ws = null; //singleton websocket connection
console.log(KEY,METHOD)
const encryptor = new Encryptor(KEY, METHOD);

const src = {sth:'edfcad33b93bbd72d360ea3a06984c0e4a2674bc6146df752f1429c79228'};
const buf = Buffer.from(BSON.serialize(src))
const wrap = obj => encryptor.encrypt(BSON.serialize(obj))
const unwrap = buf => BSON.deserialize(encryptor.decrypt(buf))
console.log(buf)
for(let i=0;i<10;i++){
    let res = wrap(src)
    let unwrapped = i%2 ? unwrap(res) :null
    console.log(res,unwrapped)
}