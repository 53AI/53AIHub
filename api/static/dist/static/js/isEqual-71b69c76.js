import { cn as F, co as x, cp as K, cq as D, cr as I, cs as M, ct as $, cu as G, cv as R, cw as J, cx as B } from "./index-7b696e01.js";
var Q = "__lodash_hash_undefined__";
function X(n) {
  return this.__data__.set(n, Q), this;
}
function Y(n) {
  return this.__data__.has(n);
}
function L(n) {
  var e = -1, a = n == null ? 0 : n.length;
  for (this.__data__ = new F(); ++e < a; )
    this.add(n[e]);
}
L.prototype.add = L.prototype.push = X;
L.prototype.has = Y;
function Z(n, e) {
  for (var a = -1, f = n == null ? 0 : n.length; ++a < f; )
    if (e(n[a], a, n))
      return true;
  return false;
}
function W(n, e) {
  return n.has(e);
}
var m = 1, h = 2;
function q(n, e, a, f, u, r) {
  var s = a & m, g = n.length, l = e.length;
  if (g != l && !(s && l > g))
    return false;
  var t = r.get(n), v = r.get(e);
  if (t && v)
    return t == e && v == n;
  var _ = -1, i = true, p = a & h ? new L() : void 0;
  for (r.set(n, e), r.set(e, n); ++_ < g; ) {
    var d = n[_], A = e[_];
    if (f)
      var T = s ? f(A, d, _, e, n, r) : f(d, A, _, n, e, r);
    if (T !== void 0) {
      if (T)
        continue;
      i = false;
      break;
    }
    if (p) {
      if (!Z(e, function(O, w) {
        if (!W(p, w) && (d === O || u(d, O, a, f, r)))
          return p.push(w);
      })) {
        i = false;
        break;
      }
    } else if (!(d === A || u(d, A, a, f, r))) {
      i = false;
      break;
    }
  }
  return r.delete(n), r.delete(e), i;
}
function z(n) {
  var e = -1, a = Array(n.size);
  return n.forEach(function(f, u) {
    a[++e] = [u, f];
  }), a;
}
function j(n) {
  var e = -1, a = Array(n.size);
  return n.forEach(function(f) {
    a[++e] = f;
  }), a;
}
var o = 1, V = 2, k = "[object Boolean]", nn = "[object Date]", en = "[object Error]", rn = "[object Map]", an = "[object Number]", fn = "[object RegExp]", sn = "[object Set]", un = "[object String]", ln = "[object Symbol]", gn = "[object ArrayBuffer]", tn = "[object DataView]", C = x ? x.prototype : void 0, S = C ? C.valueOf : void 0;
function _n(n, e, a, f, u, r, s) {
  switch (a) {
    case tn:
      if (n.byteLength != e.byteLength || n.byteOffset != e.byteOffset)
        return false;
      n = n.buffer, e = e.buffer;
    case gn:
      return !(n.byteLength != e.byteLength || !r(new D(n), new D(e)));
    case k:
    case nn:
    case an:
      return K(+n, +e);
    case en:
      return n.name == e.name && n.message == e.message;
    case fn:
    case un:
      return n == e + "";
    case rn:
      var g = z;
    case sn:
      var l = f & o;
      if (g || (g = j), n.size != e.size && !l)
        return false;
      var t = s.get(n);
      if (t)
        return t == e;
      f |= V, s.set(n, e);
      var v = q(g(n), g(e), f, u, r, s);
      return s.delete(n), v;
    case ln:
      if (S)
        return S.call(n) == S.call(e);
  }
  return false;
}
var dn = 1, An = Object.prototype, vn = An.hasOwnProperty;
function pn(n, e, a, f, u, r) {
  var s = a & dn, g = I(n), l = g.length, t = I(e), v = t.length;
  if (l != v && !s)
    return false;
  for (var _ = l; _--; ) {
    var i = g[_];
    if (!(s ? i in e : vn.call(e, i)))
      return false;
  }
  var p = r.get(n), d = r.get(e);
  if (p && d)
    return p == e && d == n;
  var A = true;
  r.set(n, e), r.set(e, n);
  for (var T = s; ++_ < l; ) {
    i = g[_];
    var O = n[i], w = e[i];
    if (f)
      var c = s ? f(w, O, i, e, n, r) : f(O, w, i, n, e, r);
    if (!(c === void 0 ? O === w || u(O, w, a, f, r) : c)) {
      A = false;
      break;
    }
    T || (T = i == "constructor");
  }
  if (A && !T) {
    var y = n.constructor, P = e.constructor;
    y != P && "constructor" in n && "constructor" in e && !(typeof y == "function" && y instanceof y && typeof P == "function" && P instanceof P) && (A = false);
  }
  return r.delete(n), r.delete(e), A;
}
var Tn = 1, N = "[object Arguments]", H = "[object Array]", E = "[object Object]", On = Object.prototype, U = On.hasOwnProperty;
function wn(n, e, a, f, u, r) {
  var s = M(n), g = M(e), l = s ? H : $(n), t = g ? H : $(e);
  l = l == N ? E : l, t = t == N ? E : t;
  var v = l == E, _ = t == E, i = l == t;
  if (i && G(n)) {
    if (!G(e))
      return false;
    s = true, v = false;
  }
  if (i && !v)
    return r || (r = new R()), s || J(n) ? q(n, e, a, f, u, r) : _n(n, e, l, a, f, u, r);
  if (!(a & Tn)) {
    var p = v && U.call(n, "__wrapped__"), d = _ && U.call(e, "__wrapped__");
    if (p || d) {
      var A = p ? n.value() : n, T = d ? e.value() : e;
      return r || (r = new R()), u(A, T, a, f, r);
    }
  }
  return i ? (r || (r = new R()), pn(n, e, a, f, u, r)) : false;
}
function b(n, e, a, f, u) {
  return n === e ? true : n == null || e == null || !B(n) && !B(e) ? n !== n && e !== e : wn(n, e, a, f, b, u);
}
function Pn(n, e) {
  return b(n, e);
}
export {
  b,
  Pn as i
};
