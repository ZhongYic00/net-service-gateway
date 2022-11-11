const net = require('net');
const url = require('url');
const http = require('http');
const fs = require('fs');
const path = require('path');
const parseArgs = require('minimist');
const { Encryptor } = require('./encrypt');
const BSON = require('bson');

const crypto = require('node:crypto');
// import {
//   scrypt,
//   randomFill,
//   createCipheriv
// } from crypto;

const algorithm = 'aes-192-cbc';
const password = 'Password used to generate key';

// First, we'll generate the key. The key length is dependent on the algorithm.
// In this case for aes192, it is 24 bytes (192 bits).
// crypto.scrypt(password, 'salt', 24, (err, key) => {
//   if (err) throw err;
//   // Then, we'll generate a random initialization vector
//   crypto.randomFill(new Uint8Array(16), (err, iv) => {
//     if (err) throw err;

//     // Once we have the key and iv, we can create and use the cipher...
//     const cipher = crypto.createCipheriv(algorithm, key, iv);

//     let encrypted = '';
//     cipher.setEncoding('hex');

//     cipher.on('data', (chunk) => encrypted += chunk);
//     cipher.on('end', () => console.log(encrypted));

//     cipher.write('some clear text data');
//     cipher.end();
//   });
// });
// return
// const options = {
//   alias: {
//     b: 'local_address',
//     l: 'local_port',
//     s: 'server',
//     r: 'remote_port',
//     k: 'password',
//     c: 'config_file',
//     m: 'method'
//   },
//   string: [
//     'local_address',
//     'server',
//     'password',
//     'config_file',
//     'method',
//     'scheme'
//   ],
//   default: {
//     config_file: path.resolve(__dirname, 'config.json')
//   }
// };

// const configFromArgs = parseArgs(process.argv.slice(2), options);
// const configContent = fs.readFileSync(configFromArgs.config_file);
// const config = JSON.parse(configContent);
// for (let k in configFromArgs) {
//   const v = configFromArgs[k];
//   config[k] = v;
// }

// const KEY = config.password;
// let METHOD = config.method;
// if (['', 'null', 'table'].includes(METHOD.toLowerCase())) {
//   METHOD = null;
// }

var ws = null; //singleton websocket connection

const config = {
  timeout: 600,
  password: "`try*(^^$some^$%^complex>:<>?~password",
  method: 'aes-256-cfb'
}
console.log(config.password,config.method)
const encryptor = new Encryptor(config.password,config.method);

const src = {sth:'edfcad33b93bbd72d360ea3a06984c0e4a2674bc6146df752f1429c79228'};
const buf = Buffer.from(BSON.serialize(src))
const wrap = obj => encryptor.encrypt(BSON.serialize(obj))
const unwrap = buf => BSON.deserialize(encryptor.decrypt(buf))
console.log(buf)
for(let i=0;i<10;i++){
    let res = wrap(src)
    let unwrapped = unwrap(res)
    console.log(res,unwrapped)
}