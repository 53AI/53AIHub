const M = "-", B = /^xn--/, S = /[^\0-\x7F]/, T = /[\x2E\u3002\uFF0E\uFF61]/g, D = { overflow: "Overflow: input needs wider integers to process", "not-basic": "Illegal input >= 0x80 (not a basic code point)", "invalid-input": "Invalid input" }, C = 36 - 1, u = Math.floor, g = String.fromCharCode;
function d(t) {
  throw new RangeError(D[t]);
}
function E(t, n) {
  const o = [];
  let e = t.length;
  for (; e--; )
    o[e] = n(t[e]);
  return o;
}
function m(t, n) {
  const o = t.split("@");
  let e = "";
  o.length > 1 && (e = o[0] + "@", t = o[1]), t = t.replace(T, ".");
  const s = t.split("."), c = E(s, n).join(".");
  return e + c;
}
function v(t) {
  const n = [];
  let o = 0;
  const e = t.length;
  for (; o < e; ) {
    const s = t.charCodeAt(o++);
    if (s >= 55296 && s <= 56319 && o < e) {
      const c = t.charCodeAt(o++);
      (c & 64512) == 56320 ? n.push(((s & 1023) << 10) + (c & 1023) + 65536) : (n.push(s), o--);
    } else
      n.push(s);
  }
  return n;
}
const L = (t) => String.fromCodePoint(...t), N = function(t) {
  return t >= 48 && t < 58 ? 26 + (t - 48) : t >= 65 && t < 91 ? t - 65 : t >= 97 && t < 123 ? t - 97 : 36;
}, I = function(t, n) {
  return t + 22 + 75 * (t < 26) - ((n != 0) << 5);
}, F = function(t, n, o) {
  let e = 0;
  for (t = o ? u(t / 700) : t >> 1, t += u(t / n); t > C * 26 >> 1; e += 36)
    t = u(t / C);
  return u(e + (C + 1) * t / (t + 38));
}, A = function(t) {
  const n = [], o = t.length;
  let e = 0, s = 128, c = 72, l = t.lastIndexOf(M);
  l < 0 && (l = 0);
  for (let i = 0; i < l; ++i)
    t.charCodeAt(i) >= 128 && d("not-basic"), n.push(t.charCodeAt(i));
  for (let i = l > 0 ? l + 1 : 0; i < o; ) {
    const r = e;
    for (let a = 1, f = 36; ; f += 36) {
      i >= o && d("invalid-input");
      const x = N(t.charCodeAt(i++));
      x >= 36 && d("invalid-input"), x > u((2147483647 - e) / a) && d("overflow"), e += x * a;
      const p = f <= c ? 1 : f >= c + 26 ? 26 : f - c;
      if (x < p)
        break;
      const b = 36 - p;
      a > u(2147483647 / b) && d("overflow"), a *= b;
    }
    const h = n.length + 1;
    c = F(e - r, h, r == 0), u(e / h) > 2147483647 - s && d("overflow"), s += u(e / h), e %= h, n.splice(e++, 0, s);
  }
  return String.fromCodePoint(...n);
}, k = function(t) {
  const n = [];
  t = v(t);
  const o = t.length;
  let e = 128, s = 0, c = 72;
  for (const r of t)
    r < 128 && n.push(g(r));
  const l = n.length;
  let i = l;
  for (l && n.push(M); i < o; ) {
    let r = 2147483647;
    for (const a of t)
      a >= e && a < r && (r = a);
    const h = i + 1;
    r - e > u((2147483647 - s) / h) && d("overflow"), s += (r - e) * h, e = r;
    for (const a of t)
      if (a < e && ++s > 2147483647 && d("overflow"), a === e) {
        let f = s;
        for (let x = 36; ; x += 36) {
          const p = x <= c ? 1 : x >= c + 26 ? 26 : x - c;
          if (f < p)
            break;
          const b = f - p, w = 36 - p;
          n.push(g(I(p + b % w, 0))), f = u(b / w);
        }
        n.push(g(I(f, 0))), c = F(s, h, i === l), s = 0, ++i;
      }
    ++s, ++e;
  }
  return n.join("");
}, j = function(t) {
  return m(t, function(n) {
    return B.test(n) ? A(n.slice(4).toLowerCase()) : n;
  });
}, O = function(t) {
  return m(t, function(n) {
    return S.test(n) ? "xn--" + k(n) : n;
  });
}, V = { version: "2.3.1", ucs2: { decode: v, encode: L }, decode: A, encode: k, toASCII: O, toUnicode: j };
export {
  V as p
};
