// Writes .br and .gz copies of built JS/CSS so the server can send them without compressing on every request.
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const dir = path.resolve('web/dist/assets');
for (const f of fs.readdirSync(dir).filter((f) => /\.(js|css)$/.test(f))) {
  const buf = fs.readFileSync(path.join(dir, f));
  fs.writeFileSync(path.join(dir, f + '.br'), zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }));
  fs.writeFileSync(path.join(dir, f + '.gz'), zlib.gzipSync(buf, { level: 9 }));
}
console.log('precompressed assets');
