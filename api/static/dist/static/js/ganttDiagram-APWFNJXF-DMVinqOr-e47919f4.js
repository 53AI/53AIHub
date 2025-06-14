import { _ as d, aO as nt, c as Mt, b as En, a as Un, o as Ln, p as An, s as In, g as On, x as Wn, i as Hn, l as qt, d as Pn, j as zn, u as Vn } from "./mermaid-j5R1o_wi-141fd499.js";
import { E as xe } from "./index-6feda8be.js";
import { b as en, e as nn, g as rn, c as an, u as Bn, L as Gt, o as ne, D as Gn } from "./helper-7WMIPux3-736d9956.js";
import { Z as Nn, X as Xn, O as jn, _ as Rn, w as Ie } from "./linear-DRFqyOtL-feda5bd6.js";
import { t as qn } from "./init-DjUOC4st-cac434d1.js";
import { t as Jn, l as Kn } from "./min-DLf0xQMm-9aab427e.js";
import "./copy-BS31ARP0-bcf717fb.js";
function Zn(t) {
  return t;
}
var Xt = 1, re = 2, fe = 3, Nt = 4, Oe = 1e-6;
function Qn(t) {
  return "translate(" + t + ",0)";
}
function tr(t) {
  return "translate(0," + t + ")";
}
function er(t) {
  return (e) => +t(e);
}
function nr(t, e) {
  return e = Math.max(0, t.bandwidth() - e * 2) / 2, t.round() && (e = Math.round(e)), (n) => +t(n) + e;
}
function rr() {
  return !this.__axis;
}
function sn(t, e) {
  var n = [], r = null, a = null, s = 6, o = 6, y = 3, M = typeof window < "u" && window.devicePixelRatio > 1 ? 0 : 0.5, m = t === Xt || t === Nt ? -1 : 1, k = t === Nt || t === re ? "x" : "y", F = t === Xt || t === fe ? Qn : tr;
  function b(v) {
    var j = r ?? (e.ticks ? e.ticks.apply(e, n) : e.domain()), O = a ?? (e.tickFormat ? e.tickFormat.apply(e, n) : Zn), D = Math.max(s, 0) + y, E = e.range(), z = +E[0] + M, U = +E[E.length - 1] + M, N = (e.bandwidth ? nr : er)(e.copy(), M), q = v.selection ? v.selection() : v, w = q.selectAll(".domain").data([null]), H = q.selectAll(".tick").data(j, e).order(), T = H.exit(), S = H.enter().append("g").attr("class", "tick"), _ = H.select("line"), $ = H.select("text");
    w = w.merge(w.enter().insert("path", ".tick").attr("class", "domain").attr("stroke", "currentColor")), H = H.merge(S), _ = _.merge(S.append("line").attr("stroke", "currentColor").attr(k + "2", m * s)), $ = $.merge(S.append("text").attr("fill", "currentColor").attr(k, m * D).attr("dy", t === Xt ? "0em" : t === fe ? "0.71em" : "0.32em")), v !== q && (w = w.transition(v), H = H.transition(v), _ = _.transition(v), $ = $.transition(v), T = T.transition(v).attr("opacity", Oe).attr("transform", function(g) {
      return isFinite(g = N(g)) ? F(g + M) : this.getAttribute("transform");
    }), S.attr("opacity", Oe).attr("transform", function(g) {
      var C = this.parentNode.__axis;
      return F((C && isFinite(C = C(g)) ? C : N(g)) + M);
    })), T.remove(), w.attr("d", t === Nt || t === re ? o ? "M" + m * o + "," + z + "H" + M + "V" + U + "H" + m * o : "M" + M + "," + z + "V" + U : o ? "M" + z + "," + m * o + "V" + M + "H" + U + "V" + m * o : "M" + z + "," + M + "H" + U), H.attr("opacity", 1).attr("transform", function(g) {
      return F(N(g) + M);
    }), _.attr(k + "2", m * s), $.attr(k, m * D).text(O), q.filter(rr).attr("fill", "none").attr("font-size", 10).attr("font-family", "sans-serif").attr("text-anchor", t === re ? "start" : t === Nt ? "end" : "middle"), q.each(function() {
      this.__axis = N;
    });
  }
  return b.scale = function(v) {
    return arguments.length ? (e = v, b) : e;
  }, b.ticks = function() {
    return n = Array.from(arguments), b;
  }, b.tickArguments = function(v) {
    return arguments.length ? (n = v == null ? [] : Array.from(v), b) : n.slice();
  }, b.tickValues = function(v) {
    return arguments.length ? (r = v == null ? null : Array.from(v), b) : r && r.slice();
  }, b.tickFormat = function(v) {
    return arguments.length ? (a = v, b) : a;
  }, b.tickSize = function(v) {
    return arguments.length ? (s = o = +v, b) : s;
  }, b.tickSizeInner = function(v) {
    return arguments.length ? (s = +v, b) : s;
  }, b.tickSizeOuter = function(v) {
    return arguments.length ? (o = +v, b) : o;
  }, b.tickPadding = function(v) {
    return arguments.length ? (y = +v, b) : y;
  }, b.offset = function(v) {
    return arguments.length ? (M = +v, b) : M;
  }, b;
}
function ir(t) {
  return sn(Xt, t);
}
function ar(t) {
  return sn(fe, t);
}
const sr = Math.PI / 180, or = 180 / Math.PI, Jt = 18, on = 0.96422, cn = 1, ln = 0.82521, un = 4 / 29, _t = 6 / 29, dn = 3 * _t * _t, cr = _t * _t * _t;
function hn(t) {
  if (t instanceof lt)
    return new lt(t.l, t.a, t.b, t.opacity);
  if (t instanceof dt)
    return fn(t);
  t instanceof rn || (t = Bn(t));
  var e = oe(t.r), n = oe(t.g), r = oe(t.b), a = ie((0.2225045 * e + 0.7168786 * n + 0.0606169 * r) / cn), s, o;
  return e === n && n === r ? s = o = a : (s = ie((0.4360747 * e + 0.3850649 * n + 0.1430804 * r) / on), o = ie((0.0139322 * e + 0.0971045 * n + 0.7141733 * r) / ln)), new lt(116 * a - 16, 500 * (s - a), 200 * (a - o), t.opacity);
}
function lr(t, e, n, r) {
  return arguments.length === 1 ? hn(t) : new lt(t, e, n, r ?? 1);
}
function lt(t, e, n, r) {
  this.l = +t, this.a = +e, this.b = +n, this.opacity = +r;
}
en(lt, lr, nn(an, { brighter(t) {
  return new lt(this.l + Jt * (t ?? 1), this.a, this.b, this.opacity);
}, darker(t) {
  return new lt(this.l - Jt * (t ?? 1), this.a, this.b, this.opacity);
}, rgb() {
  var t = (this.l + 16) / 116, e = isNaN(this.a) ? t : t + this.a / 500, n = isNaN(this.b) ? t : t - this.b / 200;
  return e = on * ae(e), t = cn * ae(t), n = ln * ae(n), new rn(se(3.1338561 * e - 1.6168667 * t - 0.4906146 * n), se(-0.9787684 * e + 1.9161415 * t + 0.033454 * n), se(0.0719453 * e - 0.2289914 * t + 1.4052427 * n), this.opacity);
} }));
function ie(t) {
  return t > cr ? Math.pow(t, 1 / 3) : t / dn + un;
}
function ae(t) {
  return t > _t ? t * t * t : dn * (t - un);
}
function se(t) {
  return 255 * (t <= 31308e-7 ? 12.92 * t : 1.055 * Math.pow(t, 1 / 2.4) - 0.055);
}
function oe(t) {
  return (t /= 255) <= 0.04045 ? t / 12.92 : Math.pow((t + 0.055) / 1.055, 2.4);
}
function ur(t) {
  if (t instanceof dt)
    return new dt(t.h, t.c, t.l, t.opacity);
  if (t instanceof lt || (t = hn(t)), t.a === 0 && t.b === 0)
    return new dt(NaN, 0 < t.l && t.l < 100 ? 0 : NaN, t.l, t.opacity);
  var e = Math.atan2(t.b, t.a) * or;
  return new dt(e < 0 ? e + 360 : e, Math.sqrt(t.a * t.a + t.b * t.b), t.l, t.opacity);
}
function ge(t, e, n, r) {
  return arguments.length === 1 ? ur(t) : new dt(t, e, n, r ?? 1);
}
function dt(t, e, n, r) {
  this.h = +t, this.c = +e, this.l = +n, this.opacity = +r;
}
function fn(t) {
  if (isNaN(t.h))
    return new lt(t.l, 0, 0, t.opacity);
  var e = t.h * sr;
  return new lt(t.l, Math.cos(e) * t.c, Math.sin(e) * t.c, t.opacity);
}
en(dt, ge, nn(an, { brighter(t) {
  return new dt(this.h, this.c, this.l + Jt * (t ?? 1), this.opacity);
}, darker(t) {
  return new dt(this.h, this.c, this.l - Jt * (t ?? 1), this.opacity);
}, rgb() {
  return fn(this).rgb();
} }));
function dr(t) {
  return function(e, n) {
    var r = t((e = ge(e)).h, (n = ge(n)).h), a = ne(e.c, n.c), s = ne(e.l, n.l), o = ne(e.opacity, n.opacity);
    return function(y) {
      return e.h = r(y), e.c = a(y), e.l = s(y), e.opacity = o(y), e + "";
    };
  };
}
const hr = dr(Gn);
function fr(t, e) {
  t = t.slice();
  var n = 0, r = t.length - 1, a = t[n], s = t[r], o;
  return s < a && (o = n, n = r, r = o, o = a, a = s, s = o), t[n] = e.floor(a), t[r] = e.ceil(s), t;
}
const ce = /* @__PURE__ */ new Date(), le = /* @__PURE__ */ new Date();
function Q(t, e, n, r) {
  function a(s) {
    return t(s = arguments.length === 0 ? /* @__PURE__ */ new Date() : /* @__PURE__ */ new Date(+s)), s;
  }
  return a.floor = (s) => (t(s = /* @__PURE__ */ new Date(+s)), s), a.ceil = (s) => (t(s = new Date(s - 1)), e(s, 1), t(s), s), a.round = (s) => {
    const o = a(s), y = a.ceil(s);
    return s - o < y - s ? o : y;
  }, a.offset = (s, o) => (e(s = /* @__PURE__ */ new Date(+s), o == null ? 1 : Math.floor(o)), s), a.range = (s, o, y) => {
    const M = [];
    if (s = a.ceil(s), y = y == null ? 1 : Math.floor(y), !(s < o) || !(y > 0))
      return M;
    let m;
    do
      M.push(m = /* @__PURE__ */ new Date(+s)), e(s, y), t(s);
    while (m < s && s < o);
    return M;
  }, a.filter = (s) => Q((o) => {
    if (o >= o)
      for (; t(o), !s(o); )
        o.setTime(o - 1);
  }, (o, y) => {
    if (o >= o)
      if (y < 0)
        for (; ++y <= 0; )
          for (; e(o, -1), !s(o); )
            ;
      else
        for (; --y >= 0; )
          for (; e(o, 1), !s(o); )
            ;
  }), n && (a.count = (s, o) => (ce.setTime(+s), le.setTime(+o), t(ce), t(le), Math.floor(n(ce, le))), a.every = (s) => (s = Math.floor(s), !isFinite(s) || !(s > 0) ? null : s > 1 ? a.filter(r ? (o) => r(o) % s === 0 : (o) => a.count(0, o) % s === 0) : a)), a;
}
const St = Q(() => {
}, (t, e) => {
  t.setTime(+t + e);
}, (t, e) => e - t);
St.every = (t) => (t = Math.floor(t), !isFinite(t) || !(t > 0) ? null : t > 1 ? Q((e) => {
  e.setTime(Math.floor(e / t) * t);
}, (e, n) => {
  e.setTime(+e + n * t);
}, (e, n) => (n - e) / t) : St);
St.range;
const ht = 1e3, at = ht * 60, ft = at * 60, gt = ft * 24, we = gt * 7, We = gt * 30, ue = gt * 365, mt = Q((t) => {
  t.setTime(t - t.getMilliseconds());
}, (t, e) => {
  t.setTime(+t + e * ht);
}, (t, e) => (e - t) / ht, (t) => t.getUTCSeconds());
mt.range;
const At = Q((t) => {
  t.setTime(t - t.getMilliseconds() - t.getSeconds() * ht);
}, (t, e) => {
  t.setTime(+t + e * at);
}, (t, e) => (e - t) / at, (t) => t.getMinutes());
At.range;
const gr = Q((t) => {
  t.setUTCSeconds(0, 0);
}, (t, e) => {
  t.setTime(+t + e * at);
}, (t, e) => (e - t) / at, (t) => t.getUTCMinutes());
gr.range;
const It = Q((t) => {
  t.setTime(t - t.getMilliseconds() - t.getSeconds() * ht - t.getMinutes() * at);
}, (t, e) => {
  t.setTime(+t + e * ft);
}, (t, e) => (e - t) / ft, (t) => t.getHours());
It.range;
const yr = Q((t) => {
  t.setUTCMinutes(0, 0, 0);
}, (t, e) => {
  t.setTime(+t + e * ft);
}, (t, e) => (e - t) / ft, (t) => t.getUTCHours());
yr.range;
const Tt = Q((t) => t.setHours(0, 0, 0, 0), (t, e) => t.setDate(t.getDate() + e), (t, e) => (e - t - (e.getTimezoneOffset() - t.getTimezoneOffset()) * at) / gt, (t) => t.getDate() - 1);
Tt.range;
const Ce = Q((t) => {
  t.setUTCHours(0, 0, 0, 0);
}, (t, e) => {
  t.setUTCDate(t.getUTCDate() + e);
}, (t, e) => (e - t) / gt, (t) => t.getUTCDate() - 1);
Ce.range;
const mr = Q((t) => {
  t.setUTCHours(0, 0, 0, 0);
}, (t, e) => {
  t.setUTCDate(t.getUTCDate() + e);
}, (t, e) => (e - t) / gt, (t) => Math.floor(t / gt));
mr.range;
function xt(t) {
  return Q((e) => {
    e.setDate(e.getDate() - (e.getDay() + 7 - t) % 7), e.setHours(0, 0, 0, 0);
  }, (e, n) => {
    e.setDate(e.getDate() + n * 7);
  }, (e, n) => (n - e - (n.getTimezoneOffset() - e.getTimezoneOffset()) * at) / we);
}
const Ht = xt(0), Ot = xt(1), gn = xt(2), yn = xt(3), bt = xt(4), mn = xt(5), kn = xt(6);
Ht.range;
Ot.range;
gn.range;
yn.range;
bt.range;
mn.range;
kn.range;
function wt(t) {
  return Q((e) => {
    e.setUTCDate(e.getUTCDate() - (e.getUTCDay() + 7 - t) % 7), e.setUTCHours(0, 0, 0, 0);
  }, (e, n) => {
    e.setUTCDate(e.getUTCDate() + n * 7);
  }, (e, n) => (n - e) / we);
}
const pn = wt(0), Kt = wt(1), kr = wt(2), pr = wt(3), Yt = wt(4), Tr = wt(5), br = wt(6);
pn.range;
Kt.range;
kr.range;
pr.range;
Yt.range;
Tr.range;
br.range;
const Wt = Q((t) => {
  t.setDate(1), t.setHours(0, 0, 0, 0);
}, (t, e) => {
  t.setMonth(t.getMonth() + e);
}, (t, e) => e.getMonth() - t.getMonth() + (e.getFullYear() - t.getFullYear()) * 12, (t) => t.getMonth());
Wt.range;
const vr = Q((t) => {
  t.setUTCDate(1), t.setUTCHours(0, 0, 0, 0);
}, (t, e) => {
  t.setUTCMonth(t.getUTCMonth() + e);
}, (t, e) => e.getUTCMonth() - t.getUTCMonth() + (e.getUTCFullYear() - t.getUTCFullYear()) * 12, (t) => t.getUTCMonth());
vr.range;
const yt = Q((t) => {
  t.setMonth(0, 1), t.setHours(0, 0, 0, 0);
}, (t, e) => {
  t.setFullYear(t.getFullYear() + e);
}, (t, e) => e.getFullYear() - t.getFullYear(), (t) => t.getFullYear());
yt.every = (t) => !isFinite(t = Math.floor(t)) || !(t > 0) ? null : Q((e) => {
  e.setFullYear(Math.floor(e.getFullYear() / t) * t), e.setMonth(0, 1), e.setHours(0, 0, 0, 0);
}, (e, n) => {
  e.setFullYear(e.getFullYear() + n * t);
});
yt.range;
const vt = Q((t) => {
  t.setUTCMonth(0, 1), t.setUTCHours(0, 0, 0, 0);
}, (t, e) => {
  t.setUTCFullYear(t.getUTCFullYear() + e);
}, (t, e) => e.getUTCFullYear() - t.getUTCFullYear(), (t) => t.getUTCFullYear());
vt.every = (t) => !isFinite(t = Math.floor(t)) || !(t > 0) ? null : Q((e) => {
  e.setUTCFullYear(Math.floor(e.getUTCFullYear() / t) * t), e.setUTCMonth(0, 1), e.setUTCHours(0, 0, 0, 0);
}, (e, n) => {
  e.setUTCFullYear(e.getUTCFullYear() + n * t);
});
vt.range;
function xr(t, e, n, r, a, s) {
  const o = [[mt, 1, ht], [mt, 5, 5 * ht], [mt, 15, 15 * ht], [mt, 30, 30 * ht], [s, 1, at], [s, 5, 5 * at], [s, 15, 15 * at], [s, 30, 30 * at], [a, 1, ft], [a, 3, 3 * ft], [a, 6, 6 * ft], [a, 12, 12 * ft], [r, 1, gt], [r, 2, 2 * gt], [n, 1, we], [e, 1, We], [e, 3, 3 * We], [t, 1, ue]];
  function y(m, k, F) {
    const b = k < m;
    b && ([m, k] = [k, m]);
    const v = F && typeof F.range == "function" ? F : M(m, k, F), j = v ? v.range(m, +k + 1) : [];
    return b ? j.reverse() : j;
  }
  function M(m, k, F) {
    const b = Math.abs(k - m) / F, v = Rn(([, , D]) => D).right(o, b);
    if (v === o.length)
      return t.every(Ie(m / ue, k / ue, F));
    if (v === 0)
      return St.every(Math.max(Ie(m, k, F), 1));
    const [j, O] = o[b / o[v - 1][2] < o[v][2] / b ? v - 1 : v];
    return j.every(O);
  }
  return [y, M];
}
const [wr, Cr] = xr(yt, Wt, Ht, Tt, It, At);
function de(t) {
  if (0 <= t.y && t.y < 100) {
    var e = new Date(-1, t.m, t.d, t.H, t.M, t.S, t.L);
    return e.setFullYear(t.y), e;
  }
  return new Date(t.y, t.m, t.d, t.H, t.M, t.S, t.L);
}
function he(t) {
  if (0 <= t.y && t.y < 100) {
    var e = new Date(Date.UTC(-1, t.m, t.d, t.H, t.M, t.S, t.L));
    return e.setUTCFullYear(t.y), e;
  }
  return new Date(Date.UTC(t.y, t.m, t.d, t.H, t.M, t.S, t.L));
}
function Et(t, e, n) {
  return { y: t, m: e, d: n, H: 0, M: 0, S: 0, L: 0 };
}
function Dr(t) {
  var e = t.dateTime, n = t.date, r = t.time, a = t.periods, s = t.days, o = t.shortDays, y = t.months, M = t.shortMonths, m = Ut(a), k = Lt(a), F = Ut(s), b = Lt(s), v = Ut(o), j = Lt(o), O = Ut(y), D = Lt(y), E = Ut(M), z = Lt(M), U = { a: Y, A: i, b: x, B: l, c: null, d: Ge, e: Ge, f: Rr, g: ii, G: si, H: Nr, I: Xr, j: jr, L: Tn, m: qr, M: Jr, p: A, q: L, Q: je, s: Re, S: Kr, u: Zr, U: Qr, V: ti, w: ei, W: ni, x: null, X: null, y: ri, Y: ai, Z: oi, "%": Xe }, N = { a: X, A: R, b: kt, B: J, c: null, d: Ne, e: Ne, f: di, g: vi, G: wi, H: ci, I: li, j: ui, L: vn, m: hi, M: fi, p: st, q: pt, Q: je, s: Re, S: gi, u: yi, U: mi, V: ki, w: pi, W: Ti, x: null, X: null, y: bi, Y: xi, Z: Ci, "%": Xe }, q = { a: _, A: $, b: g, B: C, c, d: Ve, e: Ve, f: zr, g: ze, G: Pe, H: Be, I: Be, j: Or, L: Pr, m: Ir, M: Wr, p: S, q: Ar, Q: Br, s: Gr, S: Hr, u: Yr, U: Fr, V: Er, w: Sr, W: Ur, x: f, X: h, y: ze, Y: Pe, Z: Lr, "%": Vr };
  U.x = w(n, U), U.X = w(r, U), U.c = w(e, U), N.x = w(n, N), N.X = w(r, N), N.c = w(e, N);
  function w(p, I) {
    return function(P) {
      var u = [], V = -1, W = 0, G = p.length, K, tt, ot;
      for (P instanceof Date || (P = /* @__PURE__ */ new Date(+P)); ++V < G; )
        p.charCodeAt(V) === 37 && (u.push(p.slice(W, V)), (tt = He[K = p.charAt(++V)]) != null ? K = p.charAt(++V) : tt = K === "e" ? " " : "0", (ot = I[K]) && (K = ot(P, tt)), u.push(K), W = V + 1);
      return u.push(p.slice(W, V)), u.join("");
    };
  }
  function H(p, I) {
    return function(P) {
      var u = Et(1900, void 0, 1), V = T(u, p, P += "", 0), W, G;
      if (V != P.length)
        return null;
      if ("Q" in u)
        return new Date(u.Q);
      if ("s" in u)
        return new Date(u.s * 1e3 + ("L" in u ? u.L : 0));
      if (I && !("Z" in u) && (u.Z = 0), "p" in u && (u.H = u.H % 12 + u.p * 12), u.m === void 0 && (u.m = "q" in u ? u.q : 0), "V" in u) {
        if (u.V < 1 || u.V > 53)
          return null;
        "w" in u || (u.w = 1), "Z" in u ? (W = he(Et(u.y, 0, 1)), G = W.getUTCDay(), W = G > 4 || G === 0 ? Kt.ceil(W) : Kt(W), W = Ce.offset(W, (u.V - 1) * 7), u.y = W.getUTCFullYear(), u.m = W.getUTCMonth(), u.d = W.getUTCDate() + (u.w + 6) % 7) : (W = de(Et(u.y, 0, 1)), G = W.getDay(), W = G > 4 || G === 0 ? Ot.ceil(W) : Ot(W), W = Tt.offset(W, (u.V - 1) * 7), u.y = W.getFullYear(), u.m = W.getMonth(), u.d = W.getDate() + (u.w + 6) % 7);
      } else
        ("W" in u || "U" in u) && ("w" in u || (u.w = "u" in u ? u.u % 7 : "W" in u ? 1 : 0), G = "Z" in u ? he(Et(u.y, 0, 1)).getUTCDay() : de(Et(u.y, 0, 1)).getDay(), u.m = 0, u.d = "W" in u ? (u.w + 6) % 7 + u.W * 7 - (G + 5) % 7 : u.w + u.U * 7 - (G + 6) % 7);
      return "Z" in u ? (u.H += u.Z / 100 | 0, u.M += u.Z % 100, he(u)) : de(u);
    };
  }
  function T(p, I, P, u) {
    for (var V = 0, W = I.length, G = P.length, K, tt; V < W; ) {
      if (u >= G)
        return -1;
      if (K = I.charCodeAt(V++), K === 37) {
        if (K = I.charAt(V++), tt = q[K in He ? I.charAt(V++) : K], !tt || (u = tt(p, P, u)) < 0)
          return -1;
      } else if (K != P.charCodeAt(u++))
        return -1;
    }
    return u;
  }
  function S(p, I, P) {
    var u = m.exec(I.slice(P));
    return u ? (p.p = k.get(u[0].toLowerCase()), P + u[0].length) : -1;
  }
  function _(p, I, P) {
    var u = v.exec(I.slice(P));
    return u ? (p.w = j.get(u[0].toLowerCase()), P + u[0].length) : -1;
  }
  function $(p, I, P) {
    var u = F.exec(I.slice(P));
    return u ? (p.w = b.get(u[0].toLowerCase()), P + u[0].length) : -1;
  }
  function g(p, I, P) {
    var u = E.exec(I.slice(P));
    return u ? (p.m = z.get(u[0].toLowerCase()), P + u[0].length) : -1;
  }
  function C(p, I, P) {
    var u = O.exec(I.slice(P));
    return u ? (p.m = D.get(u[0].toLowerCase()), P + u[0].length) : -1;
  }
  function c(p, I, P) {
    return T(p, e, I, P);
  }
  function f(p, I, P) {
    return T(p, n, I, P);
  }
  function h(p, I, P) {
    return T(p, r, I, P);
  }
  function Y(p) {
    return o[p.getDay()];
  }
  function i(p) {
    return s[p.getDay()];
  }
  function x(p) {
    return M[p.getMonth()];
  }
  function l(p) {
    return y[p.getMonth()];
  }
  function A(p) {
    return a[+(p.getHours() >= 12)];
  }
  function L(p) {
    return 1 + ~~(p.getMonth() / 3);
  }
  function X(p) {
    return o[p.getUTCDay()];
  }
  function R(p) {
    return s[p.getUTCDay()];
  }
  function kt(p) {
    return M[p.getUTCMonth()];
  }
  function J(p) {
    return y[p.getUTCMonth()];
  }
  function st(p) {
    return a[+(p.getUTCHours() >= 12)];
  }
  function pt(p) {
    return 1 + ~~(p.getUTCMonth() / 3);
  }
  return { format: function(p) {
    var I = w(p += "", U);
    return I.toString = function() {
      return p;
    }, I;
  }, parse: function(p) {
    var I = H(p += "", false);
    return I.toString = function() {
      return p;
    }, I;
  }, utcFormat: function(p) {
    var I = w(p += "", N);
    return I.toString = function() {
      return p;
    }, I;
  }, utcParse: function(p) {
    var I = H(p += "", true);
    return I.toString = function() {
      return p;
    }, I;
  } };
}
var He = { "-": "", _: " ", 0: "0" }, et = /^\s*\d+/, Mr = /^%/, _r = /[\\^$*+?|[\]().{}]/g;
function B(t, e, n) {
  var r = t < 0 ? "-" : "", a = (r ? -t : t) + "", s = a.length;
  return r + (s < n ? new Array(n - s + 1).join(e) + a : a);
}
function $r(t) {
  return t.replace(_r, "\\$&");
}
function Ut(t) {
  return new RegExp("^(?:" + t.map($r).join("|") + ")", "i");
}
function Lt(t) {
  return new Map(t.map((e, n) => [e.toLowerCase(), n]));
}
function Sr(t, e, n) {
  var r = et.exec(e.slice(n, n + 1));
  return r ? (t.w = +r[0], n + r[0].length) : -1;
}
function Yr(t, e, n) {
  var r = et.exec(e.slice(n, n + 1));
  return r ? (t.u = +r[0], n + r[0].length) : -1;
}
function Fr(t, e, n) {
  var r = et.exec(e.slice(n, n + 2));
  return r ? (t.U = +r[0], n + r[0].length) : -1;
}
function Er(t, e, n) {
  var r = et.exec(e.slice(n, n + 2));
  return r ? (t.V = +r[0], n + r[0].length) : -1;
}
function Ur(t, e, n) {
  var r = et.exec(e.slice(n, n + 2));
  return r ? (t.W = +r[0], n + r[0].length) : -1;
}
function Pe(t, e, n) {
  var r = et.exec(e.slice(n, n + 4));
  return r ? (t.y = +r[0], n + r[0].length) : -1;
}
function ze(t, e, n) {
  var r = et.exec(e.slice(n, n + 2));
  return r ? (t.y = +r[0] + (+r[0] > 68 ? 1900 : 2e3), n + r[0].length) : -1;
}
function Lr(t, e, n) {
  var r = /^(Z)|([+-]\d\d)(?::?(\d\d))?/.exec(e.slice(n, n + 6));
  return r ? (t.Z = r[1] ? 0 : -(r[2] + (r[3] || "00")), n + r[0].length) : -1;
}
function Ar(t, e, n) {
  var r = et.exec(e.slice(n, n + 1));
  return r ? (t.q = r[0] * 3 - 3, n + r[0].length) : -1;
}
function Ir(t, e, n) {
  var r = et.exec(e.slice(n, n + 2));
  return r ? (t.m = r[0] - 1, n + r[0].length) : -1;
}
function Ve(t, e, n) {
  var r = et.exec(e.slice(n, n + 2));
  return r ? (t.d = +r[0], n + r[0].length) : -1;
}
function Or(t, e, n) {
  var r = et.exec(e.slice(n, n + 3));
  return r ? (t.m = 0, t.d = +r[0], n + r[0].length) : -1;
}
function Be(t, e, n) {
  var r = et.exec(e.slice(n, n + 2));
  return r ? (t.H = +r[0], n + r[0].length) : -1;
}
function Wr(t, e, n) {
  var r = et.exec(e.slice(n, n + 2));
  return r ? (t.M = +r[0], n + r[0].length) : -1;
}
function Hr(t, e, n) {
  var r = et.exec(e.slice(n, n + 2));
  return r ? (t.S = +r[0], n + r[0].length) : -1;
}
function Pr(t, e, n) {
  var r = et.exec(e.slice(n, n + 3));
  return r ? (t.L = +r[0], n + r[0].length) : -1;
}
function zr(t, e, n) {
  var r = et.exec(e.slice(n, n + 6));
  return r ? (t.L = Math.floor(r[0] / 1e3), n + r[0].length) : -1;
}
function Vr(t, e, n) {
  var r = Mr.exec(e.slice(n, n + 1));
  return r ? n + r[0].length : -1;
}
function Br(t, e, n) {
  var r = et.exec(e.slice(n));
  return r ? (t.Q = +r[0], n + r[0].length) : -1;
}
function Gr(t, e, n) {
  var r = et.exec(e.slice(n));
  return r ? (t.s = +r[0], n + r[0].length) : -1;
}
function Ge(t, e) {
  return B(t.getDate(), e, 2);
}
function Nr(t, e) {
  return B(t.getHours(), e, 2);
}
function Xr(t, e) {
  return B(t.getHours() % 12 || 12, e, 2);
}
function jr(t, e) {
  return B(1 + Tt.count(yt(t), t), e, 3);
}
function Tn(t, e) {
  return B(t.getMilliseconds(), e, 3);
}
function Rr(t, e) {
  return Tn(t, e) + "000";
}
function qr(t, e) {
  return B(t.getMonth() + 1, e, 2);
}
function Jr(t, e) {
  return B(t.getMinutes(), e, 2);
}
function Kr(t, e) {
  return B(t.getSeconds(), e, 2);
}
function Zr(t) {
  var e = t.getDay();
  return e === 0 ? 7 : e;
}
function Qr(t, e) {
  return B(Ht.count(yt(t) - 1, t), e, 2);
}
function bn(t) {
  var e = t.getDay();
  return e >= 4 || e === 0 ? bt(t) : bt.ceil(t);
}
function ti(t, e) {
  return t = bn(t), B(bt.count(yt(t), t) + (yt(t).getDay() === 4), e, 2);
}
function ei(t) {
  return t.getDay();
}
function ni(t, e) {
  return B(Ot.count(yt(t) - 1, t), e, 2);
}
function ri(t, e) {
  return B(t.getFullYear() % 100, e, 2);
}
function ii(t, e) {
  return t = bn(t), B(t.getFullYear() % 100, e, 2);
}
function ai(t, e) {
  return B(t.getFullYear() % 1e4, e, 4);
}
function si(t, e) {
  var n = t.getDay();
  return t = n >= 4 || n === 0 ? bt(t) : bt.ceil(t), B(t.getFullYear() % 1e4, e, 4);
}
function oi(t) {
  var e = t.getTimezoneOffset();
  return (e > 0 ? "-" : (e *= -1, "+")) + B(e / 60 | 0, "0", 2) + B(e % 60, "0", 2);
}
function Ne(t, e) {
  return B(t.getUTCDate(), e, 2);
}
function ci(t, e) {
  return B(t.getUTCHours(), e, 2);
}
function li(t, e) {
  return B(t.getUTCHours() % 12 || 12, e, 2);
}
function ui(t, e) {
  return B(1 + Ce.count(vt(t), t), e, 3);
}
function vn(t, e) {
  return B(t.getUTCMilliseconds(), e, 3);
}
function di(t, e) {
  return vn(t, e) + "000";
}
function hi(t, e) {
  return B(t.getUTCMonth() + 1, e, 2);
}
function fi(t, e) {
  return B(t.getUTCMinutes(), e, 2);
}
function gi(t, e) {
  return B(t.getUTCSeconds(), e, 2);
}
function yi(t) {
  var e = t.getUTCDay();
  return e === 0 ? 7 : e;
}
function mi(t, e) {
  return B(pn.count(vt(t) - 1, t), e, 2);
}
function xn(t) {
  var e = t.getUTCDay();
  return e >= 4 || e === 0 ? Yt(t) : Yt.ceil(t);
}
function ki(t, e) {
  return t = xn(t), B(Yt.count(vt(t), t) + (vt(t).getUTCDay() === 4), e, 2);
}
function pi(t) {
  return t.getUTCDay();
}
function Ti(t, e) {
  return B(Kt.count(vt(t) - 1, t), e, 2);
}
function bi(t, e) {
  return B(t.getUTCFullYear() % 100, e, 2);
}
function vi(t, e) {
  return t = xn(t), B(t.getUTCFullYear() % 100, e, 2);
}
function xi(t, e) {
  return B(t.getUTCFullYear() % 1e4, e, 4);
}
function wi(t, e) {
  var n = t.getUTCDay();
  return t = n >= 4 || n === 0 ? Yt(t) : Yt.ceil(t), B(t.getUTCFullYear() % 1e4, e, 4);
}
function Ci() {
  return "+0000";
}
function Xe() {
  return "%";
}
function je(t) {
  return +t;
}
function Re(t) {
  return Math.floor(+t / 1e3);
}
var Dt, Zt;
Di({ dateTime: "%x, %X", date: "%-m/%-d/%Y", time: "%-I:%M:%S %p", periods: ["AM", "PM"], days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], shortDays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], shortMonths: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] });
function Di(t) {
  return Dt = Dr(t), Zt = Dt.format, Dt.parse, Dt.utcFormat, Dt.utcParse, Dt;
}
function Mi(t) {
  return new Date(t);
}
function _i(t) {
  return t instanceof Date ? +t : +/* @__PURE__ */ new Date(+t);
}
function wn(t, e, n, r, a, s, o, y, M, m) {
  var k = Xn(), F = k.invert, b = k.domain, v = m(".%L"), j = m(":%S"), O = m("%I:%M"), D = m("%I %p"), E = m("%a %d"), z = m("%b %d"), U = m("%B"), N = m("%Y");
  function q(w) {
    return (M(w) < w ? v : y(w) < w ? j : o(w) < w ? O : s(w) < w ? D : r(w) < w ? a(w) < w ? E : z : n(w) < w ? U : N)(w);
  }
  return k.invert = function(w) {
    return new Date(F(w));
  }, k.domain = function(w) {
    return arguments.length ? b(Array.from(w, _i)) : b().map(Mi);
  }, k.ticks = function(w) {
    var H = b();
    return t(H[0], H[H.length - 1], w ?? 10);
  }, k.tickFormat = function(w, H) {
    return H == null ? q : m(H);
  }, k.nice = function(w) {
    var H = b();
    return (!w || typeof w.range != "function") && (w = e(H[0], H[H.length - 1], w ?? 10)), w ? b(fr(H, w)) : k;
  }, k.copy = function() {
    return jn(k, wn(t, e, n, r, a, s, o, y, M, m));
  }, k;
}
function $i() {
  return qn.apply(wn(wr, Cr, yt, Wt, Ht, Tt, It, At, mt, Zt).domain([new Date(2e3, 0, 1), new Date(2e3, 0, 2)]), arguments);
}
var ye = { exports: {} }, Si = ye.exports, qe;
function Yi() {
  return qe || (qe = 1, function(t, e) {
    (function(n, r) {
      t.exports = r();
    })(Si, function() {
      var n = "day";
      return function(r, a, s) {
        var o = function(m) {
          return m.add(4 - m.isoWeekday(), n);
        }, y = a.prototype;
        y.isoWeekYear = function() {
          return o(this).year();
        }, y.isoWeek = function(m) {
          if (!this.$utils().u(m))
            return this.add(7 * (m - this.isoWeek()), n);
          var k, F, b, v, j = o(this), O = (k = this.isoWeekYear(), F = this.$u, b = (F ? s.utc : s)().year(k).startOf("year"), v = 4 - b.isoWeekday(), b.isoWeekday() > 4 && (v += 7), b.add(v, n));
          return j.diff(O, "week") + 1;
        }, y.isoWeekday = function(m) {
          return this.$utils().u(m) ? this.day() || 7 : this.day(this.day() % 7 ? m : m - 7);
        };
        var M = y.startOf;
        y.startOf = function(m, k) {
          var F = this.$utils(), b = !!F.u(k) || k;
          return F.p(m) === "isoweek" ? b ? this.date(this.date() - (this.isoWeekday() - 1)).startOf("day") : this.date(this.date() - 1 - (this.isoWeekday() - 1) + 7).endOf("day") : M.bind(this)(m, k);
        };
      };
    });
  }(ye)), ye.exports;
}
var Fi = Yi();
const Ei = xe(Fi);
var me = { exports: {} }, Ui = me.exports, Je;
function Li() {
  return Je || (Je = 1, function(t, e) {
    (function(n, r) {
      t.exports = r();
    })(Ui, function() {
      var n = { LTS: "h:mm:ss A", LT: "h:mm A", L: "MM/DD/YYYY", LL: "MMMM D, YYYY", LLL: "MMMM D, YYYY h:mm A", LLLL: "dddd, MMMM D, YYYY h:mm A" }, r = /(\[[^[]*\])|([-_:/.,()\s]+)|(A|a|Q|YYYY|YY?|ww?|MM?M?M?|Do|DD?|hh?|HH?|mm?|ss?|S{1,3}|z|ZZ?)/g, a = /\d/, s = /\d\d/, o = /\d\d?/, y = /\d*[^-_:/,()\s\d]+/, M = {}, m = function(D) {
        return (D = +D) + (D > 68 ? 1900 : 2e3);
      }, k = function(D) {
        return function(E) {
          this[D] = +E;
        };
      }, F = [/[+-]\d\d:?(\d\d)?|Z/, function(D) {
        (this.zone || (this.zone = {})).offset = function(E) {
          if (!E || E === "Z")
            return 0;
          var z = E.match(/([+-]|\d\d)/g), U = 60 * z[1] + (+z[2] || 0);
          return U === 0 ? 0 : z[0] === "+" ? -U : U;
        }(D);
      }], b = function(D) {
        var E = M[D];
        return E && (E.indexOf ? E : E.s.concat(E.f));
      }, v = function(D, E) {
        var z, U = M.meridiem;
        if (U) {
          for (var N = 1; N <= 24; N += 1)
            if (D.indexOf(U(N, 0, E)) > -1) {
              z = N > 12;
              break;
            }
        } else
          z = D === (E ? "pm" : "PM");
        return z;
      }, j = { A: [y, function(D) {
        this.afternoon = v(D, false);
      }], a: [y, function(D) {
        this.afternoon = v(D, true);
      }], Q: [a, function(D) {
        this.month = 3 * (D - 1) + 1;
      }], S: [a, function(D) {
        this.milliseconds = 100 * +D;
      }], SS: [s, function(D) {
        this.milliseconds = 10 * +D;
      }], SSS: [/\d{3}/, function(D) {
        this.milliseconds = +D;
      }], s: [o, k("seconds")], ss: [o, k("seconds")], m: [o, k("minutes")], mm: [o, k("minutes")], H: [o, k("hours")], h: [o, k("hours")], HH: [o, k("hours")], hh: [o, k("hours")], D: [o, k("day")], DD: [s, k("day")], Do: [y, function(D) {
        var E = M.ordinal, z = D.match(/\d+/);
        if (this.day = z[0], E)
          for (var U = 1; U <= 31; U += 1)
            E(U).replace(/\[|\]/g, "") === D && (this.day = U);
      }], w: [o, k("week")], ww: [s, k("week")], M: [o, k("month")], MM: [s, k("month")], MMM: [y, function(D) {
        var E = b("months"), z = (b("monthsShort") || E.map(function(U) {
          return U.slice(0, 3);
        })).indexOf(D) + 1;
        if (z < 1)
          throw new Error();
        this.month = z % 12 || z;
      }], MMMM: [y, function(D) {
        var E = b("months").indexOf(D) + 1;
        if (E < 1)
          throw new Error();
        this.month = E % 12 || E;
      }], Y: [/[+-]?\d+/, k("year")], YY: [s, function(D) {
        this.year = m(D);
      }], YYYY: [/\d{4}/, k("year")], Z: F, ZZ: F };
      function O(D) {
        var E, z;
        E = D, z = M && M.formats;
        for (var U = (D = E.replace(/(\[[^\]]+])|(LTS?|l{1,4}|L{1,4})/g, function(_, $, g) {
          var C = g && g.toUpperCase();
          return $ || z[g] || n[g] || z[C].replace(/(\[[^\]]+])|(MMMM|MM|DD|dddd)/g, function(c, f, h) {
            return f || h.slice(1);
          });
        })).match(r), N = U.length, q = 0; q < N; q += 1) {
          var w = U[q], H = j[w], T = H && H[0], S = H && H[1];
          U[q] = S ? { regex: T, parser: S } : w.replace(/^\[|\]$/g, "");
        }
        return function(_) {
          for (var $ = {}, g = 0, C = 0; g < N; g += 1) {
            var c = U[g];
            if (typeof c == "string")
              C += c.length;
            else {
              var f = c.regex, h = c.parser, Y = _.slice(C), i = f.exec(Y)[0];
              h.call($, i), _ = _.replace(i, "");
            }
          }
          return function(x) {
            var l = x.afternoon;
            if (l !== void 0) {
              var A = x.hours;
              l ? A < 12 && (x.hours += 12) : A === 12 && (x.hours = 0), delete x.afternoon;
            }
          }($), $;
        };
      }
      return function(D, E, z) {
        z.p.customParseFormat = true, D && D.parseTwoDigitYear && (m = D.parseTwoDigitYear);
        var U = E.prototype, N = U.parse;
        U.parse = function(q) {
          var w = q.date, H = q.utc, T = q.args;
          this.$u = H;
          var S = T[1];
          if (typeof S == "string") {
            var _ = T[2] === true, $ = T[3] === true, g = _ || $, C = T[2];
            $ && (C = T[2]), M = this.$locale(), !_ && C && (M = z.Ls[C]), this.$d = function(Y, i, x, l) {
              try {
                if (["x", "X"].indexOf(i) > -1)
                  return new Date((i === "X" ? 1e3 : 1) * Y);
                var A = O(i)(Y), L = A.year, X = A.month, R = A.day, kt = A.hours, J = A.minutes, st = A.seconds, pt = A.milliseconds, p = A.zone, I = A.week, P = /* @__PURE__ */ new Date(), u = R || (L || X ? 1 : P.getDate()), V = L || P.getFullYear(), W = 0;
                L && !X || (W = X > 0 ? X - 1 : P.getMonth());
                var G, K = kt || 0, tt = J || 0, ot = st || 0, rt = pt || 0;
                return p ? new Date(Date.UTC(V, W, u, K, tt, ot, rt + 60 * p.offset * 1e3)) : x ? new Date(Date.UTC(V, W, u, K, tt, ot, rt)) : (G = new Date(V, W, u, K, tt, ot, rt), I && (G = l(G).week(I).toDate()), G);
              } catch {
                return /* @__PURE__ */ new Date("");
              }
            }(w, S, H, z), this.init(), C && C !== true && (this.$L = this.locale(C).$L), g && w != this.format(S) && (this.$d = /* @__PURE__ */ new Date("")), M = {};
          } else if (S instanceof Array)
            for (var c = S.length, f = 1; f <= c; f += 1) {
              T[1] = S[f - 1];
              var h = z.apply(this, T);
              if (h.isValid()) {
                this.$d = h.$d, this.$L = h.$L, this.init();
                break;
              }
              f === c && (this.$d = /* @__PURE__ */ new Date(""));
            }
          else
            N.call(this, q);
        };
      };
    });
  }(me)), me.exports;
}
var Ai = Li();
const Ii = xe(Ai);
var ke = { exports: {} }, Oi = ke.exports, Ke;
function Wi() {
  return Ke || (Ke = 1, function(t, e) {
    (function(n, r) {
      t.exports = r();
    })(Oi, function() {
      return function(n, r) {
        var a = r.prototype, s = a.format;
        a.format = function(o) {
          var y = this, M = this.$locale();
          if (!this.isValid())
            return s.bind(this)(o);
          var m = this.$utils(), k = (o || "YYYY-MM-DDTHH:mm:ssZ").replace(/\[([^\]]+)]|Q|wo|ww|w|WW|W|zzz|z|gggg|GGGG|Do|X|x|k{1,2}|S/g, function(F) {
            switch (F) {
              case "Q":
                return Math.ceil((y.$M + 1) / 3);
              case "Do":
                return M.ordinal(y.$D);
              case "gggg":
                return y.weekYear();
              case "GGGG":
                return y.isoWeekYear();
              case "wo":
                return M.ordinal(y.week(), "W");
              case "w":
              case "ww":
                return m.s(y.week(), F === "w" ? 1 : 2, "0");
              case "W":
              case "WW":
                return m.s(y.isoWeek(), F === "W" ? 1 : 2, "0");
              case "k":
              case "kk":
                return m.s(String(y.$H === 0 ? 24 : y.$H), F === "k" ? 1 : 2, "0");
              case "X":
                return Math.floor(y.$d.getTime() / 1e3);
              case "x":
                return y.$d.getTime();
              case "z":
                return "[" + y.offsetName() + "]";
              case "zzz":
                return "[" + y.offsetName("long") + "]";
              default:
                return F;
            }
          });
          return s.bind(this)(k);
        };
      };
    });
  }(ke)), ke.exports;
}
var Hi = Wi();
const Pi = xe(Hi);
var pe = function() {
  var t = d(function(C, c, f, h) {
    for (f = f || {}, h = C.length; h--; f[C[h]] = c)
      ;
    return f;
  }, "o"), e = [6, 8, 10, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 33, 35, 36, 38, 40], n = [1, 26], r = [1, 27], a = [1, 28], s = [1, 29], o = [1, 30], y = [1, 31], M = [1, 32], m = [1, 33], k = [1, 34], F = [1, 9], b = [1, 10], v = [1, 11], j = [1, 12], O = [1, 13], D = [1, 14], E = [1, 15], z = [1, 16], U = [1, 19], N = [1, 20], q = [1, 21], w = [1, 22], H = [1, 23], T = [1, 25], S = [1, 35], _ = { trace: d(function() {
  }, "trace"), yy: {}, symbols_: { error: 2, start: 3, gantt: 4, document: 5, EOF: 6, line: 7, SPACE: 8, statement: 9, NL: 10, weekday: 11, weekday_monday: 12, weekday_tuesday: 13, weekday_wednesday: 14, weekday_thursday: 15, weekday_friday: 16, weekday_saturday: 17, weekday_sunday: 18, weekend: 19, weekend_friday: 20, weekend_saturday: 21, dateFormat: 22, inclusiveEndDates: 23, topAxis: 24, axisFormat: 25, tickInterval: 26, excludes: 27, includes: 28, todayMarker: 29, title: 30, acc_title: 31, acc_title_value: 32, acc_descr: 33, acc_descr_value: 34, acc_descr_multiline_value: 35, section: 36, clickStatement: 37, taskTxt: 38, taskData: 39, click: 40, callbackname: 41, callbackargs: 42, href: 43, clickStatementDebug: 44, $accept: 0, $end: 1 }, terminals_: { 2: "error", 4: "gantt", 6: "EOF", 8: "SPACE", 10: "NL", 12: "weekday_monday", 13: "weekday_tuesday", 14: "weekday_wednesday", 15: "weekday_thursday", 16: "weekday_friday", 17: "weekday_saturday", 18: "weekday_sunday", 20: "weekend_friday", 21: "weekend_saturday", 22: "dateFormat", 23: "inclusiveEndDates", 24: "topAxis", 25: "axisFormat", 26: "tickInterval", 27: "excludes", 28: "includes", 29: "todayMarker", 30: "title", 31: "acc_title", 32: "acc_title_value", 33: "acc_descr", 34: "acc_descr_value", 35: "acc_descr_multiline_value", 36: "section", 38: "taskTxt", 39: "taskData", 40: "click", 41: "callbackname", 42: "callbackargs", 43: "href" }, productions_: [0, [3, 3], [5, 0], [5, 2], [7, 2], [7, 1], [7, 1], [7, 1], [11, 1], [11, 1], [11, 1], [11, 1], [11, 1], [11, 1], [11, 1], [19, 1], [19, 1], [9, 1], [9, 1], [9, 1], [9, 1], [9, 1], [9, 1], [9, 1], [9, 1], [9, 1], [9, 1], [9, 1], [9, 2], [9, 2], [9, 1], [9, 1], [9, 1], [9, 2], [37, 2], [37, 3], [37, 3], [37, 4], [37, 3], [37, 4], [37, 2], [44, 2], [44, 3], [44, 3], [44, 4], [44, 3], [44, 4], [44, 2]], performAction: d(function(C, c, f, h, Y, i, x) {
    var l = i.length - 1;
    switch (Y) {
      case 1:
        return i[l - 1];
      case 2:
        this.$ = [];
        break;
      case 3:
        i[l - 1].push(i[l]), this.$ = i[l - 1];
        break;
      case 4:
      case 5:
        this.$ = i[l];
        break;
      case 6:
      case 7:
        this.$ = [];
        break;
      case 8:
        h.setWeekday("monday");
        break;
      case 9:
        h.setWeekday("tuesday");
        break;
      case 10:
        h.setWeekday("wednesday");
        break;
      case 11:
        h.setWeekday("thursday");
        break;
      case 12:
        h.setWeekday("friday");
        break;
      case 13:
        h.setWeekday("saturday");
        break;
      case 14:
        h.setWeekday("sunday");
        break;
      case 15:
        h.setWeekend("friday");
        break;
      case 16:
        h.setWeekend("saturday");
        break;
      case 17:
        h.setDateFormat(i[l].substr(11)), this.$ = i[l].substr(11);
        break;
      case 18:
        h.enableInclusiveEndDates(), this.$ = i[l].substr(18);
        break;
      case 19:
        h.TopAxis(), this.$ = i[l].substr(8);
        break;
      case 20:
        h.setAxisFormat(i[l].substr(11)), this.$ = i[l].substr(11);
        break;
      case 21:
        h.setTickInterval(i[l].substr(13)), this.$ = i[l].substr(13);
        break;
      case 22:
        h.setExcludes(i[l].substr(9)), this.$ = i[l].substr(9);
        break;
      case 23:
        h.setIncludes(i[l].substr(9)), this.$ = i[l].substr(9);
        break;
      case 24:
        h.setTodayMarker(i[l].substr(12)), this.$ = i[l].substr(12);
        break;
      case 27:
        h.setDiagramTitle(i[l].substr(6)), this.$ = i[l].substr(6);
        break;
      case 28:
        this.$ = i[l].trim(), h.setAccTitle(this.$);
        break;
      case 29:
      case 30:
        this.$ = i[l].trim(), h.setAccDescription(this.$);
        break;
      case 31:
        h.addSection(i[l].substr(8)), this.$ = i[l].substr(8);
        break;
      case 33:
        h.addTask(i[l - 1], i[l]), this.$ = "task";
        break;
      case 34:
        this.$ = i[l - 1], h.setClickEvent(i[l - 1], i[l], null);
        break;
      case 35:
        this.$ = i[l - 2], h.setClickEvent(i[l - 2], i[l - 1], i[l]);
        break;
      case 36:
        this.$ = i[l - 2], h.setClickEvent(i[l - 2], i[l - 1], null), h.setLink(i[l - 2], i[l]);
        break;
      case 37:
        this.$ = i[l - 3], h.setClickEvent(i[l - 3], i[l - 2], i[l - 1]), h.setLink(i[l - 3], i[l]);
        break;
      case 38:
        this.$ = i[l - 2], h.setClickEvent(i[l - 2], i[l], null), h.setLink(i[l - 2], i[l - 1]);
        break;
      case 39:
        this.$ = i[l - 3], h.setClickEvent(i[l - 3], i[l - 1], i[l]), h.setLink(i[l - 3], i[l - 2]);
        break;
      case 40:
        this.$ = i[l - 1], h.setLink(i[l - 1], i[l]);
        break;
      case 41:
      case 47:
        this.$ = i[l - 1] + " " + i[l];
        break;
      case 42:
      case 43:
      case 45:
        this.$ = i[l - 2] + " " + i[l - 1] + " " + i[l];
        break;
      case 44:
      case 46:
        this.$ = i[l - 3] + " " + i[l - 2] + " " + i[l - 1] + " " + i[l];
        break;
    }
  }, "anonymous"), table: [{ 3: 1, 4: [1, 2] }, { 1: [3] }, t(e, [2, 2], { 5: 3 }), { 6: [1, 4], 7: 5, 8: [1, 6], 9: 7, 10: [1, 8], 11: 17, 12: n, 13: r, 14: a, 15: s, 16: o, 17: y, 18: M, 19: 18, 20: m, 21: k, 22: F, 23: b, 24: v, 25: j, 26: O, 27: D, 28: E, 29: z, 30: U, 31: N, 33: q, 35: w, 36: H, 37: 24, 38: T, 40: S }, t(e, [2, 7], { 1: [2, 1] }), t(e, [2, 3]), { 9: 36, 11: 17, 12: n, 13: r, 14: a, 15: s, 16: o, 17: y, 18: M, 19: 18, 20: m, 21: k, 22: F, 23: b, 24: v, 25: j, 26: O, 27: D, 28: E, 29: z, 30: U, 31: N, 33: q, 35: w, 36: H, 37: 24, 38: T, 40: S }, t(e, [2, 5]), t(e, [2, 6]), t(e, [2, 17]), t(e, [2, 18]), t(e, [2, 19]), t(e, [2, 20]), t(e, [2, 21]), t(e, [2, 22]), t(e, [2, 23]), t(e, [2, 24]), t(e, [2, 25]), t(e, [2, 26]), t(e, [2, 27]), { 32: [1, 37] }, { 34: [1, 38] }, t(e, [2, 30]), t(e, [2, 31]), t(e, [2, 32]), { 39: [1, 39] }, t(e, [2, 8]), t(e, [2, 9]), t(e, [2, 10]), t(e, [2, 11]), t(e, [2, 12]), t(e, [2, 13]), t(e, [2, 14]), t(e, [2, 15]), t(e, [2, 16]), { 41: [1, 40], 43: [1, 41] }, t(e, [2, 4]), t(e, [2, 28]), t(e, [2, 29]), t(e, [2, 33]), t(e, [2, 34], { 42: [1, 42], 43: [1, 43] }), t(e, [2, 40], { 41: [1, 44] }), t(e, [2, 35], { 43: [1, 45] }), t(e, [2, 36]), t(e, [2, 38], { 42: [1, 46] }), t(e, [2, 37]), t(e, [2, 39])], defaultActions: {}, parseError: d(function(C, c) {
    if (c.recoverable)
      this.trace(C);
    else {
      var f = new Error(C);
      throw f.hash = c, f;
    }
  }, "parseError"), parse: d(function(C) {
    var c = this, f = [0], h = [], Y = [null], i = [], x = this.table, l = "", A = 0, L = 0, X = 2, R = 1, kt = i.slice.call(arguments, 1), J = Object.create(this.lexer), st = { yy: {} };
    for (var pt in this.yy)
      Object.prototype.hasOwnProperty.call(this.yy, pt) && (st.yy[pt] = this.yy[pt]);
    J.setInput(C, st.yy), st.yy.lexer = J, st.yy.parser = this, typeof J.yylloc > "u" && (J.yylloc = {});
    var p = J.yylloc;
    i.push(p);
    var I = J.options && J.options.ranges;
    typeof st.yy.parseError == "function" ? this.parseError = st.yy.parseError : this.parseError = Object.getPrototypeOf(this).parseError;
    function P(it) {
      f.length = f.length - 2 * it, Y.length = Y.length - it, i.length = i.length - it;
    }
    d(P, "popStack");
    function u() {
      var it;
      return it = h.pop() || J.lex() || R, typeof it != "number" && (it instanceof Array && (h = it, it = h.pop()), it = c.symbols_[it] || it), it;
    }
    d(u, "lex");
    for (var V, W, G, K, tt = {}, ot, rt, Ae, Bt; ; ) {
      if (W = f[f.length - 1], this.defaultActions[W] ? G = this.defaultActions[W] : ((V === null || typeof V > "u") && (V = u()), G = x[W] && x[W][V]), typeof G > "u" || !G.length || !G[0]) {
        var ee = "";
        Bt = [];
        for (ot in x[W])
          this.terminals_[ot] && ot > X && Bt.push("'" + this.terminals_[ot] + "'");
        J.showPosition ? ee = "Parse error on line " + (A + 1) + `:
` + J.showPosition() + `
Expecting ` + Bt.join(", ") + ", got '" + (this.terminals_[V] || V) + "'" : ee = "Parse error on line " + (A + 1) + ": Unexpected " + (V == R ? "end of input" : "'" + (this.terminals_[V] || V) + "'"), this.parseError(ee, { text: J.match, token: this.terminals_[V] || V, line: J.yylineno, loc: p, expected: Bt });
      }
      if (G[0] instanceof Array && G.length > 1)
        throw new Error("Parse Error: multiple actions possible at state: " + W + ", token: " + V);
      switch (G[0]) {
        case 1:
          f.push(V), Y.push(J.yytext), i.push(J.yylloc), f.push(G[1]), V = null, L = J.yyleng, l = J.yytext, A = J.yylineno, p = J.yylloc;
          break;
        case 2:
          if (rt = this.productions_[G[1]][1], tt.$ = Y[Y.length - rt], tt._$ = { first_line: i[i.length - (rt || 1)].first_line, last_line: i[i.length - 1].last_line, first_column: i[i.length - (rt || 1)].first_column, last_column: i[i.length - 1].last_column }, I && (tt._$.range = [i[i.length - (rt || 1)].range[0], i[i.length - 1].range[1]]), K = this.performAction.apply(tt, [l, L, A, st.yy, G[1], Y, i].concat(kt)), typeof K < "u")
            return K;
          rt && (f = f.slice(0, -1 * rt * 2), Y = Y.slice(0, -1 * rt), i = i.slice(0, -1 * rt)), f.push(this.productions_[G[1]][0]), Y.push(tt.$), i.push(tt._$), Ae = x[f[f.length - 2]][f[f.length - 1]], f.push(Ae);
          break;
        case 3:
          return true;
      }
    }
    return true;
  }, "parse") }, $ = function() {
    var C = { EOF: 1, parseError: d(function(c, f) {
      if (this.yy.parser)
        this.yy.parser.parseError(c, f);
      else
        throw new Error(c);
    }, "parseError"), setInput: d(function(c, f) {
      return this.yy = f || this.yy || {}, this._input = c, this._more = this._backtrack = this.done = false, this.yylineno = this.yyleng = 0, this.yytext = this.matched = this.match = "", this.conditionStack = ["INITIAL"], this.yylloc = { first_line: 1, first_column: 0, last_line: 1, last_column: 0 }, this.options.ranges && (this.yylloc.range = [0, 0]), this.offset = 0, this;
    }, "setInput"), input: d(function() {
      var c = this._input[0];
      this.yytext += c, this.yyleng++, this.offset++, this.match += c, this.matched += c;
      var f = c.match(/(?:\r\n?|\n).*/g);
      return f ? (this.yylineno++, this.yylloc.last_line++) : this.yylloc.last_column++, this.options.ranges && this.yylloc.range[1]++, this._input = this._input.slice(1), c;
    }, "input"), unput: d(function(c) {
      var f = c.length, h = c.split(/(?:\r\n?|\n)/g);
      this._input = c + this._input, this.yytext = this.yytext.substr(0, this.yytext.length - f), this.offset -= f;
      var Y = this.match.split(/(?:\r\n?|\n)/g);
      this.match = this.match.substr(0, this.match.length - 1), this.matched = this.matched.substr(0, this.matched.length - 1), h.length - 1 && (this.yylineno -= h.length - 1);
      var i = this.yylloc.range;
      return this.yylloc = { first_line: this.yylloc.first_line, last_line: this.yylineno + 1, first_column: this.yylloc.first_column, last_column: h ? (h.length === Y.length ? this.yylloc.first_column : 0) + Y[Y.length - h.length].length - h[0].length : this.yylloc.first_column - f }, this.options.ranges && (this.yylloc.range = [i[0], i[0] + this.yyleng - f]), this.yyleng = this.yytext.length, this;
    }, "unput"), more: d(function() {
      return this._more = true, this;
    }, "more"), reject: d(function() {
      if (this.options.backtrack_lexer)
        this._backtrack = true;
      else
        return this.parseError("Lexical error on line " + (this.yylineno + 1) + `. You can only invoke reject() in the lexer when the lexer is of the backtracking persuasion (options.backtrack_lexer = true).
` + this.showPosition(), { text: "", token: null, line: this.yylineno });
      return this;
    }, "reject"), less: d(function(c) {
      this.unput(this.match.slice(c));
    }, "less"), pastInput: d(function() {
      var c = this.matched.substr(0, this.matched.length - this.match.length);
      return (c.length > 20 ? "..." : "") + c.substr(-20).replace(/\n/g, "");
    }, "pastInput"), upcomingInput: d(function() {
      var c = this.match;
      return c.length < 20 && (c += this._input.substr(0, 20 - c.length)), (c.substr(0, 20) + (c.length > 20 ? "..." : "")).replace(/\n/g, "");
    }, "upcomingInput"), showPosition: d(function() {
      var c = this.pastInput(), f = new Array(c.length + 1).join("-");
      return c + this.upcomingInput() + `
` + f + "^";
    }, "showPosition"), test_match: d(function(c, f) {
      var h, Y, i;
      if (this.options.backtrack_lexer && (i = { yylineno: this.yylineno, yylloc: { first_line: this.yylloc.first_line, last_line: this.last_line, first_column: this.yylloc.first_column, last_column: this.yylloc.last_column }, yytext: this.yytext, match: this.match, matches: this.matches, matched: this.matched, yyleng: this.yyleng, offset: this.offset, _more: this._more, _input: this._input, yy: this.yy, conditionStack: this.conditionStack.slice(0), done: this.done }, this.options.ranges && (i.yylloc.range = this.yylloc.range.slice(0))), Y = c[0].match(/(?:\r\n?|\n).*/g), Y && (this.yylineno += Y.length), this.yylloc = { first_line: this.yylloc.last_line, last_line: this.yylineno + 1, first_column: this.yylloc.last_column, last_column: Y ? Y[Y.length - 1].length - Y[Y.length - 1].match(/\r?\n?/)[0].length : this.yylloc.last_column + c[0].length }, this.yytext += c[0], this.match += c[0], this.matches = c, this.yyleng = this.yytext.length, this.options.ranges && (this.yylloc.range = [this.offset, this.offset += this.yyleng]), this._more = false, this._backtrack = false, this._input = this._input.slice(c[0].length), this.matched += c[0], h = this.performAction.call(this, this.yy, this, f, this.conditionStack[this.conditionStack.length - 1]), this.done && this._input && (this.done = false), h)
        return h;
      if (this._backtrack) {
        for (var x in i)
          this[x] = i[x];
        return false;
      }
      return false;
    }, "test_match"), next: d(function() {
      if (this.done)
        return this.EOF;
      this._input || (this.done = true);
      var c, f, h, Y;
      this._more || (this.yytext = "", this.match = "");
      for (var i = this._currentRules(), x = 0; x < i.length; x++)
        if (h = this._input.match(this.rules[i[x]]), h && (!f || h[0].length > f[0].length)) {
          if (f = h, Y = x, this.options.backtrack_lexer) {
            if (c = this.test_match(h, i[x]), c !== false)
              return c;
            if (this._backtrack) {
              f = false;
              continue;
            } else
              return false;
          } else if (!this.options.flex)
            break;
        }
      return f ? (c = this.test_match(f, i[Y]), c !== false ? c : false) : this._input === "" ? this.EOF : this.parseError("Lexical error on line " + (this.yylineno + 1) + `. Unrecognized text.
` + this.showPosition(), { text: "", token: null, line: this.yylineno });
    }, "next"), lex: d(function() {
      var c = this.next();
      return c || this.lex();
    }, "lex"), begin: d(function(c) {
      this.conditionStack.push(c);
    }, "begin"), popState: d(function() {
      var c = this.conditionStack.length - 1;
      return c > 0 ? this.conditionStack.pop() : this.conditionStack[0];
    }, "popState"), _currentRules: d(function() {
      return this.conditionStack.length && this.conditionStack[this.conditionStack.length - 1] ? this.conditions[this.conditionStack[this.conditionStack.length - 1]].rules : this.conditions.INITIAL.rules;
    }, "_currentRules"), topState: d(function(c) {
      return c = this.conditionStack.length - 1 - Math.abs(c || 0), c >= 0 ? this.conditionStack[c] : "INITIAL";
    }, "topState"), pushState: d(function(c) {
      this.begin(c);
    }, "pushState"), stateStackSize: d(function() {
      return this.conditionStack.length;
    }, "stateStackSize"), options: { "case-insensitive": true }, performAction: d(function(c, f, h, Y) {
      switch (h) {
        case 0:
          return this.begin("open_directive"), "open_directive";
        case 1:
          return this.begin("acc_title"), 31;
        case 2:
          return this.popState(), "acc_title_value";
        case 3:
          return this.begin("acc_descr"), 33;
        case 4:
          return this.popState(), "acc_descr_value";
        case 5:
          this.begin("acc_descr_multiline");
          break;
        case 6:
          this.popState();
          break;
        case 7:
          return "acc_descr_multiline_value";
        case 8:
          break;
        case 9:
          break;
        case 10:
          break;
        case 11:
          return 10;
        case 12:
          break;
        case 13:
          break;
        case 14:
          this.begin("href");
          break;
        case 15:
          this.popState();
          break;
        case 16:
          return 43;
        case 17:
          this.begin("callbackname");
          break;
        case 18:
          this.popState();
          break;
        case 19:
          this.popState(), this.begin("callbackargs");
          break;
        case 20:
          return 41;
        case 21:
          this.popState();
          break;
        case 22:
          return 42;
        case 23:
          this.begin("click");
          break;
        case 24:
          this.popState();
          break;
        case 25:
          return 40;
        case 26:
          return 4;
        case 27:
          return 22;
        case 28:
          return 23;
        case 29:
          return 24;
        case 30:
          return 25;
        case 31:
          return 26;
        case 32:
          return 28;
        case 33:
          return 27;
        case 34:
          return 29;
        case 35:
          return 12;
        case 36:
          return 13;
        case 37:
          return 14;
        case 38:
          return 15;
        case 39:
          return 16;
        case 40:
          return 17;
        case 41:
          return 18;
        case 42:
          return 20;
        case 43:
          return 21;
        case 44:
          return "date";
        case 45:
          return 30;
        case 46:
          return "accDescription";
        case 47:
          return 36;
        case 48:
          return 38;
        case 49:
          return 39;
        case 50:
          return ":";
        case 51:
          return 6;
        case 52:
          return "INVALID";
      }
    }, "anonymous"), rules: [/^(?:%%\{)/i, /^(?:accTitle\s*:\s*)/i, /^(?:(?!\n||)*[^\n]*)/i, /^(?:accDescr\s*:\s*)/i, /^(?:(?!\n||)*[^\n]*)/i, /^(?:accDescr\s*\{\s*)/i, /^(?:[\}])/i, /^(?:[^\}]*)/i, /^(?:%%(?!\{)*[^\n]*)/i, /^(?:[^\}]%%*[^\n]*)/i, /^(?:%%*[^\n]*[\n]*)/i, /^(?:[\n]+)/i, /^(?:\s+)/i, /^(?:%[^\n]*)/i, /^(?:href[\s]+["])/i, /^(?:["])/i, /^(?:[^"]*)/i, /^(?:call[\s]+)/i, /^(?:\([\s]*\))/i, /^(?:\()/i, /^(?:[^(]*)/i, /^(?:\))/i, /^(?:[^)]*)/i, /^(?:click[\s]+)/i, /^(?:[\s\n])/i, /^(?:[^\s\n]*)/i, /^(?:gantt\b)/i, /^(?:dateFormat\s[^#\n;]+)/i, /^(?:inclusiveEndDates\b)/i, /^(?:topAxis\b)/i, /^(?:axisFormat\s[^#\n;]+)/i, /^(?:tickInterval\s[^#\n;]+)/i, /^(?:includes\s[^#\n;]+)/i, /^(?:excludes\s[^#\n;]+)/i, /^(?:todayMarker\s[^\n;]+)/i, /^(?:weekday\s+monday\b)/i, /^(?:weekday\s+tuesday\b)/i, /^(?:weekday\s+wednesday\b)/i, /^(?:weekday\s+thursday\b)/i, /^(?:weekday\s+friday\b)/i, /^(?:weekday\s+saturday\b)/i, /^(?:weekday\s+sunday\b)/i, /^(?:weekend\s+friday\b)/i, /^(?:weekend\s+saturday\b)/i, /^(?:\d\d\d\d-\d\d-\d\d\b)/i, /^(?:title\s[^\n]+)/i, /^(?:accDescription\s[^#\n;]+)/i, /^(?:section\s[^\n]+)/i, /^(?:[^:\n]+)/i, /^(?::[^#\n;]+)/i, /^(?::)/i, /^(?:$)/i, /^(?:.)/i], conditions: { acc_descr_multiline: { rules: [6, 7], inclusive: false }, acc_descr: { rules: [4], inclusive: false }, acc_title: { rules: [2], inclusive: false }, callbackargs: { rules: [21, 22], inclusive: false }, callbackname: { rules: [18, 19, 20], inclusive: false }, href: { rules: [15, 16], inclusive: false }, click: { rules: [24, 25], inclusive: false }, INITIAL: { rules: [0, 1, 3, 5, 8, 9, 10, 11, 12, 13, 14, 17, 23, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52], inclusive: true } } };
    return C;
  }();
  _.lexer = $;
  function g() {
    this.yy = {};
  }
  return d(g, "Parser"), g.prototype = _, _.Parser = g, new g();
}();
pe.parser = pe;
var zi = pe;
nt.extend(Ei);
nt.extend(Ii);
nt.extend(Pi);
var Ze = { friday: 5, saturday: 6 }, ct = "", De = "", Me = void 0, _e = "", Pt = [], zt = [], $e = /* @__PURE__ */ new Map(), Se = [], Qt = [], Ft = "", Ye = "", Cn = ["active", "done", "crit", "milestone"], Fe = [], Vt = false, Ee = false, Ue = "sunday", te = "saturday", Te = 0, Vi = d(function() {
  Se = [], Qt = [], Ft = "", Fe = [], jt = 0, ve = void 0, Rt = void 0, Z = [], ct = "", De = "", Ye = "", Me = void 0, _e = "", Pt = [], zt = [], Vt = false, Ee = false, Te = 0, $e = /* @__PURE__ */ new Map(), Wn(), Ue = "sunday", te = "saturday";
}, "clear"), Bi = d(function(t) {
  De = t;
}, "setAxisFormat"), Gi = d(function() {
  return De;
}, "getAxisFormat"), Ni = d(function(t) {
  Me = t;
}, "setTickInterval"), Xi = d(function() {
  return Me;
}, "getTickInterval"), ji = d(function(t) {
  _e = t;
}, "setTodayMarker"), Ri = d(function() {
  return _e;
}, "getTodayMarker"), qi = d(function(t) {
  ct = t;
}, "setDateFormat"), Ji = d(function() {
  Vt = true;
}, "enableInclusiveEndDates"), Ki = d(function() {
  return Vt;
}, "endDatesAreInclusive"), Zi = d(function() {
  Ee = true;
}, "enableTopAxis"), Qi = d(function() {
  return Ee;
}, "topAxisEnabled"), ta = d(function(t) {
  Ye = t;
}, "setDisplayMode"), ea = d(function() {
  return Ye;
}, "getDisplayMode"), na = d(function() {
  return ct;
}, "getDateFormat"), ra = d(function(t) {
  Pt = t.toLowerCase().split(/[\s,]+/);
}, "setIncludes"), ia = d(function() {
  return Pt;
}, "getIncludes"), aa = d(function(t) {
  zt = t.toLowerCase().split(/[\s,]+/);
}, "setExcludes"), sa = d(function() {
  return zt;
}, "getExcludes"), oa = d(function() {
  return $e;
}, "getLinks"), ca = d(function(t) {
  Ft = t, Se.push(t);
}, "addSection"), la = d(function() {
  return Se;
}, "getSections"), ua = d(function() {
  let t = Qe();
  const e = 10;
  let n = 0;
  for (; !t && n < e; )
    t = Qe(), n++;
  return Qt = Z, Qt;
}, "getTasks"), Dn = d(function(t, e, n, r) {
  return r.includes(t.format(e.trim())) ? false : n.includes("weekends") && (t.isoWeekday() === Ze[te] || t.isoWeekday() === Ze[te] + 1) || n.includes(t.format("dddd").toLowerCase()) ? true : n.includes(t.format(e.trim()));
}, "isInvalidDate"), da = d(function(t) {
  Ue = t;
}, "setWeekday"), ha = d(function() {
  return Ue;
}, "getWeekday"), fa = d(function(t) {
  te = t;
}, "setWeekend"), Mn = d(function(t, e, n, r) {
  if (!n.length || t.manualEndTime)
    return;
  let a;
  t.startTime instanceof Date ? a = nt(t.startTime) : a = nt(t.startTime, e, true), a = a.add(1, "d");
  let s;
  t.endTime instanceof Date ? s = nt(t.endTime) : s = nt(t.endTime, e, true);
  const [o, y] = ga(a, s, e, n, r);
  t.endTime = o.toDate(), t.renderEndTime = y;
}, "checkTaskDates"), ga = d(function(t, e, n, r, a) {
  let s = false, o = null;
  for (; t <= e; )
    s || (o = e.toDate()), s = Dn(t, n, r, a), s && (e = e.add(1, "d")), t = t.add(1, "d");
  return [e, o];
}, "fixTaskDates"), be = d(function(t, e, n) {
  n = n.trim();
  const r = /^after\s+(?<ids>[\d\w- ]+)/.exec(n);
  if (r !== null) {
    let s = null;
    for (const y of r.groups.ids.split(" ")) {
      let M = Ct(y);
      M !== void 0 && (!s || M.endTime > s.endTime) && (s = M);
    }
    if (s)
      return s.endTime;
    const o = /* @__PURE__ */ new Date();
    return o.setHours(0, 0, 0, 0), o;
  }
  let a = nt(n, e.trim(), true);
  if (a.isValid())
    return a.toDate();
  {
    qt.debug("Invalid date:" + n), qt.debug("With date format:" + e.trim());
    const s = new Date(n);
    if (s === void 0 || isNaN(s.getTime()) || s.getFullYear() < -1e4 || s.getFullYear() > 1e4)
      throw new Error("Invalid date:" + n);
    return s;
  }
}, "getStartDate"), _n = d(function(t) {
  const e = /^(\d+(?:\.\d+)?)([Mdhmswy]|ms)$/.exec(t.trim());
  return e !== null ? [Number.parseFloat(e[1]), e[2]] : [NaN, "ms"];
}, "parseDuration"), $n = d(function(t, e, n, r = false) {
  n = n.trim();
  const a = /^until\s+(?<ids>[\d\w- ]+)/.exec(n);
  if (a !== null) {
    let m = null;
    for (const F of a.groups.ids.split(" ")) {
      let b = Ct(F);
      b !== void 0 && (!m || b.startTime < m.startTime) && (m = b);
    }
    if (m)
      return m.startTime;
    const k = /* @__PURE__ */ new Date();
    return k.setHours(0, 0, 0, 0), k;
  }
  let s = nt(n, e.trim(), true);
  if (s.isValid())
    return r && (s = s.add(1, "d")), s.toDate();
  let o = nt(t);
  const [y, M] = _n(n);
  if (!Number.isNaN(y)) {
    const m = o.add(y, M);
    m.isValid() && (o = m);
  }
  return o.toDate();
}, "getEndDate"), jt = 0, $t = d(function(t) {
  return t === void 0 ? (jt = jt + 1, "task" + jt) : t;
}, "parseId"), ya = d(function(t, e) {
  let n;
  e.substr(0, 1) === ":" ? n = e.substr(1, e.length) : n = e;
  const r = n.split(","), a = {};
  Le(r, a, Cn);
  for (let o = 0; o < r.length; o++)
    r[o] = r[o].trim();
  let s = "";
  switch (r.length) {
    case 1:
      a.id = $t(), a.startTime = t.endTime, s = r[0];
      break;
    case 2:
      a.id = $t(), a.startTime = be(void 0, ct, r[0]), s = r[1];
      break;
    case 3:
      a.id = $t(r[0]), a.startTime = be(void 0, ct, r[1]), s = r[2];
      break;
  }
  return s && (a.endTime = $n(a.startTime, ct, s, Vt), a.manualEndTime = nt(s, "YYYY-MM-DD", true).isValid(), Mn(a, ct, zt, Pt)), a;
}, "compileData"), ma = d(function(t, e) {
  let n;
  e.substr(0, 1) === ":" ? n = e.substr(1, e.length) : n = e;
  const r = n.split(","), a = {};
  Le(r, a, Cn);
  for (let s = 0; s < r.length; s++)
    r[s] = r[s].trim();
  switch (r.length) {
    case 1:
      a.id = $t(), a.startTime = { type: "prevTaskEnd", id: t }, a.endTime = { data: r[0] };
      break;
    case 2:
      a.id = $t(), a.startTime = { type: "getStartDate", startData: r[0] }, a.endTime = { data: r[1] };
      break;
    case 3:
      a.id = $t(r[0]), a.startTime = { type: "getStartDate", startData: r[1] }, a.endTime = { data: r[2] };
      break;
  }
  return a;
}, "parseData"), ve, Rt, Z = [], Sn = {}, ka = d(function(t, e) {
  const n = { section: Ft, type: Ft, processed: false, manualEndTime: false, renderEndTime: null, raw: { data: e }, task: t, classes: [] }, r = ma(Rt, e);
  n.raw.startTime = r.startTime, n.raw.endTime = r.endTime, n.id = r.id, n.prevTaskId = Rt, n.active = r.active, n.done = r.done, n.crit = r.crit, n.milestone = r.milestone, n.order = Te, Te++;
  const a = Z.push(n);
  Rt = n.id, Sn[n.id] = a - 1;
}, "addTask"), Ct = d(function(t) {
  const e = Sn[t];
  return Z[e];
}, "findTaskById"), pa = d(function(t, e) {
  const n = { section: Ft, type: Ft, description: t, task: t, classes: [] }, r = ya(ve, e);
  n.startTime = r.startTime, n.endTime = r.endTime, n.id = r.id, n.active = r.active, n.done = r.done, n.crit = r.crit, n.milestone = r.milestone, ve = n, Qt.push(n);
}, "addTaskOrg"), Qe = d(function() {
  const t = d(function(n) {
    const r = Z[n];
    let a = "";
    switch (Z[n].raw.startTime.type) {
      case "prevTaskEnd": {
        const s = Ct(r.prevTaskId);
        r.startTime = s.endTime;
        break;
      }
      case "getStartDate":
        a = be(void 0, ct, Z[n].raw.startTime.startData), a && (Z[n].startTime = a);
        break;
    }
    return Z[n].startTime && (Z[n].endTime = $n(Z[n].startTime, ct, Z[n].raw.endTime.data, Vt), Z[n].endTime && (Z[n].processed = true, Z[n].manualEndTime = nt(Z[n].raw.endTime.data, "YYYY-MM-DD", true).isValid(), Mn(Z[n], ct, zt, Pt))), Z[n].processed;
  }, "compileTask");
  let e = true;
  for (const [n, r] of Z.entries())
    t(n), e = e && r.processed;
  return e;
}, "compileTasks"), Ta = d(function(t, e) {
  let n = e;
  Mt().securityLevel !== "loose" && (n = Hn.sanitizeUrl(e)), t.split(",").forEach(function(r) {
    Ct(r) !== void 0 && (Fn(r, () => {
      window.open(n, "_self");
    }), $e.set(r, n));
  }), Yn(t, "clickable");
}, "setLink"), Yn = d(function(t, e) {
  t.split(",").forEach(function(n) {
    let r = Ct(n);
    r !== void 0 && r.classes.push(e);
  });
}, "setClass"), ba = d(function(t, e, n) {
  if (Mt().securityLevel !== "loose" || e === void 0)
    return;
  let r = [];
  if (typeof n == "string") {
    r = n.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
    for (let a = 0; a < r.length; a++) {
      let s = r[a].trim();
      s.startsWith('"') && s.endsWith('"') && (s = s.substr(1, s.length - 2)), r[a] = s;
    }
  }
  r.length === 0 && r.push(t), Ct(t) !== void 0 && Fn(t, () => {
    Vn.runFunc(e, ...r);
  });
}, "setClickFun"), Fn = d(function(t, e) {
  Fe.push(function() {
    const n = document.querySelector(`[id="${t}"]`);
    n !== null && n.addEventListener("click", function() {
      e();
    });
  }, function() {
    const n = document.querySelector(`[id="${t}-text"]`);
    n !== null && n.addEventListener("click", function() {
      e();
    });
  });
}, "pushFun"), va = d(function(t, e, n) {
  t.split(",").forEach(function(r) {
    ba(r, e, n);
  }), Yn(t, "clickable");
}, "setClickEvent"), xa = d(function(t) {
  Fe.forEach(function(e) {
    e(t);
  });
}, "bindFunctions"), wa = { getConfig: d(() => Mt().gantt, "getConfig"), clear: Vi, setDateFormat: qi, getDateFormat: na, enableInclusiveEndDates: Ji, endDatesAreInclusive: Ki, enableTopAxis: Zi, topAxisEnabled: Qi, setAxisFormat: Bi, getAxisFormat: Gi, setTickInterval: Ni, getTickInterval: Xi, setTodayMarker: ji, getTodayMarker: Ri, setAccTitle: En, getAccTitle: Un, setDiagramTitle: Ln, getDiagramTitle: An, setDisplayMode: ta, getDisplayMode: ea, setAccDescription: In, getAccDescription: On, addSection: ca, getSections: la, getTasks: ua, addTask: ka, findTaskById: Ct, addTaskOrg: pa, setIncludes: ra, getIncludes: ia, setExcludes: aa, getExcludes: sa, setClickEvent: va, setLink: Ta, getLinks: oa, bindFunctions: xa, parseDuration: _n, isInvalidDate: Dn, setWeekday: da, getWeekday: ha, setWeekend: fa };
function Le(t, e, n) {
  let r = true;
  for (; r; )
    r = false, n.forEach(function(a) {
      const s = "^\\s*" + a + "\\s*$", o = new RegExp(s);
      t[0].match(o) && (e[a] = true, t.shift(1), r = true);
    });
}
d(Le, "getTaskTags");
var Ca = d(function() {
  qt.debug("Something is calling, setConf, remove the call");
}, "setConf"), tn = { monday: Ot, tuesday: gn, wednesday: yn, thursday: bt, friday: mn, saturday: kn, sunday: Ht }, Da = d((t, e) => {
  let n = [...t].map(() => -1 / 0), r = [...t].sort((s, o) => s.startTime - o.startTime || s.order - o.order), a = 0;
  for (const s of r)
    for (let o = 0; o < n.length; o++)
      if (s.startTime >= n[o]) {
        n[o] = s.endTime, s.order = o + e, o > a && (a = o);
        break;
      }
  return a;
}, "getMaxIntersections"), ut, Ma = d(function(t, e, n, r) {
  const a = Mt().gantt, s = Mt().securityLevel;
  let o;
  s === "sandbox" && (o = Gt("#i" + e));
  const y = s === "sandbox" ? Gt(o.nodes()[0].contentDocument.body) : Gt("body"), M = s === "sandbox" ? o.nodes()[0].contentDocument : document, m = M.getElementById(e);
  ut = m.parentElement.offsetWidth, ut === void 0 && (ut = 1200), a.useWidth !== void 0 && (ut = a.useWidth);
  const k = r.db.getTasks();
  let F = [];
  for (const T of k)
    F.push(T.type);
  F = H(F);
  const b = {};
  let v = 2 * a.topPadding;
  if (r.db.getDisplayMode() === "compact" || a.displayMode === "compact") {
    const T = {};
    for (const _ of k)
      T[_.section] === void 0 ? T[_.section] = [_] : T[_.section].push(_);
    let S = 0;
    for (const _ of Object.keys(T)) {
      const $ = Da(T[_], S) + 1;
      S += $, v += $ * (a.barHeight + a.barGap), b[_] = $;
    }
  } else {
    v += k.length * (a.barHeight + a.barGap);
    for (const T of F)
      b[T] = k.filter((S) => S.type === T).length;
  }
  m.setAttribute("viewBox", "0 0 " + ut + " " + v);
  const j = y.select(`[id="${e}"]`), O = $i().domain([Jn(k, function(T) {
    return T.startTime;
  }), Kn(k, function(T) {
    return T.endTime;
  })]).rangeRound([0, ut - a.leftPadding - a.rightPadding]);
  function D(T, S) {
    const _ = T.startTime, $ = S.startTime;
    let g = 0;
    return _ > $ ? g = 1 : _ < $ && (g = -1), g;
  }
  d(D, "taskCompare"), k.sort(D), E(k, ut, v), Pn(j, v, ut, a.useMaxWidth), j.append("text").text(r.db.getDiagramTitle()).attr("x", ut / 2).attr("y", a.titleTopMargin).attr("class", "titleText");
  function E(T, S, _) {
    const $ = a.barHeight, g = $ + a.barGap, C = a.topPadding, c = a.leftPadding, f = Nn().domain([0, F.length]).range(["#00B9FA", "#F95002"]).interpolate(hr);
    U(g, C, c, S, _, T, r.db.getExcludes(), r.db.getIncludes()), N(c, C, S, _), z(T, g, C, c, $, f, S), q(g, C), w(c, C, S, _);
  }
  d(E, "makeGantt");
  function z(T, S, _, $, g, C, c) {
    const f = [...new Set(T.map((i) => i.order))].map((i) => T.find((x) => x.order === i));
    j.append("g").selectAll("rect").data(f).enter().append("rect").attr("x", 0).attr("y", function(i, x) {
      return x = i.order, x * S + _ - 2;
    }).attr("width", function() {
      return c - a.rightPadding / 2;
    }).attr("height", S).attr("class", function(i) {
      for (const [x, l] of F.entries())
        if (i.type === l)
          return "section section" + x % a.numberSectionStyles;
      return "section section0";
    });
    const h = j.append("g").selectAll("rect").data(T).enter(), Y = r.db.getLinks();
    if (h.append("rect").attr("id", function(i) {
      return i.id;
    }).attr("rx", 3).attr("ry", 3).attr("x", function(i) {
      return i.milestone ? O(i.startTime) + $ + 0.5 * (O(i.endTime) - O(i.startTime)) - 0.5 * g : O(i.startTime) + $;
    }).attr("y", function(i, x) {
      return x = i.order, x * S + _;
    }).attr("width", function(i) {
      return i.milestone ? g : O(i.renderEndTime || i.endTime) - O(i.startTime);
    }).attr("height", g).attr("transform-origin", function(i, x) {
      return x = i.order, (O(i.startTime) + $ + 0.5 * (O(i.endTime) - O(i.startTime))).toString() + "px " + (x * S + _ + 0.5 * g).toString() + "px";
    }).attr("class", function(i) {
      const x = "task";
      let l = "";
      i.classes.length > 0 && (l = i.classes.join(" "));
      let A = 0;
      for (const [X, R] of F.entries())
        i.type === R && (A = X % a.numberSectionStyles);
      let L = "";
      return i.active ? i.crit ? L += " activeCrit" : L = " active" : i.done ? i.crit ? L = " doneCrit" : L = " done" : i.crit && (L += " crit"), L.length === 0 && (L = " task"), i.milestone && (L = " milestone " + L), L += A, L += " " + l, x + L;
    }), h.append("text").attr("id", function(i) {
      return i.id + "-text";
    }).text(function(i) {
      return i.task;
    }).attr("font-size", a.fontSize).attr("x", function(i) {
      let x = O(i.startTime), l = O(i.renderEndTime || i.endTime);
      i.milestone && (x += 0.5 * (O(i.endTime) - O(i.startTime)) - 0.5 * g), i.milestone && (l = x + g);
      const A = this.getBBox().width;
      return A > l - x ? l + A + 1.5 * a.leftPadding > c ? x + $ - 5 : l + $ + 5 : (l - x) / 2 + x + $;
    }).attr("y", function(i, x) {
      return x = i.order, x * S + a.barHeight / 2 + (a.fontSize / 2 - 2) + _;
    }).attr("text-height", g).attr("class", function(i) {
      const x = O(i.startTime);
      let l = O(i.endTime);
      i.milestone && (l = x + g);
      const A = this.getBBox().width;
      let L = "";
      i.classes.length > 0 && (L = i.classes.join(" "));
      let X = 0;
      for (const [kt, J] of F.entries())
        i.type === J && (X = kt % a.numberSectionStyles);
      let R = "";
      return i.active && (i.crit ? R = "activeCritText" + X : R = "activeText" + X), i.done ? i.crit ? R = R + " doneCritText" + X : R = R + " doneText" + X : i.crit && (R = R + " critText" + X), i.milestone && (R += " milestoneText"), A > l - x ? l + A + 1.5 * a.leftPadding > c ? L + " taskTextOutsideLeft taskTextOutside" + X + " " + R : L + " taskTextOutsideRight taskTextOutside" + X + " " + R + " width-" + A : L + " taskText taskText" + X + " " + R + " width-" + A;
    }), Mt().securityLevel === "sandbox") {
      let i;
      i = Gt("#i" + e);
      const x = i.nodes()[0].contentDocument;
      h.filter(function(l) {
        return Y.has(l.id);
      }).each(function(l) {
        var A = x.querySelector("#" + l.id), L = x.querySelector("#" + l.id + "-text");
        const X = A.parentNode;
        var R = x.createElement("a");
        R.setAttribute("xlink:href", Y.get(l.id)), R.setAttribute("target", "_top"), X.appendChild(R), R.appendChild(A), R.appendChild(L);
      });
    }
  }
  d(z, "drawRects");
  function U(T, S, _, $, g, C, c, f) {
    if (c.length === 0 && f.length === 0)
      return;
    let h, Y;
    for (const { startTime: L, endTime: X } of C)
      (h === void 0 || L < h) && (h = L), (Y === void 0 || X > Y) && (Y = X);
    if (!h || !Y)
      return;
    if (nt(Y).diff(nt(h), "year") > 5) {
      qt.warn("The difference between the min and max time is more than 5 years. This will cause performance issues. Skipping drawing exclude days.");
      return;
    }
    const i = r.db.getDateFormat(), x = [];
    let l = null, A = nt(h);
    for (; A.valueOf() <= Y; )
      r.db.isInvalidDate(A, i, c, f) ? l ? l.end = A : l = { start: A, end: A } : l && (x.push(l), l = null), A = A.add(1, "d");
    j.append("g").selectAll("rect").data(x).enter().append("rect").attr("id", function(L) {
      return "exclude-" + L.start.format("YYYY-MM-DD");
    }).attr("x", function(L) {
      return O(L.start) + _;
    }).attr("y", a.gridLineStartPadding).attr("width", function(L) {
      const X = L.end.add(1, "day");
      return O(X) - O(L.start);
    }).attr("height", g - S - a.gridLineStartPadding).attr("transform-origin", function(L, X) {
      return (O(L.start) + _ + 0.5 * (O(L.end) - O(L.start))).toString() + "px " + (X * T + 0.5 * g).toString() + "px";
    }).attr("class", "exclude-range");
  }
  d(U, "drawExcludeDays");
  function N(T, S, _, $) {
    let g = ar(O).tickSize(-$ + S + a.gridLineStartPadding).tickFormat(Zt(r.db.getAxisFormat() || a.axisFormat || "%Y-%m-%d"));
    const C = /^([1-9]\d*)(millisecond|second|minute|hour|day|week|month)$/.exec(r.db.getTickInterval() || a.tickInterval);
    if (C !== null) {
      const c = C[1], f = C[2], h = r.db.getWeekday() || a.weekday;
      switch (f) {
        case "millisecond":
          g.ticks(St.every(c));
          break;
        case "second":
          g.ticks(mt.every(c));
          break;
        case "minute":
          g.ticks(At.every(c));
          break;
        case "hour":
          g.ticks(It.every(c));
          break;
        case "day":
          g.ticks(Tt.every(c));
          break;
        case "week":
          g.ticks(tn[h].every(c));
          break;
        case "month":
          g.ticks(Wt.every(c));
          break;
      }
    }
    if (j.append("g").attr("class", "grid").attr("transform", "translate(" + T + ", " + ($ - 50) + ")").call(g).selectAll("text").style("text-anchor", "middle").attr("fill", "#000").attr("stroke", "none").attr("font-size", 10).attr("dy", "1em"), r.db.topAxisEnabled() || a.topAxis) {
      let c = ir(O).tickSize(-$ + S + a.gridLineStartPadding).tickFormat(Zt(r.db.getAxisFormat() || a.axisFormat || "%Y-%m-%d"));
      if (C !== null) {
        const f = C[1], h = C[2], Y = r.db.getWeekday() || a.weekday;
        switch (h) {
          case "millisecond":
            c.ticks(St.every(f));
            break;
          case "second":
            c.ticks(mt.every(f));
            break;
          case "minute":
            c.ticks(At.every(f));
            break;
          case "hour":
            c.ticks(It.every(f));
            break;
          case "day":
            c.ticks(Tt.every(f));
            break;
          case "week":
            c.ticks(tn[Y].every(f));
            break;
          case "month":
            c.ticks(Wt.every(f));
            break;
        }
      }
      j.append("g").attr("class", "grid").attr("transform", "translate(" + T + ", " + S + ")").call(c).selectAll("text").style("text-anchor", "middle").attr("fill", "#000").attr("stroke", "none").attr("font-size", 10);
    }
  }
  d(N, "makeGrid");
  function q(T, S) {
    let _ = 0;
    const $ = Object.keys(b).map((g) => [g, b[g]]);
    j.append("g").selectAll("text").data($).enter().append(function(g) {
      const C = g[0].split(zn.lineBreakRegex), c = -(C.length - 1) / 2, f = M.createElementNS("http://www.w3.org/2000/svg", "text");
      f.setAttribute("dy", c + "em");
      for (const [h, Y] of C.entries()) {
        const i = M.createElementNS("http://www.w3.org/2000/svg", "tspan");
        i.setAttribute("alignment-baseline", "central"), i.setAttribute("x", "10"), h > 0 && i.setAttribute("dy", "1em"), i.textContent = Y, f.appendChild(i);
      }
      return f;
    }).attr("x", 10).attr("y", function(g, C) {
      if (C > 0)
        for (let c = 0; c < C; c++)
          return _ += $[C - 1][1], g[1] * T / 2 + _ * T + S;
      else
        return g[1] * T / 2 + S;
    }).attr("font-size", a.sectionFontSize).attr("class", function(g) {
      for (const [C, c] of F.entries())
        if (g[0] === c)
          return "sectionTitle sectionTitle" + C % a.numberSectionStyles;
      return "sectionTitle";
    });
  }
  d(q, "vertLabels");
  function w(T, S, _, $) {
    const g = r.db.getTodayMarker();
    if (g === "off")
      return;
    const C = j.append("g").attr("class", "today"), c = /* @__PURE__ */ new Date(), f = C.append("line");
    f.attr("x1", O(c) + T).attr("x2", O(c) + T).attr("y1", a.titleTopMargin).attr("y2", $ - a.titleTopMargin).attr("class", "today"), g !== "" && f.attr("style", g.replace(/,/g, ";"));
  }
  d(w, "drawToday");
  function H(T) {
    const S = {}, _ = [];
    for (let $ = 0, g = T.length; $ < g; ++$)
      Object.prototype.hasOwnProperty.call(S, T[$]) || (S[T[$]] = true, _.push(T[$]));
    return _;
  }
  d(H, "checkUnique");
}, "draw"), _a = { setConf: Ca, draw: Ma }, $a = d((t) => `
  .mermaid-main-font {
        font-family: ${t.fontFamily};
  }

  .exclude-range {
    fill: ${t.excludeBkgColor};
  }

  .section {
    stroke: none;
    opacity: 0.2;
  }

  .section0 {
    fill: ${t.sectionBkgColor};
  }

  .section2 {
    fill: ${t.sectionBkgColor2};
  }

  .section1,
  .section3 {
    fill: ${t.altSectionBkgColor};
    opacity: 0.2;
  }

  .sectionTitle0 {
    fill: ${t.titleColor};
  }

  .sectionTitle1 {
    fill: ${t.titleColor};
  }

  .sectionTitle2 {
    fill: ${t.titleColor};
  }

  .sectionTitle3 {
    fill: ${t.titleColor};
  }

  .sectionTitle {
    text-anchor: start;
    font-family: ${t.fontFamily};
  }


  /* Grid and axis */

  .grid .tick {
    stroke: ${t.gridColor};
    opacity: 0.8;
    shape-rendering: crispEdges;
  }

  .grid .tick text {
    font-family: ${t.fontFamily};
    fill: ${t.textColor};
  }

  .grid path {
    stroke-width: 0;
  }


  /* Today line */

  .today {
    fill: none;
    stroke: ${t.todayLineColor};
    stroke-width: 2px;
  }


  /* Task styling */

  /* Default task */

  .task {
    stroke-width: 2;
  }

  .taskText {
    text-anchor: middle;
    font-family: ${t.fontFamily};
  }

  .taskTextOutsideRight {
    fill: ${t.taskTextDarkColor};
    text-anchor: start;
    font-family: ${t.fontFamily};
  }

  .taskTextOutsideLeft {
    fill: ${t.taskTextDarkColor};
    text-anchor: end;
  }


  /* Special case clickable */

  .task.clickable {
    cursor: pointer;
  }

  .taskText.clickable {
    cursor: pointer;
    fill: ${t.taskTextClickableColor} !important;
    font-weight: bold;
  }

  .taskTextOutsideLeft.clickable {
    cursor: pointer;
    fill: ${t.taskTextClickableColor} !important;
    font-weight: bold;
  }

  .taskTextOutsideRight.clickable {
    cursor: pointer;
    fill: ${t.taskTextClickableColor} !important;
    font-weight: bold;
  }


  /* Specific task settings for the sections*/

  .taskText0,
  .taskText1,
  .taskText2,
  .taskText3 {
    fill: ${t.taskTextColor};
  }

  .task0,
  .task1,
  .task2,
  .task3 {
    fill: ${t.taskBkgColor};
    stroke: ${t.taskBorderColor};
  }

  .taskTextOutside0,
  .taskTextOutside2
  {
    fill: ${t.taskTextOutsideColor};
  }

  .taskTextOutside1,
  .taskTextOutside3 {
    fill: ${t.taskTextOutsideColor};
  }


  /* Active task */

  .active0,
  .active1,
  .active2,
  .active3 {
    fill: ${t.activeTaskBkgColor};
    stroke: ${t.activeTaskBorderColor};
  }

  .activeText0,
  .activeText1,
  .activeText2,
  .activeText3 {
    fill: ${t.taskTextDarkColor} !important;
  }


  /* Completed task */

  .done0,
  .done1,
  .done2,
  .done3 {
    stroke: ${t.doneTaskBorderColor};
    fill: ${t.doneTaskBkgColor};
    stroke-width: 2;
  }

  .doneText0,
  .doneText1,
  .doneText2,
  .doneText3 {
    fill: ${t.taskTextDarkColor} !important;
  }


  /* Tasks on the critical line */

  .crit0,
  .crit1,
  .crit2,
  .crit3 {
    stroke: ${t.critBorderColor};
    fill: ${t.critBkgColor};
    stroke-width: 2;
  }

  .activeCrit0,
  .activeCrit1,
  .activeCrit2,
  .activeCrit3 {
    stroke: ${t.critBorderColor};
    fill: ${t.activeTaskBkgColor};
    stroke-width: 2;
  }

  .doneCrit0,
  .doneCrit1,
  .doneCrit2,
  .doneCrit3 {
    stroke: ${t.critBorderColor};
    fill: ${t.doneTaskBkgColor};
    stroke-width: 2;
    cursor: pointer;
    shape-rendering: crispEdges;
  }

  .milestone {
    transform: rotate(45deg) scale(0.8,0.8);
  }

  .milestoneText {
    font-style: italic;
  }
  .doneCritText0,
  .doneCritText1,
  .doneCritText2,
  .doneCritText3 {
    fill: ${t.taskTextDarkColor} !important;
  }

  .activeCritText0,
  .activeCritText1,
  .activeCritText2,
  .activeCritText3 {
    fill: ${t.taskTextDarkColor} !important;
  }

  .titleText {
    text-anchor: middle;
    font-size: 18px;
    fill: ${t.titleColor || t.textColor};
    font-family: ${t.fontFamily};
  }
`, "getStyles"), Sa = $a, Oa = { parser: zi, db: wa, renderer: _a, styles: Sa };
export {
  Oa as diagram
};
