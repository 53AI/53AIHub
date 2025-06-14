/*!
  * shared v9.14.3
  * (c) 2025 kazuya kawaguchi
  * Released under the MIT License.
  */
const Nr = typeof window < "u", Lr = (e, t = false) => t ? Symbol.for(e) : Symbol(e), Mt = (e, t, n) => Ut({ l: e, k: t, s: n }), Ut = (e) => JSON.stringify(e).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029").replace(/\u0027/g, "\\u0027"), $ = (e) => typeof e == "number" && isFinite(e), wt = (e) => Ze(e) === "[object Date]", Fe = (e) => Ze(e) === "[object RegExp]", ge = (e) => U(e) && Object.keys(e).length === 0, le = Object.assign, Ft = Object.create, W = (e = null) => Ft(e);
let ve;
const he = () => ve || (ve = typeof globalThis < "u" ? globalThis : typeof self < "u" ? self : typeof window < "u" ? window : typeof global < "u" ? global : W());
function We(e) {
  return e.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
const vt = Object.prototype.hasOwnProperty;
function se(e, t) {
  return vt.call(e, t);
}
const x = Array.isArray, v = (e) => typeof e == "function", g = (e) => typeof e == "string", X = (e) => typeof e == "boolean", F = (e) => e !== null && typeof e == "object", Wt = (e) => F(e) && v(e.then) && v(e.catch), qe = Object.prototype.toString, Ze = (e) => qe.call(e), U = (e) => {
  if (!F(e))
    return false;
  const t = Object.getPrototypeOf(e);
  return t === null || t.constructor === Object;
}, Yt = (e) => e == null ? "" : x(e) || U(e) && e.toString === qe ? JSON.stringify(e, null, 2) : String(e);
function Kt(e, t = "") {
  return e.reduce((n, s, c) => c === 0 ? n + s : n + t + s, "");
}
function ze(e) {
  let t = e;
  return () => ++t;
}
function $t(e, t) {
  typeof console < "u" && (console.warn("[intlify] " + e), t && console.warn(t.stack));
}
const Ee = (e) => !F(e) || x(e);
function Tr(e, t) {
  if (Ee(e) || Ee(t))
    throw new Error("Invalid value");
  const n = [{ src: e, des: t }];
  for (; n.length; ) {
    const { src: s, des: c } = n.pop();
    Object.keys(s).forEach((i) => {
      i !== "__proto__" && (F(s[i]) && !F(c[i]) && (c[i] = Array.isArray(s[i]) ? [] : W()), Ee(c[i]) || Ee(s[i]) ? c[i] = s[i] : n.push({ src: s[i], des: c[i] }));
    });
  }
}
/*!
* message-compiler v9.14.3
* (c) 2025 kazuya kawaguchi
* Released under the MIT License.
*/
function Xt(e, t, n) {
  return { line: e, column: t, offset: n };
}
function Ne(e, t, n) {
  const s = { start: e, end: t };
  return n != null && (s.source = n), s;
}
const Gt = /\{([0-9a-zA-Z]+)\}/g;
function et(e, ...t) {
  return t.length === 1 && Vt(t[0]) && (t = t[0]), (!t || !t.hasOwnProperty) && (t = {}), e.replace(Gt, (n, s) => t.hasOwnProperty(s) ? t[s] : "");
}
const tt = Object.assign, Ye = (e) => typeof e == "string", Vt = (e) => e !== null && typeof e == "object";
function nt(e, t = "") {
  return e.reduce((n, s, c) => c === 0 ? n + s : n + t + s, "");
}
const Pe = { USE_MODULO_SYNTAX: 1, __EXTEND_POINT__: 2 }, Ht = { [Pe.USE_MODULO_SYNTAX]: "Use modulo before '{{0}}'." };
function xt(e, t, ...n) {
  const s = et(Ht[e] || "", ...n || []), c = { message: String(s), code: e };
  return t && (c.location = t), c;
}
const C = { EXPECTED_TOKEN: 1, INVALID_TOKEN_IN_PLACEHOLDER: 2, UNTERMINATED_SINGLE_QUOTE_IN_PLACEHOLDER: 3, UNKNOWN_ESCAPE_SEQUENCE: 4, INVALID_UNICODE_ESCAPE_SEQUENCE: 5, UNBALANCED_CLOSING_BRACE: 6, UNTERMINATED_CLOSING_BRACE: 7, EMPTY_PLACEHOLDER: 8, NOT_ALLOW_NEST_PLACEHOLDER: 9, INVALID_LINKED_FORMAT: 10, MUST_HAVE_MESSAGES_IN_PLURAL: 11, UNEXPECTED_EMPTY_LINKED_MODIFIER: 12, UNEXPECTED_EMPTY_LINKED_KEY: 13, UNEXPECTED_LEXICAL_ANALYSIS: 14, UNHANDLED_CODEGEN_NODE_TYPE: 15, UNHANDLED_MINIFIER_NODE_TYPE: 16, __EXTEND_POINT__: 17 }, jt = { [C.EXPECTED_TOKEN]: "Expected token: '{0}'", [C.INVALID_TOKEN_IN_PLACEHOLDER]: "Invalid token in placeholder: '{0}'", [C.UNTERMINATED_SINGLE_QUOTE_IN_PLACEHOLDER]: "Unterminated single quote in placeholder", [C.UNKNOWN_ESCAPE_SEQUENCE]: "Unknown escape sequence: \\{0}", [C.INVALID_UNICODE_ESCAPE_SEQUENCE]: "Invalid unicode escape sequence: {0}", [C.UNBALANCED_CLOSING_BRACE]: "Unbalanced closing brace", [C.UNTERMINATED_CLOSING_BRACE]: "Unterminated closing brace", [C.EMPTY_PLACEHOLDER]: "Empty placeholder", [C.NOT_ALLOW_NEST_PLACEHOLDER]: "Not allowed nest placeholder", [C.INVALID_LINKED_FORMAT]: "Invalid linked format", [C.MUST_HAVE_MESSAGES_IN_PLURAL]: "Plural must have messages", [C.UNEXPECTED_EMPTY_LINKED_MODIFIER]: "Unexpected empty linked modifier", [C.UNEXPECTED_EMPTY_LINKED_KEY]: "Unexpected empty linked key", [C.UNEXPECTED_LEXICAL_ANALYSIS]: "Unexpected lexical analysis in token: '{0}'", [C.UNHANDLED_CODEGEN_NODE_TYPE]: "unhandled codegen node type: '{0}'", [C.UNHANDLED_MINIFIER_NODE_TYPE]: "unhandled mimifier node type: '{0}'" };
function _e(e, t, n = {}) {
  const { domain: s, messages: c, args: i } = n, d = et((c || jt)[e] || "", ...i || []), E = new SyntaxError(String(d));
  return E.code = e, t && (E.location = t), E.domain = s, E;
}
function Bt(e) {
  throw e;
}
const Q = " ", Jt = "\r", K = `
`, Qt = String.fromCharCode(8232), qt = String.fromCharCode(8233);
function Zt(e) {
  const t = e;
  let n = 0, s = 1, c = 1, i = 0;
  const d = (N) => t[N] === Jt && t[N + 1] === K, E = (N) => t[N] === K, f = (N) => t[N] === qt, L = (N) => t[N] === Qt, S = (N) => d(N) || E(N) || f(N) || L(N), h = () => n, T = () => s, P = () => c, y = () => i, b = (N) => d(N) || f(N) || L(N) ? K : t[N], O = () => b(n), A = () => b(n + i);
  function D() {
    return i = 0, S(n) && (s++, c = 0), d(n) && n++, n++, c++, t[n];
  }
  function l() {
    return d(n + i) && i++, i++, t[n + i];
  }
  function o() {
    n = 0, s = 1, c = 1, i = 0;
  }
  function m(N = 0) {
    i = N;
  }
  function _() {
    const N = n + i;
    for (; N !== n; )
      D();
    i = 0;
  }
  return { index: h, line: T, column: P, peekOffset: y, charAt: b, currentChar: O, currentPeek: A, next: D, peek: l, reset: o, resetPeek: m, skipToPeek: _ };
}
const Z = void 0, zt = ".", Ke = "'", en = "tokenizer";
function tn(e, t = {}) {
  const n = t.location !== false, s = Zt(e), c = () => s.index(), i = () => Xt(s.line(), s.column(), s.index()), d = i(), E = c(), f = { currentType: 14, offset: E, startLoc: d, endLoc: d, lastType: 14, lastOffset: E, lastStartLoc: d, lastEndLoc: d, braceNest: 0, inLinked: false, text: "" }, L = () => f, { onError: S } = t;
  function h(r, a, u, ...p) {
    const w = L();
    if (a.column += u, a.offset += u, S) {
      const M = n ? Ne(w.startLoc, a) : null, q = _e(r, M, { domain: en, args: p });
      S(q);
    }
  }
  function T(r, a, u) {
    r.endLoc = i(), r.currentType = a;
    const p = { type: a };
    return n && (p.loc = Ne(r.startLoc, r.endLoc)), u != null && (p.value = u), p;
  }
  const P = (r) => T(r, 14);
  function y(r, a) {
    return r.currentChar() === a ? (r.next(), a) : (h(C.EXPECTED_TOKEN, i(), 0, a), "");
  }
  function b(r) {
    let a = "";
    for (; r.currentPeek() === Q || r.currentPeek() === K; )
      a += r.currentPeek(), r.peek();
    return a;
  }
  function O(r) {
    const a = b(r);
    return r.skipToPeek(), a;
  }
  function A(r) {
    if (r === Z)
      return false;
    const a = r.charCodeAt(0);
    return a >= 97 && a <= 122 || a >= 65 && a <= 90 || a === 95;
  }
  function D(r) {
    if (r === Z)
      return false;
    const a = r.charCodeAt(0);
    return a >= 48 && a <= 57;
  }
  function l(r, a) {
    const { currentType: u } = a;
    if (u !== 2)
      return false;
    b(r);
    const p = A(r.currentPeek());
    return r.resetPeek(), p;
  }
  function o(r, a) {
    const { currentType: u } = a;
    if (u !== 2)
      return false;
    b(r);
    const p = r.currentPeek() === "-" ? r.peek() : r.currentPeek(), w = D(p);
    return r.resetPeek(), w;
  }
  function m(r, a) {
    const { currentType: u } = a;
    if (u !== 2)
      return false;
    b(r);
    const p = r.currentPeek() === Ke;
    return r.resetPeek(), p;
  }
  function _(r, a) {
    const { currentType: u } = a;
    if (u !== 8)
      return false;
    b(r);
    const p = r.currentPeek() === ".";
    return r.resetPeek(), p;
  }
  function N(r, a) {
    const { currentType: u } = a;
    if (u !== 9)
      return false;
    b(r);
    const p = A(r.currentPeek());
    return r.resetPeek(), p;
  }
  function I(r, a) {
    const { currentType: u } = a;
    if (!(u === 8 || u === 12))
      return false;
    b(r);
    const p = r.currentPeek() === ":";
    return r.resetPeek(), p;
  }
  function R(r, a) {
    const { currentType: u } = a;
    if (u !== 10)
      return false;
    const p = () => {
      const M = r.currentPeek();
      return M === "{" ? A(r.peek()) : M === "@" || M === "%" || M === "|" || M === ":" || M === "." || M === Q || !M ? false : M === K ? (r.peek(), p()) : k(r, false);
    }, w = p();
    return r.resetPeek(), w;
  }
  function Y(r) {
    b(r);
    const a = r.currentPeek() === "|";
    return r.resetPeek(), a;
  }
  function J(r) {
    const a = b(r), u = r.currentPeek() === "%" && r.peek() === "{";
    return r.resetPeek(), { isModulo: u, hasSpace: a.length > 0 };
  }
  function k(r, a = true) {
    const u = (w = false, M = "", q = false) => {
      const te = r.currentPeek();
      return te === "{" ? M === "%" ? false : w : te === "@" || !te ? M === "%" ? true : w : te === "%" ? (r.peek(), u(w, "%", true)) : te === "|" ? M === "%" || q ? true : !(M === Q || M === K) : te === Q ? (r.peek(), u(true, Q, q)) : te === K ? (r.peek(), u(true, K, q)) : true;
    }, p = u();
    return a && r.resetPeek(), p;
  }
  function G(r, a) {
    const u = r.currentChar();
    return u === Z ? Z : a(u) ? (r.next(), u) : null;
  }
  function Et(r) {
    const a = r.charCodeAt(0);
    return a >= 97 && a <= 122 || a >= 65 && a <= 90 || a >= 48 && a <= 57 || a === 95 || a === 36;
  }
  function mt(r) {
    return G(r, Et);
  }
  function Nt(r) {
    const a = r.charCodeAt(0);
    return a >= 97 && a <= 122 || a >= 65 && a <= 90 || a >= 48 && a <= 57 || a === 95 || a === 36 || a === 45;
  }
  function Lt(r) {
    return G(r, Nt);
  }
  function Tt(r) {
    const a = r.charCodeAt(0);
    return a >= 48 && a <= 57;
  }
  function pt(r) {
    return G(r, Tt);
  }
  function ht(r) {
    const a = r.charCodeAt(0);
    return a >= 48 && a <= 57 || a >= 65 && a <= 70 || a >= 97 && a <= 102;
  }
  function Ot(r) {
    return G(r, ht);
  }
  function Me(r) {
    let a = "", u = "";
    for (; a = pt(r); )
      u += a;
    return u;
  }
  function It(r) {
    O(r);
    const a = r.currentChar();
    return a !== "%" && h(C.EXPECTED_TOKEN, i(), 0, a), r.next(), "%";
  }
  function Ue(r) {
    let a = "";
    for (; ; ) {
      const u = r.currentChar();
      if (u === "{" || u === "}" || u === "@" || u === "|" || !u)
        break;
      if (u === "%")
        if (k(r))
          a += u, r.next();
        else
          break;
      else if (u === Q || u === K)
        if (k(r))
          a += u, r.next();
        else {
          if (Y(r))
            break;
          a += u, r.next();
        }
      else
        a += u, r.next();
    }
    return a;
  }
  function At(r) {
    O(r);
    let a = "", u = "";
    for (; a = Lt(r); )
      u += a;
    return r.currentChar() === Z && h(C.UNTERMINATED_CLOSING_BRACE, i(), 0), u;
  }
  function Ct(r) {
    O(r);
    let a = "";
    return r.currentChar() === "-" ? (r.next(), a += `-${Me(r)}`) : a += Me(r), r.currentChar() === Z && h(C.UNTERMINATED_CLOSING_BRACE, i(), 0), a;
  }
  function St(r) {
    return r !== Ke && r !== K;
  }
  function gt(r) {
    O(r), y(r, "'");
    let a = "", u = "";
    for (; a = G(r, St); )
      a === "\\" ? u += Pt(r) : u += a;
    const p = r.currentChar();
    return p === K || p === Z ? (h(C.UNTERMINATED_SINGLE_QUOTE_IN_PLACEHOLDER, i(), 0), p === K && (r.next(), y(r, "'")), u) : (y(r, "'"), u);
  }
  function Pt(r) {
    const a = r.currentChar();
    switch (a) {
      case "\\":
      case "'":
        return r.next(), `\\${a}`;
      case "u":
        return we(r, a, 4);
      case "U":
        return we(r, a, 6);
      default:
        return h(C.UNKNOWN_ESCAPE_SEQUENCE, i(), 0, a), "";
    }
  }
  function we(r, a, u) {
    y(r, a);
    let p = "";
    for (let w = 0; w < u; w++) {
      const M = Ot(r);
      if (!M) {
        h(C.INVALID_UNICODE_ESCAPE_SEQUENCE, i(), 0, `\\${a}${p}${r.currentChar()}`);
        break;
      }
      p += M;
    }
    return `\\${a}${p}`;
  }
  function yt(r) {
    return r !== "{" && r !== "}" && r !== Q && r !== K;
  }
  function bt(r) {
    O(r);
    let a = "", u = "";
    for (; a = G(r, yt); )
      u += a;
    return u;
  }
  function Dt(r) {
    let a = "", u = "";
    for (; a = mt(r); )
      u += a;
    return u;
  }
  function kt(r) {
    const a = (u) => {
      const p = r.currentChar();
      return p === "{" || p === "%" || p === "@" || p === "|" || p === "(" || p === ")" || !p || p === Q ? u : (u += p, r.next(), a(u));
    };
    return a("");
  }
  function Le(r) {
    O(r);
    const a = y(r, "|");
    return O(r), a;
  }
  function Te(r, a) {
    let u = null;
    switch (r.currentChar()) {
      case "{":
        return a.braceNest >= 1 && h(C.NOT_ALLOW_NEST_PLACEHOLDER, i(), 0), r.next(), u = T(a, 2, "{"), O(r), a.braceNest++, u;
      case "}":
        return a.braceNest > 0 && a.currentType === 2 && h(C.EMPTY_PLACEHOLDER, i(), 0), r.next(), u = T(a, 3, "}"), a.braceNest--, a.braceNest > 0 && O(r), a.inLinked && a.braceNest === 0 && (a.inLinked = false), u;
      case "@":
        return a.braceNest > 0 && h(C.UNTERMINATED_CLOSING_BRACE, i(), 0), u = de(r, a) || P(a), a.braceNest = 0, u;
      default: {
        let w = true, M = true, q = true;
        if (Y(r))
          return a.braceNest > 0 && h(C.UNTERMINATED_CLOSING_BRACE, i(), 0), u = T(a, 1, Le(r)), a.braceNest = 0, a.inLinked = false, u;
        if (a.braceNest > 0 && (a.currentType === 5 || a.currentType === 6 || a.currentType === 7))
          return h(C.UNTERMINATED_CLOSING_BRACE, i(), 0), a.braceNest = 0, pe(r, a);
        if (w = l(r, a))
          return u = T(a, 5, At(r)), O(r), u;
        if (M = o(r, a))
          return u = T(a, 6, Ct(r)), O(r), u;
        if (q = m(r, a))
          return u = T(a, 7, gt(r)), O(r), u;
        if (!w && !M && !q)
          return u = T(a, 13, bt(r)), h(C.INVALID_TOKEN_IN_PLACEHOLDER, i(), 0, u.value), O(r), u;
        break;
      }
    }
    return u;
  }
  function de(r, a) {
    const { currentType: u } = a;
    let p = null;
    const w = r.currentChar();
    switch ((u === 8 || u === 9 || u === 12 || u === 10) && (w === K || w === Q) && h(C.INVALID_LINKED_FORMAT, i(), 0), w) {
      case "@":
        return r.next(), p = T(a, 8, "@"), a.inLinked = true, p;
      case ".":
        return O(r), r.next(), T(a, 9, ".");
      case ":":
        return O(r), r.next(), T(a, 10, ":");
      default:
        return Y(r) ? (p = T(a, 1, Le(r)), a.braceNest = 0, a.inLinked = false, p) : _(r, a) || I(r, a) ? (O(r), de(r, a)) : N(r, a) ? (O(r), T(a, 12, Dt(r))) : R(r, a) ? (O(r), w === "{" ? Te(r, a) || p : T(a, 11, kt(r))) : (u === 8 && h(C.INVALID_LINKED_FORMAT, i(), 0), a.braceNest = 0, a.inLinked = false, pe(r, a));
    }
  }
  function pe(r, a) {
    let u = { type: 14 };
    if (a.braceNest > 0)
      return Te(r, a) || P(a);
    if (a.inLinked)
      return de(r, a) || P(a);
    switch (r.currentChar()) {
      case "{":
        return Te(r, a) || P(a);
      case "}":
        return h(C.UNBALANCED_CLOSING_BRACE, i(), 0), r.next(), T(a, 3, "}");
      case "@":
        return de(r, a) || P(a);
      default: {
        if (Y(r))
          return u = T(a, 1, Le(r)), a.braceNest = 0, a.inLinked = false, u;
        const { isModulo: w, hasSpace: M } = J(r);
        if (w)
          return M ? T(a, 0, Ue(r)) : T(a, 4, It(r));
        if (k(r))
          return T(a, 0, Ue(r));
        break;
      }
    }
    return u;
  }
  function Rt() {
    const { currentType: r, offset: a, startLoc: u, endLoc: p } = f;
    return f.lastType = r, f.lastOffset = a, f.lastStartLoc = u, f.lastEndLoc = p, f.offset = c(), f.startLoc = i(), s.currentChar() === Z ? T(f, 14) : pe(s, f);
  }
  return { nextToken: Rt, currentOffset: c, currentPosition: i, context: L };
}
const nn = "parser", rn = /(?:\\\\|\\'|\\u([0-9a-fA-F]{4})|\\U([0-9a-fA-F]{6}))/g;
function sn(e, t, n) {
  switch (e) {
    case "\\\\":
      return "\\";
    case "\\'":
      return "'";
    default: {
      const s = parseInt(t || n, 16);
      return s <= 55295 || s >= 57344 ? String.fromCodePoint(s) : "\uFFFD";
    }
  }
}
function an(e = {}) {
  const t = e.location !== false, { onError: n, onWarn: s } = e;
  function c(l, o, m, _, ...N) {
    const I = l.currentPosition();
    if (I.offset += _, I.column += _, n) {
      const R = t ? Ne(m, I) : null, Y = _e(o, R, { domain: nn, args: N });
      n(Y);
    }
  }
  function i(l, o, m, _, ...N) {
    const I = l.currentPosition();
    if (I.offset += _, I.column += _, s) {
      const R = t ? Ne(m, I) : null;
      s(xt(o, R, N));
    }
  }
  function d(l, o, m) {
    const _ = { type: l };
    return t && (_.start = o, _.end = o, _.loc = { start: m, end: m }), _;
  }
  function E(l, o, m, _) {
    _ && (l.type = _), t && (l.end = o, l.loc && (l.loc.end = m));
  }
  function f(l, o) {
    const m = l.context(), _ = d(3, m.offset, m.startLoc);
    return _.value = o, E(_, l.currentOffset(), l.currentPosition()), _;
  }
  function L(l, o) {
    const m = l.context(), { lastOffset: _, lastStartLoc: N } = m, I = d(5, _, N);
    return I.index = parseInt(o, 10), l.nextToken(), E(I, l.currentOffset(), l.currentPosition()), I;
  }
  function S(l, o, m) {
    const _ = l.context(), { lastOffset: N, lastStartLoc: I } = _, R = d(4, N, I);
    return R.key = o, m === true && (R.modulo = true), l.nextToken(), E(R, l.currentOffset(), l.currentPosition()), R;
  }
  function h(l, o) {
    const m = l.context(), { lastOffset: _, lastStartLoc: N } = m, I = d(9, _, N);
    return I.value = o.replace(rn, sn), l.nextToken(), E(I, l.currentOffset(), l.currentPosition()), I;
  }
  function T(l) {
    const o = l.nextToken(), m = l.context(), { lastOffset: _, lastStartLoc: N } = m, I = d(8, _, N);
    return o.type !== 12 ? (c(l, C.UNEXPECTED_EMPTY_LINKED_MODIFIER, m.lastStartLoc, 0), I.value = "", E(I, _, N), { nextConsumeToken: o, node: I }) : (o.value == null && c(l, C.UNEXPECTED_LEXICAL_ANALYSIS, m.lastStartLoc, 0, V(o)), I.value = o.value || "", E(I, l.currentOffset(), l.currentPosition()), { node: I });
  }
  function P(l, o) {
    const m = l.context(), _ = d(7, m.offset, m.startLoc);
    return _.value = o, E(_, l.currentOffset(), l.currentPosition()), _;
  }
  function y(l) {
    const o = l.context(), m = d(6, o.offset, o.startLoc);
    let _ = l.nextToken();
    if (_.type === 9) {
      const N = T(l);
      m.modifier = N.node, _ = N.nextConsumeToken || l.nextToken();
    }
    switch (_.type !== 10 && c(l, C.UNEXPECTED_LEXICAL_ANALYSIS, o.lastStartLoc, 0, V(_)), _ = l.nextToken(), _.type === 2 && (_ = l.nextToken()), _.type) {
      case 11:
        _.value == null && c(l, C.UNEXPECTED_LEXICAL_ANALYSIS, o.lastStartLoc, 0, V(_)), m.key = P(l, _.value || "");
        break;
      case 5:
        _.value == null && c(l, C.UNEXPECTED_LEXICAL_ANALYSIS, o.lastStartLoc, 0, V(_)), m.key = S(l, _.value || "");
        break;
      case 6:
        _.value == null && c(l, C.UNEXPECTED_LEXICAL_ANALYSIS, o.lastStartLoc, 0, V(_)), m.key = L(l, _.value || "");
        break;
      case 7:
        _.value == null && c(l, C.UNEXPECTED_LEXICAL_ANALYSIS, o.lastStartLoc, 0, V(_)), m.key = h(l, _.value || "");
        break;
      default: {
        c(l, C.UNEXPECTED_EMPTY_LINKED_KEY, o.lastStartLoc, 0);
        const N = l.context(), I = d(7, N.offset, N.startLoc);
        return I.value = "", E(I, N.offset, N.startLoc), m.key = I, E(m, N.offset, N.startLoc), { nextConsumeToken: _, node: m };
      }
    }
    return E(m, l.currentOffset(), l.currentPosition()), { node: m };
  }
  function b(l) {
    const o = l.context(), m = o.currentType === 1 ? l.currentOffset() : o.offset, _ = o.currentType === 1 ? o.endLoc : o.startLoc, N = d(2, m, _);
    N.items = [];
    let I = null, R = null;
    do {
      const k = I || l.nextToken();
      switch (I = null, k.type) {
        case 0:
          k.value == null && c(l, C.UNEXPECTED_LEXICAL_ANALYSIS, o.lastStartLoc, 0, V(k)), N.items.push(f(l, k.value || ""));
          break;
        case 6:
          k.value == null && c(l, C.UNEXPECTED_LEXICAL_ANALYSIS, o.lastStartLoc, 0, V(k)), N.items.push(L(l, k.value || ""));
          break;
        case 4:
          R = true;
          break;
        case 5:
          k.value == null && c(l, C.UNEXPECTED_LEXICAL_ANALYSIS, o.lastStartLoc, 0, V(k)), N.items.push(S(l, k.value || "", !!R)), R && (i(l, Pe.USE_MODULO_SYNTAX, o.lastStartLoc, 0, V(k)), R = null);
          break;
        case 7:
          k.value == null && c(l, C.UNEXPECTED_LEXICAL_ANALYSIS, o.lastStartLoc, 0, V(k)), N.items.push(h(l, k.value || ""));
          break;
        case 8: {
          const G = y(l);
          N.items.push(G.node), I = G.nextConsumeToken || null;
          break;
        }
      }
    } while (o.currentType !== 14 && o.currentType !== 1);
    const Y = o.currentType === 1 ? o.lastOffset : l.currentOffset(), J = o.currentType === 1 ? o.lastEndLoc : l.currentPosition();
    return E(N, Y, J), N;
  }
  function O(l, o, m, _) {
    const N = l.context();
    let I = _.items.length === 0;
    const R = d(1, o, m);
    R.cases = [], R.cases.push(_);
    do {
      const Y = b(l);
      I || (I = Y.items.length === 0), R.cases.push(Y);
    } while (N.currentType !== 14);
    return I && c(l, C.MUST_HAVE_MESSAGES_IN_PLURAL, m, 0), E(R, l.currentOffset(), l.currentPosition()), R;
  }
  function A(l) {
    const o = l.context(), { offset: m, startLoc: _ } = o, N = b(l);
    return o.currentType === 14 ? N : O(l, m, _, N);
  }
  function D(l) {
    const o = tn(l, tt({}, e)), m = o.context(), _ = d(0, m.offset, m.startLoc);
    return t && _.loc && (_.loc.source = l), _.body = A(o), e.onCacheKey && (_.cacheKey = e.onCacheKey(l)), m.currentType !== 14 && c(o, C.UNEXPECTED_LEXICAL_ANALYSIS, m.lastStartLoc, 0, l[m.offset] || ""), E(_, o.currentOffset(), o.currentPosition()), _;
  }
  return { parse: D };
}
function V(e) {
  if (e.type === 14)
    return "EOF";
  const t = (e.value || "").replace(/\r?\n/gu, "\\n");
  return t.length > 10 ? t.slice(0, 9) + "\u2026" : t;
}
function cn(e, t = {}) {
  const n = { ast: e, helpers: /* @__PURE__ */ new Set() };
  return { context: () => n, helper: (i) => (n.helpers.add(i), i) };
}
function $e(e, t) {
  for (let n = 0; n < e.length; n++)
    ye(e[n], t);
}
function ye(e, t) {
  switch (e.type) {
    case 1:
      $e(e.cases, t), t.helper("plural");
      break;
    case 2:
      $e(e.items, t);
      break;
    case 6: {
      ye(e.key, t), t.helper("linked"), t.helper("type");
      break;
    }
    case 5:
      t.helper("interpolate"), t.helper("list");
      break;
    case 4:
      t.helper("interpolate"), t.helper("named");
      break;
  }
}
function ln(e, t = {}) {
  const n = cn(e);
  n.helper("normalize"), e.body && ye(e.body, n);
  const s = n.context();
  e.helpers = Array.from(s.helpers);
}
function on(e) {
  const t = e.body;
  return t.type === 2 ? Xe(t) : t.cases.forEach((n) => Xe(n)), e;
}
function Xe(e) {
  if (e.items.length === 1) {
    const t = e.items[0];
    (t.type === 3 || t.type === 9) && (e.static = t.value, delete t.value);
  } else {
    const t = [];
    for (let n = 0; n < e.items.length; n++) {
      const s = e.items[n];
      if (!(s.type === 3 || s.type === 9) || s.value == null)
        break;
      t.push(s.value);
    }
    if (t.length === e.items.length) {
      e.static = nt(t);
      for (let n = 0; n < e.items.length; n++) {
        const s = e.items[n];
        (s.type === 3 || s.type === 9) && delete s.value;
      }
    }
  }
}
const un = "minifier";
function ae(e) {
  switch (e.t = e.type, e.type) {
    case 0: {
      const t = e;
      ae(t.body), t.b = t.body, delete t.body;
      break;
    }
    case 1: {
      const t = e, n = t.cases;
      for (let s = 0; s < n.length; s++)
        ae(n[s]);
      t.c = n, delete t.cases;
      break;
    }
    case 2: {
      const t = e, n = t.items;
      for (let s = 0; s < n.length; s++)
        ae(n[s]);
      t.i = n, delete t.items, t.static && (t.s = t.static, delete t.static);
      break;
    }
    case 3:
    case 9:
    case 8:
    case 7: {
      const t = e;
      t.value && (t.v = t.value, delete t.value);
      break;
    }
    case 6: {
      const t = e;
      ae(t.key), t.k = t.key, delete t.key, t.modifier && (ae(t.modifier), t.m = t.modifier, delete t.modifier);
      break;
    }
    case 5: {
      const t = e;
      t.i = t.index, delete t.index;
      break;
    }
    case 4: {
      const t = e;
      t.k = t.key, delete t.key;
      break;
    }
    default:
      throw _e(C.UNHANDLED_MINIFIER_NODE_TYPE, null, { domain: un, args: [e.type] });
  }
  delete e.type;
}
const fn = "parser";
function _n(e, t) {
  const { sourceMap: n, filename: s, breakLineCode: c, needIndent: i } = t, d = t.location !== false, E = { filename: s, code: "", column: 1, line: 1, offset: 0, map: void 0, breakLineCode: c, needIndent: i, indentLevel: 0 };
  d && e.loc && (E.source = e.loc.source);
  const f = () => E;
  function L(O, A) {
    E.code += O;
  }
  function S(O, A = true) {
    const D = A ? c : "";
    L(i ? D + "  ".repeat(O) : D);
  }
  function h(O = true) {
    const A = ++E.indentLevel;
    O && S(A);
  }
  function T(O = true) {
    const A = --E.indentLevel;
    O && S(A);
  }
  function P() {
    S(E.indentLevel);
  }
  return { context: f, push: L, indent: h, deindent: T, newline: P, helper: (O) => `_${O}`, needIndent: () => E.needIndent };
}
function dn(e, t) {
  const { helper: n } = e;
  e.push(`${n("linked")}(`), ie(e, t.key), t.modifier ? (e.push(", "), ie(e, t.modifier), e.push(", _type")) : e.push(", undefined, _type"), e.push(")");
}
function En(e, t) {
  const { helper: n, needIndent: s } = e;
  e.push(`${n("normalize")}([`), e.indent(s());
  const c = t.items.length;
  for (let i = 0; i < c && (ie(e, t.items[i]), i !== c - 1); i++)
    e.push(", ");
  e.deindent(s()), e.push("])");
}
function mn(e, t) {
  const { helper: n, needIndent: s } = e;
  if (t.cases.length > 1) {
    e.push(`${n("plural")}([`), e.indent(s());
    const c = t.cases.length;
    for (let i = 0; i < c && (ie(e, t.cases[i]), i !== c - 1); i++)
      e.push(", ");
    e.deindent(s()), e.push("])");
  }
}
function Nn(e, t) {
  t.body ? ie(e, t.body) : e.push("null");
}
function ie(e, t) {
  const { helper: n } = e;
  switch (t.type) {
    case 0:
      Nn(e, t);
      break;
    case 1:
      mn(e, t);
      break;
    case 2:
      En(e, t);
      break;
    case 6:
      dn(e, t);
      break;
    case 8:
      e.push(JSON.stringify(t.value), t);
      break;
    case 7:
      e.push(JSON.stringify(t.value), t);
      break;
    case 5:
      e.push(`${n("interpolate")}(${n("list")}(${t.index}))`, t);
      break;
    case 4:
      e.push(`${n("interpolate")}(${n("named")}(${JSON.stringify(t.key)}))`, t);
      break;
    case 9:
      e.push(JSON.stringify(t.value), t);
      break;
    case 3:
      e.push(JSON.stringify(t.value), t);
      break;
    default:
      throw _e(C.UNHANDLED_CODEGEN_NODE_TYPE, null, { domain: fn, args: [t.type] });
  }
}
const Ln = (e, t = {}) => {
  const n = Ye(t.mode) ? t.mode : "normal", s = Ye(t.filename) ? t.filename : "message.intl", c = !!t.sourceMap, i = t.breakLineCode != null ? t.breakLineCode : n === "arrow" ? ";" : `
`, d = t.needIndent ? t.needIndent : n !== "arrow", E = e.helpers || [], f = _n(e, { mode: n, filename: s, sourceMap: c, breakLineCode: i, needIndent: d });
  f.push(n === "normal" ? "function __msg__ (ctx) {" : "(ctx) => {"), f.indent(d), E.length > 0 && (f.push(`const { ${nt(E.map((h) => `${h}: _${h}`), ", ")} } = ctx`), f.newline()), f.push("return "), ie(f, e), f.deindent(d), f.push("}"), delete e.helpers;
  const { code: L, map: S } = f.context();
  return { ast: e, code: L, map: S ? S.toJSON() : void 0 };
};
function Tn(e, t = {}) {
  const n = tt({}, t), s = !!n.jit, c = !!n.minify, i = n.optimize == null ? true : n.optimize, E = an(n).parse(e);
  return s ? (i && on(E), c && ae(E), { ast: E, code: "" }) : (ln(E, n), Ln(E, n));
}
/*!
* core-base v9.14.3
* (c) 2025 kazuya kawaguchi
* Released under the MIT License.
*/
function pn() {
  typeof __INTLIFY_PROD_DEVTOOLS__ != "boolean" && (he().__INTLIFY_PROD_DEVTOOLS__ = false), typeof __INTLIFY_JIT_COMPILATION__ != "boolean" && (he().__INTLIFY_JIT_COMPILATION__ = false), typeof __INTLIFY_DROP_MESSAGE_COMPILER__ != "boolean" && (he().__INTLIFY_DROP_MESSAGE_COMPILER__ = false);
}
const z = [];
z[0] = { w: [0], i: [3, 0], "[": [4], o: [7] };
z[1] = { w: [1], ".": [2], "[": [4], o: [7] };
z[2] = { w: [2], i: [3, 0], 0: [3, 0] };
z[3] = { i: [3, 0], 0: [3, 0], w: [1, 1], ".": [2, 1], "[": [4, 1], o: [7, 1] };
z[4] = { "'": [5, 0], '"': [6, 0], "[": [4, 2], "]": [1, 3], o: 8, l: [4, 0] };
z[5] = { "'": [4, 0], o: 8, l: [5, 0] };
z[6] = { '"': [4, 0], o: 8, l: [6, 0] };
const hn = /^\s?(?:true|false|-?[\d.]+|'[^']*'|"[^"]*")\s?$/;
function On(e) {
  return hn.test(e);
}
function In(e) {
  const t = e.charCodeAt(0), n = e.charCodeAt(e.length - 1);
  return t === n && (t === 34 || t === 39) ? e.slice(1, -1) : e;
}
function An(e) {
  if (e == null)
    return "o";
  switch (e.charCodeAt(0)) {
    case 91:
    case 93:
    case 46:
    case 34:
    case 39:
      return e;
    case 95:
    case 36:
    case 45:
      return "i";
    case 9:
    case 10:
    case 13:
    case 160:
    case 65279:
    case 8232:
    case 8233:
      return "w";
  }
  return "i";
}
function Cn(e) {
  const t = e.trim();
  return e.charAt(0) === "0" && isNaN(parseInt(e)) ? false : On(t) ? In(t) : "*" + t;
}
function Sn(e) {
  const t = [];
  let n = -1, s = 0, c = 0, i, d, E, f, L, S, h;
  const T = [];
  T[0] = () => {
    d === void 0 ? d = E : d += E;
  }, T[1] = () => {
    d !== void 0 && (t.push(d), d = void 0);
  }, T[2] = () => {
    T[0](), c++;
  }, T[3] = () => {
    if (c > 0)
      c--, s = 4, T[0]();
    else {
      if (c = 0, d === void 0 || (d = Cn(d), d === false))
        return false;
      T[1]();
    }
  };
  function P() {
    const y = e[n + 1];
    if (s === 5 && y === "'" || s === 6 && y === '"')
      return n++, E = "\\" + y, T[0](), true;
  }
  for (; s !== null; )
    if (n++, i = e[n], !(i === "\\" && P())) {
      if (f = An(i), h = z[s], L = h[f] || h.l || 8, L === 8 || (s = L[0], L[1] !== void 0 && (S = T[L[1]], S && (E = i, S() === false))))
        return;
      if (s === 7)
        return t;
    }
}
const Ge = /* @__PURE__ */ new Map();
function gn(e, t) {
  return F(e) ? e[t] : null;
}
function pr(e, t) {
  if (!F(e))
    return null;
  let n = Ge.get(t);
  if (n || (n = Sn(t), n && Ge.set(t, n)), !n)
    return null;
  const s = n.length;
  let c = e, i = 0;
  for (; i < s; ) {
    const d = c[n[i]];
    if (d === void 0 || v(c))
      return null;
    c = d, i++;
  }
  return c;
}
const Pn = (e) => e, yn = (e) => "", bn = "text", Dn = (e) => e.length === 0 ? "" : Kt(e), kn = Yt;
function Ve(e, t) {
  return e = Math.abs(e), t === 2 ? e ? e > 1 ? 1 : 0 : 1 : e ? Math.min(e, 2) : 0;
}
function Rn(e) {
  const t = $(e.pluralIndex) ? e.pluralIndex : -1;
  return e.named && ($(e.named.count) || $(e.named.n)) ? $(e.named.count) ? e.named.count : $(e.named.n) ? e.named.n : t : t;
}
function Mn(e, t) {
  t.count || (t.count = e), t.n || (t.n = e);
}
function Un(e = {}) {
  const t = e.locale, n = Rn(e), s = F(e.pluralRules) && g(t) && v(e.pluralRules[t]) ? e.pluralRules[t] : Ve, c = F(e.pluralRules) && g(t) && v(e.pluralRules[t]) ? Ve : void 0, i = (A) => A[s(n, A.length, c)], d = e.list || [], E = (A) => d[A], f = e.named || W();
  $(e.pluralIndex) && Mn(n, f);
  const L = (A) => f[A];
  function S(A) {
    const D = v(e.messages) ? e.messages(A) : F(e.messages) ? e.messages[A] : false;
    return D || (e.parent ? e.parent.message(A) : yn);
  }
  const h = (A) => e.modifiers ? e.modifiers[A] : Pn, T = U(e.processor) && v(e.processor.normalize) ? e.processor.normalize : Dn, P = U(e.processor) && v(e.processor.interpolate) ? e.processor.interpolate : kn, y = U(e.processor) && g(e.processor.type) ? e.processor.type : bn, O = { list: E, named: L, plural: i, linked: (A, ...D) => {
    const [l, o] = D;
    let m = "text", _ = "";
    D.length === 1 ? F(l) ? (_ = l.modifier || _, m = l.type || m) : g(l) && (_ = l || _) : D.length === 2 && (g(l) && (_ = l || _), g(o) && (m = o || m));
    const N = S(A)(O), I = m === "vnode" && x(N) && _ ? N[0] : N;
    return _ ? h(_)(I, m) : I;
  }, message: S, type: y, interpolate: P, normalize: T, values: le(W(), d, f) };
  return O;
}
let oe = null;
function hr(e) {
  oe = e;
}
function wn(e, t, n) {
  oe && oe.emit("i18n:init", { timestamp: Date.now(), i18n: e, version: t, meta: n });
}
const Fn = vn("function:translate");
function vn(e) {
  return (t) => oe && oe.emit(e, t);
}
const rt = Pe.__EXTEND_POINT__, ne = ze(rt), Or = { NOT_FOUND_KEY: rt, FALLBACK_TO_TRANSLATE: ne(), CANNOT_FORMAT_NUMBER: ne(), FALLBACK_TO_NUMBER_FORMAT: ne(), CANNOT_FORMAT_DATE: ne(), FALLBACK_TO_DATE_FORMAT: ne(), EXPERIMENTAL_CUSTOM_MESSAGE_COMPILER: ne(), __EXTEND_POINT__: ne() }, st = C.__EXTEND_POINT__, re = ze(st), j = { INVALID_ARGUMENT: st, INVALID_DATE_ARGUMENT: re(), INVALID_ISO_DATE_ARGUMENT: re(), NOT_SUPPORT_NON_STRING_MESSAGE: re(), NOT_SUPPORT_LOCALE_PROMISE_VALUE: re(), NOT_SUPPORT_LOCALE_ASYNC_FUNCTION: re(), NOT_SUPPORT_LOCALE_TYPE: re(), __EXTEND_POINT__: re() };
function B(e) {
  return _e(e, null, void 0);
}
function be(e, t) {
  return t.locale != null ? He(t.locale) : He(e.locale);
}
let Oe;
function He(e) {
  if (g(e))
    return e;
  if (v(e)) {
    if (e.resolvedOnce && Oe != null)
      return Oe;
    if (e.constructor.name === "Function") {
      const t = e();
      if (Wt(t))
        throw B(j.NOT_SUPPORT_LOCALE_PROMISE_VALUE);
      return Oe = t;
    } else
      throw B(j.NOT_SUPPORT_LOCALE_ASYNC_FUNCTION);
  } else
    throw B(j.NOT_SUPPORT_LOCALE_TYPE);
}
function Wn(e, t, n) {
  return [.../* @__PURE__ */ new Set([n, ...x(t) ? t : F(t) ? Object.keys(t) : g(t) ? [t] : [n]])];
}
function Ir(e, t, n) {
  const s = g(n) ? n : Ce, c = e;
  c.__localeChainCache || (c.__localeChainCache = /* @__PURE__ */ new Map());
  let i = c.__localeChainCache.get(s);
  if (!i) {
    i = [];
    let d = [n];
    for (; x(d); )
      d = xe(i, d, t);
    const E = x(t) || !U(t) ? t : t.default ? t.default : null;
    d = g(E) ? [E] : E, x(d) && xe(i, d, false), c.__localeChainCache.set(s, i);
  }
  return i;
}
function xe(e, t, n) {
  let s = true;
  for (let c = 0; c < t.length && X(s); c++) {
    const i = t[c];
    g(i) && (s = Yn(e, t[c], n));
  }
  return s;
}
function Yn(e, t, n) {
  let s;
  const c = t.split("-");
  do {
    const i = c.join("-");
    s = Kn(e, i, n), c.splice(-1, 1);
  } while (c.length && s === true);
  return s;
}
function Kn(e, t, n) {
  let s = false;
  if (!e.includes(t) && (s = true, t)) {
    s = t[t.length - 1] !== "!";
    const c = t.replace(/!/g, "");
    e.push(c), (x(n) || U(n)) && n[c] && (s = n[c]);
  }
  return s;
}
const $n = "9.14.3", De = -1, Ce = "en-US", Ar = "", je = (e) => `${e.charAt(0).toLocaleUpperCase()}${e.substr(1)}`;
function Xn() {
  return { upper: (e, t) => t === "text" && g(e) ? e.toUpperCase() : t === "vnode" && F(e) && "__v_isVNode" in e ? e.children.toUpperCase() : e, lower: (e, t) => t === "text" && g(e) ? e.toLowerCase() : t === "vnode" && F(e) && "__v_isVNode" in e ? e.children.toLowerCase() : e, capitalize: (e, t) => t === "text" && g(e) ? je(e) : t === "vnode" && F(e) && "__v_isVNode" in e ? je(e.children) : e };
}
let at;
function Cr(e) {
  at = e;
}
let ct;
function Sr(e) {
  ct = e;
}
let it;
function gr(e) {
  it = e;
}
let lt = null;
const Pr = (e) => {
  lt = e;
}, Gn = () => lt;
let ot = null;
const yr = (e) => {
  ot = e;
}, br = () => ot;
let Be = 0;
function Dr(e = {}) {
  const t = v(e.onWarn) ? e.onWarn : $t, n = g(e.version) ? e.version : $n, s = g(e.locale) || v(e.locale) ? e.locale : Ce, c = v(s) ? Ce : s, i = x(e.fallbackLocale) || U(e.fallbackLocale) || g(e.fallbackLocale) || e.fallbackLocale === false ? e.fallbackLocale : c, d = U(e.messages) ? e.messages : Ie(c), E = U(e.datetimeFormats) ? e.datetimeFormats : Ie(c), f = U(e.numberFormats) ? e.numberFormats : Ie(c), L = le(W(), e.modifiers, Xn()), S = e.pluralRules || W(), h = v(e.missing) ? e.missing : null, T = X(e.missingWarn) || Fe(e.missingWarn) ? e.missingWarn : true, P = X(e.fallbackWarn) || Fe(e.fallbackWarn) ? e.fallbackWarn : true, y = !!e.fallbackFormat, b = !!e.unresolving, O = v(e.postTranslation) ? e.postTranslation : null, A = U(e.processor) ? e.processor : null, D = X(e.warnHtmlMessage) ? e.warnHtmlMessage : true, l = !!e.escapeParameter, o = v(e.messageCompiler) ? e.messageCompiler : at, m = v(e.messageResolver) ? e.messageResolver : ct || gn, _ = v(e.localeFallbacker) ? e.localeFallbacker : it || Wn, N = F(e.fallbackContext) ? e.fallbackContext : void 0, I = e, R = F(I.__datetimeFormatters) ? I.__datetimeFormatters : /* @__PURE__ */ new Map(), Y = F(I.__numberFormatters) ? I.__numberFormatters : /* @__PURE__ */ new Map(), J = F(I.__meta) ? I.__meta : {};
  Be++;
  const k = { version: n, cid: Be, locale: s, fallbackLocale: i, messages: d, modifiers: L, pluralRules: S, missing: h, missingWarn: T, fallbackWarn: P, fallbackFormat: y, unresolving: b, postTranslation: O, processor: A, warnHtmlMessage: D, escapeParameter: l, messageCompiler: o, messageResolver: m, localeFallbacker: _, fallbackContext: N, onWarn: t, __meta: J };
  return k.datetimeFormats = E, k.numberFormats = f, k.__datetimeFormatters = R, k.__numberFormatters = Y, __INTLIFY_PROD_DEVTOOLS__ && wn(k, n, J), k;
}
const Ie = (e) => ({ [e]: W() });
function ke(e, t, n, s, c) {
  const { missing: i, onWarn: d } = e;
  if (i !== null) {
    const E = i(e, n, t, c);
    return g(E) ? E : t;
  } else
    return t;
}
function kr(e, t, n) {
  const s = e;
  s.__localeChainCache = /* @__PURE__ */ new Map(), e.localeFallbacker(e, n, t);
}
function Vn(e, t) {
  return e === t ? false : e.split("-")[0] === t.split("-")[0];
}
function Hn(e, t) {
  const n = t.indexOf(e);
  if (n === -1)
    return false;
  for (let s = n + 1; s < t.length; s++)
    if (Vn(e, t[s]))
      return true;
  return false;
}
function Ae(e) {
  return (n) => xn(n, e);
}
function xn(e, t) {
  const n = Bn(t);
  if (n == null)
    throw ue(0);
  if (Re(n) === 1) {
    const i = Qn(n);
    return e.plural(i.reduce((d, E) => [...d, Je(e, E)], []));
  } else
    return Je(e, n);
}
const jn = ["b", "body"];
function Bn(e) {
  return ee(e, jn);
}
const Jn = ["c", "cases"];
function Qn(e) {
  return ee(e, Jn, []);
}
function Je(e, t) {
  const n = Zn(t);
  if (n != null)
    return e.type === "text" ? n : e.normalize([n]);
  {
    const s = er(t).reduce((c, i) => [...c, Se(e, i)], []);
    return e.normalize(s);
  }
}
const qn = ["s", "static"];
function Zn(e) {
  return ee(e, qn);
}
const zn = ["i", "items"];
function er(e) {
  return ee(e, zn, []);
}
function Se(e, t) {
  const n = Re(t);
  switch (n) {
    case 3:
      return me(t, n);
    case 9:
      return me(t, n);
    case 4: {
      const s = t;
      if (se(s, "k") && s.k)
        return e.interpolate(e.named(s.k));
      if (se(s, "key") && s.key)
        return e.interpolate(e.named(s.key));
      throw ue(n);
    }
    case 5: {
      const s = t;
      if (se(s, "i") && $(s.i))
        return e.interpolate(e.list(s.i));
      if (se(s, "index") && $(s.index))
        return e.interpolate(e.list(s.index));
      throw ue(n);
    }
    case 6: {
      const s = t, c = sr(s), i = cr(s);
      return e.linked(Se(e, i), c ? Se(e, c) : void 0, e.type);
    }
    case 7:
      return me(t, n);
    case 8:
      return me(t, n);
    default:
      throw new Error(`unhandled node on format message part: ${n}`);
  }
}
const tr = ["t", "type"];
function Re(e) {
  return ee(e, tr);
}
const nr = ["v", "value"];
function me(e, t) {
  const n = ee(e, nr);
  if (n)
    return n;
  throw ue(t);
}
const rr = ["m", "modifier"];
function sr(e) {
  return ee(e, rr);
}
const ar = ["k", "key"];
function cr(e) {
  const t = ee(e, ar);
  if (t)
    return t;
  throw ue(6);
}
function ee(e, t, n) {
  for (let s = 0; s < t.length; s++) {
    const c = t[s];
    if (se(e, c) && e[c] != null)
      return e[c];
  }
  return n;
}
function ue(e) {
  return new Error(`unhandled node type: ${e}`);
}
const ut = (e) => e;
let ce = W();
function fe(e) {
  return F(e) && Re(e) === 0 && (se(e, "b") || se(e, "body"));
}
function ft(e, t = {}) {
  let n = false;
  const s = t.onError || Bt;
  return t.onError = (c) => {
    n = true, s(c);
  }, { ...Tn(e, t), detectError: n };
}
const Rr = (e, t) => {
  if (!g(e))
    throw B(j.NOT_SUPPORT_NON_STRING_MESSAGE);
  {
    X(t.warnHtmlMessage) && t.warnHtmlMessage;
    const s = (t.onCacheKey || ut)(e), c = ce[s];
    if (c)
      return c;
    const { code: i, detectError: d } = ft(e, t), E = new Function(`return ${i}`)();
    return d ? E : ce[s] = E;
  }
};
function Mr(e, t) {
  if (__INTLIFY_JIT_COMPILATION__ && !__INTLIFY_DROP_MESSAGE_COMPILER__ && g(e)) {
    X(t.warnHtmlMessage) && t.warnHtmlMessage;
    const s = (t.onCacheKey || ut)(e), c = ce[s];
    if (c)
      return c;
    const { ast: i, detectError: d } = ft(e, { ...t, location: false, jit: true }), E = Ae(i);
    return d ? E : ce[s] = E;
  } else {
    const n = e.cacheKey;
    if (n) {
      const s = ce[n];
      return s || (ce[n] = Ae(e));
    } else
      return Ae(e);
  }
}
const Qe = () => "", H = (e) => v(e);
function Ur(e, ...t) {
  const { fallbackFormat: n, postTranslation: s, unresolving: c, messageCompiler: i, fallbackLocale: d, messages: E } = e, [f, L] = or(...t), S = X(L.missingWarn) ? L.missingWarn : e.missingWarn, h = X(L.fallbackWarn) ? L.fallbackWarn : e.fallbackWarn, T = X(L.escapeParameter) ? L.escapeParameter : e.escapeParameter, P = !!L.resolvedMessage, y = g(L.default) || X(L.default) ? X(L.default) ? i ? f : () => f : L.default : n ? i ? f : () => f : "", b = n || y !== "", O = be(e, L);
  T && ir(L);
  let [A, D, l] = P ? [f, O, E[O] || W()] : _t(e, f, O, d, h, S), o = A, m = f;
  if (!P && !(g(o) || fe(o) || H(o)) && b && (o = y, m = o), !P && (!(g(o) || fe(o) || H(o)) || !g(D)))
    return c ? De : f;
  let _ = false;
  const N = () => {
    _ = true;
  }, I = H(o) ? o : dt(e, f, D, o, m, N);
  if (_)
    return o;
  const R = fr(e, D, l, L), Y = Un(R), J = lr(e, I, Y), k = s ? s(J, f) : J;
  if (__INTLIFY_PROD_DEVTOOLS__) {
    const G = { timestamp: Date.now(), key: g(f) ? f : H(o) ? o.key : "", locale: D || (H(o) ? o.locale : ""), format: g(o) ? o : H(o) ? o.source : "", message: k };
    G.meta = le({}, e.__meta, Gn() || {}), Fn(G);
  }
  return k;
}
function ir(e) {
  x(e.list) ? e.list = e.list.map((t) => g(t) ? We(t) : t) : F(e.named) && Object.keys(e.named).forEach((t) => {
    g(e.named[t]) && (e.named[t] = We(e.named[t]));
  });
}
function _t(e, t, n, s, c, i) {
  const { messages: d, onWarn: E, messageResolver: f, localeFallbacker: L } = e, S = L(e, s, n);
  let h = W(), T, P = null;
  const y = "translate";
  for (let b = 0; b < S.length && (T = S[b], h = d[T] || W(), (P = f(h, t)) === null && (P = h[t]), !(g(P) || fe(P) || H(P))); b++)
    if (!Hn(T, S)) {
      const O = ke(e, t, T, i, y);
      O !== t && (P = O);
    }
  return [P, T, h];
}
function dt(e, t, n, s, c, i) {
  const { messageCompiler: d, warnHtmlMessage: E } = e;
  if (H(s)) {
    const L = s;
    return L.locale = L.locale || n, L.key = L.key || t, L;
  }
  if (d == null) {
    const L = () => s;
    return L.locale = n, L.key = t, L;
  }
  const f = d(s, ur(e, n, c, s, E, i));
  return f.locale = n, f.key = t, f.source = s, f;
}
function lr(e, t, n) {
  return t(n);
}
function or(...e) {
  const [t, n, s] = e, c = W();
  if (!g(t) && !$(t) && !H(t) && !fe(t))
    throw B(j.INVALID_ARGUMENT);
  const i = $(t) ? String(t) : (H(t), t);
  return $(n) ? c.plural = n : g(n) ? c.default = n : U(n) && !ge(n) ? c.named = n : x(n) && (c.list = n), $(s) ? c.plural = s : g(s) ? c.default = s : U(s) && le(c, s), [i, c];
}
function ur(e, t, n, s, c, i) {
  return { locale: t, key: n, warnHtmlMessage: c, onError: (d) => {
    throw i && i(d), d;
  }, onCacheKey: (d) => Mt(t, n, d) };
}
function fr(e, t, n, s) {
  const { modifiers: c, pluralRules: i, messageResolver: d, fallbackLocale: E, fallbackWarn: f, missingWarn: L, fallbackContext: S } = e, T = { locale: t, modifiers: c, pluralRules: i, messages: (P) => {
    let y = d(n, P);
    if (y == null && S) {
      const [, , b] = _t(S, P, t, E, f, L);
      y = d(b, P);
    }
    if (g(y) || fe(y)) {
      let b = false;
      const A = dt(e, P, t, y, P, () => {
        b = true;
      });
      return b ? Qe : A;
    } else
      return H(y) ? y : Qe;
  } };
  return e.processor && (T.processor = e.processor), s.list && (T.list = s.list), s.named && (T.named = s.named), $(s.plural) && (T.pluralIndex = s.plural), T;
}
function wr(e, ...t) {
  const { datetimeFormats: n, unresolving: s, fallbackLocale: c, onWarn: i, localeFallbacker: d } = e, { __datetimeFormatters: E } = e, [f, L, S, h] = dr(...t), T = X(S.missingWarn) ? S.missingWarn : e.missingWarn;
  X(S.fallbackWarn) ? S.fallbackWarn : e.fallbackWarn;
  const P = !!S.part, y = be(e, S), b = d(e, c, y);
  if (!g(f) || f === "")
    return new Intl.DateTimeFormat(y, h).format(L);
  let O = {}, A, D = null;
  const l = "datetime format";
  for (let _ = 0; _ < b.length && (A = b[_], O = n[A] || {}, D = O[f], !U(D)); _++)
    ke(e, f, A, T, l);
  if (!U(D) || !g(A))
    return s ? De : f;
  let o = `${A}__${f}`;
  ge(h) || (o = `${o}__${JSON.stringify(h)}`);
  let m = E.get(o);
  return m || (m = new Intl.DateTimeFormat(A, le({}, D, h)), E.set(o, m)), P ? m.formatToParts(L) : m.format(L);
}
const _r = ["localeMatcher", "weekday", "era", "year", "month", "day", "hour", "minute", "second", "timeZoneName", "formatMatcher", "hour12", "timeZone", "dateStyle", "timeStyle", "calendar", "dayPeriod", "numberingSystem", "hourCycle", "fractionalSecondDigits"];
function dr(...e) {
  const [t, n, s, c] = e, i = W();
  let d = W(), E;
  if (g(t)) {
    const f = t.match(/(\d{4}-\d{2}-\d{2})(T|\s)?(.*)/);
    if (!f)
      throw B(j.INVALID_ISO_DATE_ARGUMENT);
    const L = f[3] ? f[3].trim().startsWith("T") ? `${f[1].trim()}${f[3].trim()}` : `${f[1].trim()}T${f[3].trim()}` : f[1].trim();
    E = new Date(L);
    try {
      E.toISOString();
    } catch {
      throw B(j.INVALID_ISO_DATE_ARGUMENT);
    }
  } else if (wt(t)) {
    if (isNaN(t.getTime()))
      throw B(j.INVALID_DATE_ARGUMENT);
    E = t;
  } else if ($(t))
    E = t;
  else
    throw B(j.INVALID_ARGUMENT);
  return g(n) ? i.key = n : U(n) && Object.keys(n).forEach((f) => {
    _r.includes(f) ? d[f] = n[f] : i[f] = n[f];
  }), g(s) ? i.locale = s : U(s) && (d = s), U(c) && (d = c), [i.key || "", E, i, d];
}
function Fr(e, t, n) {
  const s = e;
  for (const c in n) {
    const i = `${t}__${c}`;
    s.__datetimeFormatters.has(i) && s.__datetimeFormatters.delete(i);
  }
}
function vr(e, ...t) {
  const { numberFormats: n, unresolving: s, fallbackLocale: c, onWarn: i, localeFallbacker: d } = e, { __numberFormatters: E } = e, [f, L, S, h] = mr(...t), T = X(S.missingWarn) ? S.missingWarn : e.missingWarn;
  X(S.fallbackWarn) ? S.fallbackWarn : e.fallbackWarn;
  const P = !!S.part, y = be(e, S), b = d(e, c, y);
  if (!g(f) || f === "")
    return new Intl.NumberFormat(y, h).format(L);
  let O = {}, A, D = null;
  const l = "number format";
  for (let _ = 0; _ < b.length && (A = b[_], O = n[A] || {}, D = O[f], !U(D)); _++)
    ke(e, f, A, T, l);
  if (!U(D) || !g(A))
    return s ? De : f;
  let o = `${A}__${f}`;
  ge(h) || (o = `${o}__${JSON.stringify(h)}`);
  let m = E.get(o);
  return m || (m = new Intl.NumberFormat(A, le({}, D, h)), E.set(o, m)), P ? m.formatToParts(L) : m.format(L);
}
const Er = ["localeMatcher", "style", "currency", "currencyDisplay", "currencySign", "useGrouping", "minimumIntegerDigits", "minimumFractionDigits", "maximumFractionDigits", "minimumSignificantDigits", "maximumSignificantDigits", "compactDisplay", "notation", "signDisplay", "unit", "unitDisplay", "roundingMode", "roundingPriority", "roundingIncrement", "trailingZeroDisplay"];
function mr(...e) {
  const [t, n, s, c] = e, i = W();
  let d = W();
  if (!$(t))
    throw B(j.INVALID_ARGUMENT);
  const E = t;
  return g(n) ? i.key = n : U(n) && Object.keys(n).forEach((f) => {
    Er.includes(f) ? d[f] = n[f] : i[f] = n[f];
  }), g(s) ? i.locale = s : U(s) && (d = s), U(c) && (d = c), [i.key || "", E, i, d];
}
function Wr(e, t, n) {
  const s = e;
  for (const c in n) {
    const i = `${t}__${c}`;
    s.__numberFormatters.has(i) && s.__numberFormatters.delete(i);
  }
}
pn();
export {
  Ir as A,
  ze as B,
  j as C,
  Ce as D,
  Dr as E,
  Fr as F,
  Wr as G,
  Pr as H,
  br as I,
  De as J,
  or as K,
  Ur as L,
  Ar as M,
  Er as N,
  dr as O,
  wr as P,
  mr as Q,
  vr as R,
  fe as S,
  H as T,
  Or as U,
  yr as V,
  le as a,
  g as b,
  W as c,
  F as d,
  X as e,
  ge as f,
  x as g,
  U as h,
  $ as i,
  Fe as j,
  v as k,
  Sr as l,
  gr as m,
  he as n,
  _e as o,
  Lr as p,
  Tr as q,
  Cr as r,
  hr as s,
  se as t,
  kr as u,
  Nr as v,
  _r as w,
  Mr as x,
  Rr as y,
  pr as z
};
