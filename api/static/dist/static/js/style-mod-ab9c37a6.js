const S = "\u037C", m = typeof Symbol > "u" ? "__" + S : Symbol.for(S), c = typeof Symbol > "u" ? "__styleSet" + Math.floor(Math.random() * 1e8) : Symbol("styleSet"), w = typeof globalThis < "u" ? globalThis : typeof window < "u" ? window : {};
class A {
  constructor(e, l) {
    this.rules = [];
    let { finish: i } = l || {};
    function n(t) {
      return /^@/.test(t) ? [t] : t.split(/,\s*/);
    }
    function s(t, a, h, r) {
      let p = [], f = /^@(\w+)\b/.exec(t[0]), g = f && f[1] == "keyframes";
      if (f && a == null)
        return h.push(t[0] + ";");
      for (let o in a) {
        let u = a[o];
        if (/&/.test(o))
          s(o.split(/,\s*/).map((d) => t.map((y) => d.replace(/&/, y))).reduce((d, y) => d.concat(y)), u, h);
        else if (u && typeof u == "object") {
          if (!f)
            throw new RangeError("The value of a property (" + o + ") should be a primitive value.");
          s(n(o), u, p, g);
        } else
          u != null && p.push(o.replace(/_.*/, "").replace(/[A-Z]/g, (d) => "-" + d.toLowerCase()) + ": " + u + ";");
      }
      (p.length || g) && h.push((i && !f && !r ? t.map(i) : t).join(", ") + " {" + p.join(" ") + "}");
    }
    for (let t in e)
      s(n(t), e[t], this.rules);
  }
  getRules() {
    return this.rules.join(`
`);
  }
  static newName() {
    let e = w[m] || 1;
    return w[m] = e + 1, S + e.toString(36);
  }
  static mount(e, l, i) {
    let n = e[c], s = i && i.nonce;
    n ? s && n.setNonce(s) : n = new x(e, s), n.mount(Array.isArray(l) ? l : [l], e);
  }
}
let T = /* @__PURE__ */ new Map();
class x {
  constructor(e, l) {
    let i = e.ownerDocument || e, n = i.defaultView;
    if (!e.head && e.adoptedStyleSheets && n.CSSStyleSheet) {
      let s = T.get(i);
      if (s)
        return e[c] = s;
      this.sheet = new n.CSSStyleSheet(), T.set(i, this);
    } else
      this.styleTag = i.createElement("style"), l && this.styleTag.setAttribute("nonce", l);
    this.modules = [], e[c] = this;
  }
  mount(e, l) {
    let i = this.sheet, n = 0, s = 0;
    for (let t = 0; t < e.length; t++) {
      let a = e[t], h = this.modules.indexOf(a);
      if (h < s && h > -1 && (this.modules.splice(h, 1), s--, h = -1), h == -1) {
        if (this.modules.splice(s++, 0, a), i)
          for (let r = 0; r < a.rules.length; r++)
            i.insertRule(a.rules[r], n++);
      } else {
        for (; s < h; )
          n += this.modules[s++].rules.length;
        n += a.rules.length, s++;
      }
    }
    if (i)
      l.adoptedStyleSheets.indexOf(this.sheet) < 0 && (l.adoptedStyleSheets = [this.sheet, ...l.adoptedStyleSheets]);
    else {
      let t = "";
      for (let h = 0; h < this.modules.length; h++)
        t += this.modules[h].getRules() + `
`;
      this.styleTag.textContent = t;
      let a = l.head || l;
      this.styleTag.parentNode != a && a.insertBefore(this.styleTag, a.firstChild);
    }
  }
  setNonce(e) {
    this.styleTag && this.styleTag.getAttribute("nonce") != e && this.styleTag.setAttribute("nonce", e);
  }
}
export {
  A as S
};
