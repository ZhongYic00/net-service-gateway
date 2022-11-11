import { Injectable } from '@nestjs/common';
import { createCipheriv,Cipher, createDecipheriv, createHash, randomBytes, scryptSync } from 'crypto';

const int32Max = Math.pow(2, 32);
const method_supported = {
  'aes-128-cfb': [16, 16],
  'aes-192-cfb': [24, 16],
  'aes-256-cfb': [32, 16],
  'bf-cfb': [16, 8],
  'camellia-128-cfb': [16, 16],
  'camellia-192-cfb': [24, 16],
  'camellia-256-cfb': [32, 16],
  'cast5-cfb': [16, 8],
  'des-cfb': [8, 8],
  'idea-cfb': [16, 8],
  'rc2-cfb': [16, 8],
  rc4: [16, 0],
  'rc4-md5': [16, 16],
  'seed-cfb': [16, 16]
};

const create_rc4_md5_cipher = function(key, iv, op) {
  const md5 = createHash('md5');
  md5.update(key);
  md5.update(iv);
  const rc4_key = md5.digest();
  if (op === 1) {
    return createCipheriv('rc4', rc4_key, '');
  } else {
    return createDecipheriv('rc4', rc4_key, '');
  }
};

@Injectable()
export class Encryptor {
    private passwd:string
    private method:string
    private iv_sent:boolean
    private cipher:Cipher
    private decipher:Cipher
    private cipher_iv:Buffer
  constructor(passwd, method) {
    this.passwd = passwd;
    this.method = method;
    this.iv_sent = false;
    if (this.method) {
      this.cipher = this.get_cipher(
        this.passwd,
        this.method,
        1,
        randomBytes(32)
      );
    }
  }

  get_cipher_len(method) {
    method = method.toLowerCase();
    return method_supported[method];
  }

  get_cipher(password, method, op, iv) {
    console.log('get_cipher',method,op,iv)
    method = method.toLowerCase();
    password = Buffer.from(password);
    const m = this.get_cipher_len(method);
    if (m) {
      let key = scryptSync(password, 'salt',m[0])
      if (op === 1) {
        this.cipher_iv = iv.slice(0, m[1]);
      }
      iv = iv.slice(0, m[1]);
      console.log('iv',iv)
      if (method === 'rc4-md5') {
        throw new Error("not supported")
        // return create_rc4_md5_cipher(key, iv, op);
      } else {
        if (op === 1) {
          return createCipheriv(method, key, iv);
        } else {
          return createDecipheriv(method, key, iv);
        }
      }
    }
  }

  encrypt(buf) {
    if (this.method) {
      const result = this.cipher.update(buf);
      if (this.iv_sent) {
        return result;
      } else {
        this.iv_sent = true;
        return Buffer.concat([this.cipher_iv, result]);
      }
    }
  }

  decrypt(buf) {
    // console.log('decrypt',buf)
    if (this.method) {
        let result;
        if (!this.decipher) {
            const decipher_iv_len = this.get_cipher_len(this.method)[1];
            const decipher_iv = buf.slice(0, decipher_iv_len);
            this.decipher = this.get_cipher(this.passwd, this.method, 0, decipher_iv);
            result = this.decipher.update(buf.slice(decipher_iv_len));
        } else {
            result = this.decipher.update(buf);
        }
    // console.log('decrypt over',result)
    return result;
    }
  }
}
