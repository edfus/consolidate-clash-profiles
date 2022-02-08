import { request } from "https";
import { promises as fsp } from 'fs';
import { pipeline, Transform, Writable } from "stream";

class StringReader extends Transform {
  constructor(maxLength = Infinity) {
    super({ readableObjectMode: true });
    this[Symbol.for("kLength")] = 0;
    this[Symbol.for("kMaxLength")] = maxLength;
    this[Symbol.for("kTmpSource")] = [];
  }

  _transform(chunk, enc, cb) {
    this[Symbol.for("kTmpSource")].push(chunk);
    if (this[Symbol.for("kLength")] += chunk.length > this[Symbol.for("kMaxLength")])
      return cb(new RangeError(`${this.constructor.name}: maxLength ${maxLength} reached.`));
    return cb();
  }

  _flush(cb) {
    if (!this[Symbol.for("kTmpSource")])
      return cb(new Error("Empty response"));

    const data = new TextDecoder("utf8").decode(
      Buffer.concat(this[Symbol.for("kTmpSource")])
    );

    return cb(null, data);
  }
}

async function fetch (url) {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      headers: {
        "accept": "application/json, text/plain, */*",
        "user-agent": "ClashforWindows/0.19.6",
      }
    });

    req.once("response", res => {
      let data = '';
      pipeline(
        res,
        new StringReader(),
        new Writable({
          objectMode: true,
          write (content, encoding, cb) {
            if (data) {
              return cb(new Error(`Guess pigs can fly`));
            } else {
              data = content;
            }
            return cb();
          }
        }),
        err => err ? reject(err) : resolve({
          headers: res.headers, payload: data, url
        })
      );
    });
    req.once("error", reject);
    req.once("close", reject);
    req.end();
  });
}

export { fetch as fetchProfile }