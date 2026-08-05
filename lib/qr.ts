// 功能性 QR 產生器：只支援本系統 48 字元以內的不透明報到 token。
// 報到 token 是隨機值，不含姓名、電話或其他可逆個資。

type Matrix = (boolean | null)[][];

const SIZE = 37;
const DATA_CODEWORDS = 108;
const EC_CODEWORDS = 26;

function multiply(a: number, b: number): number {
  let result = 0;
  while (b > 0) {
    if ((b & 1) !== 0) result ^= a;
    b >>>= 1;
    a = (a << 1) ^ ((a & 0x80) !== 0 ? 0x11d : 0);
  }
  return result & 0xff;
}

function generator(degree: number): number[] {
  const result = [1];
  for (let i = 0; i < degree; i += 1) {
    result.push(0);
    const root = (() => {
      let value = 1;
      for (let j = 0; j < i; j += 1) value = multiply(value, 2);
      return value;
    })();
    for (let j = result.length - 1; j > 0; j -= 1) result[j] = result[j - 1] ^ multiply(result[j], root);
    result[0] = multiply(result[0], root);
  }
  return result;
}

function errorCorrection(data: number[]): number[] {
  const divisor = generator(EC_CODEWORDS);
  const remainder = new Array<number>(EC_CODEWORDS).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < remainder.length; i += 1) remainder[i] ^= multiply(divisor[i + 1], factor);
  }
  return remainder;
}

function bytesFor(value: string): number[] {
  const bytes = Array.from(new TextEncoder().encode(value));
  if (bytes.length > 48) throw new Error("QR 內容過長");
  const bits: number[] = [0, 1, 0, 0];
  for (let i = 7; i >= 0; i -= 1) bits.push((bytes.length >>> i) & 1);
  for (const byte of bytes) for (let i = 7; i >= 0; i -= 1) bits.push((byte >>> i) & 1);
  for (let i = 0; i < 4 && bits.length < DATA_CODEWORDS * 8; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const pads = [0xec, 0x11];
  let padIndex = 0;
  while (bits.length < DATA_CODEWORDS * 8) {
    const byte = pads[padIndex++ % pads.length];
    for (let i = 7; i >= 0; i -= 1) bits.push((byte >>> i) & 1);
  }
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((n, bit) => (n << 1) | bit, 0));
  return [...data, ...errorCorrection(data)];
}

function makeMatrix(value: string, mask: number): Matrix {
  const modules: Matrix = Array.from({ length: SIZE }, () => new Array<boolean | null>(SIZE).fill(null));
  const setFunction = (row: number, col: number, dark: boolean) => {
    if (row >= 0 && row < SIZE && col >= 0 && col < SIZE) modules[row][col] = dark;
  };
  const finder = (row: number, col: number) => {
    for (let dy = -1; dy <= 7; dy += 1) for (let dx = -1; dx <= 7; dx += 1) {
      const dark = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6 && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
      setFunction(row + dy, col + dx, dark);
    }
  };
  finder(0, 0);
  finder(0, SIZE - 7);
  finder(SIZE - 7, 0);
  for (let i = 8; i < SIZE - 8; i += 1) {
    if (modules[6][i] === null) setFunction(6, i, i % 2 === 0);
    if (modules[i][6] === null) setFunction(i, 6, i % 2 === 0);
  }
  const alignment = [6, 30];
  for (const row of alignment) for (const col of alignment) {
    if (modules[row][col] !== null) continue;
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) setFunction(row + dy, col + dx, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  for (let i = 0; i < 15; i += 1) {
    const bit = formatBits(mask) >>> i & 1;
    if (i < 6) setFunction(i, 8, bit !== 0);
    else if (i < 8) setFunction(i + 1, 8, bit !== 0);
    else setFunction(SIZE - 15 + i, 8, bit !== 0);
    if (i < 8) setFunction(8, SIZE - i - 1, bit !== 0);
    else if (i < 9) setFunction(8, 15 - i - 1 + 1, bit !== 0);
    else setFunction(8, 15 - i - 1, bit !== 0);
  }
  setFunction(SIZE - 8, 8, true);

  const codewords = bytesFor(value);
  const bits = codewords.flatMap((byte) => Array.from({ length: 8 }, (_, i) => (byte >>> (7 - i)) & 1));
  let bitIndex = 0;
  let upward = true;
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let offset = 0; offset < SIZE; offset += 1) {
      const row = upward ? SIZE - 1 - offset : offset;
      for (const col of [right, right - 1]) {
        if (modules[row][col] !== null) continue;
        const raw = bitIndex < bits.length ? bits[bitIndex++] !== 0 : false;
        modules[row][col] = raw !== maskBit(mask, row, col);
      }
    }
    upward = !upward;
  }
  return modules;
}

function formatBits(mask: number): number {
  const data = (1 << 3) | mask; // error correction level L = 01, then mask id
  let value = data << 10;
  const generatorPoly = 0x537;
  while (value >= 0x400) value ^= generatorPoly << (Math.floor(Math.log2(value)) - 10);
  return ((data << 10) | value) ^ 0x5412;
}

function maskBit(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return (row * col) % 2 + (row * col) % 3 === 0;
    case 6: return ((row * col) % 2 + (row * col) % 3) % 2 === 0;
    default: return ((row * col) % 3 + (row + col) % 2) % 2 === 0;
  }
}

function penalty(modules: Matrix): number {
  let score = 0;
  const lines: boolean[][] = [...modules.map((row) => row.map((cell) => cell ?? false)), ...Array.from({ length: SIZE }, (_, col) => modules.map((row) => row[col] ?? false))];
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i < line.length; i += 1) {
      if (line[i] === line[i - 1]) run += 1;
      else { if (run >= 5) score += 3 + run - 5; run = 1; }
    }
    if (run >= 5) score += 3 + run - 5;
    for (let i = 0; i <= line.length - 11; i += 1) {
      const pattern = line.slice(i, i + 11).map((x) => x ? "1" : "0").join("");
      if (pattern === "10111010000" || pattern === "00001011101") score += 40;
    }
  }
  for (let row = 0; row < SIZE - 1; row += 1) for (let col = 0; col < SIZE - 1; col += 1) {
    const a = modules[row][col];
    if (a === modules[row + 1][col] && a === modules[row][col + 1] && a === modules[row + 1][col + 1]) score += 3;
  }
  let dark = 0;
  for (const row of modules) for (const cell of row) if (cell) dark += 1;
  score += Math.floor(Math.abs((dark * 100) / (SIZE * SIZE) - 50) / 5) * 10;
  return score;
}

export function createQrSvg(value: string): string {
  const matrices = Array.from({ length: 8 }, (_, mask) => makeMatrix(value, mask));
  const best = matrices.reduce((winner, current) => penalty(current) < penalty(winner) ? current : winner);
  const quiet = 4;
  const size = SIZE + quiet * 2;
  const rects: string[] = [];
  for (let row = 0; row < SIZE; row += 1) for (let col = 0; col < SIZE; col += 1) if (best[row][col]) rects.push(`<rect x="${col + quiet}" y="${row + quiet}" width="1" height="1"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="報到 QR Code" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects.join("")}</g></svg>`;
}
