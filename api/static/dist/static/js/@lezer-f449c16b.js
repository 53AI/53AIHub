let Et = 0;
class pt {
  constructor(t, e) {
    this.from = t, this.to = e;
  }
}
class C {
  constructor(t = {}) {
    this.id = Et++, this.perNode = !!t.perNode, this.deserialize = t.deserialize || (() => {
      throw new Error("This node type doesn't define a deserialize function");
    });
  }
  add(t) {
    if (this.perNode)
      throw new RangeError("Can't add per-node props to node types");
    return typeof t != "function" && (t = K.match(t)), (e) => {
      let r = t(e);
      return r === void 0 ? null : [this, r];
    };
  }
}
C.closedBy = new C({ deserialize: (l) => l.split(" ") });
C.openedBy = new C({ deserialize: (l) => l.split(" ") });
C.group = new C({ deserialize: (l) => l.split(" ") });
C.isolate = new C({ deserialize: (l) => {
  if (l && l != "rtl" && l != "ltr" && l != "auto")
    throw new RangeError("Invalid value for isolate: " + l);
  return l || "auto";
} });
C.contextHash = new C({ perNode: true });
C.lookAhead = new C({ perNode: true });
C.mounted = new C({ perNode: true });
class ut {
  constructor(t, e, r) {
    this.tree = t, this.overlay = e, this.parser = r;
  }
  static get(t) {
    return t && t.props && t.props[C.mounted.id];
  }
}
const Rt = /* @__PURE__ */ Object.create(null);
class K {
  constructor(t, e, r, i = 0) {
    this.name = t, this.props = e, this.id = r, this.flags = i;
  }
  static define(t) {
    let e = t.props && t.props.length ? /* @__PURE__ */ Object.create(null) : Rt, r = (t.top ? 1 : 0) | (t.skipped ? 2 : 0) | (t.error ? 4 : 0) | (t.name == null ? 8 : 0), i = new K(t.name || "", e, t.id, r);
    if (t.props) {
      for (let n of t.props)
        if (Array.isArray(n) || (n = n(i)), n) {
          if (n[0].perNode)
            throw new RangeError("Can't store a per-node prop on a node type");
          e[n[0].id] = n[1];
        }
    }
    return i;
  }
  prop(t) {
    return this.props[t.id];
  }
  get isTop() {
    return (this.flags & 1) > 0;
  }
  get isSkipped() {
    return (this.flags & 2) > 0;
  }
  get isError() {
    return (this.flags & 4) > 0;
  }
  get isAnonymous() {
    return (this.flags & 8) > 0;
  }
  is(t) {
    if (typeof t == "string") {
      if (this.name == t)
        return true;
      let e = this.prop(C.group);
      return e ? e.indexOf(t) > -1 : false;
    }
    return this.id == t;
  }
  static match(t) {
    let e = /* @__PURE__ */ Object.create(null);
    for (let r in t)
      for (let i of r.split(" "))
        e[i] = t[r];
    return (r) => {
      for (let i = r.prop(C.group), n = -1; n < (i ? i.length : 0); n++) {
        let s = e[n < 0 ? r.name : i[n]];
        if (s)
          return s;
      }
    };
  }
}
K.none = new K("", /* @__PURE__ */ Object.create(null), 0, 8);
const lt = /* @__PURE__ */ new WeakMap(), St = /* @__PURE__ */ new WeakMap();
var B;
(function(l) {
  l[l.ExcludeBuffers = 1] = "ExcludeBuffers", l[l.IncludeAnonymous = 2] = "IncludeAnonymous", l[l.IgnoreMounts = 4] = "IgnoreMounts", l[l.IgnoreOverlays = 8] = "IgnoreOverlays";
})(B || (B = {}));
class q {
  constructor(t, e, r, i, n) {
    if (this.type = t, this.children = e, this.positions = r, this.length = i, this.props = null, n && n.length) {
      this.props = /* @__PURE__ */ Object.create(null);
      for (let [s, o] of n)
        this.props[typeof s == "number" ? s : s.id] = o;
    }
  }
  toString() {
    let t = ut.get(this);
    if (t && !t.overlay)
      return t.tree.toString();
    let e = "";
    for (let r of this.children) {
      let i = r.toString();
      i && (e && (e += ","), e += i);
    }
    return this.type.name ? (/\W/.test(this.type.name) && !this.type.isError ? JSON.stringify(this.type.name) : this.type.name) + (e.length ? "(" + e + ")" : "") : e;
  }
  cursor(t = 0) {
    return new yt(this.topNode, t);
  }
  cursorAt(t, e = 0, r = 0) {
    let i = lt.get(this) || this.topNode, n = new yt(i);
    return n.moveTo(t, e), lt.set(this, n._tree), n;
  }
  get topNode() {
    return new E(this, 0, 0, null);
  }
  resolve(t, e = 0) {
    let r = it(lt.get(this) || this.topNode, t, e, false);
    return lt.set(this, r), r;
  }
  resolveInner(t, e = 0) {
    let r = it(St.get(this) || this.topNode, t, e, true);
    return St.set(this, r), r;
  }
  resolveStack(t, e = 0) {
    return Lt(this, t, e);
  }
  iterate(t) {
    let { enter: e, leave: r, from: i = 0, to: n = this.length } = t, s = t.mode || 0, o = (s & B.IncludeAnonymous) > 0;
    for (let f = this.cursor(s | B.IncludeAnonymous); ; ) {
      let d = false;
      if (f.from <= n && f.to >= i && (!o && f.type.isAnonymous || e(f) !== false)) {
        if (f.firstChild())
          continue;
        d = true;
      }
      for (; d && r && (o || !f.type.isAnonymous) && r(f), !f.nextSibling(); ) {
        if (!f.parent())
          return;
        d = true;
      }
    }
  }
  prop(t) {
    return t.perNode ? this.props ? this.props[t.id] : void 0 : this.type.prop(t);
  }
  get propValues() {
    let t = [];
    if (this.props)
      for (let e in this.props)
        t.push([+e, this.props[e]]);
    return t;
  }
  balance(t = {}) {
    return this.children.length <= 8 ? this : vt(K.none, this.children, this.positions, 0, this.children.length, 0, this.length, (e, r, i) => new q(this.type, e, r, i, this.propValues), t.makeTree || ((e, r, i) => new q(K.none, e, r, i)));
  }
  static build(t) {
    return Dt(t);
  }
}
q.empty = new q(K.none, [], [], 0);
class kt {
  constructor(t, e) {
    this.buffer = t, this.index = e;
  }
  get id() {
    return this.buffer[this.index - 4];
  }
  get start() {
    return this.buffer[this.index - 3];
  }
  get end() {
    return this.buffer[this.index - 2];
  }
  get size() {
    return this.buffer[this.index - 1];
  }
  get pos() {
    return this.index;
  }
  next() {
    this.index -= 4;
  }
  fork() {
    return new kt(this.buffer, this.index);
  }
}
class Q {
  constructor(t, e, r) {
    this.buffer = t, this.length = e, this.set = r;
  }
  get type() {
    return K.none;
  }
  toString() {
    let t = [];
    for (let e = 0; e < this.buffer.length; )
      t.push(this.childString(e)), e = this.buffer[e + 3];
    return t.join(",");
  }
  childString(t) {
    let e = this.buffer[t], r = this.buffer[t + 3], i = this.set.types[e], n = i.name;
    if (/\W/.test(n) && !i.isError && (n = JSON.stringify(n)), t += 4, r == t)
      return n;
    let s = [];
    for (; t < r; )
      s.push(this.childString(t)), t = this.buffer[t + 3];
    return n + "(" + s.join(",") + ")";
  }
  findChild(t, e, r, i, n) {
    let { buffer: s } = this, o = -1;
    for (let f = t; f != e && !(Bt(n, i, s[f + 1], s[f + 2]) && (o = f, r > 0)); f = s[f + 3])
      ;
    return o;
  }
  slice(t, e, r) {
    let i = this.buffer, n = new Uint16Array(e - t), s = 0;
    for (let o = t, f = 0; o < e; ) {
      n[f++] = i[o++], n[f++] = i[o++] - r;
      let d = n[f++] = i[o++] - r;
      n[f++] = i[o++] - t, s = Math.max(s, d);
    }
    return new Q(n, s, this.set);
  }
}
function Bt(l, t, e, r) {
  switch (l) {
    case -2:
      return e < t;
    case -1:
      return r >= t && e < t;
    case 0:
      return e < t && r > t;
    case 1:
      return e <= t && r > t;
    case 2:
      return r > t;
    case 4:
      return true;
  }
}
function it(l, t, e, r) {
  for (var i; l.from == l.to || (e < 1 ? l.from >= t : l.from > t) || (e > -1 ? l.to <= t : l.to < t); ) {
    let s = !r && l instanceof E && l.index < 0 ? null : l.parent;
    if (!s)
      return l;
    l = s;
  }
  let n = r ? 0 : B.IgnoreOverlays;
  if (r)
    for (let s = l, o = s.parent; o; s = o, o = s.parent)
      s instanceof E && s.index < 0 && ((i = o.enter(t, e, n)) === null || i === void 0 ? void 0 : i.from) != s.from && (l = o);
  for (; ; ) {
    let s = l.enter(t, e, n);
    if (!s)
      return l;
    l = s;
  }
}
class Pt {
  cursor(t = 0) {
    return new yt(this, t);
  }
  getChild(t, e = null, r = null) {
    let i = At(this, t, e, r);
    return i.length ? i[0] : null;
  }
  getChildren(t, e = null, r = null) {
    return At(this, t, e, r);
  }
  resolve(t, e = 0) {
    return it(this, t, e, false);
  }
  resolveInner(t, e = 0) {
    return it(this, t, e, true);
  }
  matchContext(t) {
    return mt(this.parent, t);
  }
  enterUnfinishedNodesBefore(t) {
    let e = this.childBefore(t), r = this;
    for (; e; ) {
      let i = e.lastChild;
      if (!i || i.to != e.to)
        break;
      i.type.isError && i.from == i.to ? (r = e, e = i.prevSibling) : e = i;
    }
    return r;
  }
  get node() {
    return this;
  }
  get next() {
    return this.parent;
  }
}
class E extends Pt {
  constructor(t, e, r, i) {
    super(), this._tree = t, this.from = e, this.index = r, this._parent = i;
  }
  get type() {
    return this._tree.type;
  }
  get name() {
    return this._tree.type.name;
  }
  get to() {
    return this.from + this._tree.length;
  }
  nextChild(t, e, r, i, n = 0) {
    for (let s = this; ; ) {
      for (let { children: o, positions: f } = s._tree, d = e > 0 ? o.length : -1; t != d; t += e) {
        let m = o[t], y = f[t] + s.from;
        if (Bt(i, r, y, y + m.length)) {
          if (m instanceof Q) {
            if (n & B.ExcludeBuffers)
              continue;
            let p = m.findChild(0, m.buffer.length, e, r - y, i);
            if (p > -1)
              return new G(new jt(s, m, t, y), null, p);
          } else if (n & B.IncludeAnonymous || !m.type.isAnonymous || wt(m)) {
            let p;
            if (!(n & B.IgnoreMounts) && (p = ut.get(m)) && !p.overlay)
              return new E(p.tree, y, t, s);
            let _ = new E(m, y, t, s);
            return n & B.IncludeAnonymous || !_.type.isAnonymous ? _ : _.nextChild(e < 0 ? m.children.length - 1 : 0, e, r, i);
          }
        }
      }
      if (n & B.IncludeAnonymous || !s.type.isAnonymous || (s.index >= 0 ? t = s.index + e : t = e < 0 ? -1 : s._parent._tree.children.length, s = s._parent, !s))
        return null;
    }
  }
  get firstChild() {
    return this.nextChild(0, 1, 0, 4);
  }
  get lastChild() {
    return this.nextChild(this._tree.children.length - 1, -1, 0, 4);
  }
  childAfter(t) {
    return this.nextChild(0, 1, t, 2);
  }
  childBefore(t) {
    return this.nextChild(this._tree.children.length - 1, -1, t, -2);
  }
  enter(t, e, r = 0) {
    let i;
    if (!(r & B.IgnoreOverlays) && (i = ut.get(this._tree)) && i.overlay) {
      let n = t - this.from;
      for (let { from: s, to: o } of i.overlay)
        if ((e > 0 ? s <= n : s < n) && (e < 0 ? o >= n : o > n))
          return new E(i.tree, i.overlay[0].from + this.from, -1, this);
    }
    return this.nextChild(0, 1, t, e, r);
  }
  nextSignificantParent() {
    let t = this;
    for (; t.type.isAnonymous && t._parent; )
      t = t._parent;
    return t;
  }
  get parent() {
    return this._parent ? this._parent.nextSignificantParent() : null;
  }
  get nextSibling() {
    return this._parent && this.index >= 0 ? this._parent.nextChild(this.index + 1, 1, 0, 4) : null;
  }
  get prevSibling() {
    return this._parent && this.index >= 0 ? this._parent.nextChild(this.index - 1, -1, 0, 4) : null;
  }
  get tree() {
    return this._tree;
  }
  toTree() {
    return this._tree;
  }
  toString() {
    return this._tree.toString();
  }
}
function At(l, t, e, r) {
  let i = l.cursor(), n = [];
  if (!i.firstChild())
    return n;
  if (e != null) {
    for (let s = false; !s; )
      if (s = i.type.is(e), !i.nextSibling())
        return n;
  }
  for (; ; ) {
    if (r != null && i.type.is(r))
      return n;
    if (i.type.is(t) && n.push(i.node), !i.nextSibling())
      return r == null ? n : [];
  }
}
function mt(l, t, e = t.length - 1) {
  for (let r = l; e >= 0; r = r.parent) {
    if (!r)
      return false;
    if (!r.type.isAnonymous) {
      if (t[e] && t[e] != r.name)
        return false;
      e--;
    }
  }
  return true;
}
class jt {
  constructor(t, e, r, i) {
    this.parent = t, this.buffer = e, this.index = r, this.start = i;
  }
}
class G extends Pt {
  get name() {
    return this.type.name;
  }
  get from() {
    return this.context.start + this.context.buffer.buffer[this.index + 1];
  }
  get to() {
    return this.context.start + this.context.buffer.buffer[this.index + 2];
  }
  constructor(t, e, r) {
    super(), this.context = t, this._parent = e, this.index = r, this.type = t.buffer.set.types[t.buffer.buffer[r]];
  }
  child(t, e, r) {
    let { buffer: i } = this.context, n = i.findChild(this.index + 4, i.buffer[this.index + 3], t, e - this.context.start, r);
    return n < 0 ? null : new G(this.context, this, n);
  }
  get firstChild() {
    return this.child(1, 0, 4);
  }
  get lastChild() {
    return this.child(-1, 0, 4);
  }
  childAfter(t) {
    return this.child(1, t, 2);
  }
  childBefore(t) {
    return this.child(-1, t, -2);
  }
  enter(t, e, r = 0) {
    if (r & B.ExcludeBuffers)
      return null;
    let { buffer: i } = this.context, n = i.findChild(this.index + 4, i.buffer[this.index + 3], e > 0 ? 1 : -1, t - this.context.start, e);
    return n < 0 ? null : new G(this.context, this, n);
  }
  get parent() {
    return this._parent || this.context.parent.nextSignificantParent();
  }
  externalSibling(t) {
    return this._parent ? null : this.context.parent.nextChild(this.context.index + t, t, 0, 4);
  }
  get nextSibling() {
    let { buffer: t } = this.context, e = t.buffer[this.index + 3];
    return e < (this._parent ? t.buffer[this._parent.index + 3] : t.buffer.length) ? new G(this.context, this._parent, e) : this.externalSibling(1);
  }
  get prevSibling() {
    let { buffer: t } = this.context, e = this._parent ? this._parent.index + 4 : 0;
    return this.index == e ? this.externalSibling(-1) : new G(this.context, this._parent, t.findChild(e, this.index, -1, 0, 4));
  }
  get tree() {
    return null;
  }
  toTree() {
    let t = [], e = [], { buffer: r } = this.context, i = this.index + 4, n = r.buffer[this.index + 3];
    if (n > i) {
      let s = r.buffer[this.index + 1];
      t.push(r.slice(i, n, s)), e.push(0);
    }
    return new q(this.type, t, e, this.to - this.from);
  }
  toString() {
    return this.context.buffer.childString(this.index);
  }
}
function Mt(l) {
  if (!l.length)
    return null;
  let t = 0, e = l[0];
  for (let n = 1; n < l.length; n++) {
    let s = l[n];
    (s.from > e.from || s.to < e.to) && (e = s, t = n);
  }
  let r = e instanceof E && e.index < 0 ? null : e.parent, i = l.slice();
  return r ? i[t] = r : i.splice(t, 1), new Tt(i, e);
}
class Tt {
  constructor(t, e) {
    this.heads = t, this.node = e;
  }
  get next() {
    return Mt(this.heads);
  }
}
function Lt(l, t, e) {
  let r = l.resolveInner(t, e), i = null;
  for (let n = r instanceof E ? r : r.context.parent; n; n = n.parent)
    if (n.index < 0) {
      let s = n.parent;
      (i || (i = [r])).push(s.resolve(t, e)), n = s;
    } else {
      let s = ut.get(n.tree);
      if (s && s.overlay && s.overlay[0].from <= t && s.overlay[s.overlay.length - 1].to >= t) {
        let o = new E(s.tree, s.overlay[0].from + n.from, -1, n);
        (i || (i = [r])).push(it(o, t, e, false));
      }
    }
  return i ? Mt(i) : r;
}
class yt {
  get name() {
    return this.type.name;
  }
  constructor(t, e = 0) {
    if (this.mode = e, this.buffer = null, this.stack = [], this.index = 0, this.bufferNode = null, t instanceof E)
      this.yieldNode(t);
    else {
      this._tree = t.context.parent, this.buffer = t.context;
      for (let r = t._parent; r; r = r._parent)
        this.stack.unshift(r.index);
      this.bufferNode = t, this.yieldBuf(t.index);
    }
  }
  yieldNode(t) {
    return t ? (this._tree = t, this.type = t.type, this.from = t.from, this.to = t.to, true) : false;
  }
  yieldBuf(t, e) {
    this.index = t;
    let { start: r, buffer: i } = this.buffer;
    return this.type = e || i.set.types[i.buffer[t]], this.from = r + i.buffer[t + 1], this.to = r + i.buffer[t + 2], true;
  }
  yield(t) {
    return t ? t instanceof E ? (this.buffer = null, this.yieldNode(t)) : (this.buffer = t.context, this.yieldBuf(t.index, t.type)) : false;
  }
  toString() {
    return this.buffer ? this.buffer.buffer.childString(this.index) : this._tree.toString();
  }
  enterChild(t, e, r) {
    if (!this.buffer)
      return this.yield(this._tree.nextChild(t < 0 ? this._tree._tree.children.length - 1 : 0, t, e, r, this.mode));
    let { buffer: i } = this.buffer, n = i.findChild(this.index + 4, i.buffer[this.index + 3], t, e - this.buffer.start, r);
    return n < 0 ? false : (this.stack.push(this.index), this.yieldBuf(n));
  }
  firstChild() {
    return this.enterChild(1, 0, 4);
  }
  lastChild() {
    return this.enterChild(-1, 0, 4);
  }
  childAfter(t) {
    return this.enterChild(1, t, 2);
  }
  childBefore(t) {
    return this.enterChild(-1, t, -2);
  }
  enter(t, e, r = this.mode) {
    return this.buffer ? r & B.ExcludeBuffers ? false : this.enterChild(1, t, e) : this.yield(this._tree.enter(t, e, r));
  }
  parent() {
    if (!this.buffer)
      return this.yieldNode(this.mode & B.IncludeAnonymous ? this._tree._parent : this._tree.parent);
    if (this.stack.length)
      return this.yieldBuf(this.stack.pop());
    let t = this.mode & B.IncludeAnonymous ? this.buffer.parent : this.buffer.parent.nextSignificantParent();
    return this.buffer = null, this.yieldNode(t);
  }
  sibling(t) {
    if (!this.buffer)
      return this._tree._parent ? this.yield(this._tree.index < 0 ? null : this._tree._parent.nextChild(this._tree.index + t, t, 0, 4, this.mode)) : false;
    let { buffer: e } = this.buffer, r = this.stack.length - 1;
    if (t < 0) {
      let i = r < 0 ? 0 : this.stack[r] + 4;
      if (this.index != i)
        return this.yieldBuf(e.findChild(i, this.index, -1, 0, 4));
    } else {
      let i = e.buffer[this.index + 3];
      if (i < (r < 0 ? e.buffer.length : e.buffer[this.stack[r] + 3]))
        return this.yieldBuf(i);
    }
    return r < 0 ? this.yield(this.buffer.parent.nextChild(this.buffer.index + t, t, 0, 4, this.mode)) : false;
  }
  nextSibling() {
    return this.sibling(1);
  }
  prevSibling() {
    return this.sibling(-1);
  }
  atLastNode(t) {
    let e, r, { buffer: i } = this;
    if (i) {
      if (t > 0) {
        if (this.index < i.buffer.buffer.length)
          return false;
      } else
        for (let n = 0; n < this.index; n++)
          if (i.buffer.buffer[n + 3] < this.index)
            return false;
      ({ index: e, parent: r } = i);
    } else
      ({ index: e, _parent: r } = this._tree);
    for (; r; { index: e, _parent: r } = r)
      if (e > -1)
        for (let n = e + t, s = t < 0 ? -1 : r._tree.children.length; n != s; n += t) {
          let o = r._tree.children[n];
          if (this.mode & B.IncludeAnonymous || o instanceof Q || !o.type.isAnonymous || wt(o))
            return false;
        }
    return true;
  }
  move(t, e) {
    if (e && this.enterChild(t, 0, 4))
      return true;
    for (; ; ) {
      if (this.sibling(t))
        return true;
      if (this.atLastNode(t) || !this.parent())
        return false;
    }
  }
  next(t = true) {
    return this.move(1, t);
  }
  prev(t = true) {
    return this.move(-1, t);
  }
  moveTo(t, e = 0) {
    for (; (this.from == this.to || (e < 1 ? this.from >= t : this.from > t) || (e > -1 ? this.to <= t : this.to < t)) && this.parent(); )
      ;
    for (; this.enterChild(1, t, e); )
      ;
    return this;
  }
  get node() {
    if (!this.buffer)
      return this._tree;
    let t = this.bufferNode, e = null, r = 0;
    if (t && t.context == this.buffer)
      t:
        for (let i = this.index, n = this.stack.length; n >= 0; ) {
          for (let s = t; s; s = s._parent)
            if (s.index == i) {
              if (i == this.index)
                return s;
              e = s, r = n + 1;
              break t;
            }
          i = this.stack[--n];
        }
    for (let i = r; i < this.stack.length; i++)
      e = new G(this.buffer, e, this.stack[i]);
    return this.bufferNode = new G(this.buffer, e, this.index);
  }
  get tree() {
    return this.buffer ? null : this._tree._tree;
  }
  iterate(t, e) {
    for (let r = 0; ; ) {
      let i = false;
      if (this.type.isAnonymous || t(this) !== false) {
        if (this.firstChild()) {
          r++;
          continue;
        }
        this.type.isAnonymous || (i = true);
      }
      for (; ; ) {
        if (i && e && e(this), i = this.type.isAnonymous, !r)
          return;
        if (this.nextSibling())
          break;
        this.parent(), r--, i = true;
      }
    }
  }
  matchContext(t) {
    if (!this.buffer)
      return mt(this.node.parent, t);
    let { buffer: e } = this.buffer, { types: r } = e.set;
    for (let i = t.length - 1, n = this.stack.length - 1; i >= 0; n--) {
      if (n < 0)
        return mt(this._tree, t, i);
      let s = r[e.buffer[this.stack[n]]];
      if (!s.isAnonymous) {
        if (t[i] && t[i] != s.name)
          return false;
        i--;
      }
    }
    return true;
  }
}
function wt(l) {
  return l.children.some((t) => t instanceof Q || !t.type.isAnonymous || wt(t));
}
function Dt(l) {
  var t;
  let { buffer: e, nodeSet: r, maxBufferLength: i = 1024, reused: n = [], minRepeatType: s = r.types.length } = l, o = Array.isArray(e) ? new kt(e, e.length) : e, f = r.types, d = 0, m = 0;
  function y(x, w, a, N, b, S) {
    let { id: g, start: u, end: k, size: v } = o, z = m, J = d;
    for (; v < 0; )
      if (o.next(), v == -1) {
        let F = n[g];
        a.push(F), N.push(u - x);
        return;
      } else if (v == -3) {
        d = g;
        return;
      } else if (v == -4) {
        m = g;
        return;
      } else
        throw new RangeError(`Unrecognized record size: ${v}`);
    let et = f[g], nt, X, Ct = u - x;
    if (k - u <= i && (X = T(o.pos - w, b))) {
      let F = new Uint16Array(X.size - X.skip), M = o.pos - X.size, D = F.length;
      for (; o.pos > M; )
        D = j(X.start, F, D);
      nt = new Q(F, k - X.start, r), Ct = X.start - x;
    } else {
      let F = o.pos - v;
      o.next();
      let M = [], D = [], Y = g >= s ? g : -1, tt = 0, st = k;
      for (; o.pos > F; )
        Y >= 0 && o.id == Y && o.size >= 0 ? (o.end <= st - i && (I(M, D, u, tt, o.end, st, Y, z, J), tt = M.length, st = o.end), o.next()) : S > 2500 ? p(u, F, M, D) : y(u, F, M, D, Y, S + 1);
      if (Y >= 0 && tt > 0 && tt < M.length && I(M, D, u, tt, u, st, Y, z, J), M.reverse(), D.reverse(), Y > -1 && tt > 0) {
        let Nt = _(et, J);
        nt = vt(et, M, D, 0, M.length, 0, k - u, Nt, Nt);
      } else
        nt = R(et, M, D, k - u, z - k, J);
    }
    a.push(nt), N.push(Ct);
  }
  function p(x, w, a, N) {
    let b = [], S = 0, g = -1;
    for (; o.pos > w; ) {
      let { id: u, start: k, end: v, size: z } = o;
      if (z > 4)
        o.next();
      else {
        if (g > -1 && k < g)
          break;
        g < 0 && (g = v - i), b.push(u, k, v), S++, o.next();
      }
    }
    if (S) {
      let u = new Uint16Array(S * 4), k = b[b.length - 2];
      for (let v = b.length - 3, z = 0; v >= 0; v -= 3)
        u[z++] = b[v], u[z++] = b[v + 1] - k, u[z++] = b[v + 2] - k, u[z++] = z;
      a.push(new Q(u, b[2] - k, r)), N.push(k - x);
    }
  }
  function _(x, w) {
    return (a, N, b) => {
      let S = 0, g = a.length - 1, u, k;
      if (g >= 0 && (u = a[g]) instanceof q) {
        if (!g && u.type == x && u.length == b)
          return u;
        (k = u.prop(C.lookAhead)) && (S = N[g] + u.length + k);
      }
      return R(x, a, N, b, S, w);
    };
  }
  function I(x, w, a, N, b, S, g, u, k) {
    let v = [], z = [];
    for (; x.length > N; )
      v.push(x.pop()), z.push(w.pop() + a - b);
    x.push(R(r.types[g], v, z, S - b, u - S, k)), w.push(b - a);
  }
  function R(x, w, a, N, b, S, g) {
    if (S) {
      let u = [C.contextHash, S];
      g = g ? [u].concat(g) : [u];
    }
    if (b > 25) {
      let u = [C.lookAhead, b];
      g = g ? [u].concat(g) : [u];
    }
    return new q(x, w, a, N, g);
  }
  function T(x, w) {
    let a = o.fork(), N = 0, b = 0, S = 0, g = a.end - i, u = { size: 0, start: 0, skip: 0 };
    t:
      for (let k = a.pos - x; a.pos > k; ) {
        let v = a.size;
        if (a.id == w && v >= 0) {
          u.size = N, u.start = b, u.skip = S, S += 4, N += 4, a.next();
          continue;
        }
        let z = a.pos - v;
        if (v < 0 || z < k || a.start < g)
          break;
        let J = a.id >= s ? 4 : 0, et = a.start;
        for (a.next(); a.pos > z; ) {
          if (a.size < 0)
            if (a.size == -3)
              J += 4;
            else
              break t;
          else
            a.id >= s && (J += 4);
          a.next();
        }
        b = et, N += v, S += J;
      }
    return (w < 0 || N == x) && (u.size = N, u.start = b, u.skip = S), u.size > 4 ? u : void 0;
  }
  function j(x, w, a) {
    let { id: N, start: b, end: S, size: g } = o;
    if (o.next(), g >= 0 && N < s) {
      let u = a;
      if (g > 4) {
        let k = o.pos - (g - 4);
        for (; o.pos > k; )
          a = j(x, w, a);
      }
      w[--a] = u, w[--a] = S - x, w[--a] = b - x, w[--a] = N;
    } else
      g == -3 ? d = N : g == -4 && (m = N);
    return a;
  }
  let P = [], A = [];
  for (; o.pos > 0; )
    y(l.start || 0, l.bufferStart || 0, P, A, -1, 0);
  let L = (t = l.length) !== null && t !== void 0 ? t : P.length ? A[0] + P[0].length : 0;
  return new q(f[l.topID], P.reverse(), A.reverse(), L);
}
const _t = /* @__PURE__ */ new WeakMap();
function ft(l, t) {
  if (!l.isAnonymous || t instanceof Q || t.type != l)
    return 1;
  let e = _t.get(t);
  if (e == null) {
    e = 1;
    for (let r of t.children) {
      if (r.type != l || !(r instanceof q)) {
        e = 1;
        break;
      }
      e += ft(l, r);
    }
    _t.set(t, e);
  }
  return e;
}
function vt(l, t, e, r, i, n, s, o, f) {
  let d = 0;
  for (let I = r; I < i; I++)
    d += ft(l, t[I]);
  let m = Math.ceil(d * 1.5 / 8), y = [], p = [];
  function _(I, R, T, j, P) {
    for (let A = T; A < j; ) {
      let L = A, x = R[A], w = ft(l, I[A]);
      for (A++; A < j; A++) {
        let a = ft(l, I[A]);
        if (w + a >= m)
          break;
        w += a;
      }
      if (A == L + 1) {
        if (w > m) {
          let a = I[L];
          _(a.children, a.positions, 0, a.children.length, R[L] + P);
          continue;
        }
        y.push(I[L]);
      } else {
        let a = R[A - 1] + I[A - 1].length - x;
        y.push(vt(l, I, R, L, A, x, a, null, f));
      }
      p.push(x + P - n);
    }
  }
  return _(t, e, r, i, 0), (o || f)(y, p, s);
}
class xt {
  constructor(t, e, r, i, n = false, s = false) {
    this.from = t, this.to = e, this.tree = r, this.offset = i, this.open = (n ? 1 : 0) | (s ? 2 : 0);
  }
  get openStart() {
    return (this.open & 1) > 0;
  }
  get openEnd() {
    return (this.open & 2) > 0;
  }
  static addTree(t, e = [], r = false) {
    let i = [new xt(0, t.length, t, 0, false, r)];
    for (let n of e)
      n.to > t.length && i.push(n);
    return i;
  }
  static applyChanges(t, e, r = 128) {
    if (!e.length)
      return t;
    let i = [], n = 1, s = t.length ? t[0] : null;
    for (let o = 0, f = 0, d = 0; ; o++) {
      let m = o < e.length ? e[o] : null, y = m ? m.fromA : 1e9;
      if (y - f >= r)
        for (; s && s.from < y; ) {
          let p = s;
          if (f >= p.from || y <= p.to || d) {
            let _ = Math.max(p.from, f) - d, I = Math.min(p.to, y) - d;
            p = _ >= I ? null : new xt(_, I, p.tree, p.offset + d, o > 0, !!m);
          }
          if (p && i.push(p), s.to > y)
            break;
          s = n < t.length ? t[n++] : null;
        }
      if (!m)
        break;
      f = m.toA, d = m.toA - m.toB;
    }
    return i;
  }
}
class Gt {
  startParse(t, e, r) {
    return typeof t == "string" && (t = new Ht(t)), r = r ? r.length ? r.map((i) => new pt(i.from, i.to)) : [new pt(0, 0)] : [new pt(0, t.length)], this.createParse(t, e || [], r);
  }
  parse(t, e, r) {
    let i = this.startParse(t, e, r);
    for (; ; ) {
      let n = i.advance();
      if (n)
        return n;
    }
  }
}
class Ht {
  constructor(t) {
    this.string = t;
  }
  get length() {
    return this.string.length;
  }
  chunk(t) {
    return this.string.slice(t);
  }
  get lineChunks() {
    return false;
  }
  read(t, e) {
    return this.string.slice(t, e);
  }
}
new C({ perNode: true });
let Ut = 0;
class O {
  constructor(t, e, r, i) {
    this.name = t, this.set = e, this.base = r, this.modified = i, this.id = Ut++;
  }
  toString() {
    let { name: t } = this;
    for (let e of this.modified)
      e.name && (t = `${e.name}(${t})`);
    return t;
  }
  static define(t, e) {
    let r = typeof t == "string" ? t : "?";
    if (t instanceof O && (e = t), e == null ? void 0 : e.base)
      throw new Error("Can not derive from a modified tag");
    let i = new O(r, [], null, []);
    if (i.set.push(i), e)
      for (let n of e.set)
        i.set.push(n);
    return i;
  }
  static defineModifier(t) {
    let e = new ct(t);
    return (r) => r.modified.indexOf(e) > -1 ? r : ct.get(r.base || r, r.modified.concat(e).sort((i, n) => i.id - n.id));
  }
}
let Wt = 0;
class ct {
  constructor(t) {
    this.name = t, this.instances = [], this.id = Wt++;
  }
  static get(t, e) {
    if (!e.length)
      return t;
    let r = e[0].instances.find((o) => o.base == t && qt(e, o.modified));
    if (r)
      return r;
    let i = [], n = new O(t.name, i, t, e);
    for (let o of e)
      o.instances.push(n);
    let s = Ft(e);
    for (let o of t.set)
      if (!o.modified.length)
        for (let f of s)
          i.push(ct.get(o, f));
    return n;
  }
}
function qt(l, t) {
  return l.length == t.length && l.every((e, r) => e == t[r]);
}
function Ft(l) {
  let t = [[]];
  for (let e = 0; e < l.length; e++)
    for (let r = 0, i = t.length; r < i; r++)
      t.push(t[r].concat(l[e]));
  return t.sort((e, r) => r.length - e.length);
}
function Qt(l) {
  let t = /* @__PURE__ */ Object.create(null);
  for (let e in l) {
    let r = l[e];
    Array.isArray(r) || (r = [r]);
    for (let i of e.split(" "))
      if (i) {
        let n = [], s = 2, o = i;
        for (let y = 0; ; ) {
          if (o == "..." && y > 0 && y + 3 == i.length) {
            s = 1;
            break;
          }
          let p = /^"(?:[^"\\]|\\.)*?"|[^\/!]+/.exec(o);
          if (!p)
            throw new RangeError("Invalid path: " + i);
          if (n.push(p[0] == "*" ? "" : p[0][0] == '"' ? JSON.parse(p[0]) : p[0]), y += p[0].length, y == i.length)
            break;
          let _ = i[y++];
          if (y == i.length && _ == "!") {
            s = 0;
            break;
          }
          if (_ != "/")
            throw new RangeError("Invalid path: " + i);
          o = i.slice(y);
        }
        let f = n.length - 1, d = n[f];
        if (!d)
          throw new RangeError("Invalid path: " + i);
        let m = new dt(r, s, f > 0 ? n.slice(0, f) : null);
        t[d] = m.sort(t[d]);
      }
  }
  return Ot.add(t);
}
const Ot = new C();
class dt {
  constructor(t, e, r, i) {
    this.tags = t, this.mode = e, this.context = r, this.next = i;
  }
  get opaque() {
    return this.mode == 0;
  }
  get inherit() {
    return this.mode == 1;
  }
  sort(t) {
    return !t || t.depth < this.depth ? (this.next = t, this) : (t.next = this.sort(t.next), t);
  }
  get depth() {
    return this.context ? this.context.length : 0;
  }
}
dt.empty = new dt([], 2, null);
function Kt(l, t) {
  let e = /* @__PURE__ */ Object.create(null);
  for (let n of l)
    if (!Array.isArray(n.tag))
      e[n.tag.id] = n.class;
    else
      for (let s of n.tag)
        e[s.id] = n.class;
  let { scope: r, all: i = null } = t || {};
  return { style: (n) => {
    let s = i;
    for (let o of n)
      for (let f of o.set) {
        let d = e[f.id];
        if (d) {
          s = s ? s + " " + d : d;
          break;
        }
      }
    return s;
  }, scope: r };
}
function Jt(l, t) {
  let e = null;
  for (let r of l) {
    let i = r.style(t);
    i && (e = e ? e + " " + i : i);
  }
  return e;
}
function Xt(l, t, e, r = 0, i = l.length) {
  let n = new Vt(r, Array.isArray(t) ? t : [t], e);
  n.highlightRange(l.cursor(), r, i, "", n.highlighters), n.flush(i);
}
class Vt {
  constructor(t, e, r) {
    this.at = t, this.highlighters = e, this.span = r, this.class = "";
  }
  startSpan(t, e) {
    e != this.class && (this.flush(t), t > this.at && (this.at = t), this.class = e);
  }
  flush(t) {
    t > this.at && this.class && this.span(this.at, t, this.class);
  }
  highlightRange(t, e, r, i, n) {
    let { type: s, from: o, to: f } = t;
    if (o >= r || f <= e)
      return;
    s.isTop && (n = this.highlighters.filter((_) => !_.scope || _.scope(s)));
    let d = i, m = $t(t) || dt.empty, y = Jt(n, m.tags);
    if (y && (d && (d += " "), d += y, m.mode == 1 && (i += (i ? " " : "") + y)), this.startSpan(Math.max(e, o), d), m.opaque)
      return;
    let p = t.tree && t.tree.prop(C.mounted);
    if (p && p.overlay) {
      let _ = t.node.enter(p.overlay[0].from + o, 1), I = this.highlighters.filter((T) => !T.scope || T.scope(p.tree.type)), R = t.firstChild();
      for (let T = 0, j = o; ; T++) {
        let P = T < p.overlay.length ? p.overlay[T] : null, A = P ? P.from + o : f, L = Math.max(e, j), x = Math.min(r, A);
        if (L < x && R)
          for (; t.from < x && (this.highlightRange(t, L, x, i, n), this.startSpan(Math.min(x, t.to), d), !(t.to >= A || !t.nextSibling())); )
            ;
        if (!P || A > r)
          break;
        j = P.to + o, j > e && (this.highlightRange(_.cursor(), Math.max(e, P.from + o), Math.min(r, j), "", I), this.startSpan(Math.min(r, j), d));
      }
      R && t.parent();
    } else if (t.firstChild()) {
      p && (i = "");
      do
        if (!(t.to <= e)) {
          if (t.from >= r)
            break;
          this.highlightRange(t, e, r, i, n), this.startSpan(Math.min(r, t.to), d);
        }
      while (t.nextSibling());
      t.parent();
    }
  }
}
function $t(l) {
  let t = l.type.prop(Ot);
  for (; t && t.context && !l.matchContext(t.context); )
    t = t.next;
  return t || null;
}
const h = O.define, ot = h(), V = h(), It = h(V), zt = h(V), $ = h(), ht = h($), gt = h($), W = h(), Z = h(W), H = h(), U = h(), bt = h(), rt = h(bt), at = h(), c = { comment: ot, lineComment: h(ot), blockComment: h(ot), docComment: h(ot), name: V, variableName: h(V), typeName: It, tagName: h(It), propertyName: zt, attributeName: h(zt), className: h(V), labelName: h(V), namespace: h(V), macroName: h(V), literal: $, string: ht, docString: h(ht), character: h(ht), attributeValue: h(ht), number: gt, integer: h(gt), float: h(gt), bool: h($), regexp: h($), escape: h($), color: h($), url: h($), keyword: H, self: h(H), null: h(H), atom: h(H), unit: h(H), modifier: h(H), operatorKeyword: h(H), controlKeyword: h(H), definitionKeyword: h(H), moduleKeyword: h(H), operator: U, derefOperator: h(U), arithmeticOperator: h(U), logicOperator: h(U), bitwiseOperator: h(U), compareOperator: h(U), updateOperator: h(U), definitionOperator: h(U), typeOperator: h(U), controlOperator: h(U), punctuation: bt, separator: h(bt), bracket: rt, angleBracket: h(rt), squareBracket: h(rt), paren: h(rt), brace: h(rt), content: W, heading: Z, heading1: h(Z), heading2: h(Z), heading3: h(Z), heading4: h(Z), heading5: h(Z), heading6: h(Z), contentSeparator: h(W), list: h(W), quote: h(W), emphasis: h(W), strong: h(W), link: h(W), monospace: h(W), strikethrough: h(W), inserted: h(), deleted: h(), changed: h(), invalid: h(), meta: at, documentMeta: h(at), annotation: h(at), processingInstruction: h(at), definition: O.defineModifier("definition"), constant: O.defineModifier("constant"), function: O.defineModifier("function"), standard: O.defineModifier("standard"), local: O.defineModifier("local"), special: O.defineModifier("special") };
for (let l in c) {
  let t = c[l];
  t instanceof O && (t.name = l);
}
Kt([{ tag: c.link, class: "tok-link" }, { tag: c.heading, class: "tok-heading" }, { tag: c.emphasis, class: "tok-emphasis" }, { tag: c.strong, class: "tok-strong" }, { tag: c.keyword, class: "tok-keyword" }, { tag: c.atom, class: "tok-atom" }, { tag: c.bool, class: "tok-bool" }, { tag: c.url, class: "tok-url" }, { tag: c.labelName, class: "tok-labelName" }, { tag: c.inserted, class: "tok-inserted" }, { tag: c.deleted, class: "tok-deleted" }, { tag: c.literal, class: "tok-literal" }, { tag: c.string, class: "tok-string" }, { tag: c.number, class: "tok-number" }, { tag: [c.regexp, c.escape, c.special(c.string)], class: "tok-string2" }, { tag: c.variableName, class: "tok-variableName" }, { tag: c.local(c.variableName), class: "tok-variableName tok-local" }, { tag: c.definition(c.variableName), class: "tok-variableName tok-definition" }, { tag: c.special(c.variableName), class: "tok-variableName2" }, { tag: c.definition(c.propertyName), class: "tok-propertyName tok-definition" }, { tag: c.typeName, class: "tok-typeName" }, { tag: c.namespace, class: "tok-namespace" }, { tag: c.className, class: "tok-className" }, { tag: c.macroName, class: "tok-macroName" }, { tag: c.propertyName, class: "tok-propertyName" }, { tag: c.operator, class: "tok-operator" }, { tag: c.comment, class: "tok-comment" }, { tag: c.meta, class: "tok-meta" }, { tag: c.invalid, class: "tok-invalid" }, { tag: c.punctuation, class: "tok-punctuation" }]);
export {
  B as I,
  K as N,
  Gt as P,
  q as T,
  Kt as a,
  C as b,
  xt as c,
  Xt as h,
  Qt as s,
  c as t
};
