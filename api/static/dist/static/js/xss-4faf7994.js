import { l as X, g as rr } from "./cssfilter-476ae7ee.js";
var W = { exports: {} }, o = {}, k = { indexOf: function(r, t) {
  var e, n;
  if (Array.prototype.indexOf)
    return r.indexOf(t);
  for (e = 0, n = r.length; e < n; e++)
    if (r[e] === t)
      return e;
  return -1;
}, forEach: function(r, t, e) {
  var n, f;
  if (Array.prototype.forEach)
    return r.forEach(t, e);
  for (n = 0, f = r.length; n < f; n++)
    t.call(e, r[n], n, r);
}, trim: function(r) {
  return String.prototype.trim ? r.trim() : r.replace(/(^\s*)|(\s*$)/g, "");
}, spaceIndex: function(r) {
  var t = /\s|\n|\t/, e = t.exec(r);
  return e ? e.index : -1;
} }, er = X.FilterCSS, tr = X.getDefaultWhiteList, x = k;
function V() {
  return { a: ["target", "href", "title"], abbr: ["title"], address: [], area: ["shape", "coords", "href", "alt"], article: [], aside: [], audio: ["autoplay", "controls", "crossorigin", "loop", "muted", "preload", "src"], b: [], bdi: ["dir"], bdo: ["dir"], big: [], blockquote: ["cite"], br: [], caption: [], center: [], cite: [], code: [], col: ["align", "valign", "span", "width"], colgroup: ["align", "valign", "span", "width"], dd: [], del: ["datetime"], details: ["open"], div: [], dl: [], dt: [], em: [], figcaption: [], figure: [], font: ["color", "size", "face"], footer: [], h1: [], h2: [], h3: [], h4: [], h5: [], h6: [], header: [], hr: [], i: [], img: ["src", "alt", "title", "width", "height", "loading"], ins: ["datetime"], kbd: [], li: [], mark: [], nav: [], ol: [], p: [], pre: [], s: [], section: [], small: [], span: [], sub: [], summary: [], sup: [], strong: [], strike: [], table: ["width", "border", "align", "valign"], tbody: ["align", "valign"], td: ["width", "rowspan", "colspan", "align", "valign"], tfoot: ["align", "valign"], th: ["width", "rowspan", "colspan", "align", "valign"], thead: ["align", "valign"], tr: ["rowspan", "align", "valign"], tt: [], u: [], ul: [], video: ["autoplay", "controls", "crossorigin", "loop", "muted", "playsinline", "poster", "preload", "src", "height", "width"] };
}
var B = new er();
function nr(r, t, e) {
}
function ar(r, t, e) {
}
function ir(r, t, e) {
}
function sr(r, t, e) {
}
function H(r) {
  return r.replace(fr, "&lt;").replace(ur, "&gt;");
}
function or(r, t, e, n) {
  if (e = z(e), t === "href" || t === "src") {
    if (e = x.trim(e), e === "#")
      return "#";
    if (!(e.substr(0, 7) === "http://" || e.substr(0, 8) === "https://" || e.substr(0, 7) === "mailto:" || e.substr(0, 4) === "tel:" || e.substr(0, 11) === "data:image/" || e.substr(0, 6) === "ftp://" || e.substr(0, 2) === "./" || e.substr(0, 3) === "../" || e[0] === "#" || e[0] === "/"))
      return "";
  } else if (t === "background") {
    if (_.lastIndex = 0, _.test(e))
      return "";
  } else if (t === "style") {
    if (N.lastIndex = 0, N.test(e) || (F.lastIndex = 0, F.test(e) && (_.lastIndex = 0, _.test(e))))
      return "";
    n !== false && (n = n || B, e = n.process(e));
  }
  return e = M(e), e;
}
var fr = /</g, ur = />/g, lr = /"/g, cr = /&quot;/g, gr = /&#([a-zA-Z0-9]*);?/gim, pr = /&colon;?/gim, vr = /&newline;?/gim, _ = /((j\s*a\s*v\s*a|v\s*b|l\s*i\s*v\s*e)\s*s\s*c\s*r\s*i\s*p\s*t\s*|m\s*o\s*c\s*h\s*a):/gi, N = /e\s*x\s*p\s*r\s*e\s*s\s*s\s*i\s*o\s*n\s*\(.*/gi, F = /u\s*r\s*l\s*\(.*/gi;
function U(r) {
  return r.replace(lr, "&quot;");
}
function m(r) {
  return r.replace(cr, '"');
}
function Q(r) {
  return r.replace(gr, function(e, n) {
    return n[0] === "x" || n[0] === "X" ? String.fromCharCode(parseInt(n.substr(1), 16)) : String.fromCharCode(parseInt(n, 10));
  });
}
function $(r) {
  return r.replace(pr, ":").replace(vr, " ");
}
function q(r) {
  for (var t = "", e = 0, n = r.length; e < n; e++)
    t += r.charCodeAt(e) < 32 ? " " : r.charAt(e);
  return x.trim(t);
}
function z(r) {
  return r = m(r), r = Q(r), r = $(r), r = q(r), r;
}
function M(r) {
  return r = U(r), r = H(r), r;
}
function dr() {
  return "";
}
function Tr(r, t) {
  typeof t != "function" && (t = function() {
  });
  var e = !Array.isArray(r);
  function n(l) {
    return e ? true : x.indexOf(r, l) !== -1;
  }
  var f = [], i = false;
  return { onIgnoreTag: function(l, s, a) {
    if (n(l))
      if (a.isClosing) {
        var g = "[/removed]", c = a.position + g.length;
        return f.push([i !== false ? i : a.position, c]), i = false, g;
      } else
        return i || (i = a.position), "[removed]";
    else
      return t(l, s, a);
  }, remove: function(l) {
    var s = "", a = 0;
    return x.forEach(f, function(g) {
      s += l.slice(a, g[0]), a = g[1];
    }), s += l.slice(a), s;
  } };
}
function Ar(r) {
  for (var t = "", e = 0; e < r.length; ) {
    var n = r.indexOf("<!--", e);
    if (n === -1) {
      t += r.slice(e);
      break;
    }
    t += r.slice(e, n);
    var f = r.indexOf("-->", n);
    if (f === -1)
      break;
    e = f + 3;
  }
  return t;
}
function Er(r) {
  var t = r.split("");
  return t = t.filter(function(e) {
    var n = e.charCodeAt(0);
    return n === 127 ? false : n <= 31 ? n === 10 || n === 13 : true;
  }), t.join("");
}
o.whiteList = V();
o.getDefaultWhiteList = V;
o.onTag = nr;
o.onIgnoreTag = ar;
o.onTagAttr = ir;
o.onIgnoreTagAttr = sr;
o.safeAttrValue = or;
o.escapeHtml = H;
o.escapeQuote = U;
o.unescapeQuote = m;
o.escapeHtmlEntities = Q;
o.escapeDangerHtml5Entities = $;
o.clearNonPrintableCharacter = q;
o.friendlyAttrValue = z;
o.escapeAttrValue = M;
o.onIgnoreTagStripAll = dr;
o.StripTagBody = Tr;
o.stripCommentTag = Ar;
o.stripBlankChar = Er;
o.attributeWrapSign = '"';
o.cssFilter = B;
o.getDefaultCSSWhiteList = tr;
var P = {}, E = k;
function Sr(r) {
  var t = E.spaceIndex(r), e;
  return t === -1 ? e = r.slice(1, -1) : e = r.slice(1, t + 1), e = E.trim(e).toLowerCase(), e.slice(0, 1) === "/" && (e = e.slice(1)), e.slice(-1) === "/" && (e = e.slice(0, -1)), e;
}
function hr(r) {
  return r.slice(0, 2) === "</";
}
function wr(r, t, e) {
  var n = "", f = 0, i = false, l = false, s = 0, a = r.length, g = "", c = "";
  r:
    for (s = 0; s < a; s++) {
      var u = r.charAt(s);
      if (i === false) {
        if (u === "<") {
          i = s;
          continue;
        }
      } else if (l === false) {
        if (u === "<") {
          n += e(r.slice(f, s)), i = s, f = s;
          continue;
        }
        if (u === ">" || s === a - 1) {
          n += e(r.slice(f, i)), c = r.slice(i, s + 1), g = Sr(c), n += t(i, n.length, g, c, hr(c)), f = s + 1, i = false;
          continue;
        }
        if (u === '"' || u === "'")
          for (var p = 1, d = r.charAt(s - p); d.trim() === "" || d === "="; ) {
            if (d === "=") {
              l = u;
              continue r;
            }
            d = r.charAt(s - ++p);
          }
      } else if (u === l) {
        l = false;
        continue;
      }
    }
  return f < a && (n += e(r.substr(f))), n;
}
var br = /[^a-zA-Z0-9\\_:.-]/gim;
function Ir(r, t) {
  var e = 0, n = 0, f = [], i = false, l = r.length;
  function s(p, d) {
    if (p = E.trim(p), p = p.replace(br, "").toLowerCase(), !(p.length < 1)) {
      var I = t(p, d || "");
      I && f.push(I);
    }
  }
  for (var a = 0; a < l; a++) {
    var g = r.charAt(a), c, u;
    if (i === false && g === "=") {
      i = r.slice(e, a), e = a + 1, n = r.charAt(e) === '"' || r.charAt(e) === "'" ? e : _r(r, a + 1);
      continue;
    }
    if (i !== false && a === n) {
      if (u = r.indexOf(g, a + 1), u === -1)
        break;
      c = E.trim(r.slice(n + 1, u)), s(i, c), i = false, a = u, e = a + 1;
      continue;
    }
    if (/\s|\n|\t/.test(g))
      if (r = r.replace(/\s|\n|\t/g, " "), i === false)
        if (u = Cr(r, a), u === -1) {
          c = E.trim(r.slice(e, a)), s(c), i = false, e = a + 1;
          continue;
        } else {
          a = u - 1;
          continue;
        }
      else if (u = Lr(r, a - 1), u === -1) {
        c = E.trim(r.slice(e, a)), c = D(c), s(i, c), i = false, e = a + 1;
        continue;
      } else
        continue;
  }
  return e < r.length && (i === false ? s(r.slice(e)) : s(i, D(E.trim(r.slice(e))))), E.trim(f.join(" "));
}
function Cr(r, t) {
  for (; t < r.length; t++) {
    var e = r[t];
    if (e !== " ")
      return e === "=" ? t : -1;
  }
}
function _r(r, t) {
  for (; t < r.length; t++) {
    var e = r[t];
    if (e !== " ")
      return e === "'" || e === '"' ? t : -1;
  }
}
function Lr(r, t) {
  for (; t > 0; t--) {
    var e = r[t];
    if (e !== " ")
      return e === "=" ? t : -1;
  }
}
function yr(r) {
  return r[0] === '"' && r[r.length - 1] === '"' || r[0] === "'" && r[r.length - 1] === "'";
}
function D(r) {
  return yr(r) ? r.substr(1, r.length - 2) : r;
}
P.parseTag = wr;
P.parseAttr = Ir;
var xr = X.FilterCSS, v = o, Z = P, Pr = Z.parseTag, Rr = Z.parseAttr, y = k;
function L(r) {
  return r == null;
}
function Wr(r) {
  var t = y.spaceIndex(r);
  if (t === -1)
    return { html: "", closing: r[r.length - 2] === "/" };
  r = y.trim(r.slice(t + 1, -1));
  var e = r[r.length - 1] === "/";
  return e && (r = y.trim(r.slice(0, -1))), { html: r, closing: e };
}
function Xr(r) {
  var t = {};
  for (var e in r)
    t[e] = r[e];
  return t;
}
function kr(r) {
  var t = {};
  for (var e in r)
    Array.isArray(r[e]) ? t[e.toLowerCase()] = r[e].map(function(n) {
      return n.toLowerCase();
    }) : t[e.toLowerCase()] = r[e];
  return t;
}
function J(r) {
  r = Xr(r || {}), r.stripIgnoreTag && (r.onIgnoreTag && console.error('Notes: cannot use these two options "stripIgnoreTag" and "onIgnoreTag" at the same time'), r.onIgnoreTag = v.onIgnoreTagStripAll), r.whiteList || r.allowList ? r.whiteList = kr(r.whiteList || r.allowList) : r.whiteList = v.whiteList, this.attributeWrapSign = r.singleQuotedAttributeValue === true ? "'" : v.attributeWrapSign, r.onTag = r.onTag || v.onTag, r.onTagAttr = r.onTagAttr || v.onTagAttr, r.onIgnoreTag = r.onIgnoreTag || v.onIgnoreTag, r.onIgnoreTagAttr = r.onIgnoreTagAttr || v.onIgnoreTagAttr, r.safeAttrValue = r.safeAttrValue || v.safeAttrValue, r.escapeHtml = r.escapeHtml || v.escapeHtml, this.options = r, r.css === false ? this.cssFilter = false : (r.css = r.css || {}, this.cssFilter = new xr(r.css));
}
J.prototype.process = function(r) {
  if (r = r || "", r = r.toString(), !r)
    return "";
  var t = this, e = t.options, n = e.whiteList, f = e.onTag, i = e.onIgnoreTag, l = e.onTagAttr, s = e.onIgnoreTagAttr, a = e.safeAttrValue, g = e.escapeHtml, c = t.attributeWrapSign, u = t.cssFilter;
  e.stripBlankChar && (r = v.stripBlankChar(r)), e.allowCommentTag || (r = v.stripCommentTag(r));
  var p = false;
  e.stripIgnoreTagBody && (p = v.StripTagBody(e.stripIgnoreTagBody, i), i = p.onIgnoreTag);
  var d = Pr(r, function(I, K, T, A, Y) {
    var C = { sourcePosition: I, position: K, isClosing: Y, isWhite: Object.prototype.hasOwnProperty.call(n, T) }, w = f(T, A, C);
    if (!L(w))
      return w;
    if (C.isWhite) {
      if (C.isClosing)
        return "</" + T + ">";
      var G = Wr(A), j = n[T], O = Rr(G.html, function(S, h) {
        var R = y.indexOf(j, S) !== -1, b = l(T, S, h, R);
        return L(b) ? R ? (h = a(T, S, h, u), h ? S + "=" + c + h + c : S) : (b = s(T, S, h, R), L(b) ? void 0 : b) : b;
      });
      return A = "<" + T, O && (A += " " + O), G.closing && (A += " /"), A += ">", A;
    } else
      return w = i(T, A, C), L(w) ? g(A) : w;
  }, g);
  return p && (d = p.remove(d)), d;
};
var Gr = J;
(function(r, t) {
  var e = o, n = P, f = Gr;
  function i(s, a) {
    var g = new f(a);
    return g.process(s);
  }
  t = r.exports = i, t.filterXSS = i, t.FilterXSS = f, function() {
    for (var s in e)
      t[s] = e[s];
    for (var a in n)
      t[a] = n[a];
  }(), typeof window < "u" && (window.filterXSS = r.exports);
  function l() {
    return typeof self < "u" && typeof DedicatedWorkerGlobalScope < "u" && self instanceof DedicatedWorkerGlobalScope;
  }
  l() && (self.filterXSS = r.exports);
})(W, W.exports);
var Or = W.exports;
const Fr = rr(Or);
export {
  Fr as x
};
