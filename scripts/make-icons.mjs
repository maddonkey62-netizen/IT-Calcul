// 외부 도구 없이 앱 아이콘 PNG 를 만든다: 파란 바탕 + 흰 필터 원판 + 아래로 떨어지는 방울.
// 실행: npm run icons  →  public/pwa-192.png, pwa-512.png, apple-touch-icon.png
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BLUE = [37, 99, 235];
const WHITE = [255, 255, 255];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** 0~1 좌표에서 흰색 비율(0~1)을 돌려주는 도형 */
function shape(x, y) {
  // 필터 원판 (링)
  const dx = x - 0.5;
  const dy = (y - 0.4) * 2.6;
  const r = Math.hypot(dx, dy);
  if (r < 0.3 && r > 0.22) return 1;
  // 원판 가운데 선
  if (Math.abs(y - 0.4) < 0.02 && Math.abs(dx) < 0.22) return 1;
  // 방울
  const by = 0.72;
  const d = Math.hypot(x - 0.5, y - by);
  if (d < 0.08) return 1;
  if (y < by && y > by - 0.16 && Math.abs(x - 0.5) < ((y - (by - 0.16)) / 0.16) * 0.08) return 1;
  return 0;
}

function png(size, { rounded }) {
  const S = 4; // 안티앨리어싱 샘플
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let w = 0;
      let a = 0;
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const x = (px + (sx + 0.5) / S) / size;
          const y = (py + (sy + 0.5) / S) / size;
          let inside = 1;
          if (rounded) {
            const rr = 0.2;
            const cx = Math.min(Math.max(x, rr), 1 - rr);
            const cy = Math.min(Math.max(y, rr), 1 - rr);
            inside = Math.hypot(x - cx, y - cy) <= rr ? 1 : 0;
          }
          a += inside;
          w += inside * shape(x, y);
        }
      const n = S * S;
      const wf = a ? w / a : 0;
      const o = py * (size * 4 + 1) + 1 + px * 4;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(BLUE[c] * (1 - wf) + WHITE[c] * wf);
      raw[o + 3] = Math.round((a / n) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public', { recursive: true });
// 홈 화면 아이콘은 OS 가 모서리를 깎으므로 꽉 찬 사각형으로 만든다
writeFileSync('public/pwa-192.png', png(192, { rounded: false }));
writeFileSync('public/pwa-512.png', png(512, { rounded: false }));
writeFileSync('public/apple-touch-icon.png', png(180, { rounded: false }));
console.log('icons written to public/');
