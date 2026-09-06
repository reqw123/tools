/**
 * 極簡 MD5——只用來把「分類字串」轉成穩定的色環角度（對應
 * sticky_note_service.color_for_tag 裡的 hashlib.md5）。不是給安全用途的。
 * 標準演算法（RFC 1321），以 UTF-8 位元組為輸入，回傳 32 字小寫十六進位。
 */

function toBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

function rotl(x: number, c: number): number {
  return (x << c) | (x >>> (32 - c))
}

// 每回合的位移量
const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
  14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15,
  21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]
// floor(abs(sin(i + 1)) * 2^32)
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32))

export function md5(input: string): string {
  const msg = toBytes(input)
  const origLenBits = msg.length * 8

  // padding：補 0x80，再補 0，直到長度 ≡ 56 (mod 64)，最後加 64-bit 長度（小端）
  const withPad = new Uint8Array(((msg.length + 8) >> 6 << 6) + 64)
  withPad.set(msg)
  withPad[msg.length] = 0x80
  const view = new DataView(withPad.buffer)
  view.setUint32(withPad.length - 8, origLenBits >>> 0, true)
  view.setUint32(withPad.length - 4, Math.floor(origLenBits / 2 ** 32), true)

  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476

  const M = new Int32Array(16)
  for (let off = 0; off < withPad.length; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = view.getUint32(off + i * 4, true)

    let a = a0
    let b = b0
    let c = c0
    let d = d0

    for (let i = 0; i < 64; i++) {
      let f: number
      let g: number
      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      } else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) % 16
      }
      f = (f + a + K[i] + M[g]) | 0
      a = d
      d = c
      c = b
      b = (b + rotl(f, S[i])) | 0
    }

    a0 = (a0 + a) | 0
    b0 = (b0 + b) | 0
    c0 = (c0 + c) | 0
    d0 = (d0 + d) | 0
  }

  const hex = (n: number) => {
    let s = ''
    for (let i = 0; i < 4; i++) s += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0')
    return s
  }
  return hex(a0) + hex(b0) + hex(c0) + hex(d0)
}
