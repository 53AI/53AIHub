import { s as st, u as Q, at as ot, n as it, k as V, d as ze, V as ct, j as T, ad as qe, y as le, e as at, f as lt } from "./@vue-3b855f7b.js";
/*!
* vue-router v4.5.0
* (c) 2024 Eduardo San Martin Morote
* @license MIT
*/
const q = typeof document < "u";
function Ge(e) {
  return typeof e == "object" || "displayName" in e || "props" in e || "__vccOpts" in e;
}
function ut(e) {
  return e.__esModule || e[Symbol.toStringTag] === "Module" || e.default && Ge(e.default);
}
const P = Object.assign;
function ue(e, t) {
  const n = {};
  for (const r in t) {
    const s = t[r];
    n[r] = N(s) ? s.map(e) : e(s);
  }
  return n;
}
const F = () => {
}, N = Array.isArray, Ke = /#/g, ft = /&/g, ht = /\//g, dt = /=/g, pt = /\?/g, Ue = /\+/g, mt = /%5B/g, gt = /%5D/g, De = /%5E/g, vt = /%60/g, We = /%7B/g, yt = /%7C/g, Qe = /%7D/g, Rt = /%20/g;
function ge(e) {
  return encodeURI("" + e).replace(yt, "|").replace(mt, "[").replace(gt, "]");
}
function Et(e) {
  return ge(e).replace(We, "{").replace(Qe, "}").replace(De, "^");
}
function de(e) {
  return ge(e).replace(Ue, "%2B").replace(Rt, "+").replace(Ke, "%23").replace(ft, "%26").replace(vt, "`").replace(We, "{").replace(Qe, "}").replace(De, "^");
}
function wt(e) {
  return de(e).replace(dt, "%3D");
}
function Pt(e) {
  return ge(e).replace(Ke, "%23").replace(pt, "%3F");
}
function St(e) {
  return e == null ? "" : Pt(e).replace(ht, "%2F");
}
function X(e) {
  try {
    return decodeURIComponent("" + e);
  } catch {
  }
  return "" + e;
}
const kt = /\/$/, Ct = (e) => e.replace(kt, "");
function fe(e, t, n = "/") {
  let r, s = {}, a = "", d = "";
  const g = t.indexOf("#");
  let i = t.indexOf("?");
  return g < i && g >= 0 && (i = -1), i > -1 && (r = t.slice(0, i), a = t.slice(i + 1, g > -1 ? g : t.length), s = e(a)), g > -1 && (r = r || t.slice(0, g), d = t.slice(g, t.length)), r = Ot(r ?? t, n), { fullPath: r + (a && "?") + a + d, path: r, query: s, hash: X(d) };
}
function bt(e, t) {
  const n = t.query ? e(t.query) : "";
  return t.path + (n && "?") + n + (t.hash || "");
}
function ke(e, t) {
  return !t || !e.toLowerCase().startsWith(t.toLowerCase()) ? e : e.slice(t.length) || "/";
}
function At(e, t, n) {
  const r = t.matched.length - 1, s = n.matched.length - 1;
  return r > -1 && r === s && G(t.matched[r], n.matched[s]) && Fe(t.params, n.params) && e(t.query) === e(n.query) && t.hash === n.hash;
}
function G(e, t) {
  return (e.aliasOf || e) === (t.aliasOf || t);
}
function Fe(e, t) {
  if (Object.keys(e).length !== Object.keys(t).length)
    return false;
  for (const n in e)
    if (!_t(e[n], t[n]))
      return false;
  return true;
}
function _t(e, t) {
  return N(e) ? Ce(e, t) : N(t) ? Ce(t, e) : e === t;
}
function Ce(e, t) {
  return N(t) ? e.length === t.length && e.every((n, r) => n === t[r]) : e.length === 1 && e[0] === t;
}
function Ot(e, t) {
  if (e.startsWith("/"))
    return e;
  if (!e)
    return t;
  const n = t.split("/"), r = e.split("/"), s = r[r.length - 1];
  (s === ".." || s === ".") && r.push("");
  let a = n.length - 1, d, g;
  for (d = 0; d < r.length; d++)
    if (g = r[d], g !== ".")
      if (g === "..")
        a > 1 && a--;
      else
        break;
  return n.slice(0, a).join("/") + "/" + r.slice(d).join("/");
}
const j = { path: "/", name: void 0, params: {}, query: {}, hash: "", fullPath: "/", matched: [], meta: {}, redirectedFrom: void 0 };
var Z;
(function(e) {
  e.pop = "pop", e.push = "push";
})(Z || (Z = {}));
var Y;
(function(e) {
  e.back = "back", e.forward = "forward", e.unknown = "";
})(Y || (Y = {}));
function xt(e) {
  if (!e)
    if (q) {
      const t = document.querySelector("base");
      e = t && t.getAttribute("href") || "/", e = e.replace(/^\w+:\/\/[^\/]+/, "");
    } else
      e = "/";
  return e[0] !== "/" && e[0] !== "#" && (e = "/" + e), Ct(e);
}
const Mt = /^[^#]+#/;
function It(e, t) {
  return e.replace(Mt, "#") + t;
}
function Nt(e, t) {
  const n = document.documentElement.getBoundingClientRect(), r = e.getBoundingClientRect();
  return { behavior: t.behavior, left: r.left - n.left - (t.left || 0), top: r.top - n.top - (t.top || 0) };
}
const te = () => ({ left: window.scrollX, top: window.scrollY });
function Tt(e) {
  let t;
  if ("el" in e) {
    const n = e.el, r = typeof n == "string" && n.startsWith("#"), s = typeof n == "string" ? r ? document.getElementById(n.slice(1)) : document.querySelector(n) : n;
    if (!s)
      return;
    t = Nt(s, e);
  } else
    t = e;
  "scrollBehavior" in document.documentElement.style ? window.scrollTo(t) : window.scrollTo(t.left != null ? t.left : window.scrollX, t.top != null ? t.top : window.scrollY);
}
function be(e, t) {
  return (history.state ? history.state.position - t : -1) + e;
}
const pe = /* @__PURE__ */ new Map();
function Lt(e, t) {
  pe.set(e, t);
}
function $t(e) {
  const t = pe.get(e);
  return pe.delete(e), t;
}
let jt = () => location.protocol + "//" + location.host;
function Ye(e, t) {
  const { pathname: n, search: r, hash: s } = t, a = e.indexOf("#");
  if (a > -1) {
    let g = s.includes(e.slice(a)) ? e.slice(a).length : 1, i = s.slice(g);
    return i[0] !== "/" && (i = "/" + i), ke(i, "");
  }
  return ke(n, e) + r + s;
}
function Ht(e, t, n, r) {
  let s = [], a = [], d = null;
  const g = ({ state: l }) => {
    const u = Ye(e, location), w = n.value, S = t.value;
    let b = 0;
    if (l) {
      if (n.value = u, t.value = l, d && d === w) {
        d = null;
        return;
      }
      b = S ? l.position - S.position : 0;
    } else
      r(u);
    s.forEach((A) => {
      A(n.value, w, { delta: b, type: Z.pop, direction: b ? b > 0 ? Y.forward : Y.back : Y.unknown });
    });
  };
  function i() {
    d = n.value;
  }
  function f(l) {
    s.push(l);
    const u = () => {
      const w = s.indexOf(l);
      w > -1 && s.splice(w, 1);
    };
    return a.push(u), u;
  }
  function h() {
    const { history: l } = window;
    l.state && l.replaceState(P({}, l.state, { scroll: te() }), "");
  }
  function c() {
    for (const l of a)
      l();
    a = [], window.removeEventListener("popstate", g), window.removeEventListener("beforeunload", h);
  }
  return window.addEventListener("popstate", g), window.addEventListener("beforeunload", h, { passive: true }), { pauseListeners: i, listen: f, destroy: c };
}
function Ae(e, t, n, r = false, s = false) {
  return { back: e, current: t, forward: n, replaced: r, position: window.history.length, scroll: s ? te() : null };
}
function Bt(e) {
  const { history: t, location: n } = window, r = { value: Ye(e, n) }, s = { value: t.state };
  s.value || a(r.value, { back: null, current: r.value, forward: null, position: t.length - 1, replaced: true, scroll: null }, true);
  function a(i, f, h) {
    const c = e.indexOf("#"), l = c > -1 ? (n.host && document.querySelector("base") ? e : e.slice(c)) + i : jt() + e + i;
    try {
      t[h ? "replaceState" : "pushState"](f, "", l), s.value = f;
    } catch (u) {
      console.error(u), n[h ? "replace" : "assign"](l);
    }
  }
  function d(i, f) {
    const h = P({}, t.state, Ae(s.value.back, i, s.value.forward, true), f, { position: s.value.position });
    a(i, h, true), r.value = i;
  }
  function g(i, f) {
    const h = P({}, s.value, t.state, { forward: i, scroll: te() });
    a(h.current, h, true);
    const c = P({}, Ae(r.value, i, null), { position: h.position + 1 }, f);
    a(i, c, false), r.value = i;
  }
  return { location: r, state: s, push: g, replace: d };
}
function Vt(e) {
  e = xt(e);
  const t = Bt(e), n = Ht(e, t.state, t.location, t.replace);
  function r(a, d = true) {
    d || n.pauseListeners(), history.go(a);
  }
  const s = P({ location: "", base: e, go: r, createHref: It.bind(null, e) }, t, n);
  return Object.defineProperty(s, "location", { enumerable: true, get: () => t.location.value }), Object.defineProperty(s, "state", { enumerable: true, get: () => t.state.value }), s;
}
function pn(e) {
  return e = location.host ? e || location.pathname + location.search : "", e.includes("#") || (e += "#"), Vt(e);
}
function zt(e) {
  return typeof e == "string" || e && typeof e == "object";
}
function Xe(e) {
  return typeof e == "string" || typeof e == "symbol";
}
const Ze = Symbol("");
var _e;
(function(e) {
  e[e.aborted = 4] = "aborted", e[e.cancelled = 8] = "cancelled", e[e.duplicated = 16] = "duplicated";
})(_e || (_e = {}));
function K(e, t) {
  return P(new Error(), { type: e, [Ze]: true }, t);
}
function L(e, t) {
  return e instanceof Error && Ze in e && (t == null || !!(e.type & t));
}
const Oe = "[^/]+?", qt = { sensitive: false, strict: false, start: true, end: true }, Gt = /[.+*?^${}()[\]/\\]/g;
function Kt(e, t) {
  const n = P({}, qt, t), r = [];
  let s = n.start ? "^" : "";
  const a = [];
  for (const f of e) {
    const h = f.length ? [] : [90];
    n.strict && !f.length && (s += "/");
    for (let c = 0; c < f.length; c++) {
      const l = f[c];
      let u = 40 + (n.sensitive ? 0.25 : 0);
      if (l.type === 0)
        c || (s += "/"), s += l.value.replace(Gt, "\\$&"), u += 40;
      else if (l.type === 1) {
        const { value: w, repeatable: S, optional: b, regexp: A } = l;
        a.push({ name: w, repeatable: S, optional: b });
        const E = A || Oe;
        if (E !== Oe) {
          u += 10;
          try {
            new RegExp(`(${E})`);
          } catch (I) {
            throw new Error(`Invalid custom RegExp for param "${w}" (${E}): ` + I.message);
          }
        }
        let k = S ? `((?:${E})(?:/(?:${E}))*)` : `(${E})`;
        c || (k = b && f.length < 2 ? `(?:/${k})` : "/" + k), b && (k += "?"), s += k, u += 20, b && (u += -8), S && (u += -20), E === ".*" && (u += -50);
      }
      h.push(u);
    }
    r.push(h);
  }
  if (n.strict && n.end) {
    const f = r.length - 1;
    r[f][r[f].length - 1] += 0.7000000000000001;
  }
  n.strict || (s += "/?"), n.end ? s += "$" : n.strict && !s.endsWith("/") && (s += "(?:/|$)");
  const d = new RegExp(s, n.sensitive ? "" : "i");
  function g(f) {
    const h = f.match(d), c = {};
    if (!h)
      return null;
    for (let l = 1; l < h.length; l++) {
      const u = h[l] || "", w = a[l - 1];
      c[w.name] = u && w.repeatable ? u.split("/") : u;
    }
    return c;
  }
  function i(f) {
    let h = "", c = false;
    for (const l of e) {
      (!c || !h.endsWith("/")) && (h += "/"), c = false;
      for (const u of l)
        if (u.type === 0)
          h += u.value;
        else if (u.type === 1) {
          const { value: w, repeatable: S, optional: b } = u, A = w in f ? f[w] : "";
          if (N(A) && !S)
            throw new Error(`Provided param "${w}" is an array but it is not repeatable (* or + modifiers)`);
          const E = N(A) ? A.join("/") : A;
          if (!E)
            if (b)
              l.length < 2 && (h.endsWith("/") ? h = h.slice(0, -1) : c = true);
            else
              throw new Error(`Missing required param "${w}"`);
          h += E;
        }
    }
    return h || "/";
  }
  return { re: d, score: r, keys: a, parse: g, stringify: i };
}
function Ut(e, t) {
  let n = 0;
  for (; n < e.length && n < t.length; ) {
    const r = t[n] - e[n];
    if (r)
      return r;
    n++;
  }
  return e.length < t.length ? e.length === 1 && e[0] === 40 + 40 ? -1 : 1 : e.length > t.length ? t.length === 1 && t[0] === 40 + 40 ? 1 : -1 : 0;
}
function Je(e, t) {
  let n = 0;
  const r = e.score, s = t.score;
  for (; n < r.length && n < s.length; ) {
    const a = Ut(r[n], s[n]);
    if (a)
      return a;
    n++;
  }
  if (Math.abs(s.length - r.length) === 1) {
    if (xe(r))
      return 1;
    if (xe(s))
      return -1;
  }
  return s.length - r.length;
}
function xe(e) {
  const t = e[e.length - 1];
  return e.length > 0 && t[t.length - 1] < 0;
}
const Dt = { type: 0, value: "" }, Wt = /[a-zA-Z0-9_]/;
function Qt(e) {
  if (!e)
    return [[]];
  if (e === "/")
    return [[Dt]];
  if (!e.startsWith("/"))
    throw new Error(`Invalid path "${e}"`);
  function t(u) {
    throw new Error(`ERR (${n})/"${f}": ${u}`);
  }
  let n = 0, r = n;
  const s = [];
  let a;
  function d() {
    a && s.push(a), a = [];
  }
  let g = 0, i, f = "", h = "";
  function c() {
    f && (n === 0 ? a.push({ type: 0, value: f }) : n === 1 || n === 2 || n === 3 ? (a.length > 1 && (i === "*" || i === "+") && t(`A repeatable param (${f}) must be alone in its segment. eg: '/:ids+.`), a.push({ type: 1, value: f, regexp: h, repeatable: i === "*" || i === "+", optional: i === "*" || i === "?" })) : t("Invalid state to consume buffer"), f = "");
  }
  function l() {
    f += i;
  }
  for (; g < e.length; ) {
    if (i = e[g++], i === "\\" && n !== 2) {
      r = n, n = 4;
      continue;
    }
    switch (n) {
      case 0:
        i === "/" ? (f && c(), d()) : i === ":" ? (c(), n = 1) : l();
        break;
      case 4:
        l(), n = r;
        break;
      case 1:
        i === "(" ? n = 2 : Wt.test(i) ? l() : (c(), n = 0, i !== "*" && i !== "?" && i !== "+" && g--);
        break;
      case 2:
        i === ")" ? h[h.length - 1] == "\\" ? h = h.slice(0, -1) + i : n = 3 : h += i;
        break;
      case 3:
        c(), n = 0, i !== "*" && i !== "?" && i !== "+" && g--, h = "";
        break;
      default:
        t("Unknown state");
        break;
    }
  }
  return n === 2 && t(`Unfinished custom RegExp for param "${f}"`), c(), d(), s;
}
function Ft(e, t, n) {
  const r = Kt(Qt(e.path), n), s = P(r, { record: e, parent: t, children: [], alias: [] });
  return t && !s.record.aliasOf == !t.record.aliasOf && t.children.push(s), s;
}
function Yt(e, t) {
  const n = [], r = /* @__PURE__ */ new Map();
  t = Te({ strict: false, end: true, sensitive: false }, t);
  function s(c) {
    return r.get(c);
  }
  function a(c, l, u) {
    const w = !u, S = Ie(c);
    S.aliasOf = u && u.record;
    const b = Te(t, c), A = [S];
    if ("alias" in c) {
      const I = typeof c.alias == "string" ? [c.alias] : c.alias;
      for (const B of I)
        A.push(Ie(P({}, S, { components: u ? u.record.components : S.components, path: B, aliasOf: u ? u.record : S })));
    }
    let E, k;
    for (const I of A) {
      const { path: B } = I;
      if (l && B[0] !== "/") {
        const $ = l.record.path, M = $[$.length - 1] === "/" ? "" : "/";
        I.path = l.record.path + (B && M + B);
      }
      if (E = Ft(I, l, b), u ? u.alias.push(E) : (k = k || E, k !== E && k.alias.push(E), w && c.name && !Ne(E) && d(c.name)), et(E) && i(E), S.children) {
        const $ = S.children;
        for (let M = 0; M < $.length; M++)
          a($[M], E, u && u.children[M]);
      }
      u = u || E;
    }
    return k ? () => {
      d(k);
    } : F;
  }
  function d(c) {
    if (Xe(c)) {
      const l = r.get(c);
      l && (r.delete(c), n.splice(n.indexOf(l), 1), l.children.forEach(d), l.alias.forEach(d));
    } else {
      const l = n.indexOf(c);
      l > -1 && (n.splice(l, 1), c.record.name && r.delete(c.record.name), c.children.forEach(d), c.alias.forEach(d));
    }
  }
  function g() {
    return n;
  }
  function i(c) {
    const l = Jt(c, n);
    n.splice(l, 0, c), c.record.name && !Ne(c) && r.set(c.record.name, c);
  }
  function f(c, l) {
    let u, w = {}, S, b;
    if ("name" in c && c.name) {
      if (u = r.get(c.name), !u)
        throw K(1, { location: c });
      b = u.record.name, w = P(Me(l.params, u.keys.filter((k) => !k.optional).concat(u.parent ? u.parent.keys.filter((k) => k.optional) : []).map((k) => k.name)), c.params && Me(c.params, u.keys.map((k) => k.name))), S = u.stringify(w);
    } else if (c.path != null)
      S = c.path, u = n.find((k) => k.re.test(S)), u && (w = u.parse(S), b = u.record.name);
    else {
      if (u = l.name ? r.get(l.name) : n.find((k) => k.re.test(l.path)), !u)
        throw K(1, { location: c, currentLocation: l });
      b = u.record.name, w = P({}, l.params, c.params), S = u.stringify(w);
    }
    const A = [];
    let E = u;
    for (; E; )
      A.unshift(E.record), E = E.parent;
    return { name: b, path: S, params: w, matched: A, meta: Zt(A) };
  }
  e.forEach((c) => a(c));
  function h() {
    n.length = 0, r.clear();
  }
  return { addRoute: a, resolve: f, removeRoute: d, clearRoutes: h, getRoutes: g, getRecordMatcher: s };
}
function Me(e, t) {
  const n = {};
  for (const r of t)
    r in e && (n[r] = e[r]);
  return n;
}
function Ie(e) {
  const t = { path: e.path, redirect: e.redirect, name: e.name, meta: e.meta || {}, aliasOf: e.aliasOf, beforeEnter: e.beforeEnter, props: Xt(e), children: e.children || [], instances: {}, leaveGuards: /* @__PURE__ */ new Set(), updateGuards: /* @__PURE__ */ new Set(), enterCallbacks: {}, components: "components" in e ? e.components || null : e.component && { default: e.component } };
  return Object.defineProperty(t, "mods", { value: {} }), t;
}
function Xt(e) {
  const t = {}, n = e.props || false;
  if ("component" in e)
    t.default = n;
  else
    for (const r in e.components)
      t[r] = typeof n == "object" ? n[r] : n;
  return t;
}
function Ne(e) {
  for (; e; ) {
    if (e.record.aliasOf)
      return true;
    e = e.parent;
  }
  return false;
}
function Zt(e) {
  return e.reduce((t, n) => P(t, n.meta), {});
}
function Te(e, t) {
  const n = {};
  for (const r in e)
    n[r] = r in t ? t[r] : e[r];
  return n;
}
function Jt(e, t) {
  let n = 0, r = t.length;
  for (; n !== r; ) {
    const a = n + r >> 1;
    Je(e, t[a]) < 0 ? r = a : n = a + 1;
  }
  const s = en(e);
  return s && (r = t.lastIndexOf(s, r - 1)), r;
}
function en(e) {
  let t = e;
  for (; t = t.parent; )
    if (et(t) && Je(e, t) === 0)
      return t;
}
function et({ record: e }) {
  return !!(e.name || e.components && Object.keys(e.components).length || e.redirect);
}
function tn(e) {
  const t = {};
  if (e === "" || e === "?")
    return t;
  const r = (e[0] === "?" ? e.slice(1) : e).split("&");
  for (let s = 0; s < r.length; ++s) {
    const a = r[s].replace(Ue, " "), d = a.indexOf("="), g = X(d < 0 ? a : a.slice(0, d)), i = d < 0 ? null : X(a.slice(d + 1));
    if (g in t) {
      let f = t[g];
      N(f) || (f = t[g] = [f]), f.push(i);
    } else
      t[g] = i;
  }
  return t;
}
function Le(e) {
  let t = "";
  for (let n in e) {
    const r = e[n];
    if (n = wt(n), r == null) {
      r !== void 0 && (t += (t.length ? "&" : "") + n);
      continue;
    }
    (N(r) ? r.map((a) => a && de(a)) : [r && de(r)]).forEach((a) => {
      a !== void 0 && (t += (t.length ? "&" : "") + n, a != null && (t += "=" + a));
    });
  }
  return t;
}
function nn(e) {
  const t = {};
  for (const n in e) {
    const r = e[n];
    r !== void 0 && (t[n] = N(r) ? r.map((s) => s == null ? null : "" + s) : r == null ? r : "" + r);
  }
  return t;
}
const rn = Symbol(""), $e = Symbol(""), ne = Symbol(""), ve = Symbol(""), me = Symbol("");
function W() {
  let e = [];
  function t(r) {
    return e.push(r), () => {
      const s = e.indexOf(r);
      s > -1 && e.splice(s, 1);
    };
  }
  function n() {
    e = [];
  }
  return { add: t, list: () => e.slice(), reset: n };
}
function H(e, t, n, r, s, a = (d) => d()) {
  const d = r && (r.enterCallbacks[s] = r.enterCallbacks[s] || []);
  return () => new Promise((g, i) => {
    const f = (l) => {
      l === false ? i(K(4, { from: n, to: t })) : l instanceof Error ? i(l) : zt(l) ? i(K(2, { from: t, to: l })) : (d && r.enterCallbacks[s] === d && typeof l == "function" && d.push(l), g());
    }, h = a(() => e.call(r && r.instances[s], t, n, f));
    let c = Promise.resolve(h);
    e.length < 3 && (c = c.then(f)), c.catch((l) => i(l));
  });
}
function he(e, t, n, r, s = (a) => a()) {
  const a = [];
  for (const d of e)
    for (const g in d.components) {
      let i = d.components[g];
      if (!(t !== "beforeRouteEnter" && !d.instances[g]))
        if (Ge(i)) {
          const h = (i.__vccOpts || i)[t];
          h && a.push(H(h, n, r, d, g, s));
        } else {
          let f = i();
          a.push(() => f.then((h) => {
            if (!h)
              throw new Error(`Couldn't resolve component "${g}" at "${d.path}"`);
            const c = ut(h) ? h.default : h;
            d.mods[g] = h, d.components[g] = c;
            const u = (c.__vccOpts || c)[t];
            return u && H(u, n, r, d, g, s)();
          }));
        }
    }
  return a;
}
function je(e) {
  const t = V(ne), n = V(ve), r = T(() => {
    const i = Q(e.to);
    return t.resolve(i);
  }), s = T(() => {
    const { matched: i } = r.value, { length: f } = i, h = i[f - 1], c = n.matched;
    if (!h || !c.length)
      return -1;
    const l = c.findIndex(G.bind(null, h));
    if (l > -1)
      return l;
    const u = He(i[f - 2]);
    return f > 1 && He(h) === u && c[c.length - 1].path !== u ? c.findIndex(G.bind(null, i[f - 2])) : l;
  }), a = T(() => s.value > -1 && ln(n.params, r.value.params)), d = T(() => s.value > -1 && s.value === n.matched.length - 1 && Fe(n.params, r.value.params));
  function g(i = {}) {
    if (an(i)) {
      const f = t[Q(e.replace) ? "replace" : "push"](Q(e.to)).catch(F);
      return e.viewTransition && typeof document < "u" && "startViewTransition" in document && document.startViewTransition(() => f), f;
    }
    return Promise.resolve();
  }
  return { route: r, href: T(() => r.value.href), isActive: a, isExactActive: d, navigate: g };
}
function sn(e) {
  return e.length === 1 ? e[0] : e;
}
const on = ze({ name: "RouterLink", compatConfig: { MODE: 3 }, props: { to: { type: [String, Object], required: true }, replace: Boolean, activeClass: String, exactActiveClass: String, custom: Boolean, ariaCurrentValue: { type: String, default: "page" } }, useLink: je, setup(e, { slots: t }) {
  const n = ct(je(e)), { options: r } = V(ne), s = T(() => ({ [Be(e.activeClass, r.linkActiveClass, "router-link-active")]: n.isActive, [Be(e.exactActiveClass, r.linkExactActiveClass, "router-link-exact-active")]: n.isExactActive }));
  return () => {
    const a = t.default && sn(t.default(n));
    return e.custom ? a : qe("a", { "aria-current": n.isExactActive ? e.ariaCurrentValue : null, href: n.href, onClick: n.navigate, class: s.value }, a);
  };
} }), cn = on;
function an(e) {
  if (!(e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) && !e.defaultPrevented && !(e.button !== void 0 && e.button !== 0)) {
    if (e.currentTarget && e.currentTarget.getAttribute) {
      const t = e.currentTarget.getAttribute("target");
      if (/\b_blank\b/i.test(t))
        return;
    }
    return e.preventDefault && e.preventDefault(), true;
  }
}
function ln(e, t) {
  for (const n in t) {
    const r = t[n], s = e[n];
    if (typeof r == "string") {
      if (r !== s)
        return false;
    } else if (!N(s) || s.length !== r.length || r.some((a, d) => a !== s[d]))
      return false;
  }
  return true;
}
function He(e) {
  return e ? e.aliasOf ? e.aliasOf.path : e.path : "";
}
const Be = (e, t, n) => e ?? t ?? n, un = ze({ name: "RouterView", inheritAttrs: false, props: { name: { type: String, default: "default" }, route: Object }, compatConfig: { MODE: 3 }, setup(e, { attrs: t, slots: n }) {
  const r = V(me), s = T(() => e.route || r.value), a = V($e, 0), d = T(() => {
    let f = Q(a);
    const { matched: h } = s.value;
    let c;
    for (; (c = h[f]) && !c.components; )
      f++;
    return f;
  }), g = T(() => s.value.matched[d.value]);
  le($e, T(() => d.value + 1)), le(rn, g), le(me, s);
  const i = at();
  return lt(() => [i.value, g.value, e.name], ([f, h, c], [l, u, w]) => {
    h && (h.instances[c] = f, u && u !== h && f && f === l && (h.leaveGuards.size || (h.leaveGuards = u.leaveGuards), h.updateGuards.size || (h.updateGuards = u.updateGuards))), f && h && (!u || !G(h, u) || !l) && (h.enterCallbacks[c] || []).forEach((S) => S(f));
  }, { flush: "post" }), () => {
    const f = s.value, h = e.name, c = g.value, l = c && c.components[h];
    if (!l)
      return Ve(n.default, { Component: l, route: f });
    const u = c.props[h], w = u ? u === true ? f.params : typeof u == "function" ? u(f) : u : null, b = qe(l, P({}, w, t, { onVnodeUnmounted: (A) => {
      A.component.isUnmounted && (c.instances[h] = null);
    }, ref: i }));
    return Ve(n.default, { Component: b, route: f }) || b;
  };
} });
function Ve(e, t) {
  if (!e)
    return null;
  const n = e(t);
  return n.length === 1 ? n[0] : n;
}
const fn = un;
function mn(e) {
  const t = Yt(e.routes, e), n = e.parseQuery || tn, r = e.stringifyQuery || Le, s = e.history, a = W(), d = W(), g = W(), i = st(j);
  let f = j;
  q && e.scrollBehavior && "scrollRestoration" in history && (history.scrollRestoration = "manual");
  const h = ue.bind(null, (o) => "" + o), c = ue.bind(null, St), l = ue.bind(null, X);
  function u(o, m) {
    let p, v;
    return Xe(o) ? (p = t.getRecordMatcher(o), v = m) : v = o, t.addRoute(v, p);
  }
  function w(o) {
    const m = t.getRecordMatcher(o);
    m && t.removeRoute(m);
  }
  function S() {
    return t.getRoutes().map((o) => o.record);
  }
  function b(o) {
    return !!t.getRecordMatcher(o);
  }
  function A(o, m) {
    if (m = P({}, m || i.value), typeof o == "string") {
      const y = fe(n, o, m.path), O = t.resolve({ path: y.path }, m), D = s.createHref(y.fullPath);
      return P(y, O, { params: l(O.params), hash: X(y.hash), redirectedFrom: void 0, href: D });
    }
    let p;
    if (o.path != null)
      p = P({}, o, { path: fe(n, o.path, m.path).path });
    else {
      const y = P({}, o.params);
      for (const O in y)
        y[O] == null && delete y[O];
      p = P({}, o, { params: c(y) }), m.params = c(m.params);
    }
    const v = t.resolve(p, m), C = o.hash || "";
    v.params = h(l(v.params));
    const _ = bt(r, P({}, o, { hash: Et(C), path: v.path })), R = s.createHref(_);
    return P({ fullPath: _, hash: C, query: r === Le ? nn(o.query) : o.query || {} }, v, { redirectedFrom: void 0, href: R });
  }
  function E(o) {
    return typeof o == "string" ? fe(n, o, i.value.path) : P({}, o);
  }
  function k(o, m) {
    if (f !== o)
      return K(8, { from: m, to: o });
  }
  function I(o) {
    return M(o);
  }
  function B(o) {
    return I(P(E(o), { replace: true }));
  }
  function $(o) {
    const m = o.matched[o.matched.length - 1];
    if (m && m.redirect) {
      const { redirect: p } = m;
      let v = typeof p == "function" ? p(o) : p;
      return typeof v == "string" && (v = v.includes("?") || v.includes("#") ? v = E(v) : { path: v }, v.params = {}), P({ query: o.query, hash: o.hash, params: v.path != null ? {} : o.params }, v);
    }
  }
  function M(o, m) {
    const p = f = A(o), v = i.value, C = o.state, _ = o.force, R = o.replace === true, y = $(p);
    if (y)
      return M(P(E(y), { state: typeof y == "object" ? P({}, C, y.state) : C, force: _, replace: R }), m || p);
    const O = p;
    O.redirectedFrom = m;
    let D;
    return !_ && At(r, v, p) && (D = K(16, { to: O, from: v }), Pe(v, v, true, false)), (D ? Promise.resolve(D) : ye(O, v)).catch((x) => L(x) ? L(x, 2) ? x : ie(x) : oe(x, O, v)).then((x) => {
      if (x) {
        if (L(x, 2))
          return M(P({ replace: R }, E(x.to), { state: typeof x.to == "object" ? P({}, C, x.to.state) : C, force: _ }), m || O);
      } else
        x = Ee(O, v, true, R, C);
      return Re(O, v, x), x;
    });
  }
  function tt(o, m) {
    const p = k(o, m);
    return p ? Promise.reject(p) : Promise.resolve();
  }
  function re(o) {
    const m = ee.values().next().value;
    return m && typeof m.runWithContext == "function" ? m.runWithContext(o) : o();
  }
  function ye(o, m) {
    let p;
    const [v, C, _] = hn(o, m);
    p = he(v.reverse(), "beforeRouteLeave", o, m);
    for (const y of v)
      y.leaveGuards.forEach((O) => {
        p.push(H(O, o, m));
      });
    const R = tt.bind(null, o, m);
    return p.push(R), z(p).then(() => {
      p = [];
      for (const y of a.list())
        p.push(H(y, o, m));
      return p.push(R), z(p);
    }).then(() => {
      p = he(C, "beforeRouteUpdate", o, m);
      for (const y of C)
        y.updateGuards.forEach((O) => {
          p.push(H(O, o, m));
        });
      return p.push(R), z(p);
    }).then(() => {
      p = [];
      for (const y of _)
        if (y.beforeEnter)
          if (N(y.beforeEnter))
            for (const O of y.beforeEnter)
              p.push(H(O, o, m));
          else
            p.push(H(y.beforeEnter, o, m));
      return p.push(R), z(p);
    }).then(() => (o.matched.forEach((y) => y.enterCallbacks = {}), p = he(_, "beforeRouteEnter", o, m, re), p.push(R), z(p))).then(() => {
      p = [];
      for (const y of d.list())
        p.push(H(y, o, m));
      return p.push(R), z(p);
    }).catch((y) => L(y, 8) ? y : Promise.reject(y));
  }
  function Re(o, m, p) {
    g.list().forEach((v) => re(() => v(o, m, p)));
  }
  function Ee(o, m, p, v, C) {
    const _ = k(o, m);
    if (_)
      return _;
    const R = m === j, y = q ? history.state : {};
    p && (v || R ? s.replace(o.fullPath, P({ scroll: R && y && y.scroll }, C)) : s.push(o.fullPath, C)), i.value = o, Pe(o, m, p, R), ie();
  }
  let U;
  function nt() {
    U || (U = s.listen((o, m, p) => {
      if (!Se.listening)
        return;
      const v = A(o), C = $(v);
      if (C) {
        M(P(C, { replace: true, force: true }), v).catch(F);
        return;
      }
      f = v;
      const _ = i.value;
      q && Lt(be(_.fullPath, p.delta), te()), ye(v, _).catch((R) => L(R, 12) ? R : L(R, 2) ? (M(P(E(R.to), { force: true }), v).then((y) => {
        L(y, 20) && !p.delta && p.type === Z.pop && s.go(-1, false);
      }).catch(F), Promise.reject()) : (p.delta && s.go(-p.delta, false), oe(R, v, _))).then((R) => {
        R = R || Ee(v, _, false), R && (p.delta && !L(R, 8) ? s.go(-p.delta, false) : p.type === Z.pop && L(R, 20) && s.go(-1, false)), Re(v, _, R);
      }).catch(F);
    }));
  }
  let se = W(), we = W(), J;
  function oe(o, m, p) {
    ie(o);
    const v = we.list();
    return v.length ? v.forEach((C) => C(o, m, p)) : console.error(o), Promise.reject(o);
  }
  function rt() {
    return J && i.value !== j ? Promise.resolve() : new Promise((o, m) => {
      se.add([o, m]);
    });
  }
  function ie(o) {
    return J || (J = !o, nt(), se.list().forEach(([m, p]) => o ? p(o) : m()), se.reset()), o;
  }
  function Pe(o, m, p, v) {
    const { scrollBehavior: C } = e;
    if (!q || !C)
      return Promise.resolve();
    const _ = !p && $t(be(o.fullPath, 0)) || (v || !p) && history.state && history.state.scroll || null;
    return it().then(() => C(o, m, _)).then((R) => R && Tt(R)).catch((R) => oe(R, o, m));
  }
  const ce = (o) => s.go(o);
  let ae;
  const ee = /* @__PURE__ */ new Set(), Se = { currentRoute: i, listening: true, addRoute: u, removeRoute: w, clearRoutes: t.clearRoutes, hasRoute: b, getRoutes: S, resolve: A, options: e, push: I, replace: B, go: ce, back: () => ce(-1), forward: () => ce(1), beforeEach: a.add, beforeResolve: d.add, afterEach: g.add, onError: we.add, isReady: rt, install(o) {
    const m = this;
    o.component("RouterLink", cn), o.component("RouterView", fn), o.config.globalProperties.$router = m, Object.defineProperty(o.config.globalProperties, "$route", { enumerable: true, get: () => Q(i) }), q && !ae && i.value === j && (ae = true, I(s.location).catch((C) => {
    }));
    const p = {};
    for (const C in j)
      Object.defineProperty(p, C, { get: () => i.value[C], enumerable: true });
    o.provide(ne, m), o.provide(ve, ot(p)), o.provide(me, i);
    const v = o.unmount;
    ee.add(o), o.unmount = function() {
      ee.delete(o), ee.size < 1 && (f = j, U && U(), U = null, i.value = j, ae = false, J = false), v();
    };
  } };
  function z(o) {
    return o.reduce((m, p) => m.then(() => re(p)), Promise.resolve());
  }
  return Se;
}
function hn(e, t) {
  const n = [], r = [], s = [], a = Math.max(t.matched.length, e.matched.length);
  for (let d = 0; d < a; d++) {
    const g = t.matched[d];
    g && (e.matched.find((f) => G(f, g)) ? r.push(g) : n.push(g));
    const i = e.matched[d];
    i && (t.matched.find((f) => G(f, i)) || s.push(i));
  }
  return [n, r, s];
}
function gn() {
  return V(ne);
}
function vn(e) {
  return V(ve);
}
export {
  pn as a,
  gn as b,
  mn as c,
  vn as u
};
