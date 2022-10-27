const crypto = require('crypto');
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
  const md5 = crypto.createHash('md5');
  md5.update(key);
  md5.update(iv);
  const rc4_key = md5.digest();
  if (op === 1) {
    return crypto.createCipheriv('rc4', rc4_key, '');
  } else {
    return crypto.createDecipheriv('rc4', rc4_key, '');
  }
};

class Encryptor {
  constructor(key, method) {
    this.key = key;
    this.method = method;
    this.iv_sent = false;
    if (this.method === 'table') {
      this.method = null;
    }
    if (this.method) {
      this.cipher = this.get_cipher(
        this.key,
        this.method,
        1,
        crypto.randomBytes(32)
      );
    }
  }

  get_cipher_len(method) {
    method = method.toLowerCase();
    return method_supported[method];
  }

  get_cipher(password, method, op, iv) {
    method = method.toLowerCase();
    password = Buffer.from(password);
    const m = this.get_cipher_len(method);
    if (m) {
      let key = crypto.scryptSync(password, 'salt',m[0])
      if (op === 1) {
        this.cipher_iv = iv.slice(0, m[1]);
      }
      iv = iv.slice(0, m[1]);
      if (method === 'rc4-md5') {
        throw new Error("not supported")
        // return create_rc4_md5_cipher(key, iv, op);
      } else {
        if (op === 1) {
          return crypto.createCipheriv(method, key, iv);
        } else {
          return crypto.createDecipheriv(method, key, iv);
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
    if (this.method) {
      let result;
      if (!this.decipher) {
        const decipher_iv_len = this.get_cipher_len(this.method)[1];
        const decipher_iv = buf.slice(0, decipher_iv_len);
        this.decipher = this.get_cipher(this.key, this.method, 0, decipher_iv);
        result = this.decipher.update(buf.slice(decipher_iv_len));
        return result;
      } else {
        result = this.decipher.update(buf);
        return result;
      }
    }
  }
}

exports.Encryptor = Encryptor;
