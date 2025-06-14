import { _ as a, l as tt, c as H, G as pt, ab as yt, ac as ft, ad as mt, T as _t, E as q, h as j, q as bt, J as Et, U as St, V as at, W as lt } from "./mermaid-j5R1o_wi-141fd499.js";
import "./index-6feda8be.js";
import "./helper-7WMIPux3-736d9956.js";
import "./copy-BS31ARP0-bcf717fb.js";
var Z = function() {
  var i = a(function(k, t, n, r) {
    for (n = n || {}, r = k.length; r--; n[k[r]] = t)
      ;
    return n;
  }, "o"), u = [1, 4], d = [1, 13], s = [1, 12], g = [1, 15], D = [1, 16], S = [1, 20], h = [1, 19], v = [6, 7, 8], _ = [1, 26], b = [1, 24], C = [1, 25], o = [6, 7, 11], M = [1, 31], I = [6, 7, 11, 24], $ = [1, 6, 13, 16, 17, 20, 23], T = [1, 35], G = [1, 36], w = [1, 6, 7, 11, 13, 16, 17, 20, 23], U = [1, 38], y = { trace: a(function() {
  }, "trace"), yy: {}, symbols_: { error: 2, start: 3, mindMap: 4, spaceLines: 5, SPACELINE: 6, NL: 7, KANBAN: 8, document: 9, stop: 10, EOF: 11, statement: 12, SPACELIST: 13, node: 14, shapeData: 15, ICON: 16, CLASS: 17, nodeWithId: 18, nodeWithoutId: 19, NODE_DSTART: 20, NODE_DESCR: 21, NODE_DEND: 22, NODE_ID: 23, SHAPE_DATA: 24, $accept: 0, $end: 1 }, terminals_: { 2: "error", 6: "SPACELINE", 7: "NL", 8: "KANBAN", 11: "EOF", 13: "SPACELIST", 16: "ICON", 17: "CLASS", 20: "NODE_DSTART", 21: "NODE_DESCR", 22: "NODE_DEND", 23: "NODE_ID", 24: "SHAPE_DATA" }, productions_: [0, [3, 1], [3, 2], [5, 1], [5, 2], [5, 2], [4, 2], [4, 3], [10, 1], [10, 1], [10, 1], [10, 2], [10, 2], [9, 3], [9, 2], [12, 3], [12, 2], [12, 2], [12, 2], [12, 1], [12, 2], [12, 1], [12, 1], [12, 1], [12, 1], [14, 1], [14, 1], [19, 3], [18, 1], [18, 4], [15, 2], [15, 1]], performAction: a(function(k, t, n, r, c, e, m) {
    var l = e.length - 1;
    switch (c) {
      case 6:
      case 7:
        return r;
      case 8:
        r.getLogger().trace("Stop NL ");
        break;
      case 9:
        r.getLogger().trace("Stop EOF ");
        break;
      case 11:
        r.getLogger().trace("Stop NL2 ");
        break;
      case 12:
        r.getLogger().trace("Stop EOF2 ");
        break;
      case 15:
        r.getLogger().info("Node: ", e[l - 1].id), r.addNode(e[l - 2].length, e[l - 1].id, e[l - 1].descr, e[l - 1].type, e[l]);
        break;
      case 16:
        r.getLogger().info("Node: ", e[l].id), r.addNode(e[l - 1].length, e[l].id, e[l].descr, e[l].type);
        break;
      case 17:
        r.getLogger().trace("Icon: ", e[l]), r.decorateNode({ icon: e[l] });
        break;
      case 18:
      case 23:
        r.decorateNode({ class: e[l] });
        break;
      case 19:
        r.getLogger().trace("SPACELIST");
        break;
      case 20:
        r.getLogger().trace("Node: ", e[l - 1].id), r.addNode(0, e[l - 1].id, e[l - 1].descr, e[l - 1].type, e[l]);
        break;
      case 21:
        r.getLogger().trace("Node: ", e[l].id), r.addNode(0, e[l].id, e[l].descr, e[l].type);
        break;
      case 22:
        r.decorateNode({ icon: e[l] });
        break;
      case 27:
        r.getLogger().trace("node found ..", e[l - 2]), this.$ = { id: e[l - 1], descr: e[l - 1], type: r.getType(e[l - 2], e[l]) };
        break;
      case 28:
        this.$ = { id: e[l], descr: e[l], type: 0 };
        break;
      case 29:
        r.getLogger().trace("node found ..", e[l - 3]), this.$ = { id: e[l - 3], descr: e[l - 1], type: r.getType(e[l - 2], e[l]) };
        break;
      case 30:
        this.$ = e[l - 1] + e[l];
        break;
      case 31:
        this.$ = e[l];
        break;
    }
  }, "anonymous"), table: [{ 3: 1, 4: 2, 5: 3, 6: [1, 5], 8: u }, { 1: [3] }, { 1: [2, 1] }, { 4: 6, 6: [1, 7], 7: [1, 8], 8: u }, { 6: d, 7: [1, 10], 9: 9, 12: 11, 13: s, 14: 14, 16: g, 17: D, 18: 17, 19: 18, 20: S, 23: h }, i(v, [2, 3]), { 1: [2, 2] }, i(v, [2, 4]), i(v, [2, 5]), { 1: [2, 6], 6: d, 12: 21, 13: s, 14: 14, 16: g, 17: D, 18: 17, 19: 18, 20: S, 23: h }, { 6: d, 9: 22, 12: 11, 13: s, 14: 14, 16: g, 17: D, 18: 17, 19: 18, 20: S, 23: h }, { 6: _, 7: b, 10: 23, 11: C }, i(o, [2, 24], { 18: 17, 19: 18, 14: 27, 16: [1, 28], 17: [1, 29], 20: S, 23: h }), i(o, [2, 19]), i(o, [2, 21], { 15: 30, 24: M }), i(o, [2, 22]), i(o, [2, 23]), i(I, [2, 25]), i(I, [2, 26]), i(I, [2, 28], { 20: [1, 32] }), { 21: [1, 33] }, { 6: _, 7: b, 10: 34, 11: C }, { 1: [2, 7], 6: d, 12: 21, 13: s, 14: 14, 16: g, 17: D, 18: 17, 19: 18, 20: S, 23: h }, i($, [2, 14], { 7: T, 11: G }), i(w, [2, 8]), i(w, [2, 9]), i(w, [2, 10]), i(o, [2, 16], { 15: 37, 24: M }), i(o, [2, 17]), i(o, [2, 18]), i(o, [2, 20], { 24: U }), i(I, [2, 31]), { 21: [1, 39] }, { 22: [1, 40] }, i($, [2, 13], { 7: T, 11: G }), i(w, [2, 11]), i(w, [2, 12]), i(o, [2, 15], { 24: U }), i(I, [2, 30]), { 22: [1, 41] }, i(I, [2, 27]), i(I, [2, 29])], defaultActions: { 2: [2, 1], 6: [2, 2] }, parseError: a(function(k, t) {
    if (t.recoverable)
      this.trace(k);
    else {
      var n = new Error(k);
      throw n.hash = t, n;
    }
  }, "parseError"), parse: a(function(k) {
    var t = this, n = [0], r = [], c = [null], e = [], m = this.table, l = "", W = 0, nt = 0, ht = 2, st = 1, ut = e.slice.call(arguments, 1), f = Object.create(this.lexer), P = { yy: {} };
    for (var X in this.yy)
      Object.prototype.hasOwnProperty.call(this.yy, X) && (P.yy[X] = this.yy[X]);
    f.setInput(k, P.yy), P.yy.lexer = f, P.yy.parser = this, typeof f.yylloc > "u" && (f.yylloc = {});
    var Y = f.yylloc;
    e.push(Y);
    var gt = f.options && f.options.ranges;
    typeof P.yy.parseError == "function" ? this.parseError = P.yy.parseError : this.parseError = Object.getPrototypeOf(this).parseError;
    function dt(N) {
      n.length = n.length - 2 * N, c.length = c.length - N, e.length = e.length - N;
    }
    a(dt, "popStack");
    function rt() {
      var N;
      return N = r.pop() || f.lex() || st, typeof N != "number" && (N instanceof Array && (r = N, N = r.pop()), N = t.symbols_[N] || N), N;
    }
    a(rt, "lex");
    for (var E, B, x, J, F = {}, z, A, ot, V; ; ) {
      if (B = n[n.length - 1], this.defaultActions[B] ? x = this.defaultActions[B] : ((E === null || typeof E > "u") && (E = rt()), x = m[B] && m[B][E]), typeof x > "u" || !x.length || !x[0]) {
        var K = "";
        V = [];
        for (z in m[B])
          this.terminals_[z] && z > ht && V.push("'" + this.terminals_[z] + "'");
        f.showPosition ? K = "Parse error on line " + (W + 1) + `:
` + f.showPosition() + `
Expecting ` + V.join(", ") + ", got '" + (this.terminals_[E] || E) + "'" : K = "Parse error on line " + (W + 1) + ": Unexpected " + (E == st ? "end of input" : "'" + (this.terminals_[E] || E) + "'"), this.parseError(K, { text: f.match, token: this.terminals_[E] || E, line: f.yylineno, loc: Y, expected: V });
      }
      if (x[0] instanceof Array && x.length > 1)
        throw new Error("Parse Error: multiple actions possible at state: " + B + ", token: " + E);
      switch (x[0]) {
        case 1:
          n.push(E), c.push(f.yytext), e.push(f.yylloc), n.push(x[1]), E = null, nt = f.yyleng, l = f.yytext, W = f.yylineno, Y = f.yylloc;
          break;
        case 2:
          if (A = this.productions_[x[1]][1], F.$ = c[c.length - A], F._$ = { first_line: e[e.length - (A || 1)].first_line, last_line: e[e.length - 1].last_line, first_column: e[e.length - (A || 1)].first_column, last_column: e[e.length - 1].last_column }, gt && (F._$.range = [e[e.length - (A || 1)].range[0], e[e.length - 1].range[1]]), J = this.performAction.apply(F, [l, nt, W, P.yy, x[1], c, e].concat(ut)), typeof J < "u")
            return J;
          A && (n = n.slice(0, -1 * A * 2), c = c.slice(0, -1 * A), e = e.slice(0, -1 * A)), n.push(this.productions_[x[1]][0]), c.push(F.$), e.push(F._$), ot = m[n[n.length - 2]][n[n.length - 1]], n.push(ot);
          break;
        case 3:
          return true;
      }
    }
    return true;
  }, "parse") }, R = function() {
    var k = { EOF: 1, parseError: a(function(t, n) {
      if (this.yy.parser)
        this.yy.parser.parseError(t, n);
      else
        throw new Error(t);
    }, "parseError"), setInput: a(function(t, n) {
      return this.yy = n || this.yy || {}, this._input = t, this._more = this._backtrack = this.done = false, this.yylineno = this.yyleng = 0, this.yytext = this.matched = this.match = "", this.conditionStack = ["INITIAL"], this.yylloc = { first_line: 1, first_column: 0, last_line: 1, last_column: 0 }, this.options.ranges && (this.yylloc.range = [0, 0]), this.offset = 0, this;
    }, "setInput"), input: a(function() {
      var t = this._input[0];
      this.yytext += t, this.yyleng++, this.offset++, this.match += t, this.matched += t;
      var n = t.match(/(?:\r\n?|\n).*/g);
      return n ? (this.yylineno++, this.yylloc.last_line++) : this.yylloc.last_column++, this.options.ranges && this.yylloc.range[1]++, this._input = this._input.slice(1), t;
    }, "input"), unput: a(function(t) {
      var n = t.length, r = t.split(/(?:\r\n?|\n)/g);
      this._input = t + this._input, this.yytext = this.yytext.substr(0, this.yytext.length - n), this.offset -= n;
      var c = this.match.split(/(?:\r\n?|\n)/g);
      this.match = this.match.substr(0, this.match.length - 1), this.matched = this.matched.substr(0, this.matched.length - 1), r.length - 1 && (this.yylineno -= r.length - 1);
      var e = this.yylloc.range;
      return this.yylloc = { first_line: this.yylloc.first_line, last_line: this.yylineno + 1, first_column: this.yylloc.first_column, last_column: r ? (r.length === c.length ? this.yylloc.first_column : 0) + c[c.length - r.length].length - r[0].length : this.yylloc.first_column - n }, this.options.ranges && (this.yylloc.range = [e[0], e[0] + this.yyleng - n]), this.yyleng = this.yytext.length, this;
    }, "unput"), more: a(function() {
      return this._more = true, this;
    }, "more"), reject: a(function() {
      if (this.options.backtrack_lexer)
        this._backtrack = true;
      else
        return this.parseError("Lexical error on line " + (this.yylineno + 1) + `. You can only invoke reject() in the lexer when the lexer is of the backtracking persuasion (options.backtrack_lexer = true).
` + this.showPosition(), { text: "", token: null, line: this.yylineno });
      return this;
    }, "reject"), less: a(function(t) {
      this.unput(this.match.slice(t));
    }, "less"), pastInput: a(function() {
      var t = this.matched.substr(0, this.matched.length - this.match.length);
      return (t.length > 20 ? "..." : "") + t.substr(-20).replace(/\n/g, "");
    }, "pastInput"), upcomingInput: a(function() {
      var t = this.match;
      return t.length < 20 && (t += this._input.substr(0, 20 - t.length)), (t.substr(0, 20) + (t.length > 20 ? "..." : "")).replace(/\n/g, "");
    }, "upcomingInput"), showPosition: a(function() {
      var t = this.pastInput(), n = new Array(t.length + 1).join("-");
      return t + this.upcomingInput() + `
` + n + "^";
    }, "showPosition"), test_match: a(function(t, n) {
      var r, c, e;
      if (this.options.backtrack_lexer && (e = { yylineno: this.yylineno, yylloc: { first_line: this.yylloc.first_line, last_line: this.last_line, first_column: this.yylloc.first_column, last_column: this.yylloc.last_column }, yytext: this.yytext, match: this.match, matches: this.matches, matched: this.matched, yyleng: this.yyleng, offset: this.offset, _more: this._more, _input: this._input, yy: this.yy, conditionStack: this.conditionStack.slice(0), done: this.done }, this.options.ranges && (e.yylloc.range = this.yylloc.range.slice(0))), c = t[0].match(/(?:\r\n?|\n).*/g), c && (this.yylineno += c.length), this.yylloc = { first_line: this.yylloc.last_line, last_line: this.yylineno + 1, first_column: this.yylloc.last_column, last_column: c ? c[c.length - 1].length - c[c.length - 1].match(/\r?\n?/)[0].length : this.yylloc.last_column + t[0].length }, this.yytext += t[0], this.match += t[0], this.matches = t, this.yyleng = this.yytext.length, this.options.ranges && (this.yylloc.range = [this.offset, this.offset += this.yyleng]), this._more = false, this._backtrack = false, this._input = this._input.slice(t[0].length), this.matched += t[0], r = this.performAction.call(this, this.yy, this, n, this.conditionStack[this.conditionStack.length - 1]), this.done && this._input && (this.done = false), r)
        return r;
      if (this._backtrack) {
        for (var m in e)
          this[m] = e[m];
        return false;
      }
      return false;
    }, "test_match"), next: a(function() {
      if (this.done)
        return this.EOF;
      this._input || (this.done = true);
      var t, n, r, c;
      this._more || (this.yytext = "", this.match = "");
      for (var e = this._currentRules(), m = 0; m < e.length; m++)
        if (r = this._input.match(this.rules[e[m]]), r && (!n || r[0].length > n[0].length)) {
          if (n = r, c = m, this.options.backtrack_lexer) {
            if (t = this.test_match(r, e[m]), t !== false)
              return t;
            if (this._backtrack) {
              n = false;
              continue;
            } else
              return false;
          } else if (!this.options.flex)
            break;
        }
      return n ? (t = this.test_match(n, e[c]), t !== false ? t : false) : this._input === "" ? this.EOF : this.parseError("Lexical error on line " + (this.yylineno + 1) + `. Unrecognized text.
` + this.showPosition(), { text: "", token: null, line: this.yylineno });
    }, "next"), lex: a(function() {
      var t = this.next();
      return t || this.lex();
    }, "lex"), begin: a(function(t) {
      this.conditionStack.push(t);
    }, "begin"), popState: a(function() {
      var t = this.conditionStack.length - 1;
      return t > 0 ? this.conditionStack.pop() : this.conditionStack[0];
    }, "popState"), _currentRules: a(function() {
      return this.conditionStack.length && this.conditionStack[this.conditionStack.length - 1] ? this.conditions[this.conditionStack[this.conditionStack.length - 1]].rules : this.conditions.INITIAL.rules;
    }, "_currentRules"), topState: a(function(t) {
      return t = this.conditionStack.length - 1 - Math.abs(t || 0), t >= 0 ? this.conditionStack[t] : "INITIAL";
    }, "topState"), pushState: a(function(t) {
      this.begin(t);
    }, "pushState"), stateStackSize: a(function() {
      return this.conditionStack.length;
    }, "stateStackSize"), options: { "case-insensitive": true }, performAction: a(function(t, n, r, c) {
      switch (r) {
        case 0:
          return this.pushState("shapeData"), n.yytext = "", 24;
        case 1:
          return this.pushState("shapeDataStr"), 24;
        case 2:
          return this.popState(), 24;
        case 3:
          const e = /\n\s*/g;
          return n.yytext = n.yytext.replace(e, "<br/>"), 24;
        case 4:
          return 24;
        case 5:
          this.popState();
          break;
        case 6:
          return t.getLogger().trace("Found comment", n.yytext), 6;
        case 7:
          return 8;
        case 8:
          this.begin("CLASS");
          break;
        case 9:
          return this.popState(), 17;
        case 10:
          this.popState();
          break;
        case 11:
          t.getLogger().trace("Begin icon"), this.begin("ICON");
          break;
        case 12:
          return t.getLogger().trace("SPACELINE"), 6;
        case 13:
          return 7;
        case 14:
          return 16;
        case 15:
          t.getLogger().trace("end icon"), this.popState();
          break;
        case 16:
          return t.getLogger().trace("Exploding node"), this.begin("NODE"), 20;
        case 17:
          return t.getLogger().trace("Cloud"), this.begin("NODE"), 20;
        case 18:
          return t.getLogger().trace("Explosion Bang"), this.begin("NODE"), 20;
        case 19:
          return t.getLogger().trace("Cloud Bang"), this.begin("NODE"), 20;
        case 20:
          return this.begin("NODE"), 20;
        case 21:
          return this.begin("NODE"), 20;
        case 22:
          return this.begin("NODE"), 20;
        case 23:
          return this.begin("NODE"), 20;
        case 24:
          return 13;
        case 25:
          return 23;
        case 26:
          return 11;
        case 27:
          this.begin("NSTR2");
          break;
        case 28:
          return "NODE_DESCR";
        case 29:
          this.popState();
          break;
        case 30:
          t.getLogger().trace("Starting NSTR"), this.begin("NSTR");
          break;
        case 31:
          return t.getLogger().trace("description:", n.yytext), "NODE_DESCR";
        case 32:
          this.popState();
          break;
        case 33:
          return this.popState(), t.getLogger().trace("node end ))"), "NODE_DEND";
        case 34:
          return this.popState(), t.getLogger().trace("node end )"), "NODE_DEND";
        case 35:
          return this.popState(), t.getLogger().trace("node end ...", n.yytext), "NODE_DEND";
        case 36:
          return this.popState(), t.getLogger().trace("node end (("), "NODE_DEND";
        case 37:
          return this.popState(), t.getLogger().trace("node end (-"), "NODE_DEND";
        case 38:
          return this.popState(), t.getLogger().trace("node end (-"), "NODE_DEND";
        case 39:
          return this.popState(), t.getLogger().trace("node end (("), "NODE_DEND";
        case 40:
          return this.popState(), t.getLogger().trace("node end (("), "NODE_DEND";
        case 41:
          return t.getLogger().trace("Long description:", n.yytext), 21;
        case 42:
          return t.getLogger().trace("Long description:", n.yytext), 21;
      }
    }, "anonymous"), rules: [/^(?:@\{)/i, /^(?:["])/i, /^(?:["])/i, /^(?:[^\"]+)/i, /^(?:[^}^"]+)/i, /^(?:\})/i, /^(?:\s*%%.*)/i, /^(?:kanban\b)/i, /^(?::::)/i, /^(?:.+)/i, /^(?:\n)/i, /^(?:::icon\()/i, /^(?:[\s]+[\n])/i, /^(?:[\n]+)/i, /^(?:[^\)]+)/i, /^(?:\))/i, /^(?:-\))/i, /^(?:\(-)/i, /^(?:\)\))/i, /^(?:\))/i, /^(?:\(\()/i, /^(?:\{\{)/i, /^(?:\()/i, /^(?:\[)/i, /^(?:[\s]+)/i, /^(?:[^\(\[\n\)\{\}@]+)/i, /^(?:$)/i, /^(?:["][`])/i, /^(?:[^`"]+)/i, /^(?:[`]["])/i, /^(?:["])/i, /^(?:[^"]+)/i, /^(?:["])/i, /^(?:[\)]\))/i, /^(?:[\)])/i, /^(?:[\]])/i, /^(?:\}\})/i, /^(?:\(-)/i, /^(?:-\))/i, /^(?:\(\()/i, /^(?:\()/i, /^(?:[^\)\]\(\}]+)/i, /^(?:.+(?!\(\())/i], conditions: { shapeDataEndBracket: { rules: [], inclusive: false }, shapeDataStr: { rules: [2, 3], inclusive: false }, shapeData: { rules: [1, 4, 5], inclusive: false }, CLASS: { rules: [9, 10], inclusive: false }, ICON: { rules: [14, 15], inclusive: false }, NSTR2: { rules: [28, 29], inclusive: false }, NSTR: { rules: [31, 32], inclusive: false }, NODE: { rules: [27, 30, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42], inclusive: false }, INITIAL: { rules: [0, 6, 7, 8, 11, 12, 13, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26], inclusive: true } } };
    return k;
  }();
  y.lexer = R;
  function O() {
    this.yy = {};
  }
  return a(O, "Parser"), O.prototype = y, y.Parser = O, new O();
}();
Z.parser = Z;
var kt = Z, L = [], et = [], Q = 0, it = {}, Nt = a(() => {
  L = [], et = [], Q = 0, it = {};
}, "clear"), Dt = a((i) => {
  if (L.length === 0)
    return null;
  const u = L[0].level;
  let d = null;
  for (let s = L.length - 1; s >= 0; s--)
    if (L[s].level === u && !d && (d = L[s]), L[s].level < u)
      throw new Error('Items without section detected, found section ("' + L[s].label + '")');
  return i === (d == null ? void 0 : d.level) ? null : d;
}, "getSection"), ct = a(function() {
  return et;
}, "getSections"), xt = a(function() {
  const i = [], u = [], d = ct(), s = H();
  for (const g of d) {
    const D = { id: g.id, label: j(g.label ?? "", s), isGroup: true, ticket: g.ticket, shape: "kanbanSection", level: g.level, look: s.look };
    u.push(D);
    const S = L.filter((h) => h.parentId === g.id);
    for (const h of S) {
      const v = { id: h.id, parentId: g.id, label: j(h.label ?? "", s), isGroup: false, ticket: h == null ? void 0 : h.ticket, priority: h == null ? void 0 : h.priority, assigned: h == null ? void 0 : h.assigned, icon: h == null ? void 0 : h.icon, shape: "kanbanItem", level: h.level, rx: 5, ry: 5, cssStyles: ["text-align: left"] };
      u.push(v);
    }
  }
  return { nodes: u, edges: i, other: {}, config: H() };
}, "getData"), Lt = a((i, u, d, s, g) => {
  var D, S;
  const h = H();
  let v = ((D = h.mindmap) == null ? void 0 : D.padding) ?? q.mindmap.padding;
  switch (s) {
    case p.ROUNDED_RECT:
    case p.RECT:
    case p.HEXAGON:
      v *= 2;
  }
  const _ = { id: j(u, h) || "kbn" + Q++, level: i, label: j(d, h), width: ((S = h.mindmap) == null ? void 0 : S.maxNodeWidth) ?? q.mindmap.maxNodeWidth, padding: v, isGroup: false };
  if (g !== void 0) {
    let C;
    g.includes(`
`) ? C = g + `
` : C = `{
` + g + `
}`;
    const o = bt(C, { schema: Et });
    if (o.shape && (o.shape !== o.shape.toLowerCase() || o.shape.includes("_")))
      throw new Error(`No such shape: ${o.shape}. Shape names should be lowercase.`);
    o != null && o.shape && o.shape === "kanbanItem" && (_.shape = o == null ? void 0 : o.shape), o != null && o.label && (_.label = o == null ? void 0 : o.label), o != null && o.icon && (_.icon = o == null ? void 0 : o.icon.toString()), o != null && o.assigned && (_.assigned = o == null ? void 0 : o.assigned.toString()), o != null && o.ticket && (_.ticket = o == null ? void 0 : o.ticket.toString()), o != null && o.priority && (_.priority = o == null ? void 0 : o.priority);
  }
  const b = Dt(i);
  b ? _.parentId = b.id || "kbn" + Q++ : et.push(_), L.push(_);
}, "addNode"), p = { DEFAULT: 0, NO_BORDER: 0, ROUNDED_RECT: 1, RECT: 2, CIRCLE: 3, CLOUD: 4, BANG: 5, HEXAGON: 6 }, vt = a((i, u) => {
  switch (tt.debug("In get type", i, u), i) {
    case "[":
      return p.RECT;
    case "(":
      return u === ")" ? p.ROUNDED_RECT : p.CLOUD;
    case "((":
      return p.CIRCLE;
    case ")":
      return p.CLOUD;
    case "))":
      return p.BANG;
    case "{{":
      return p.HEXAGON;
    default:
      return p.DEFAULT;
  }
}, "getType"), Ot = a((i, u) => {
  it[i] = u;
}, "setElementForId"), Ct = a((i) => {
  if (!i)
    return;
  const u = H(), d = L[L.length - 1];
  i.icon && (d.icon = j(i.icon, u)), i.class && (d.cssClasses = j(i.class, u));
}, "decorateNode"), It = a((i) => {
  switch (i) {
    case p.DEFAULT:
      return "no-border";
    case p.RECT:
      return "rect";
    case p.ROUNDED_RECT:
      return "rounded-rect";
    case p.CIRCLE:
      return "circle";
    case p.CLOUD:
      return "cloud";
    case p.BANG:
      return "bang";
    case p.HEXAGON:
      return "hexgon";
    default:
      return "no-border";
  }
}, "type2Str"), wt = a(() => tt, "getLogger"), At = a((i) => it[i], "getElementById"), $t = { clear: Nt, addNode: Lt, getSections: ct, getData: xt, nodeType: p, getType: vt, setElementForId: Ot, decorateNode: Ct, type2Str: It, getLogger: wt, getElementById: At }, Tt = $t, Rt = a(async (i, u, d, s) => {
  var g, D, S, h, v;
  tt.debug(`Rendering kanban diagram
` + i);
  const _ = s.db.getData(), b = H();
  b.htmlLabels = false;
  const C = pt(u), o = C.append("g");
  o.attr("class", "sections");
  const M = C.append("g");
  M.attr("class", "items");
  const I = _.nodes.filter((y) => y.isGroup);
  let $ = 0;
  const T = 10, G = [];
  let w = 25;
  for (const y of I) {
    const R = ((g = b == null ? void 0 : b.kanban) == null ? void 0 : g.sectionWidth) || 200;
    $ = $ + 1, y.x = R * $ + ($ - 1) * T / 2, y.width = R, y.y = 0, y.height = R * 3, y.rx = 5, y.ry = 5, y.cssClasses = y.cssClasses + " section-" + $;
    const O = await yt(o, y);
    w = Math.max(w, (D = O == null ? void 0 : O.labelBBox) == null ? void 0 : D.height), G.push(O);
  }
  let U = 0;
  for (const y of I) {
    const R = G[U];
    U = U + 1;
    const O = ((S = b == null ? void 0 : b.kanban) == null ? void 0 : S.sectionWidth) || 200, k = -O * 3 / 2 + w;
    let t = k;
    const n = _.nodes.filter((e) => e.parentId === y.id);
    for (const e of n) {
      if (e.isGroup)
        throw new Error("Groups within groups are not allowed in Kanban diagrams");
      e.x = y.x, e.width = O - 1.5 * T;
      const m = (await ft(M, e, { config: b })).node().getBBox();
      e.y = t + m.height / 2, await mt(e), t = e.y + m.height / 2 + T / 2;
    }
    const r = R.cluster.select("rect"), c = Math.max(t - k + 3 * T, 50) + (w - 25);
    r.attr("height", c);
  }
  _t(void 0, C, ((h = b.mindmap) == null ? void 0 : h.padding) ?? q.kanban.padding, ((v = b.mindmap) == null ? void 0 : v.useMaxWidth) ?? q.kanban.useMaxWidth);
}, "draw"), Pt = { draw: Rt }, Bt = a((i) => {
  let u = "";
  for (let s = 0; s < i.THEME_COLOR_LIMIT; s++)
    i["lineColor" + s] = i["lineColor" + s] || i["cScaleInv" + s], St(i["lineColor" + s]) ? i["lineColor" + s] = at(i["lineColor" + s], 20) : i["lineColor" + s] = lt(i["lineColor" + s], 20);
  const d = a((s, g) => i.darkMode ? lt(s, g) : at(s, g), "adjuster");
  for (let s = 0; s < i.THEME_COLOR_LIMIT; s++) {
    const g = "" + (17 - 3 * s);
    u += `
    .section-${s - 1} rect, .section-${s - 1} path, .section-${s - 1} circle, .section-${s - 1} polygon, .section-${s - 1} path  {
      fill: ${d(i["cScale" + s], 10)};
      stroke: ${d(i["cScale" + s], 10)};

    }
    .section-${s - 1} text {
     fill: ${i["cScaleLabel" + s]};
    }
    .node-icon-${s - 1} {
      font-size: 40px;
      color: ${i["cScaleLabel" + s]};
    }
    .section-edge-${s - 1}{
      stroke: ${i["cScale" + s]};
    }
    .edge-depth-${s - 1}{
      stroke-width: ${g};
    }
    .section-${s - 1} line {
      stroke: ${i["cScaleInv" + s]} ;
      stroke-width: 3;
    }

    .disabled, .disabled circle, .disabled text {
      fill: lightgray;
    }
    .disabled text {
      fill: #efefef;
    }

  .node rect,
  .node circle,
  .node ellipse,
  .node polygon,
  .node path {
    fill: ${i.background};
    stroke: ${i.nodeBorder};
    stroke-width: 1px;
  }

  .kanban-ticket-link {
    fill: ${i.background};
    stroke: ${i.nodeBorder};
    text-decoration: underline;
  }
    `;
  }
  return u;
}, "genSections"), Ut = a((i) => `
  .edge {
    stroke-width: 3;
  }
  ${Bt(i)}
  .section-root rect, .section-root path, .section-root circle, .section-root polygon  {
    fill: ${i.git0};
  }
  .section-root text {
    fill: ${i.gitBranchLabel0};
  }
  .icon-container {
    height:100%;
    display: flex;
    justify-content: center;
    align-items: center;
  }
  .edge {
    fill: none;
  }
  .cluster-label, .label {
    color: ${i.textColor};
    fill: ${i.textColor};
    }
  .kanban-label {
    dy: 1em;
    alignment-baseline: middle;
    text-anchor: middle;
    dominant-baseline: middle;
    text-align: center;
  }
`, "getStyles"), Ft = Ut, Wt = { db: Tt, renderer: Pt, parser: kt, styles: Ft };
export {
  Wt as diagram
};
