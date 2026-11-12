// Three original example sprites so the library isn't empty on first launch.
const PALETTE: Record<string, string> = {
  K: '#1a1423', G: '#4fbf4a', L: '#b8f0a0', D: '#2a7d3a', M: '#d03a3a',
  R: '#d23c3c', W: '#f6f0e6', S: '#f2d2a9', P: '#c46a5a',
  H: '#b9c0cc', C: '#2f5fb3', Y: '#f2c14e',
};

const SLIME = [
  '....KKKK....',
  '..KKGGGGKK..',
  '.KGGGGGGLGK.',
  '.KGGGGGGGLK.',
  'KGGKGGGKGGGK',
  'KGGKGGGKGGGK',
  'KGGGGGGGGGGK',
  'KDGGGMMGGGDK',
  '.KDDGGGGDDK.',
  '..KKKKKKKK..',
];

const MUSHROOM = [
  '....KKKK....',
  '..KKRRRRKK..',
  '.KRRWWRRRRK.',
  'KRRWWWRRWWRK',
  'KRRRWRRRWWRK',
  'KRRRRRRRRRRK',
  'KWWRRRWWRRRK',
  '.KKKKKKKKKK.',
  '..KSSSSSSK..',
  '..KSKSSKSK..',
  '..KSSSSSSK..',
  '..KSSPPSSK..',
  '...KSSSSK...',
  '....KKKK....',
];

const KNIGHT = [
  '.....KKKK.....',
  '....KHHHHK....',
  '...KHHHHHHK...',
  '...KHKKKKHK...',
  '...KHHHHHHK...',
  '....KKKKKK....',
  '..KKCCCCCCKK..',
  '.KHHKCYYCKHHK.',
  '.KHHKCYYCKHHK.',
  '.KKKKCCCCKKKK.',
  '....KCCCCK....',
  '....KHKKHK....',
  '...KHHK.KHHK..',
  '...KKKK.KKKK..',
];

export async function makeSampleSheet(): Promise<Blob> {
  const sprites = [KNIGHT, SLIME, MUSHROOM];
  const pad = 4;
  const w = sprites.reduce((s, sp) => s + sp[0].length + pad, pad);
  const h = Math.max(...sprites.map((s) => s.length)) + pad * 2;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  let ox = pad;
  for (const sp of sprites) {
    const oy = h - pad - sp.length;
    sp.forEach((row, y) =>
      row.split('').forEach((ch, x) => {
        if (ch === '.') return;
        ctx.fillStyle = PALETTE[ch];
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }),
    );
    ox += sp[0].length + pad;
  }
  return new Promise((res) => c.toBlob((b) => res(b!), 'image/png'));
}
