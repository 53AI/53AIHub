import { k as O, $ as or, d as U, f as Y, h as ur } from "./helper-7WMIPux3-736d9956.js";
import { t as cr } from "./init-DjUOC4st-cac434d1.js";
function q(r, n) {
  return r == null || n == null ? NaN : r < n ? -1 : r > n ? 1 : r >= n ? 0 : NaN;
}
function fr(r, n) {
  return r == null || n == null ? NaN : n < r ? -1 : n > r ? 1 : n >= r ? 0 : NaN;
}
function _(r) {
  let n, e, t;
  r.length !== 2 ? (n = q, e = (u, f) => q(r(u), f), t = (u, f) => r(u) - f) : (n = r === q || r === fr ? r : sr, e = r, t = r);
  function i(u, f, a = 0, g = u.length) {
    if (a < g) {
      if (n(f, f) !== 0)
        return g;
      do {
        const s = a + g >>> 1;
        e(u[s], f) < 0 ? a = s + 1 : g = s;
      } while (a < g);
    }
    return a;
  }
  function c(u, f, a = 0, g = u.length) {
    if (a < g) {
      if (n(f, f) !== 0)
        return g;
      do {
        const s = a + g >>> 1;
        e(u[s], f) <= 0 ? a = s + 1 : g = s;
      } while (a < g);
    }
    return a;
  }
  function o(u, f, a = 0, g = u.length) {
    const s = i(u, f, a, g - 1);
    return s > a && t(u[s - 1], f) > -t(u[s], f) ? s - 1 : s;
  }
  return { left: i, center: o, right: c };
}
function sr() {
  return 0;
}
function lr(r) {
  return r === null ? NaN : +r;
}
const hr = _(q), gr = hr.right;
_(lr).center;
const pr = Math.sqrt(50), vr = Math.sqrt(10), dr = Math.sqrt(2);
function C(r, n, e) {
  const t = (n - r) / Math.max(0, e), i = Math.floor(Math.log10(t)), c = t / Math.pow(10, i), o = c >= pr ? 10 : c >= vr ? 5 : c >= dr ? 2 : 1;
  let u, f, a;
  return i < 0 ? (a = Math.pow(10, -i) / o, u = Math.round(r * a), f = Math.round(n * a), u / a < r && ++u, f / a > n && --f, a = -a) : (a = Math.pow(10, i) * o, u = Math.round(r / a), f = Math.round(n / a), u * a < r && ++u, f * a > n && --f), f < u && 0.5 <= e && e < 2 ? C(r, n, e * 2) : [u, f, a];
}
function Mr(r, n, e) {
  if (n = +n, r = +r, e = +e, !(e > 0))
    return [];
  if (r === n)
    return [r];
  const t = n < r, [i, c, o] = t ? C(n, r, e) : C(r, n, e);
  if (!(c >= i))
    return [];
  const u = c - i + 1, f = new Array(u);
  if (t)
    if (o < 0)
      for (let a = 0; a < u; ++a)
        f[a] = (c - a) / -o;
    else
      for (let a = 0; a < u; ++a)
        f[a] = (c - a) * o;
  else if (o < 0)
    for (let a = 0; a < u; ++a)
      f[a] = (i + a) / -o;
  else
    for (let a = 0; a < u; ++a)
      f[a] = (i + a) * o;
  return f;
}
function V(r, n, e) {
  return n = +n, r = +r, e = +e, C(r, n, e)[2];
}
function mr(r, n, e) {
  n = +n, r = +r, e = +e;
  const t = n < r, i = t ? V(n, r, e) : V(r, n, e);
  return (t ? -1 : 1) * (i < 0 ? 1 / -i : i);
}
function yr(r, n) {
  n || (n = []);
  var e = r ? Math.min(n.length, r.length) : 0, t = n.slice(), i;
  return function(c) {
    for (i = 0; i < e; ++i)
      t[i] = r[i] * (1 - c) + n[i] * c;
    return t;
  };
}
function br(r) {
  return ArrayBuffer.isView(r) && !(r instanceof DataView);
}
function wr(r, n) {
  var e = n ? n.length : 0, t = r ? Math.min(e, r.length) : 0, i = new Array(t), c = new Array(e), o;
  for (o = 0; o < t; ++o)
    i[o] = T(r[o], n[o]);
  for (; o < e; ++o)
    c[o] = n[o];
  return function(u) {
    for (o = 0; o < t; ++o)
      c[o] = i[o](u);
    return c;
  };
}
function Nr(r, n) {
  var e = /* @__PURE__ */ new Date();
  return r = +r, n = +n, function(t) {
    return e.setTime(r * (1 - t) + n * t), e;
  };
}
function xr(r, n) {
  var e = {}, t = {}, i;
  (r === null || typeof r != "object") && (r = {}), (n === null || typeof n != "object") && (n = {});
  for (i in n)
    i in r ? e[i] = T(r[i], n[i]) : t[i] = n[i];
  return function(c) {
    for (i in e)
      t[i] = e[i](c);
    return t;
  };
}
function T(r, n) {
  var e = typeof n, t;
  return n == null || e === "boolean" ? or(n) : (e === "number" ? O : e === "string" ? (t = U(n)) ? (n = t, Y) : ur : n instanceof U ? Y : n instanceof Date ? Nr : br(n) ? yr : Array.isArray(n) ? wr : typeof n.valueOf != "function" && typeof n.toString != "function" || isNaN(n) ? xr : O)(r, n);
}
function kr(r, n) {
  return r = +r, n = +n, function(e) {
    return Math.round(r * (1 - e) + n * e);
  };
}
function Ar(r) {
  return Math.abs(r = Math.round(r)) >= 1e21 ? r.toLocaleString("en").replace(/,/g, "") : r.toString(10);
}
function D(r, n) {
  if ((e = (r = n ? r.toExponential(n - 1) : r.toExponential()).indexOf("e")) < 0)
    return null;
  var e, t = r.slice(0, e);
  return [t.length > 1 ? t[0] + t.slice(2) : t, +r.slice(e + 1)];
}
function k(r) {
  return r = D(Math.abs(r)), r ? r[1] : NaN;
}
function Sr(r, n) {
  return function(e, t) {
    for (var i = e.length, c = [], o = 0, u = r[0], f = 0; i > 0 && u > 0 && (f + u + 1 > t && (u = Math.max(1, t - f)), c.push(e.substring(i -= u, i + u)), !((f += u + 1) > t)); )
      u = r[o = (o + 1) % r.length];
    return c.reverse().join(n);
  };
}
function jr(r) {
  return function(n) {
    return n.replace(/[0-9]/g, function(e) {
      return r[+e];
    });
  };
}
var zr = /^(?:(.)?([<>=^]))?([+\-( ])?([$#])?(0)?(\d+)?(,)?(\.\d+)?(~)?([a-z%])?$/i;
function F(r) {
  if (!(n = zr.exec(r)))
    throw new Error("invalid format: " + r);
  var n;
  return new Z({ fill: n[1], align: n[2], sign: n[3], symbol: n[4], zero: n[5], width: n[6], comma: n[7], precision: n[8] && n[8].slice(1), trim: n[9], type: n[10] });
}
F.prototype = Z.prototype;
function Z(r) {
  this.fill = r.fill === void 0 ? " " : r.fill + "", this.align = r.align === void 0 ? ">" : r.align + "", this.sign = r.sign === void 0 ? "-" : r.sign + "", this.symbol = r.symbol === void 0 ? "" : r.symbol + "", this.zero = !!r.zero, this.width = r.width === void 0 ? void 0 : +r.width, this.comma = !!r.comma, this.precision = r.precision === void 0 ? void 0 : +r.precision, this.trim = !!r.trim, this.type = r.type === void 0 ? "" : r.type + "";
}
Z.prototype.toString = function() {
  return this.fill + this.align + this.sign + this.symbol + (this.zero ? "0" : "") + (this.width === void 0 ? "" : Math.max(1, this.width | 0)) + (this.comma ? "," : "") + (this.precision === void 0 ? "" : "." + Math.max(0, this.precision | 0)) + (this.trim ? "~" : "") + this.type;
};
function $r(r) {
  r:
    for (var n = r.length, e = 1, t = -1, i; e < n; ++e)
      switch (r[e]) {
        case ".":
          t = i = e;
          break;
        case "0":
          t === 0 && (t = e), i = e;
          break;
        default:
          if (!+r[e])
            break r;
          t > 0 && (t = 0);
          break;
      }
  return t > 0 ? r.slice(0, t) + r.slice(i + 1) : r;
}
var rr;
function Er(r, n) {
  var e = D(r, n);
  if (!e)
    return r + "";
  var t = e[0], i = e[1], c = i - (rr = Math.max(-8, Math.min(8, Math.floor(i / 3))) * 3) + 1, o = t.length;
  return c === o ? t : c > o ? t + new Array(c - o + 1).join("0") : c > 0 ? t.slice(0, c) + "." + t.slice(c) : "0." + new Array(1 - c).join("0") + D(r, Math.max(0, n + c - 1))[0];
}
function H(r, n) {
  var e = D(r, n);
  if (!e)
    return r + "";
  var t = e[0], i = e[1];
  return i < 0 ? "0." + new Array(-i).join("0") + t : t.length > i + 1 ? t.slice(0, i + 1) + "." + t.slice(i + 1) : t + new Array(i - t.length + 2).join("0");
}
const I = { "%": (r, n) => (r * 100).toFixed(n), b: (r) => Math.round(r).toString(2), c: (r) => r + "", d: Ar, e: (r, n) => r.toExponential(n), f: (r, n) => r.toFixed(n), g: (r, n) => r.toPrecision(n), o: (r) => Math.round(r).toString(8), p: (r, n) => H(r * 100, n), r: H, s: Er, X: (r) => Math.round(r).toString(16).toUpperCase(), x: (r) => Math.round(r).toString(16) };
function J(r) {
  return r;
}
var K = Array.prototype.map, Q = ["y", "z", "a", "f", "p", "n", "\xB5", "m", "", "k", "M", "G", "T", "P", "E", "Z", "Y"];
function qr(r) {
  var n = r.grouping === void 0 || r.thousands === void 0 ? J : Sr(K.call(r.grouping, Number), r.thousands + ""), e = r.currency === void 0 ? "" : r.currency[0] + "", t = r.currency === void 0 ? "" : r.currency[1] + "", i = r.decimal === void 0 ? "." : r.decimal + "", c = r.numerals === void 0 ? J : jr(K.call(r.numerals, String)), o = r.percent === void 0 ? "%" : r.percent + "", u = r.minus === void 0 ? "\u2212" : r.minus + "", f = r.nan === void 0 ? "NaN" : r.nan + "";
  function a(s) {
    s = F(s);
    var h = s.fill, m = s.align, d = s.sign, A = s.symbol, w = s.zero, S = s.width, L = s.comma, y = s.precision, B = s.trim, p = s.type;
    p === "n" ? (L = true, p = "g") : I[p] || (y === void 0 && (y = 12), B = true, p = "g"), (w || h === "0" && m === "=") && (w = true, h = "0", m = "=");
    var er = A === "$" ? e : A === "#" && /[boxX]/.test(p) ? "0" + p.toLowerCase() : "", ir = A === "$" ? t : /[%p]/.test(p) ? o : "", G = I[p], ar = /[defgprs%]/.test(p);
    y = y === void 0 ? 6 : /[gprs]/.test(p) ? Math.max(1, Math.min(21, y)) : Math.max(0, Math.min(20, y));
    function R(l) {
      var b = er, v = ir, N, P, j;
      if (p === "c")
        v = G(l) + v, l = "";
      else {
        l = +l;
        var z = l < 0 || 1 / l < 0;
        if (l = isNaN(l) ? f : G(Math.abs(l), y), B && (l = $r(l)), z && +l == 0 && d !== "+" && (z = false), b = (z ? d === "(" ? d : u : d === "-" || d === "(" ? "" : d) + b, v = (p === "s" ? Q[8 + rr / 3] : "") + v + (z && d === "(" ? ")" : ""), ar) {
          for (N = -1, P = l.length; ++N < P; )
            if (j = l.charCodeAt(N), 48 > j || j > 57) {
              v = (j === 46 ? i + l.slice(N + 1) : l.slice(N)) + v, l = l.slice(0, N);
              break;
            }
        }
      }
      L && !w && (l = n(l, 1 / 0));
      var $ = b.length + l.length + v.length, M = $ < S ? new Array(S - $ + 1).join(h) : "";
      switch (L && w && (l = n(M + l, M.length ? S - v.length : 1 / 0), M = ""), m) {
        case "<":
          l = b + l + v + M;
          break;
        case "=":
          l = b + M + l + v;
          break;
        case "^":
          l = M.slice(0, $ = M.length >> 1) + b + l + v + M.slice($);
          break;
        default:
          l = M + b + l + v;
          break;
      }
      return c(l);
    }
    return R.toString = function() {
      return s + "";
    }, R;
  }
  function g(s, h) {
    var m = a((s = F(s), s.type = "f", s)), d = Math.max(-8, Math.min(8, Math.floor(k(h) / 3))) * 3, A = Math.pow(10, -d), w = Q[8 + d / 3];
    return function(S) {
      return m(A * S) + w;
    };
  }
  return { format: a, formatPrefix: g };
}
var E, nr, tr;
Cr({ thousands: ",", grouping: [3], currency: ["$", ""] });
function Cr(r) {
  return E = qr(r), nr = E.format, tr = E.formatPrefix, E;
}
function Dr(r) {
  return Math.max(0, -k(Math.abs(r)));
}
function Fr(r, n) {
  return Math.max(0, Math.max(-8, Math.min(8, Math.floor(k(n) / 3))) * 3 - k(Math.abs(r)));
}
function Lr(r, n) {
  return r = Math.abs(r), n = Math.abs(n) - r, Math.max(0, k(n) - k(r)) + 1;
}
function Or(r) {
  return function() {
    return r;
  };
}
function Vr(r) {
  return +r;
}
var W = [0, 1];
function x(r) {
  return r;
}
function X(r, n) {
  return (n -= r = +r) ? function(e) {
    return (e - r) / n;
  } : Or(isNaN(n) ? NaN : 0.5);
}
function Xr(r, n) {
  var e;
  return r > n && (e = r, r = n, n = e), function(t) {
    return Math.max(r, Math.min(n, t));
  };
}
function Tr(r, n, e) {
  var t = r[0], i = r[1], c = n[0], o = n[1];
  return i < t ? (t = X(i, t), c = e(o, c)) : (t = X(t, i), c = e(c, o)), function(u) {
    return c(t(u));
  };
}
function Zr(r, n, e) {
  var t = Math.min(r.length, n.length) - 1, i = new Array(t), c = new Array(t), o = -1;
  for (r[t] < r[0] && (r = r.slice().reverse(), n = n.slice().reverse()); ++o < t; )
    i[o] = X(r[o], r[o + 1]), c[o] = e(n[o], n[o + 1]);
  return function(u) {
    var f = gr(r, u, 1, t) - 1;
    return c[f](i[f](u));
  };
}
function Br(r, n) {
  return n.domain(r.domain()).range(r.range()).interpolate(r.interpolate()).clamp(r.clamp()).unknown(r.unknown());
}
function Gr() {
  var r = W, n = W, e = T, t, i, c, o = x, u, f, a;
  function g() {
    var h = Math.min(r.length, n.length);
    return o !== x && (o = Xr(r[0], r[h - 1])), u = h > 2 ? Zr : Tr, f = a = null, s;
  }
  function s(h) {
    return h == null || isNaN(h = +h) ? c : (f || (f = u(r.map(t), n, e)))(t(o(h)));
  }
  return s.invert = function(h) {
    return o(i((a || (a = u(n, r.map(t), O)))(h)));
  }, s.domain = function(h) {
    return arguments.length ? (r = Array.from(h, Vr), g()) : r.slice();
  }, s.range = function(h) {
    return arguments.length ? (n = Array.from(h), g()) : n.slice();
  }, s.rangeRound = function(h) {
    return n = Array.from(h), e = kr, g();
  }, s.clamp = function(h) {
    return arguments.length ? (o = h ? true : x, g()) : o !== x;
  }, s.interpolate = function(h) {
    return arguments.length ? (e = h, g()) : e;
  }, s.unknown = function(h) {
    return arguments.length ? (c = h, s) : c;
  }, function(h, m) {
    return t = h, i = m, g();
  };
}
function Rr() {
  return Gr()(x, x);
}
function Pr(r, n, e, t) {
  var i = mr(r, n, e), c;
  switch (t = F(t ?? ",f"), t.type) {
    case "s": {
      var o = Math.max(Math.abs(r), Math.abs(n));
      return t.precision == null && !isNaN(c = Fr(i, o)) && (t.precision = c), tr(t, o);
    }
    case "":
    case "e":
    case "g":
    case "p":
    case "r": {
      t.precision == null && !isNaN(c = Lr(i, Math.max(Math.abs(r), Math.abs(n)))) && (t.precision = c - (t.type === "e"));
      break;
    }
    case "f":
    case "%": {
      t.precision == null && !isNaN(c = Dr(i)) && (t.precision = c - (t.type === "%") * 2);
      break;
    }
  }
  return nr(t);
}
function Ur(r) {
  var n = r.domain;
  return r.ticks = function(e) {
    var t = n();
    return Mr(t[0], t[t.length - 1], e ?? 10);
  }, r.tickFormat = function(e, t) {
    var i = n();
    return Pr(i[0], i[i.length - 1], e ?? 10, t);
  }, r.nice = function(e) {
    e == null && (e = 10);
    var t = n(), i = 0, c = t.length - 1, o = t[i], u = t[c], f, a, g = 10;
    for (u < o && (a = o, o = u, u = a, a = i, i = c, c = a); g-- > 0; ) {
      if (a = V(o, u, e), a === f)
        return t[i] = o, t[c] = u, n(t);
      if (a > 0)
        o = Math.floor(o / a) * a, u = Math.ceil(u / a) * a;
      else if (a < 0)
        o = Math.ceil(o * a) / a, u = Math.floor(u * a) / a;
      else
        break;
      f = a;
    }
    return r;
  }, r;
}
function Yr() {
  var r = Rr();
  return r.copy = function() {
    return Br(r, Yr());
  }, cr.apply(r, arguments), Ur(r);
}
export {
  Br as O,
  Rr as X,
  Yr as Z,
  _,
  mr as w
};
