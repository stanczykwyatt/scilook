// What the shared readers expect from Node or a browser, for Quick Look's bare JavaScript engine:
// the parts of Node's Buffer the HDF5 reader uses, and a TextDecoder for UTF-8, UTF-16 and Latin-1.
// In Node and browsers the real ones are kept.

class LiteDecoder {
  constructor(label = "utf-8") {
    this.encoding = String(label).toLowerCase().replace(/^utf8$/, "utf-8").replace(/^(iso-8859-1|ascii|binary)$/, "latin1");
  }
  decode(bytes = new Uint8Array(0)) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength ?? bytes.length);
    let s = "";
    if (this.encoding === "latin1") {
      for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
      return s;
    }
    if (this.encoding === "utf-16le") {
      for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b[i] | (b[i + 1] << 8));
      return s;
    }
    for (let i = 0; i < b.length; ) {
      const c = b[i];
      let cp;
      let n;
      if (c < 0x80) (cp = c), (n = 1);
      else if (c >= 0xc0 && c < 0xe0) (cp = c & 0x1f), (n = 2);
      else if (c >= 0xe0 && c < 0xf0) (cp = c & 0x0f), (n = 3);
      else if (c >= 0xf0 && c < 0xf8) (cp = c & 0x07), (n = 4);
      else {
        s += "�";
        i++;
        continue;
      }
      let ok = i + n <= b.length;
      for (let k = 1; ok && k < n; k++) {
        if ((b[i + k] & 0xc0) !== 0x80) ok = false;
        else cp = (cp << 6) | (b[i + k] & 0x3f);
      }
      // Overlong forms, surrogates and code points past U+10FFFF are invalid, as in Node.
      const min = [0, 0, 0x80, 0x800, 0x10000][n];
      if (!ok || cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
        s += "�";
        i++;
        continue;
      }
      s += String.fromCodePoint(cp);
      i += n;
    }
    return s;
  }
}

class LiteBuffer extends Uint8Array {
  static alloc(n) {
    return new LiteBuffer(n);
  }
  static from(x) {
    if (typeof x === "string") return new LiteBuffer(Array.from(x, (c) => c.charCodeAt(0) & 0xff));
    if (ArrayBuffer.isView(x)) return new LiteBuffer(new Uint8Array(x.buffer, x.byteOffset, x.byteLength));
    return new LiteBuffer(x);
  }
  static concat(list) {
    const out = new LiteBuffer(list.reduce((n, b) => n + b.length, 0));
    let at = 0;
    for (const b of list) {
      out.set(b, at);
      at += b.length;
    }
    return out;
  }
  get view() {
    return new DataView(this.buffer, this.byteOffset, this.byteLength);
  }
  toString(encoding = "utf8", start = 0, end = this.length) {
    return new LiteDecoder(encoding).decode(this.subarray(start, end));
  }
  equals(other) {
    return this.length === other.length && this.every((v, i) => v === other[i]);
  }
  copy(target, targetStart = 0, start = 0, end = this.length) {
    const piece = this.subarray(start, Math.min(end, start + target.length - targetStart));
    target.set(piece, targetStart);
    return piece.length;
  }
  readUInt8(at) {
    return this.view.getUint8(at);
  }
  readInt8(at) {
    return this.view.getInt8(at);
  }
}
const methods = {
  UInt16: "getUint16",
  Int16: "getInt16",
  UInt32: "getUint32",
  Int32: "getInt32",
  Float: "getFloat32",
  Double: "getFloat64",
  BigUInt64: "getBigUint64",
  BigInt64: "getBigInt64",
};
for (const [name, getter] of Object.entries(methods)) {
  LiteBuffer.prototype[`read${name}LE`] = function (at) {
    return this.view[getter](at, true);
  };
  LiteBuffer.prototype[`read${name}BE`] = function (at) {
    return this.view[getter](at, false);
  };
}

export function installShims(target = globalThis) {
  if (!target.TextDecoder) target.TextDecoder = LiteDecoder;
  if (!target.Buffer) target.Buffer = LiteBuffer;
}

export { LiteBuffer, LiteDecoder };
