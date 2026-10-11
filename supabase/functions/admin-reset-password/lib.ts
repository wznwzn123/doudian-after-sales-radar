// 临时密码：12 位，必含大写、小写、数字、符号（满足前端 strong() 的规则），去掉易混淆字符（0/O、1/l/I）。
const UP = "ABCDEFGHJKLMNPQRSTUVWXYZ", LO = "abcdefghijkmnpqrstuvwxyz", DI = "23456789", SY = "!@#$%&*?";
const ALL = UP + LO + DI + SY;

function pick(set: string, rnd: () => number): string {
  return set[rnd() % set.length];
}

export function tempPassword(len = 12, rnd: () => number = cryptoRand): string {
  const chars = [pick(UP, rnd), pick(LO, rnd), pick(DI, rnd), pick(SY, rnd)];
  while (chars.length < len) chars.push(pick(ALL, rnd));
  for (let i = chars.length - 1; i > 0; i--) { const j = rnd() % (i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}

function cryptoRand(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

// 和前端 strong() 同一条规则
export function strong(p: string): boolean {
  return p.length >= 8 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p);
}

export function isUuid(v: unknown): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ""));
}
