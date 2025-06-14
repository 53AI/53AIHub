import { _ as g, c as B, l as L, ak as ce, D as at, af as J, ag as Xt, ah as he, u as tt, ae as ge, P as ue, d as ye, x as pe, z as be, Q as xe, ai as fe, aj as bt, j as me, h as Tt } from "./mermaid-j5R1o_wi-141fd499.js";
import { a as we } from "./clone-CawhnH1Z-b16b00d8.js";
import { L as O } from "./helper-7WMIPux3-736d9956.js";
import { L as Le } from "./graph-BlpFl8hT-b0c4ce28.js";
import { l as Se } from "./channel-BY04PUnR-a45bf446.js";
import "./index-6feda8be.js";
import "./copy-BS31ARP0-bcf717fb.js";
import "./_baseUniq-Bc4pAwPa-cec378bd.js";
var xt = function() {
  var e = g(function(D, c, p, f) {
    for (p = p || {}, f = D.length; f--; p[D[f]] = c)
      ;
    return p;
  }, "o"), t = [1, 7], a = [1, 13], n = [1, 14], s = [1, 15], r = [1, 19], i = [1, 16], o = [1, 17], l = [1, 18], y = [8, 30], u = [8, 21, 28, 29, 30, 31, 32, 40, 44, 47], b = [1, 23], x = [1, 24], S = [8, 15, 16, 21, 28, 29, 30, 31, 32, 40, 44, 47], w = [8, 15, 16, 21, 27, 28, 29, 30, 31, 32, 40, 44, 47], v = [1, 49], k = { trace: g(function() {
  }, "trace"), yy: {}, symbols_: { error: 2, spaceLines: 3, SPACELINE: 4, NL: 5, separator: 6, SPACE: 7, EOF: 8, start: 9, BLOCK_DIAGRAM_KEY: 10, document: 11, stop: 12, statement: 13, link: 14, LINK: 15, START_LINK: 16, LINK_LABEL: 17, STR: 18, nodeStatement: 19, columnsStatement: 20, SPACE_BLOCK: 21, blockStatement: 22, classDefStatement: 23, cssClassStatement: 24, styleStatement: 25, node: 26, SIZE: 27, COLUMNS: 28, "id-block": 29, end: 30, block: 31, NODE_ID: 32, nodeShapeNLabel: 33, dirList: 34, DIR: 35, NODE_DSTART: 36, NODE_DEND: 37, BLOCK_ARROW_START: 38, BLOCK_ARROW_END: 39, classDef: 40, CLASSDEF_ID: 41, CLASSDEF_STYLEOPTS: 42, DEFAULT: 43, class: 44, CLASSENTITY_IDS: 45, STYLECLASS: 46, style: 47, STYLE_ENTITY_IDS: 48, STYLE_DEFINITION_DATA: 49, $accept: 0, $end: 1 }, terminals_: { 2: "error", 4: "SPACELINE", 5: "NL", 7: "SPACE", 8: "EOF", 10: "BLOCK_DIAGRAM_KEY", 15: "LINK", 16: "START_LINK", 17: "LINK_LABEL", 18: "STR", 21: "SPACE_BLOCK", 27: "SIZE", 28: "COLUMNS", 29: "id-block", 30: "end", 31: "block", 32: "NODE_ID", 35: "DIR", 36: "NODE_DSTART", 37: "NODE_DEND", 38: "BLOCK_ARROW_START", 39: "BLOCK_ARROW_END", 40: "classDef", 41: "CLASSDEF_ID", 42: "CLASSDEF_STYLEOPTS", 43: "DEFAULT", 44: "class", 45: "CLASSENTITY_IDS", 46: "STYLECLASS", 47: "style", 48: "STYLE_ENTITY_IDS", 49: "STYLE_DEFINITION_DATA" }, productions_: [0, [3, 1], [3, 2], [3, 2], [6, 1], [6, 1], [6, 1], [9, 3], [12, 1], [12, 1], [12, 2], [12, 2], [11, 1], [11, 2], [14, 1], [14, 4], [13, 1], [13, 1], [13, 1], [13, 1], [13, 1], [13, 1], [13, 1], [19, 3], [19, 2], [19, 1], [20, 1], [22, 4], [22, 3], [26, 1], [26, 2], [34, 1], [34, 2], [33, 3], [33, 4], [23, 3], [23, 3], [24, 3], [25, 3]], performAction: g(function(D, c, p, f, E, d, m) {
    var h = d.length - 1;
    switch (E) {
      case 4:
        f.getLogger().debug("Rule: separator (NL) ");
        break;
      case 5:
        f.getLogger().debug("Rule: separator (Space) ");
        break;
      case 6:
        f.getLogger().debug("Rule: separator (EOF) ");
        break;
      case 7:
        f.getLogger().debug("Rule: hierarchy: ", d[h - 1]), f.setHierarchy(d[h - 1]);
        break;
      case 8:
        f.getLogger().debug("Stop NL ");
        break;
      case 9:
        f.getLogger().debug("Stop EOF ");
        break;
      case 10:
        f.getLogger().debug("Stop NL2 ");
        break;
      case 11:
        f.getLogger().debug("Stop EOF2 ");
        break;
      case 12:
        f.getLogger().debug("Rule: statement: ", d[h]), typeof d[h].length == "number" ? this.$ = d[h] : this.$ = [d[h]];
        break;
      case 13:
        f.getLogger().debug("Rule: statement #2: ", d[h - 1]), this.$ = [d[h - 1]].concat(d[h]);
        break;
      case 14:
        f.getLogger().debug("Rule: link: ", d[h], D), this.$ = { edgeTypeStr: d[h], label: "" };
        break;
      case 15:
        f.getLogger().debug("Rule: LABEL link: ", d[h - 3], d[h - 1], d[h]), this.$ = { edgeTypeStr: d[h], label: d[h - 1] };
        break;
      case 18:
        const I = parseInt(d[h]), M = f.generateId();
        this.$ = { id: M, type: "space", label: "", width: I, children: [] };
        break;
      case 23:
        f.getLogger().debug("Rule: (nodeStatement link node) ", d[h - 2], d[h - 1], d[h], " typestr: ", d[h - 1].edgeTypeStr);
        const z = f.edgeStrToEdgeData(d[h - 1].edgeTypeStr);
        this.$ = [{ id: d[h - 2].id, label: d[h - 2].label, type: d[h - 2].type, directions: d[h - 2].directions }, { id: d[h - 2].id + "-" + d[h].id, start: d[h - 2].id, end: d[h].id, label: d[h - 1].label, type: "edge", directions: d[h].directions, arrowTypeEnd: z, arrowTypeStart: "arrow_open" }, { id: d[h].id, label: d[h].label, type: f.typeStr2Type(d[h].typeStr), directions: d[h].directions }];
        break;
      case 24:
        f.getLogger().debug("Rule: nodeStatement (abc88 node size) ", d[h - 1], d[h]), this.$ = { id: d[h - 1].id, label: d[h - 1].label, type: f.typeStr2Type(d[h - 1].typeStr), directions: d[h - 1].directions, widthInColumns: parseInt(d[h], 10) };
        break;
      case 25:
        f.getLogger().debug("Rule: nodeStatement (node) ", d[h]), this.$ = { id: d[h].id, label: d[h].label, type: f.typeStr2Type(d[h].typeStr), directions: d[h].directions, widthInColumns: 1 };
        break;
      case 26:
        f.getLogger().debug("APA123", this ? this : "na"), f.getLogger().debug("COLUMNS: ", d[h]), this.$ = { type: "column-setting", columns: d[h] === "auto" ? -1 : parseInt(d[h]) };
        break;
      case 27:
        f.getLogger().debug("Rule: id-block statement : ", d[h - 2], d[h - 1]), f.generateId(), this.$ = { ...d[h - 2], type: "composite", children: d[h - 1] };
        break;
      case 28:
        f.getLogger().debug("Rule: blockStatement : ", d[h - 2], d[h - 1], d[h]);
        const X = f.generateId();
        this.$ = { id: X, type: "composite", label: "", children: d[h - 1] };
        break;
      case 29:
        f.getLogger().debug("Rule: node (NODE_ID separator): ", d[h]), this.$ = { id: d[h] };
        break;
      case 30:
        f.getLogger().debug("Rule: node (NODE_ID nodeShapeNLabel separator): ", d[h - 1], d[h]), this.$ = { id: d[h - 1], label: d[h].label, typeStr: d[h].typeStr, directions: d[h].directions };
        break;
      case 31:
        f.getLogger().debug("Rule: dirList: ", d[h]), this.$ = [d[h]];
        break;
      case 32:
        f.getLogger().debug("Rule: dirList: ", d[h - 1], d[h]), this.$ = [d[h - 1]].concat(d[h]);
        break;
      case 33:
        f.getLogger().debug("Rule: nodeShapeNLabel: ", d[h - 2], d[h - 1], d[h]), this.$ = { typeStr: d[h - 2] + d[h], label: d[h - 1] };
        break;
      case 34:
        f.getLogger().debug("Rule: BLOCK_ARROW nodeShapeNLabel: ", d[h - 3], d[h - 2], " #3:", d[h - 1], d[h]), this.$ = { typeStr: d[h - 3] + d[h], label: d[h - 2], directions: d[h - 1] };
        break;
      case 35:
      case 36:
        this.$ = { type: "classDef", id: d[h - 1].trim(), css: d[h].trim() };
        break;
      case 37:
        this.$ = { type: "applyClass", id: d[h - 1].trim(), styleClass: d[h].trim() };
        break;
      case 38:
        this.$ = { type: "applyStyles", id: d[h - 1].trim(), stylesStr: d[h].trim() };
        break;
    }
  }, "anonymous"), table: [{ 9: 1, 10: [1, 2] }, { 1: [3] }, { 11: 3, 13: 4, 19: 5, 20: 6, 21: t, 22: 8, 23: 9, 24: 10, 25: 11, 26: 12, 28: a, 29: n, 31: s, 32: r, 40: i, 44: o, 47: l }, { 8: [1, 20] }, e(y, [2, 12], { 13: 4, 19: 5, 20: 6, 22: 8, 23: 9, 24: 10, 25: 11, 26: 12, 11: 21, 21: t, 28: a, 29: n, 31: s, 32: r, 40: i, 44: o, 47: l }), e(u, [2, 16], { 14: 22, 15: b, 16: x }), e(u, [2, 17]), e(u, [2, 18]), e(u, [2, 19]), e(u, [2, 20]), e(u, [2, 21]), e(u, [2, 22]), e(S, [2, 25], { 27: [1, 25] }), e(u, [2, 26]), { 19: 26, 26: 12, 32: r }, { 11: 27, 13: 4, 19: 5, 20: 6, 21: t, 22: 8, 23: 9, 24: 10, 25: 11, 26: 12, 28: a, 29: n, 31: s, 32: r, 40: i, 44: o, 47: l }, { 41: [1, 28], 43: [1, 29] }, { 45: [1, 30] }, { 48: [1, 31] }, e(w, [2, 29], { 33: 32, 36: [1, 33], 38: [1, 34] }), { 1: [2, 7] }, e(y, [2, 13]), { 26: 35, 32: r }, { 32: [2, 14] }, { 17: [1, 36] }, e(S, [2, 24]), { 11: 37, 13: 4, 14: 22, 15: b, 16: x, 19: 5, 20: 6, 21: t, 22: 8, 23: 9, 24: 10, 25: 11, 26: 12, 28: a, 29: n, 31: s, 32: r, 40: i, 44: o, 47: l }, { 30: [1, 38] }, { 42: [1, 39] }, { 42: [1, 40] }, { 46: [1, 41] }, { 49: [1, 42] }, e(w, [2, 30]), { 18: [1, 43] }, { 18: [1, 44] }, e(S, [2, 23]), { 18: [1, 45] }, { 30: [1, 46] }, e(u, [2, 28]), e(u, [2, 35]), e(u, [2, 36]), e(u, [2, 37]), e(u, [2, 38]), { 37: [1, 47] }, { 34: 48, 35: v }, { 15: [1, 50] }, e(u, [2, 27]), e(w, [2, 33]), { 39: [1, 51] }, { 34: 52, 35: v, 39: [2, 31] }, { 32: [2, 15] }, e(w, [2, 34]), { 39: [2, 32] }], defaultActions: { 20: [2, 7], 23: [2, 14], 50: [2, 15], 52: [2, 32] }, parseError: g(function(D, c) {
    if (c.recoverable)
      this.trace(D);
    else {
      var p = new Error(D);
      throw p.hash = c, p;
    }
  }, "parseError"), parse: g(function(D) {
    var c = this, p = [0], f = [], E = [null], d = [], m = this.table, h = "", I = 0, M = 0, z = 2, X = 1, F = d.slice.call(arguments, 1), A = Object.create(this.lexer), V = { yy: {} };
    for (var gt in this.yy)
      Object.prototype.hasOwnProperty.call(this.yy, gt) && (V.yy[gt] = this.yy[gt]);
    A.setInput(D, V.yy), V.yy.lexer = A, V.yy.parser = this, typeof A.yylloc > "u" && (A.yylloc = {});
    var ut = A.yylloc;
    d.push(ut);
    var le = A.options && A.options.ranges;
    typeof V.yy.parseError == "function" ? this.parseError = V.yy.parseError : this.parseError = Object.getPrototypeOf(this).parseError;
    function de(Y) {
      p.length = p.length - 2 * Y, E.length = E.length - Y, d.length = d.length - Y;
    }
    g(de, "popStack");
    function Dt() {
      var Y;
      return Y = f.pop() || A.lex() || X, typeof Y != "number" && (Y instanceof Array && (f = Y, Y = f.pop()), Y = c.symbols_[Y] || Y), Y;
    }
    g(Dt, "lex");
    for (var W, q, K, yt, Q = {}, it, G, Nt, st; ; ) {
      if (q = p[p.length - 1], this.defaultActions[q] ? K = this.defaultActions[q] : ((W === null || typeof W > "u") && (W = Dt()), K = m[q] && m[q][W]), typeof K > "u" || !K.length || !K[0]) {
        var pt = "";
        st = [];
        for (it in m[q])
          this.terminals_[it] && it > z && st.push("'" + this.terminals_[it] + "'");
        A.showPosition ? pt = "Parse error on line " + (I + 1) + `:
` + A.showPosition() + `
Expecting ` + st.join(", ") + ", got '" + (this.terminals_[W] || W) + "'" : pt = "Parse error on line " + (I + 1) + ": Unexpected " + (W == X ? "end of input" : "'" + (this.terminals_[W] || W) + "'"), this.parseError(pt, { text: A.match, token: this.terminals_[W] || W, line: A.yylineno, loc: ut, expected: st });
      }
      if (K[0] instanceof Array && K.length > 1)
        throw new Error("Parse Error: multiple actions possible at state: " + q + ", token: " + W);
      switch (K[0]) {
        case 1:
          p.push(W), E.push(A.yytext), d.push(A.yylloc), p.push(K[1]), W = null, M = A.yyleng, h = A.yytext, I = A.yylineno, ut = A.yylloc;
          break;
        case 2:
          if (G = this.productions_[K[1]][1], Q.$ = E[E.length - G], Q._$ = { first_line: d[d.length - (G || 1)].first_line, last_line: d[d.length - 1].last_line, first_column: d[d.length - (G || 1)].first_column, last_column: d[d.length - 1].last_column }, le && (Q._$.range = [d[d.length - (G || 1)].range[0], d[d.length - 1].range[1]]), yt = this.performAction.apply(Q, [h, M, I, V.yy, K[1], E, d].concat(F)), typeof yt < "u")
            return yt;
          G && (p = p.slice(0, -1 * G * 2), E = E.slice(0, -1 * G), d = d.slice(0, -1 * G)), p.push(this.productions_[K[1]][0]), E.push(Q.$), d.push(Q._$), Nt = m[p[p.length - 2]][p[p.length - 1]], p.push(Nt);
          break;
        case 3:
          return true;
      }
    }
    return true;
  }, "parse") }, N = function() {
    var D = { EOF: 1, parseError: g(function(c, p) {
      if (this.yy.parser)
        this.yy.parser.parseError(c, p);
      else
        throw new Error(c);
    }, "parseError"), setInput: g(function(c, p) {
      return this.yy = p || this.yy || {}, this._input = c, this._more = this._backtrack = this.done = false, this.yylineno = this.yyleng = 0, this.yytext = this.matched = this.match = "", this.conditionStack = ["INITIAL"], this.yylloc = { first_line: 1, first_column: 0, last_line: 1, last_column: 0 }, this.options.ranges && (this.yylloc.range = [0, 0]), this.offset = 0, this;
    }, "setInput"), input: g(function() {
      var c = this._input[0];
      this.yytext += c, this.yyleng++, this.offset++, this.match += c, this.matched += c;
      var p = c.match(/(?:\r\n?|\n).*/g);
      return p ? (this.yylineno++, this.yylloc.last_line++) : this.yylloc.last_column++, this.options.ranges && this.yylloc.range[1]++, this._input = this._input.slice(1), c;
    }, "input"), unput: g(function(c) {
      var p = c.length, f = c.split(/(?:\r\n?|\n)/g);
      this._input = c + this._input, this.yytext = this.yytext.substr(0, this.yytext.length - p), this.offset -= p;
      var E = this.match.split(/(?:\r\n?|\n)/g);
      this.match = this.match.substr(0, this.match.length - 1), this.matched = this.matched.substr(0, this.matched.length - 1), f.length - 1 && (this.yylineno -= f.length - 1);
      var d = this.yylloc.range;
      return this.yylloc = { first_line: this.yylloc.first_line, last_line: this.yylineno + 1, first_column: this.yylloc.first_column, last_column: f ? (f.length === E.length ? this.yylloc.first_column : 0) + E[E.length - f.length].length - f[0].length : this.yylloc.first_column - p }, this.options.ranges && (this.yylloc.range = [d[0], d[0] + this.yyleng - p]), this.yyleng = this.yytext.length, this;
    }, "unput"), more: g(function() {
      return this._more = true, this;
    }, "more"), reject: g(function() {
      if (this.options.backtrack_lexer)
        this._backtrack = true;
      else
        return this.parseError("Lexical error on line " + (this.yylineno + 1) + `. You can only invoke reject() in the lexer when the lexer is of the backtracking persuasion (options.backtrack_lexer = true).
` + this.showPosition(), { text: "", token: null, line: this.yylineno });
      return this;
    }, "reject"), less: g(function(c) {
      this.unput(this.match.slice(c));
    }, "less"), pastInput: g(function() {
      var c = this.matched.substr(0, this.matched.length - this.match.length);
      return (c.length > 20 ? "..." : "") + c.substr(-20).replace(/\n/g, "");
    }, "pastInput"), upcomingInput: g(function() {
      var c = this.match;
      return c.length < 20 && (c += this._input.substr(0, 20 - c.length)), (c.substr(0, 20) + (c.length > 20 ? "..." : "")).replace(/\n/g, "");
    }, "upcomingInput"), showPosition: g(function() {
      var c = this.pastInput(), p = new Array(c.length + 1).join("-");
      return c + this.upcomingInput() + `
` + p + "^";
    }, "showPosition"), test_match: g(function(c, p) {
      var f, E, d;
      if (this.options.backtrack_lexer && (d = { yylineno: this.yylineno, yylloc: { first_line: this.yylloc.first_line, last_line: this.last_line, first_column: this.yylloc.first_column, last_column: this.yylloc.last_column }, yytext: this.yytext, match: this.match, matches: this.matches, matched: this.matched, yyleng: this.yyleng, offset: this.offset, _more: this._more, _input: this._input, yy: this.yy, conditionStack: this.conditionStack.slice(0), done: this.done }, this.options.ranges && (d.yylloc.range = this.yylloc.range.slice(0))), E = c[0].match(/(?:\r\n?|\n).*/g), E && (this.yylineno += E.length), this.yylloc = { first_line: this.yylloc.last_line, last_line: this.yylineno + 1, first_column: this.yylloc.last_column, last_column: E ? E[E.length - 1].length - E[E.length - 1].match(/\r?\n?/)[0].length : this.yylloc.last_column + c[0].length }, this.yytext += c[0], this.match += c[0], this.matches = c, this.yyleng = this.yytext.length, this.options.ranges && (this.yylloc.range = [this.offset, this.offset += this.yyleng]), this._more = false, this._backtrack = false, this._input = this._input.slice(c[0].length), this.matched += c[0], f = this.performAction.call(this, this.yy, this, p, this.conditionStack[this.conditionStack.length - 1]), this.done && this._input && (this.done = false), f)
        return f;
      if (this._backtrack) {
        for (var m in d)
          this[m] = d[m];
        return false;
      }
      return false;
    }, "test_match"), next: g(function() {
      if (this.done)
        return this.EOF;
      this._input || (this.done = true);
      var c, p, f, E;
      this._more || (this.yytext = "", this.match = "");
      for (var d = this._currentRules(), m = 0; m < d.length; m++)
        if (f = this._input.match(this.rules[d[m]]), f && (!p || f[0].length > p[0].length)) {
          if (p = f, E = m, this.options.backtrack_lexer) {
            if (c = this.test_match(f, d[m]), c !== false)
              return c;
            if (this._backtrack) {
              p = false;
              continue;
            } else
              return false;
          } else if (!this.options.flex)
            break;
        }
      return p ? (c = this.test_match(p, d[E]), c !== false ? c : false) : this._input === "" ? this.EOF : this.parseError("Lexical error on line " + (this.yylineno + 1) + `. Unrecognized text.
` + this.showPosition(), { text: "", token: null, line: this.yylineno });
    }, "next"), lex: g(function() {
      var c = this.next();
      return c || this.lex();
    }, "lex"), begin: g(function(c) {
      this.conditionStack.push(c);
    }, "begin"), popState: g(function() {
      var c = this.conditionStack.length - 1;
      return c > 0 ? this.conditionStack.pop() : this.conditionStack[0];
    }, "popState"), _currentRules: g(function() {
      return this.conditionStack.length && this.conditionStack[this.conditionStack.length - 1] ? this.conditions[this.conditionStack[this.conditionStack.length - 1]].rules : this.conditions.INITIAL.rules;
    }, "_currentRules"), topState: g(function(c) {
      return c = this.conditionStack.length - 1 - Math.abs(c || 0), c >= 0 ? this.conditionStack[c] : "INITIAL";
    }, "topState"), pushState: g(function(c) {
      this.begin(c);
    }, "pushState"), stateStackSize: g(function() {
      return this.conditionStack.length;
    }, "stateStackSize"), options: {}, performAction: g(function(c, p, f, E) {
      switch (f) {
        case 0:
          return 10;
        case 1:
          return c.getLogger().debug("Found space-block"), 31;
        case 2:
          return c.getLogger().debug("Found nl-block"), 31;
        case 3:
          return c.getLogger().debug("Found space-block"), 29;
        case 4:
          c.getLogger().debug(".", p.yytext);
          break;
        case 5:
          c.getLogger().debug("_", p.yytext);
          break;
        case 6:
          return 5;
        case 7:
          return p.yytext = -1, 28;
        case 8:
          return p.yytext = p.yytext.replace(/columns\s+/, ""), c.getLogger().debug("COLUMNS (LEX)", p.yytext), 28;
        case 9:
          this.pushState("md_string");
          break;
        case 10:
          return "MD_STR";
        case 11:
          this.popState();
          break;
        case 12:
          this.pushState("string");
          break;
        case 13:
          c.getLogger().debug("LEX: POPPING STR:", p.yytext), this.popState();
          break;
        case 14:
          return c.getLogger().debug("LEX: STR end:", p.yytext), "STR";
        case 15:
          return p.yytext = p.yytext.replace(/space\:/, ""), c.getLogger().debug("SPACE NUM (LEX)", p.yytext), 21;
        case 16:
          return p.yytext = "1", c.getLogger().debug("COLUMNS (LEX)", p.yytext), 21;
        case 17:
          return 43;
        case 18:
          return "LINKSTYLE";
        case 19:
          return "INTERPOLATE";
        case 20:
          return this.pushState("CLASSDEF"), 40;
        case 21:
          return this.popState(), this.pushState("CLASSDEFID"), "DEFAULT_CLASSDEF_ID";
        case 22:
          return this.popState(), this.pushState("CLASSDEFID"), 41;
        case 23:
          return this.popState(), 42;
        case 24:
          return this.pushState("CLASS"), 44;
        case 25:
          return this.popState(), this.pushState("CLASS_STYLE"), 45;
        case 26:
          return this.popState(), 46;
        case 27:
          return this.pushState("STYLE_STMNT"), 47;
        case 28:
          return this.popState(), this.pushState("STYLE_DEFINITION"), 48;
        case 29:
          return this.popState(), 49;
        case 30:
          return this.pushState("acc_title"), "acc_title";
        case 31:
          return this.popState(), "acc_title_value";
        case 32:
          return this.pushState("acc_descr"), "acc_descr";
        case 33:
          return this.popState(), "acc_descr_value";
        case 34:
          this.pushState("acc_descr_multiline");
          break;
        case 35:
          this.popState();
          break;
        case 36:
          return "acc_descr_multiline_value";
        case 37:
          return 30;
        case 38:
          return this.popState(), c.getLogger().debug("Lex: (("), "NODE_DEND";
        case 39:
          return this.popState(), c.getLogger().debug("Lex: (("), "NODE_DEND";
        case 40:
          return this.popState(), c.getLogger().debug("Lex: ))"), "NODE_DEND";
        case 41:
          return this.popState(), c.getLogger().debug("Lex: (("), "NODE_DEND";
        case 42:
          return this.popState(), c.getLogger().debug("Lex: (("), "NODE_DEND";
        case 43:
          return this.popState(), c.getLogger().debug("Lex: (-"), "NODE_DEND";
        case 44:
          return this.popState(), c.getLogger().debug("Lex: -)"), "NODE_DEND";
        case 45:
          return this.popState(), c.getLogger().debug("Lex: (("), "NODE_DEND";
        case 46:
          return this.popState(), c.getLogger().debug("Lex: ]]"), "NODE_DEND";
        case 47:
          return this.popState(), c.getLogger().debug("Lex: ("), "NODE_DEND";
        case 48:
          return this.popState(), c.getLogger().debug("Lex: ])"), "NODE_DEND";
        case 49:
          return this.popState(), c.getLogger().debug("Lex: /]"), "NODE_DEND";
        case 50:
          return this.popState(), c.getLogger().debug("Lex: /]"), "NODE_DEND";
        case 51:
          return this.popState(), c.getLogger().debug("Lex: )]"), "NODE_DEND";
        case 52:
          return this.popState(), c.getLogger().debug("Lex: )"), "NODE_DEND";
        case 53:
          return this.popState(), c.getLogger().debug("Lex: ]>"), "NODE_DEND";
        case 54:
          return this.popState(), c.getLogger().debug("Lex: ]"), "NODE_DEND";
        case 55:
          return c.getLogger().debug("Lexa: -)"), this.pushState("NODE"), 36;
        case 56:
          return c.getLogger().debug("Lexa: (-"), this.pushState("NODE"), 36;
        case 57:
          return c.getLogger().debug("Lexa: ))"), this.pushState("NODE"), 36;
        case 58:
          return c.getLogger().debug("Lexa: )"), this.pushState("NODE"), 36;
        case 59:
          return c.getLogger().debug("Lex: ((("), this.pushState("NODE"), 36;
        case 60:
          return c.getLogger().debug("Lexa: )"), this.pushState("NODE"), 36;
        case 61:
          return c.getLogger().debug("Lexa: )"), this.pushState("NODE"), 36;
        case 62:
          return c.getLogger().debug("Lexa: )"), this.pushState("NODE"), 36;
        case 63:
          return c.getLogger().debug("Lexc: >"), this.pushState("NODE"), 36;
        case 64:
          return c.getLogger().debug("Lexa: (["), this.pushState("NODE"), 36;
        case 65:
          return c.getLogger().debug("Lexa: )"), this.pushState("NODE"), 36;
        case 66:
          return this.pushState("NODE"), 36;
        case 67:
          return this.pushState("NODE"), 36;
        case 68:
          return this.pushState("NODE"), 36;
        case 69:
          return this.pushState("NODE"), 36;
        case 70:
          return this.pushState("NODE"), 36;
        case 71:
          return this.pushState("NODE"), 36;
        case 72:
          return this.pushState("NODE"), 36;
        case 73:
          return c.getLogger().debug("Lexa: ["), this.pushState("NODE"), 36;
        case 74:
          return this.pushState("BLOCK_ARROW"), c.getLogger().debug("LEX ARR START"), 38;
        case 75:
          return c.getLogger().debug("Lex: NODE_ID", p.yytext), 32;
        case 76:
          return c.getLogger().debug("Lex: EOF", p.yytext), 8;
        case 77:
          this.pushState("md_string");
          break;
        case 78:
          this.pushState("md_string");
          break;
        case 79:
          return "NODE_DESCR";
        case 80:
          this.popState();
          break;
        case 81:
          c.getLogger().debug("Lex: Starting string"), this.pushState("string");
          break;
        case 82:
          c.getLogger().debug("LEX ARR: Starting string"), this.pushState("string");
          break;
        case 83:
          return c.getLogger().debug("LEX: NODE_DESCR:", p.yytext), "NODE_DESCR";
        case 84:
          c.getLogger().debug("LEX POPPING"), this.popState();
          break;
        case 85:
          c.getLogger().debug("Lex: =>BAE"), this.pushState("ARROW_DIR");
          break;
        case 86:
          return p.yytext = p.yytext.replace(/^,\s*/, ""), c.getLogger().debug("Lex (right): dir:", p.yytext), "DIR";
        case 87:
          return p.yytext = p.yytext.replace(/^,\s*/, ""), c.getLogger().debug("Lex (left):", p.yytext), "DIR";
        case 88:
          return p.yytext = p.yytext.replace(/^,\s*/, ""), c.getLogger().debug("Lex (x):", p.yytext), "DIR";
        case 89:
          return p.yytext = p.yytext.replace(/^,\s*/, ""), c.getLogger().debug("Lex (y):", p.yytext), "DIR";
        case 90:
          return p.yytext = p.yytext.replace(/^,\s*/, ""), c.getLogger().debug("Lex (up):", p.yytext), "DIR";
        case 91:
          return p.yytext = p.yytext.replace(/^,\s*/, ""), c.getLogger().debug("Lex (down):", p.yytext), "DIR";
        case 92:
          return p.yytext = "]>", c.getLogger().debug("Lex (ARROW_DIR end):", p.yytext), this.popState(), this.popState(), "BLOCK_ARROW_END";
        case 93:
          return c.getLogger().debug("Lex: LINK", "#" + p.yytext + "#"), 15;
        case 94:
          return c.getLogger().debug("Lex: LINK", p.yytext), 15;
        case 95:
          return c.getLogger().debug("Lex: LINK", p.yytext), 15;
        case 96:
          return c.getLogger().debug("Lex: LINK", p.yytext), 15;
        case 97:
          return c.getLogger().debug("Lex: START_LINK", p.yytext), this.pushState("LLABEL"), 16;
        case 98:
          return c.getLogger().debug("Lex: START_LINK", p.yytext), this.pushState("LLABEL"), 16;
        case 99:
          return c.getLogger().debug("Lex: START_LINK", p.yytext), this.pushState("LLABEL"), 16;
        case 100:
          this.pushState("md_string");
          break;
        case 101:
          return c.getLogger().debug("Lex: Starting string"), this.pushState("string"), "LINK_LABEL";
        case 102:
          return this.popState(), c.getLogger().debug("Lex: LINK", "#" + p.yytext + "#"), 15;
        case 103:
          return this.popState(), c.getLogger().debug("Lex: LINK", p.yytext), 15;
        case 104:
          return this.popState(), c.getLogger().debug("Lex: LINK", p.yytext), 15;
        case 105:
          return c.getLogger().debug("Lex: COLON", p.yytext), p.yytext = p.yytext.slice(1), 27;
      }
    }, "anonymous"), rules: [/^(?:block-beta\b)/, /^(?:block\s+)/, /^(?:block\n+)/, /^(?:block:)/, /^(?:[\s]+)/, /^(?:[\n]+)/, /^(?:((\u000D\u000A)|(\u000A)))/, /^(?:columns\s+auto\b)/, /^(?:columns\s+[\d]+)/, /^(?:["][`])/, /^(?:[^`"]+)/, /^(?:[`]["])/, /^(?:["])/, /^(?:["])/, /^(?:[^"]*)/, /^(?:space[:]\d+)/, /^(?:space\b)/, /^(?:default\b)/, /^(?:linkStyle\b)/, /^(?:interpolate\b)/, /^(?:classDef\s+)/, /^(?:DEFAULT\s+)/, /^(?:\w+\s+)/, /^(?:[^\n]*)/, /^(?:class\s+)/, /^(?:(\w+)+((,\s*\w+)*))/, /^(?:[^\n]*)/, /^(?:style\s+)/, /^(?:(\w+)+((,\s*\w+)*))/, /^(?:[^\n]*)/, /^(?:accTitle\s*:\s*)/, /^(?:(?!\n||)*[^\n]*)/, /^(?:accDescr\s*:\s*)/, /^(?:(?!\n||)*[^\n]*)/, /^(?:accDescr\s*\{\s*)/, /^(?:[\}])/, /^(?:[^\}]*)/, /^(?:end\b\s*)/, /^(?:\(\(\()/, /^(?:\)\)\))/, /^(?:[\)]\))/, /^(?:\}\})/, /^(?:\})/, /^(?:\(-)/, /^(?:-\))/, /^(?:\(\()/, /^(?:\]\])/, /^(?:\()/, /^(?:\]\))/, /^(?:\\\])/, /^(?:\/\])/, /^(?:\)\])/, /^(?:[\)])/, /^(?:\]>)/, /^(?:[\]])/, /^(?:-\))/, /^(?:\(-)/, /^(?:\)\))/, /^(?:\))/, /^(?:\(\(\()/, /^(?:\(\()/, /^(?:\{\{)/, /^(?:\{)/, /^(?:>)/, /^(?:\(\[)/, /^(?:\()/, /^(?:\[\[)/, /^(?:\[\|)/, /^(?:\[\()/, /^(?:\)\)\))/, /^(?:\[\\)/, /^(?:\[\/)/, /^(?:\[\\)/, /^(?:\[)/, /^(?:<\[)/, /^(?:[^\(\[\n\-\)\{\}\s\<\>:]+)/, /^(?:$)/, /^(?:["][`])/, /^(?:["][`])/, /^(?:[^`"]+)/, /^(?:[`]["])/, /^(?:["])/, /^(?:["])/, /^(?:[^"]+)/, /^(?:["])/, /^(?:\]>\s*\()/, /^(?:,?\s*right\s*)/, /^(?:,?\s*left\s*)/, /^(?:,?\s*x\s*)/, /^(?:,?\s*y\s*)/, /^(?:,?\s*up\s*)/, /^(?:,?\s*down\s*)/, /^(?:\)\s*)/, /^(?:\s*[xo<]?--+[-xo>]\s*)/, /^(?:\s*[xo<]?==+[=xo>]\s*)/, /^(?:\s*[xo<]?-?\.+-[xo>]?\s*)/, /^(?:\s*~~[\~]+\s*)/, /^(?:\s*[xo<]?--\s*)/, /^(?:\s*[xo<]?==\s*)/, /^(?:\s*[xo<]?-\.\s*)/, /^(?:["][`])/, /^(?:["])/, /^(?:\s*[xo<]?--+[-xo>]\s*)/, /^(?:\s*[xo<]?==+[=xo>]\s*)/, /^(?:\s*[xo<]?-?\.+-[xo>]?\s*)/, /^(?::\d+)/], conditions: { STYLE_DEFINITION: { rules: [29], inclusive: false }, STYLE_STMNT: { rules: [28], inclusive: false }, CLASSDEFID: { rules: [23], inclusive: false }, CLASSDEF: { rules: [21, 22], inclusive: false }, CLASS_STYLE: { rules: [26], inclusive: false }, CLASS: { rules: [25], inclusive: false }, LLABEL: { rules: [100, 101, 102, 103, 104], inclusive: false }, ARROW_DIR: { rules: [86, 87, 88, 89, 90, 91, 92], inclusive: false }, BLOCK_ARROW: { rules: [77, 82, 85], inclusive: false }, NODE: { rules: [38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 78, 81], inclusive: false }, md_string: { rules: [10, 11, 79, 80], inclusive: false }, space: { rules: [], inclusive: false }, string: { rules: [13, 14, 83, 84], inclusive: false }, acc_descr_multiline: { rules: [35, 36], inclusive: false }, acc_descr: { rules: [33], inclusive: false }, acc_title: { rules: [31], inclusive: false }, INITIAL: { rules: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 15, 16, 17, 18, 19, 20, 24, 27, 30, 32, 34, 37, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 93, 94, 95, 96, 97, 98, 99, 105], inclusive: true } } };
    return D;
  }();
  k.lexer = N;
  function _() {
    this.yy = {};
  }
  return g(_, "Parser"), _.prototype = k, k.Parser = _, new _();
}();
xt.parser = xt;
var ke = xt, U = /* @__PURE__ */ new Map(), St = [], ft = /* @__PURE__ */ new Map(), $t = "color", Ct = "fill", _e = "bgFill", Ft = ",", ve = B(), lt = /* @__PURE__ */ new Map(), Ee = g((e) => me.sanitizeText(e, ve), "sanitizeText"), De = g(function(e, t = "") {
  let a = lt.get(e);
  a || (a = { id: e, styles: [], textStyles: [] }, lt.set(e, a)), t == null ? void 0 : t.split(Ft).forEach((n) => {
    const s = n.replace(/([^;]*);/, "$1").trim();
    if (RegExp($t).exec(n)) {
      const r = s.replace(Ct, _e).replace($t, Ct);
      a.textStyles.push(r);
    }
    a.styles.push(s);
  });
}, "addStyleClass"), Ne = g(function(e, t = "") {
  const a = U.get(e);
  t != null && (a.styles = t.split(Ft));
}, "addStyle2Node"), Te = g(function(e, t) {
  e.split(",").forEach(function(a) {
    let n = U.get(a);
    if (n === void 0) {
      const s = a.trim();
      n = { id: s, type: "na", children: [] }, U.set(s, n);
    }
    n.classes || (n.classes = []), n.classes.push(t);
  });
}, "setCssClass"), Yt = g((e, t) => {
  const a = e.flat(), n = [];
  for (const s of a) {
    if (s.label && (s.label = Ee(s.label)), s.type === "classDef") {
      De(s.id, s.css);
      continue;
    }
    if (s.type === "applyClass") {
      Te(s.id, (s == null ? void 0 : s.styleClass) ?? "");
      continue;
    }
    if (s.type === "applyStyles") {
      s != null && s.stylesStr && Ne(s.id, s == null ? void 0 : s.stylesStr);
      continue;
    }
    if (s.type === "column-setting")
      t.columns = s.columns ?? -1;
    else if (s.type === "edge") {
      const r = (ft.get(s.id) ?? 0) + 1;
      ft.set(s.id, r), s.id = r + "-" + s.id, St.push(s);
    } else {
      s.label || (s.type === "composite" ? s.label = "" : s.label = s.id);
      const r = U.get(s.id);
      if (r === void 0 ? U.set(s.id, s) : (s.type !== "na" && (r.type = s.type), s.label !== s.id && (r.label = s.label)), s.children && Yt(s.children, s), s.type === "space") {
        const i = s.width ?? 1;
        for (let o = 0; o < i; o++) {
          const l = we(s);
          l.id = l.id + "-" + o, U.set(l.id, l), n.push(l);
        }
      } else
        r === void 0 && n.push(s);
    }
  }
  t.children = n;
}, "populateBlockDatabase"), kt = [], rt = { id: "root", type: "composite", children: [], columns: -1 }, $e = g(() => {
  L.debug("Clear called"), pe(), rt = { id: "root", type: "composite", children: [], columns: -1 }, U = /* @__PURE__ */ new Map([["root", rt]]), kt = [], lt = /* @__PURE__ */ new Map(), St = [], ft = /* @__PURE__ */ new Map();
}, "clear");
function Ht(e) {
  switch (L.debug("typeStr2Type", e), e) {
    case "[]":
      return "square";
    case "()":
      return L.debug("we have a round"), "round";
    case "(())":
      return "circle";
    case ">]":
      return "rect_left_inv_arrow";
    case "{}":
      return "diamond";
    case "{{}}":
      return "hexagon";
    case "([])":
      return "stadium";
    case "[[]]":
      return "subroutine";
    case "[()]":
      return "cylinder";
    case "((()))":
      return "doublecircle";
    case "[//]":
      return "lean_right";
    case "[\\\\]":
      return "lean_left";
    case "[/\\]":
      return "trapezoid";
    case "[\\/]":
      return "inv_trapezoid";
    case "<[]>":
      return "block_arrow";
    default:
      return "na";
  }
}
g(Ht, "typeStr2Type");
function Kt(e) {
  switch (L.debug("typeStr2Type", e), e) {
    case "==":
      return "thick";
    default:
      return "normal";
  }
}
g(Kt, "edgeTypeStr2Type");
function jt(e) {
  switch (e.trim()) {
    case "--x":
      return "arrow_cross";
    case "--o":
      return "arrow_circle";
    default:
      return "arrow_point";
  }
}
g(jt, "edgeStrToEdgeData");
var It = 0, Ce = g(() => (It++, "id-" + Math.random().toString(36).substr(2, 12) + "-" + It), "generateId"), Ie = g((e) => {
  rt.children = e, Yt(e, rt), kt = rt.children;
}, "setHierarchy"), Oe = g((e) => {
  const t = U.get(e);
  return t ? t.columns ? t.columns : t.children ? t.children.length : -1 : -1;
}, "getColumns"), Be = g(() => [...U.values()], "getBlocksFlat"), ze = g(() => kt || [], "getBlocks"), Ae = g(() => St, "getEdges"), Re = g((e) => U.get(e), "getBlock"), Me = g((e) => {
  U.set(e.id, e);
}, "setBlock"), Pe = g(() => console, "getLogger"), We = g(function() {
  return lt;
}, "getClasses"), Xe = { getConfig: g(() => at().block, "getConfig"), typeStr2Type: Ht, edgeTypeStr2Type: Kt, edgeStrToEdgeData: jt, getLogger: Pe, getBlocksFlat: Be, getBlocks: ze, getEdges: Ae, setHierarchy: Ie, getBlock: Re, setBlock: Me, getColumns: Oe, getClasses: We, clear: $e, generateId: Ce }, Fe = Xe, nt = g((e, t) => {
  const a = Se, n = a(e, "r"), s = a(e, "g"), r = a(e, "b");
  return be(n, s, r, t);
}, "fade"), Ye = g((e) => `.label {
    font-family: ${e.fontFamily};
    color: ${e.nodeTextColor || e.textColor};
  }
  .cluster-label text {
    fill: ${e.titleColor};
  }
  .cluster-label span,p {
    color: ${e.titleColor};
  }



  .label text,span,p {
    fill: ${e.nodeTextColor || e.textColor};
    color: ${e.nodeTextColor || e.textColor};
  }

  .node rect,
  .node circle,
  .node ellipse,
  .node polygon,
  .node path {
    fill: ${e.mainBkg};
    stroke: ${e.nodeBorder};
    stroke-width: 1px;
  }
  .flowchart-label text {
    text-anchor: middle;
  }
  // .flowchart-label .text-outer-tspan {
  //   text-anchor: middle;
  // }
  // .flowchart-label .text-inner-tspan {
  //   text-anchor: start;
  // }

  .node .label {
    text-align: center;
  }
  .node.clickable {
    cursor: pointer;
  }

  .arrowheadPath {
    fill: ${e.arrowheadColor};
  }

  .edgePath .path {
    stroke: ${e.lineColor};
    stroke-width: 2.0px;
  }

  .flowchart-link {
    stroke: ${e.lineColor};
    fill: none;
  }

  .edgeLabel {
    background-color: ${e.edgeLabelBackground};
    rect {
      opacity: 0.5;
      background-color: ${e.edgeLabelBackground};
      fill: ${e.edgeLabelBackground};
    }
    text-align: center;
  }

  /* For html labels only */
  .labelBkg {
    background-color: ${nt(e.edgeLabelBackground, 0.5)};
    // background-color:
  }

  .node .cluster {
    // fill: ${nt(e.mainBkg, 0.5)};
    fill: ${nt(e.clusterBkg, 0.5)};
    stroke: ${nt(e.clusterBorder, 0.2)};
    box-shadow: rgba(50, 50, 93, 0.25) 0px 13px 27px -5px, rgba(0, 0, 0, 0.3) 0px 8px 16px -8px;
    stroke-width: 1px;
  }

  .cluster text {
    fill: ${e.titleColor};
  }

  .cluster span,p {
    color: ${e.titleColor};
  }
  /* .cluster div {
    color: ${e.titleColor};
  } */

  div.mermaidTooltip {
    position: absolute;
    text-align: center;
    max-width: 200px;
    padding: 2px;
    font-family: ${e.fontFamily};
    font-size: 12px;
    background: ${e.tertiaryColor};
    border: 1px solid ${e.border2};
    border-radius: 2px;
    pointer-events: none;
    z-index: 100;
  }

  .flowchartTitleText {
    text-anchor: middle;
    font-size: 18px;
    fill: ${e.textColor};
  }
`, "getStyles"), He = Ye, Ke = g((e, t, a, n) => {
  t.forEach((s) => {
    er[s](e, a, n);
  });
}, "insertMarkers"), je = g((e, t, a) => {
  L.trace("Making markers for ", a), e.append("defs").append("marker").attr("id", a + "_" + t + "-extensionStart").attr("class", "marker extension " + t).attr("refX", 18).attr("refY", 7).attr("markerWidth", 190).attr("markerHeight", 240).attr("orient", "auto").append("path").attr("d", "M 1,7 L18,13 V 1 Z"), e.append("defs").append("marker").attr("id", a + "_" + t + "-extensionEnd").attr("class", "marker extension " + t).attr("refX", 1).attr("refY", 7).attr("markerWidth", 20).attr("markerHeight", 28).attr("orient", "auto").append("path").attr("d", "M 1,1 V 13 L18,7 Z");
}, "extension"), Ue = g((e, t, a) => {
  e.append("defs").append("marker").attr("id", a + "_" + t + "-compositionStart").attr("class", "marker composition " + t).attr("refX", 18).attr("refY", 7).attr("markerWidth", 190).attr("markerHeight", 240).attr("orient", "auto").append("path").attr("d", "M 18,7 L9,13 L1,7 L9,1 Z"), e.append("defs").append("marker").attr("id", a + "_" + t + "-compositionEnd").attr("class", "marker composition " + t).attr("refX", 1).attr("refY", 7).attr("markerWidth", 20).attr("markerHeight", 28).attr("orient", "auto").append("path").attr("d", "M 18,7 L9,13 L1,7 L9,1 Z");
}, "composition"), Ze = g((e, t, a) => {
  e.append("defs").append("marker").attr("id", a + "_" + t + "-aggregationStart").attr("class", "marker aggregation " + t).attr("refX", 18).attr("refY", 7).attr("markerWidth", 190).attr("markerHeight", 240).attr("orient", "auto").append("path").attr("d", "M 18,7 L9,13 L1,7 L9,1 Z"), e.append("defs").append("marker").attr("id", a + "_" + t + "-aggregationEnd").attr("class", "marker aggregation " + t).attr("refX", 1).attr("refY", 7).attr("markerWidth", 20).attr("markerHeight", 28).attr("orient", "auto").append("path").attr("d", "M 18,7 L9,13 L1,7 L9,1 Z");
}, "aggregation"), Je = g((e, t, a) => {
  e.append("defs").append("marker").attr("id", a + "_" + t + "-dependencyStart").attr("class", "marker dependency " + t).attr("refX", 6).attr("refY", 7).attr("markerWidth", 190).attr("markerHeight", 240).attr("orient", "auto").append("path").attr("d", "M 5,7 L9,13 L1,7 L9,1 Z"), e.append("defs").append("marker").attr("id", a + "_" + t + "-dependencyEnd").attr("class", "marker dependency " + t).attr("refX", 13).attr("refY", 7).attr("markerWidth", 20).attr("markerHeight", 28).attr("orient", "auto").append("path").attr("d", "M 18,7 L9,13 L14,7 L9,1 Z");
}, "dependency"), Ge = g((e, t, a) => {
  e.append("defs").append("marker").attr("id", a + "_" + t + "-lollipopStart").attr("class", "marker lollipop " + t).attr("refX", 13).attr("refY", 7).attr("markerWidth", 190).attr("markerHeight", 240).attr("orient", "auto").append("circle").attr("stroke", "black").attr("fill", "transparent").attr("cx", 7).attr("cy", 7).attr("r", 6), e.append("defs").append("marker").attr("id", a + "_" + t + "-lollipopEnd").attr("class", "marker lollipop " + t).attr("refX", 1).attr("refY", 7).attr("markerWidth", 190).attr("markerHeight", 240).attr("orient", "auto").append("circle").attr("stroke", "black").attr("fill", "transparent").attr("cx", 7).attr("cy", 7).attr("r", 6);
}, "lollipop"), Ve = g((e, t, a) => {
  e.append("marker").attr("id", a + "_" + t + "-pointEnd").attr("class", "marker " + t).attr("viewBox", "0 0 10 10").attr("refX", 6).attr("refY", 5).attr("markerUnits", "userSpaceOnUse").attr("markerWidth", 12).attr("markerHeight", 12).attr("orient", "auto").append("path").attr("d", "M 0 0 L 10 5 L 0 10 z").attr("class", "arrowMarkerPath").style("stroke-width", 1).style("stroke-dasharray", "1,0"), e.append("marker").attr("id", a + "_" + t + "-pointStart").attr("class", "marker " + t).attr("viewBox", "0 0 10 10").attr("refX", 4.5).attr("refY", 5).attr("markerUnits", "userSpaceOnUse").attr("markerWidth", 12).attr("markerHeight", 12).attr("orient", "auto").append("path").attr("d", "M 0 5 L 10 10 L 10 0 z").attr("class", "arrowMarkerPath").style("stroke-width", 1).style("stroke-dasharray", "1,0");
}, "point"), qe = g((e, t, a) => {
  e.append("marker").attr("id", a + "_" + t + "-circleEnd").attr("class", "marker " + t).attr("viewBox", "0 0 10 10").attr("refX", 11).attr("refY", 5).attr("markerUnits", "userSpaceOnUse").attr("markerWidth", 11).attr("markerHeight", 11).attr("orient", "auto").append("circle").attr("cx", "5").attr("cy", "5").attr("r", "5").attr("class", "arrowMarkerPath").style("stroke-width", 1).style("stroke-dasharray", "1,0"), e.append("marker").attr("id", a + "_" + t + "-circleStart").attr("class", "marker " + t).attr("viewBox", "0 0 10 10").attr("refX", -1).attr("refY", 5).attr("markerUnits", "userSpaceOnUse").attr("markerWidth", 11).attr("markerHeight", 11).attr("orient", "auto").append("circle").attr("cx", "5").attr("cy", "5").attr("r", "5").attr("class", "arrowMarkerPath").style("stroke-width", 1).style("stroke-dasharray", "1,0");
}, "circle"), Qe = g((e, t, a) => {
  e.append("marker").attr("id", a + "_" + t + "-crossEnd").attr("class", "marker cross " + t).attr("viewBox", "0 0 11 11").attr("refX", 12).attr("refY", 5.2).attr("markerUnits", "userSpaceOnUse").attr("markerWidth", 11).attr("markerHeight", 11).attr("orient", "auto").append("path").attr("d", "M 1,1 l 9,9 M 10,1 l -9,9").attr("class", "arrowMarkerPath").style("stroke-width", 2).style("stroke-dasharray", "1,0"), e.append("marker").attr("id", a + "_" + t + "-crossStart").attr("class", "marker cross " + t).attr("viewBox", "0 0 11 11").attr("refX", -1).attr("refY", 5.2).attr("markerUnits", "userSpaceOnUse").attr("markerWidth", 11).attr("markerHeight", 11).attr("orient", "auto").append("path").attr("d", "M 1,1 l 9,9 M 10,1 l -9,9").attr("class", "arrowMarkerPath").style("stroke-width", 2).style("stroke-dasharray", "1,0");
}, "cross"), tr = g((e, t, a) => {
  e.append("defs").append("marker").attr("id", a + "_" + t + "-barbEnd").attr("refX", 19).attr("refY", 7).attr("markerWidth", 20).attr("markerHeight", 14).attr("markerUnits", "strokeWidth").attr("orient", "auto").append("path").attr("d", "M 19,7 L9,13 L14,7 L9,1 Z");
}, "barb"), er = { extension: je, composition: Ue, aggregation: Ze, dependency: Je, lollipop: Ge, point: Ve, circle: qe, cross: Qe, barb: tr }, rr = Ke, Ot, Bt, C = ((Bt = (Ot = B()) == null ? void 0 : Ot.block) == null ? void 0 : Bt.padding) ?? 8;
function Ut(e, t) {
  if (e === 0 || !Number.isInteger(e))
    throw new Error("Columns must be an integer !== 0.");
  if (t < 0 || !Number.isInteger(t))
    throw new Error("Position must be a non-negative integer." + t);
  if (e < 0)
    return { px: t, py: 0 };
  if (e === 1)
    return { px: 0, py: t };
  const a = t % e, n = Math.floor(t / e);
  return { px: a, py: n };
}
g(Ut, "calculateBlockPosition");
var ar = g((e) => {
  let t = 0, a = 0;
  for (const n of e.children) {
    const { width: s, height: r, x: i, y: o } = n.size ?? { width: 0, height: 0, x: 0, y: 0 };
    L.debug("getMaxChildSize abc95 child:", n.id, "width:", s, "height:", r, "x:", i, "y:", o, n.type), n.type !== "space" && (s > t && (t = s / (e.widthInColumns ?? 1)), r > a && (a = r));
  }
  return { width: t, height: a };
}, "getMaxChildSize");
function dt(e, t, a = 0, n = 0) {
  var s, r, i, o, l, y, u, b, x, S, w;
  L.debug("setBlockSizes abc95 (start)", e.id, (s = e == null ? void 0 : e.size) == null ? void 0 : s.x, "block width =", e == null ? void 0 : e.size, "sieblingWidth", a), (r = e == null ? void 0 : e.size) != null && r.width || (e.size = { width: a, height: n, x: 0, y: 0 });
  let v = 0, k = 0;
  if (((i = e.children) == null ? void 0 : i.length) > 0) {
    for (const d of e.children)
      dt(d, t);
    const N = ar(e);
    v = N.width, k = N.height, L.debug("setBlockSizes abc95 maxWidth of", e.id, ":s children is ", v, k);
    for (const d of e.children)
      d.size && (L.debug(`abc95 Setting size of children of ${e.id} id=${d.id} ${v} ${k} ${JSON.stringify(d.size)}`), d.size.width = v * (d.widthInColumns ?? 1) + C * ((d.widthInColumns ?? 1) - 1), d.size.height = k, d.size.x = 0, d.size.y = 0, L.debug(`abc95 updating size of ${e.id} children child:${d.id} maxWidth:${v} maxHeight:${k}`));
    for (const d of e.children)
      dt(d, t, v, k);
    const _ = e.columns ?? -1;
    let D = 0;
    for (const d of e.children)
      D += d.widthInColumns ?? 1;
    let c = e.children.length;
    _ > 0 && _ < D && (c = _);
    const p = Math.ceil(D / c);
    let f = c * (v + C) + C, E = p * (k + C) + C;
    if (f < a) {
      L.debug(`Detected to small siebling: abc95 ${e.id} sieblingWidth ${a} sieblingHeight ${n} width ${f}`), f = a, E = n;
      const d = (a - c * C - C) / c, m = (n - p * C - C) / p;
      L.debug("Size indata abc88", e.id, "childWidth", d, "maxWidth", v), L.debug("Size indata abc88", e.id, "childHeight", m, "maxHeight", k), L.debug("Size indata abc88 xSize", c, "padding", C);
      for (const h of e.children)
        h.size && (h.size.width = d, h.size.height = m, h.size.x = 0, h.size.y = 0);
    }
    if (L.debug(`abc95 (finale calc) ${e.id} xSize ${c} ySize ${p} columns ${_}${e.children.length} width=${Math.max(f, ((o = e.size) == null ? void 0 : o.width) || 0)}`), f < (((l = e == null ? void 0 : e.size) == null ? void 0 : l.width) || 0)) {
      f = ((y = e == null ? void 0 : e.size) == null ? void 0 : y.width) || 0;
      const d = _ > 0 ? Math.min(e.children.length, _) : e.children.length;
      if (d > 0) {
        const m = (f - d * C - C) / d;
        L.debug("abc95 (growing to fit) width", e.id, f, (u = e.size) == null ? void 0 : u.width, m);
        for (const h of e.children)
          h.size && (h.size.width = m);
      }
    }
    e.size = { width: f, height: E, x: 0, y: 0 };
  }
  L.debug("setBlockSizes abc94 (done)", e.id, (b = e == null ? void 0 : e.size) == null ? void 0 : b.x, (x = e == null ? void 0 : e.size) == null ? void 0 : x.width, (S = e == null ? void 0 : e.size) == null ? void 0 : S.y, (w = e == null ? void 0 : e.size) == null ? void 0 : w.height);
}
g(dt, "setBlockSizes");
function _t(e, t) {
  var a, n, s, r, i, o, l, y, u, b, x, S, w, v, k, N, _;
  L.debug(`abc85 layout blocks (=>layoutBlocks) ${e.id} x: ${(a = e == null ? void 0 : e.size) == null ? void 0 : a.x} y: ${(n = e == null ? void 0 : e.size) == null ? void 0 : n.y} width: ${(s = e == null ? void 0 : e.size) == null ? void 0 : s.width}`);
  const D = e.columns ?? -1;
  if (L.debug("layoutBlocks columns abc95", e.id, "=>", D, e), e.children && e.children.length > 0) {
    const c = ((i = (r = e == null ? void 0 : e.children[0]) == null ? void 0 : r.size) == null ? void 0 : i.width) ?? 0, p = e.children.length * c + (e.children.length - 1) * C;
    L.debug("widthOfChildren 88", p, "posX");
    let f = 0;
    L.debug("abc91 block?.size?.x", e.id, (o = e == null ? void 0 : e.size) == null ? void 0 : o.x);
    let E = (l = e == null ? void 0 : e.size) != null && l.x ? ((y = e == null ? void 0 : e.size) == null ? void 0 : y.x) + (-((u = e == null ? void 0 : e.size) == null ? void 0 : u.width) / 2 || 0) : -C, d = 0;
    for (const m of e.children) {
      const h = e;
      if (!m.size)
        continue;
      const { width: I, height: M } = m.size, { px: z, py: X } = Ut(D, f);
      if (X != d && (d = X, E = (b = e == null ? void 0 : e.size) != null && b.x ? ((x = e == null ? void 0 : e.size) == null ? void 0 : x.x) + (-((S = e == null ? void 0 : e.size) == null ? void 0 : S.width) / 2 || 0) : -C, L.debug("New row in layout for block", e.id, " and child ", m.id, d)), L.debug(`abc89 layout blocks (child) id: ${m.id} Pos: ${f} (px, py) ${z},${X} (${(w = h == null ? void 0 : h.size) == null ? void 0 : w.x},${(v = h == null ? void 0 : h.size) == null ? void 0 : v.y}) parent: ${h.id} width: ${I}${C}`), h.size) {
        const F = I / 2;
        m.size.x = E + C + F, L.debug(`abc91 layout blocks (calc) px, pyid:${m.id} startingPos=X${E} new startingPosX${m.size.x} ${F} padding=${C} width=${I} halfWidth=${F} => x:${m.size.x} y:${m.size.y} ${m.widthInColumns} (width * (child?.w || 1)) / 2 ${I * ((m == null ? void 0 : m.widthInColumns) ?? 1) / 2}`), E = m.size.x + F, m.size.y = h.size.y - h.size.height / 2 + X * (M + C) + M / 2 + C, L.debug(`abc88 layout blocks (calc) px, pyid:${m.id}startingPosX${E}${C}${F}=>x:${m.size.x}y:${m.size.y}${m.widthInColumns}(width * (child?.w || 1)) / 2${I * ((m == null ? void 0 : m.widthInColumns) ?? 1) / 2}`);
      }
      m.children && _t(m), f += (m == null ? void 0 : m.widthInColumns) ?? 1, L.debug("abc88 columnsPos", m, f);
    }
  }
  L.debug(`layout blocks (<==layoutBlocks) ${e.id} x: ${(k = e == null ? void 0 : e.size) == null ? void 0 : k.x} y: ${(N = e == null ? void 0 : e.size) == null ? void 0 : N.y} width: ${(_ = e == null ? void 0 : e.size) == null ? void 0 : _.width}`);
}
g(_t, "layoutBlocks");
function vt(e, { minX: t, minY: a, maxX: n, maxY: s } = { minX: 0, minY: 0, maxX: 0, maxY: 0 }) {
  if (e.size && e.id !== "root") {
    const { x: r, y: i, width: o, height: l } = e.size;
    r - o / 2 < t && (t = r - o / 2), i - l / 2 < a && (a = i - l / 2), r + o / 2 > n && (n = r + o / 2), i + l / 2 > s && (s = i + l / 2);
  }
  if (e.children)
    for (const r of e.children)
      ({ minX: t, minY: a, maxX: n, maxY: s } = vt(r, { minX: t, minY: a, maxX: n, maxY: s }));
  return { minX: t, minY: a, maxX: n, maxY: s };
}
g(vt, "findBounds");
function Zt(e) {
  const t = e.getBlock("root");
  if (!t)
    return;
  dt(t, e, 0, 0), _t(t), L.debug("getBlocks", JSON.stringify(t, null, 2));
  const { minX: a, minY: n, maxX: s, maxY: r } = vt(t), i = r - n, o = s - a;
  return { x: a, y: n, width: o, height: i };
}
g(Zt, "layout");
function mt(e, t) {
  t && e.attr("style", t);
}
g(mt, "applyStyle");
function Jt(e) {
  const t = O(document.createElementNS("http://www.w3.org/2000/svg", "foreignObject")), a = t.append("xhtml:div"), n = e.label, s = e.isNode ? "nodeLabel" : "edgeLabel", r = a.append("span");
  return r.html(n), mt(r, e.labelStyle), r.attr("class", s), mt(a, e.labelStyle), a.style("display", "inline-block"), a.style("white-space", "nowrap"), a.attr("xmlns", "http://www.w3.org/1999/xhtml"), t.node();
}
g(Jt, "addHtmlLabel");
var ir = g((e, t, a, n) => {
  let s = e || "";
  if (typeof s == "object" && (s = s[0]), J(B().flowchart.htmlLabels)) {
    s = s.replace(/\\n|\n/g, "<br />"), L.debug("vertexText" + s);
    const r = { isNode: n, label: fe(bt(s)), labelStyle: t.replace("fill:", "color:") };
    return Jt(r);
  } else {
    const r = document.createElementNS("http://www.w3.org/2000/svg", "text");
    r.setAttribute("style", t.replace("color:", "fill:"));
    let i = [];
    typeof s == "string" ? i = s.split(/\\n|\n|<br\s*\/?>/gi) : Array.isArray(s) ? i = s : i = [];
    for (const o of i) {
      const l = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
      l.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve"), l.setAttribute("dy", "1em"), l.setAttribute("x", "0"), a ? l.setAttribute("class", "title-row") : l.setAttribute("class", "row"), l.textContent = o.trim(), r.appendChild(l);
    }
    return r;
  }
}, "createLabel"), j = ir, sr = g((e, t, a, n, s) => {
  t.arrowTypeStart && zt(e, "start", t.arrowTypeStart, a, n, s), t.arrowTypeEnd && zt(e, "end", t.arrowTypeEnd, a, n, s);
}, "addEdgeMarkers"), nr = { arrow_cross: "cross", arrow_point: "point", arrow_barb: "barb", arrow_circle: "circle", aggregation: "aggregation", extension: "extension", composition: "composition", dependency: "dependency", lollipop: "lollipop" }, zt = g((e, t, a, n, s, r) => {
  const i = nr[a];
  if (!i) {
    L.warn(`Unknown arrow type: ${a}`);
    return;
  }
  const o = t === "start" ? "Start" : "End";
  e.attr(`marker-${t}`, `url(${n}#${s}_${r}-${i}${o})`);
}, "addEdgeMarker"), wt = {}, P = {}, or = g((e, t) => {
  const a = B(), n = J(a.flowchart.htmlLabels), s = t.labelType === "markdown" ? Xt(e, t.label, { style: t.labelStyle, useHtmlLabels: n, addSvgBackground: true }, a) : j(t.label, t.labelStyle), r = e.insert("g").attr("class", "edgeLabel"), i = r.insert("g").attr("class", "label");
  i.node().appendChild(s);
  let o = s.getBBox();
  if (n) {
    const y = s.children[0], u = O(s);
    o = y.getBoundingClientRect(), u.attr("width", o.width), u.attr("height", o.height);
  }
  i.attr("transform", "translate(" + -o.width / 2 + ", " + -o.height / 2 + ")"), wt[t.id] = r, t.width = o.width, t.height = o.height;
  let l;
  if (t.startLabelLeft) {
    const y = j(t.startLabelLeft, t.labelStyle), u = e.insert("g").attr("class", "edgeTerminals"), b = u.insert("g").attr("class", "inner");
    l = b.node().appendChild(y);
    const x = y.getBBox();
    b.attr("transform", "translate(" + -x.width / 2 + ", " + -x.height / 2 + ")"), P[t.id] || (P[t.id] = {}), P[t.id].startLeft = u, et(l, t.startLabelLeft);
  }
  if (t.startLabelRight) {
    const y = j(t.startLabelRight, t.labelStyle), u = e.insert("g").attr("class", "edgeTerminals"), b = u.insert("g").attr("class", "inner");
    l = u.node().appendChild(y), b.node().appendChild(y);
    const x = y.getBBox();
    b.attr("transform", "translate(" + -x.width / 2 + ", " + -x.height / 2 + ")"), P[t.id] || (P[t.id] = {}), P[t.id].startRight = u, et(l, t.startLabelRight);
  }
  if (t.endLabelLeft) {
    const y = j(t.endLabelLeft, t.labelStyle), u = e.insert("g").attr("class", "edgeTerminals"), b = u.insert("g").attr("class", "inner");
    l = b.node().appendChild(y);
    const x = y.getBBox();
    b.attr("transform", "translate(" + -x.width / 2 + ", " + -x.height / 2 + ")"), u.node().appendChild(y), P[t.id] || (P[t.id] = {}), P[t.id].endLeft = u, et(l, t.endLabelLeft);
  }
  if (t.endLabelRight) {
    const y = j(t.endLabelRight, t.labelStyle), u = e.insert("g").attr("class", "edgeTerminals"), b = u.insert("g").attr("class", "inner");
    l = b.node().appendChild(y);
    const x = y.getBBox();
    b.attr("transform", "translate(" + -x.width / 2 + ", " + -x.height / 2 + ")"), u.node().appendChild(y), P[t.id] || (P[t.id] = {}), P[t.id].endRight = u, et(l, t.endLabelRight);
  }
  return s;
}, "insertEdgeLabel");
function et(e, t) {
  B().flowchart.htmlLabels && e && (e.style.width = t.length * 9 + "px", e.style.height = "12px");
}
g(et, "setTerminalWidth");
var lr = g((e, t) => {
  L.debug("Moving label abc88 ", e.id, e.label, wt[e.id], t);
  let a = t.updatedPath ? t.updatedPath : t.originalPath;
  const n = B(), { subGraphTitleTotalMargin: s } = he(n);
  if (e.label) {
    const r = wt[e.id];
    let i = e.x, o = e.y;
    if (a) {
      const l = tt.calcLabelPosition(a);
      L.debug("Moving label " + e.label + " from (", i, ",", o, ") to (", l.x, ",", l.y, ") abc88"), t.updatedPath && (i = l.x, o = l.y);
    }
    r.attr("transform", `translate(${i}, ${o + s / 2})`);
  }
  if (e.startLabelLeft) {
    const r = P[e.id].startLeft;
    let i = e.x, o = e.y;
    if (a) {
      const l = tt.calcTerminalLabelPosition(e.arrowTypeStart ? 10 : 0, "start_left", a);
      i = l.x, o = l.y;
    }
    r.attr("transform", `translate(${i}, ${o})`);
  }
  if (e.startLabelRight) {
    const r = P[e.id].startRight;
    let i = e.x, o = e.y;
    if (a) {
      const l = tt.calcTerminalLabelPosition(e.arrowTypeStart ? 10 : 0, "start_right", a);
      i = l.x, o = l.y;
    }
    r.attr("transform", `translate(${i}, ${o})`);
  }
  if (e.endLabelLeft) {
    const r = P[e.id].endLeft;
    let i = e.x, o = e.y;
    if (a) {
      const l = tt.calcTerminalLabelPosition(e.arrowTypeEnd ? 10 : 0, "end_left", a);
      i = l.x, o = l.y;
    }
    r.attr("transform", `translate(${i}, ${o})`);
  }
  if (e.endLabelRight) {
    const r = P[e.id].endRight;
    let i = e.x, o = e.y;
    if (a) {
      const l = tt.calcTerminalLabelPosition(e.arrowTypeEnd ? 10 : 0, "end_right", a);
      i = l.x, o = l.y;
    }
    r.attr("transform", `translate(${i}, ${o})`);
  }
}, "positionEdgeLabel"), dr = g((e, t) => {
  const a = e.x, n = e.y, s = Math.abs(t.x - a), r = Math.abs(t.y - n), i = e.width / 2, o = e.height / 2;
  return s >= i || r >= o;
}, "outsideNode"), cr = g((e, t, a) => {
  L.debug(`intersection calc abc89:
  outsidePoint: ${JSON.stringify(t)}
  insidePoint : ${JSON.stringify(a)}
  node        : x:${e.x} y:${e.y} w:${e.width} h:${e.height}`);
  const n = e.x, s = e.y, r = Math.abs(n - a.x), i = e.width / 2;
  let o = a.x < t.x ? i - r : i + r;
  const l = e.height / 2, y = Math.abs(t.y - a.y), u = Math.abs(t.x - a.x);
  if (Math.abs(s - t.y) * i > Math.abs(n - t.x) * l) {
    let b = a.y < t.y ? t.y - l - s : s - l - t.y;
    o = u * b / y;
    const x = { x: a.x < t.x ? a.x + o : a.x - u + o, y: a.y < t.y ? a.y + y - b : a.y - y + b };
    return o === 0 && (x.x = t.x, x.y = t.y), u === 0 && (x.x = t.x), y === 0 && (x.y = t.y), L.debug(`abc89 topp/bott calc, Q ${y}, q ${b}, R ${u}, r ${o}`, x), x;
  } else {
    a.x < t.x ? o = t.x - i - n : o = n - i - t.x;
    let b = y * o / u, x = a.x < t.x ? a.x + u - o : a.x - u + o, S = a.y < t.y ? a.y + b : a.y - b;
    return L.debug(`sides calc abc89, Q ${y}, q ${b}, R ${u}, r ${o}`, { _x: x, _y: S }), o === 0 && (x = t.x, S = t.y), u === 0 && (x = t.x), y === 0 && (S = t.y), { x, y: S };
  }
}, "intersection"), At = g((e, t) => {
  L.debug("abc88 cutPathAtIntersect", e, t);
  let a = [], n = e[0], s = false;
  return e.forEach((r) => {
    if (!dr(t, r) && !s) {
      const i = cr(t, n, r);
      let o = false;
      a.forEach((l) => {
        o = o || l.x === i.x && l.y === i.y;
      }), a.some((l) => l.x === i.x && l.y === i.y) || a.push(i), s = true;
    } else
      n = r, s || a.push(r);
  }), a;
}, "cutPathAtIntersect"), hr = g(function(e, t, a, n, s, r, i) {
  let o = a.points;
  L.debug("abc88 InsertEdge: edge=", a, "e=", t);
  let l = false;
  const y = r.node(t.v);
  var u = r.node(t.w);
  u != null && u.intersect && y != null && y.intersect && (o = o.slice(1, a.points.length - 1), o.unshift(y.intersect(o[0])), o.push(u.intersect(o[o.length - 1]))), a.toCluster && (L.debug("to cluster abc88", n[a.toCluster]), o = At(a.points, n[a.toCluster].node), l = true), a.fromCluster && (L.debug("from cluster abc88", n[a.fromCluster]), o = At(o.reverse(), n[a.fromCluster].node).reverse(), l = true);
  const b = o.filter((c) => !Number.isNaN(c.y));
  let x = xe;
  a.curve && (s === "graph" || s === "flowchart") && (x = a.curve);
  const { x: S, y: w } = ge(a), v = ue().x(S).y(w).curve(x);
  let k;
  switch (a.thickness) {
    case "normal":
      k = "edge-thickness-normal";
      break;
    case "thick":
      k = "edge-thickness-thick";
      break;
    case "invisible":
      k = "edge-thickness-thick";
      break;
    default:
      k = "";
  }
  switch (a.pattern) {
    case "solid":
      k += " edge-pattern-solid";
      break;
    case "dotted":
      k += " edge-pattern-dotted";
      break;
    case "dashed":
      k += " edge-pattern-dashed";
      break;
  }
  const N = e.append("path").attr("d", v(b)).attr("id", a.id).attr("class", " " + k + (a.classes ? " " + a.classes : "")).attr("style", a.style);
  let _ = "";
  (B().flowchart.arrowMarkerAbsolute || B().state.arrowMarkerAbsolute) && (_ = window.location.protocol + "//" + window.location.host + window.location.pathname + window.location.search, _ = _.replace(/\(/g, "\\("), _ = _.replace(/\)/g, "\\)")), sr(N, a, _, i, s);
  let D = {};
  return l && (D.updatedPath = o), D.originalPath = a.points, D;
}, "insertEdge"), gr = g((e) => {
  const t = /* @__PURE__ */ new Set();
  for (const a of e)
    switch (a) {
      case "x":
        t.add("right"), t.add("left");
        break;
      case "y":
        t.add("up"), t.add("down");
        break;
      default:
        t.add(a);
        break;
    }
  return t;
}, "expandAndDeduplicateDirections"), ur = g((e, t, a) => {
  const n = gr(e), s = 2, r = t.height + 2 * a.padding, i = r / s, o = t.width + 2 * i + a.padding, l = a.padding / 2;
  return n.has("right") && n.has("left") && n.has("up") && n.has("down") ? [{ x: 0, y: 0 }, { x: i, y: 0 }, { x: o / 2, y: 2 * l }, { x: o - i, y: 0 }, { x: o, y: 0 }, { x: o, y: -r / 3 }, { x: o + 2 * l, y: -r / 2 }, { x: o, y: -2 * r / 3 }, { x: o, y: -r }, { x: o - i, y: -r }, { x: o / 2, y: -r - 2 * l }, { x: i, y: -r }, { x: 0, y: -r }, { x: 0, y: -2 * r / 3 }, { x: -2 * l, y: -r / 2 }, { x: 0, y: -r / 3 }] : n.has("right") && n.has("left") && n.has("up") ? [{ x: i, y: 0 }, { x: o - i, y: 0 }, { x: o, y: -r / 2 }, { x: o - i, y: -r }, { x: i, y: -r }, { x: 0, y: -r / 2 }] : n.has("right") && n.has("left") && n.has("down") ? [{ x: 0, y: 0 }, { x: i, y: -r }, { x: o - i, y: -r }, { x: o, y: 0 }] : n.has("right") && n.has("up") && n.has("down") ? [{ x: 0, y: 0 }, { x: o, y: -i }, { x: o, y: -r + i }, { x: 0, y: -r }] : n.has("left") && n.has("up") && n.has("down") ? [{ x: o, y: 0 }, { x: 0, y: -i }, { x: 0, y: -r + i }, { x: o, y: -r }] : n.has("right") && n.has("left") ? [{ x: i, y: 0 }, { x: i, y: -l }, { x: o - i, y: -l }, { x: o - i, y: 0 }, { x: o, y: -r / 2 }, { x: o - i, y: -r }, { x: o - i, y: -r + l }, { x: i, y: -r + l }, { x: i, y: -r }, { x: 0, y: -r / 2 }] : n.has("up") && n.has("down") ? [{ x: o / 2, y: 0 }, { x: 0, y: -l }, { x: i, y: -l }, { x: i, y: -r + l }, { x: 0, y: -r + l }, { x: o / 2, y: -r }, { x: o, y: -r + l }, { x: o - i, y: -r + l }, { x: o - i, y: -l }, { x: o, y: -l }] : n.has("right") && n.has("up") ? [{ x: 0, y: 0 }, { x: o, y: -i }, { x: 0, y: -r }] : n.has("right") && n.has("down") ? [{ x: 0, y: 0 }, { x: o, y: 0 }, { x: 0, y: -r }] : n.has("left") && n.has("up") ? [{ x: o, y: 0 }, { x: 0, y: -i }, { x: o, y: -r }] : n.has("left") && n.has("down") ? [{ x: o, y: 0 }, { x: 0, y: 0 }, { x: o, y: -r }] : n.has("right") ? [{ x: i, y: -l }, { x: i, y: -l }, { x: o - i, y: -l }, { x: o - i, y: 0 }, { x: o, y: -r / 2 }, { x: o - i, y: -r }, { x: o - i, y: -r + l }, { x: i, y: -r + l }, { x: i, y: -r + l }] : n.has("left") ? [{ x: i, y: 0 }, { x: i, y: -l }, { x: o - i, y: -l }, { x: o - i, y: -r + l }, { x: i, y: -r + l }, { x: i, y: -r }, { x: 0, y: -r / 2 }] : n.has("up") ? [{ x: i, y: -l }, { x: i, y: -r + l }, { x: 0, y: -r + l }, { x: o / 2, y: -r }, { x: o, y: -r + l }, { x: o - i, y: -r + l }, { x: o - i, y: -l }] : n.has("down") ? [{ x: o / 2, y: 0 }, { x: 0, y: -l }, { x: i, y: -l }, { x: i, y: -r + l }, { x: o - i, y: -r + l }, { x: o - i, y: -l }, { x: o, y: -l }] : [{ x: 0, y: 0 }];
}, "getArrowPoints");
function Gt(e, t) {
  return e.intersect(t);
}
g(Gt, "intersectNode");
var yr = Gt;
function Vt(e, t, a, n) {
  var s = e.x, r = e.y, i = s - n.x, o = r - n.y, l = Math.sqrt(t * t * o * o + a * a * i * i), y = Math.abs(t * a * i / l);
  n.x < s && (y = -y);
  var u = Math.abs(t * a * o / l);
  return n.y < r && (u = -u), { x: s + y, y: r + u };
}
g(Vt, "intersectEllipse");
var qt = Vt;
function Qt(e, t, a) {
  return qt(e, t, t, a);
}
g(Qt, "intersectCircle");
var pr = Qt;
function te(e, t, a, n) {
  var s, r, i, o, l, y, u, b, x, S, w, v, k, N, _;
  if (s = t.y - e.y, i = e.x - t.x, l = t.x * e.y - e.x * t.y, x = s * a.x + i * a.y + l, S = s * n.x + i * n.y + l, !(x !== 0 && S !== 0 && Lt(x, S)) && (r = n.y - a.y, o = a.x - n.x, y = n.x * a.y - a.x * n.y, u = r * e.x + o * e.y + y, b = r * t.x + o * t.y + y, !(u !== 0 && b !== 0 && Lt(u, b)) && (w = s * o - r * i, w !== 0)))
    return v = Math.abs(w / 2), k = i * y - o * l, N = k < 0 ? (k - v) / w : (k + v) / w, k = r * l - s * y, _ = k < 0 ? (k - v) / w : (k + v) / w, { x: N, y: _ };
}
g(te, "intersectLine");
function Lt(e, t) {
  return e * t > 0;
}
g(Lt, "sameSign");
var br = te, xr = ee;
function ee(e, t, a) {
  var n = e.x, s = e.y, r = [], i = Number.POSITIVE_INFINITY, o = Number.POSITIVE_INFINITY;
  typeof t.forEach == "function" ? t.forEach(function(w) {
    i = Math.min(i, w.x), o = Math.min(o, w.y);
  }) : (i = Math.min(i, t.x), o = Math.min(o, t.y));
  for (var l = n - e.width / 2 - i, y = s - e.height / 2 - o, u = 0; u < t.length; u++) {
    var b = t[u], x = t[u < t.length - 1 ? u + 1 : 0], S = br(e, a, { x: l + b.x, y: y + b.y }, { x: l + x.x, y: y + x.y });
    S && r.push(S);
  }
  return r.length ? (r.length > 1 && r.sort(function(w, v) {
    var k = w.x - a.x, N = w.y - a.y, _ = Math.sqrt(k * k + N * N), D = v.x - a.x, c = v.y - a.y, p = Math.sqrt(D * D + c * c);
    return _ < p ? -1 : _ === p ? 0 : 1;
  }), r[0]) : e;
}
g(ee, "intersectPolygon");
var fr = g((e, t) => {
  var a = e.x, n = e.y, s = t.x - a, r = t.y - n, i = e.width / 2, o = e.height / 2, l, y;
  return Math.abs(r) * i > Math.abs(s) * o ? (r < 0 && (o = -o), l = r === 0 ? 0 : o * s / r, y = o) : (s < 0 && (i = -i), l = i, y = s === 0 ? 0 : i * r / s), { x: a + l, y: n + y };
}, "intersectRect"), mr = fr, T = { node: yr, circle: pr, ellipse: qt, polygon: xr, rect: mr }, R = g(async (e, t, a, n) => {
  const s = B();
  let r;
  const i = t.useHtmlLabels || J(s.flowchart.htmlLabels);
  a ? r = a : r = "node default";
  const o = e.insert("g").attr("class", r).attr("id", t.domId || t.id), l = o.insert("g").attr("class", "label").attr("style", t.labelStyle);
  let y;
  t.labelText === void 0 ? y = "" : y = typeof t.labelText == "string" ? t.labelText : t.labelText[0];
  const u = l.node();
  let b;
  t.labelType === "markdown" ? b = Xt(l, Tt(bt(y), s), { useHtmlLabels: i, width: t.width || s.flowchart.wrappingWidth, classes: "markdown-node-label" }, s) : b = u.appendChild(j(Tt(bt(y), s), t.labelStyle, false, n));
  let x = b.getBBox();
  const S = t.padding / 2;
  if (J(s.flowchart.htmlLabels)) {
    const w = b.children[0], v = O(b), k = w.getElementsByTagName("img");
    if (k) {
      const N = y.replace(/<img[^>]*>/g, "").trim() === "";
      await Promise.all([...k].map((_) => new Promise((D) => {
        function c() {
          if (_.style.display = "flex", _.style.flexDirection = "column", N) {
            const p = s.fontSize ? s.fontSize : window.getComputedStyle(document.body).fontSize, f = parseInt(p, 10) * 5 + "px";
            _.style.minWidth = f, _.style.maxWidth = f;
          } else
            _.style.width = "100%";
          D(_);
        }
        g(c, "setupImage"), setTimeout(() => {
          _.complete && c();
        }), _.addEventListener("error", c), _.addEventListener("load", c);
      })));
    }
    x = w.getBoundingClientRect(), v.attr("width", x.width), v.attr("height", x.height);
  }
  return i ? l.attr("transform", "translate(" + -x.width / 2 + ", " + -x.height / 2 + ")") : l.attr("transform", "translate(0, " + -x.height / 2 + ")"), t.centerLabel && l.attr("transform", "translate(" + -x.width / 2 + ", " + -x.height / 2 + ")"), l.insert("rect", ":first-child"), { shapeSvg: o, bbox: x, halfPadding: S, label: l };
}, "labelHelper"), $ = g((e, t) => {
  const a = t.node().getBBox();
  e.width = a.width, e.height = a.height;
}, "updateNodeBounds");
function Z(e, t, a, n) {
  return e.insert("polygon", ":first-child").attr("points", n.map(function(s) {
    return s.x + "," + s.y;
  }).join(" ")).attr("class", "label-container").attr("transform", "translate(" + -t / 2 + "," + a / 2 + ")");
}
g(Z, "insertPolygonShape");
var wr = g(async (e, t) => {
  t.useHtmlLabels || B().flowchart.htmlLabels || (t.centerLabel = true);
  const { shapeSvg: a, bbox: n, halfPadding: s } = await R(e, t, "node " + t.classes, true);
  L.info("Classes = ", t.classes);
  const r = a.insert("rect", ":first-child");
  return r.attr("rx", t.rx).attr("ry", t.ry).attr("x", -n.width / 2 - s).attr("y", -n.height / 2 - s).attr("width", n.width + t.padding).attr("height", n.height + t.padding), $(t, r), t.intersect = function(i) {
    return T.rect(t, i);
  }, a;
}, "note"), Lr = wr, Rt = g((e) => e ? " " + e : "", "formatClass"), H = g((e, t) => `${t || "node default"}${Rt(e.classes)} ${Rt(e.class)}`, "getClassesFromNode"), Mt = g(async (e, t) => {
  const { shapeSvg: a, bbox: n } = await R(e, t, H(t, void 0), true), s = n.width + t.padding, r = n.height + t.padding, i = s + r, o = [{ x: i / 2, y: 0 }, { x: i, y: -i / 2 }, { x: i / 2, y: -i }, { x: 0, y: -i / 2 }];
  L.info("Question main (Circle)");
  const l = Z(a, i, i, o);
  return l.attr("style", t.style), $(t, l), t.intersect = function(y) {
    return L.warn("Intersect called"), T.polygon(t, o, y);
  }, a;
}, "question"), Sr = g((e, t) => {
  const a = e.insert("g").attr("class", "node default").attr("id", t.domId || t.id), n = 28, s = [{ x: 0, y: n / 2 }, { x: n / 2, y: 0 }, { x: 0, y: -28 / 2 }, { x: -28 / 2, y: 0 }];
  return a.insert("polygon", ":first-child").attr("points", s.map(function(r) {
    return r.x + "," + r.y;
  }).join(" ")).attr("class", "state-start").attr("r", 7).attr("width", 28).attr("height", 28), t.width = 28, t.height = 28, t.intersect = function(r) {
    return T.circle(t, 14, r);
  }, a;
}, "choice"), kr = g(async (e, t) => {
  const { shapeSvg: a, bbox: n } = await R(e, t, H(t, void 0), true), s = 4, r = n.height + t.padding, i = r / s, o = n.width + 2 * i + t.padding, l = [{ x: i, y: 0 }, { x: o - i, y: 0 }, { x: o, y: -r / 2 }, { x: o - i, y: -r }, { x: i, y: -r }, { x: 0, y: -r / 2 }], y = Z(a, o, r, l);
  return y.attr("style", t.style), $(t, y), t.intersect = function(u) {
    return T.polygon(t, l, u);
  }, a;
}, "hexagon"), _r = g(async (e, t) => {
  const { shapeSvg: a, bbox: n } = await R(e, t, void 0, true), s = 2, r = n.height + 2 * t.padding, i = r / s, o = n.width + 2 * i + t.padding, l = ur(t.directions, n, t), y = Z(a, o, r, l);
  return y.attr("style", t.style), $(t, y), t.intersect = function(u) {
    return T.polygon(t, l, u);
  }, a;
}, "block_arrow"), vr = g(async (e, t) => {
  const { shapeSvg: a, bbox: n } = await R(e, t, H(t, void 0), true), s = n.width + t.padding, r = n.height + t.padding, i = [{ x: -r / 2, y: 0 }, { x: s, y: 0 }, { x: s, y: -r }, { x: -r / 2, y: -r }, { x: 0, y: -r / 2 }];
  return Z(a, s, r, i).attr("style", t.style), t.width = s + r, t.height = r, t.intersect = function(o) {
    return T.polygon(t, i, o);
  }, a;
}, "rect_left_inv_arrow"), Er = g(async (e, t) => {
  const { shapeSvg: a, bbox: n } = await R(e, t, H(t), true), s = n.width + t.padding, r = n.height + t.padding, i = [{ x: -2 * r / 6, y: 0 }, { x: s - r / 6, y: 0 }, { x: s + 2 * r / 6, y: -r }, { x: r / 6, y: -r }], o = Z(a, s, r, i);
  return o.attr("style", t.style), $(t, o), t.intersect = function(l) {
    return T.polygon(t, i, l);
  }, a;
}, "lean_right"), Dr = g(async (e, t) => {
  const { shapeSvg: a, bbox: n } = await R(e, t, H(t, void 0), true), s = n.width + t.padding, r = n.height + t.padding, i = [{ x: 2 * r / 6, y: 0 }, { x: s + r / 6, y: 0 }, { x: s - 2 * r / 6, y: -r }, { x: -r / 6, y: -r }], o = Z(a, s, r, i);
  return o.attr("style", t.style), $(t, o), t.intersect = function(l) {
    return T.polygon(t, i, l);
  }, a;
}, "lean_left"), Nr = g(async (e, t) => {
  const { shapeSvg: a, bbox: n } = await R(e, t, H(t, void 0), true), s = n.width + t.padding, r = n.height + t.padding, i = [{ x: -2 * r / 6, y: 0 }, { x: s + 2 * r / 6, y: 0 }, { x: s - r / 6, y: -r }, { x: r / 6, y: -r }], o = Z(a, s, r, i);
  return o.attr("style", t.style), $(t, o), t.intersect = function(l) {
    return T.polygon(t, i, l);
  }, a;
}, "trapezoid"), Tr = g(async (e, t) => {
  const { shapeSvg: a, bbox: n } = await R(e, t, H(t, void 0), true), s = n.width + t.padding, r = n.height + t.padding, i = [{ x: r / 6, y: 0 }, { x: s - r / 6, y: 0 }, { x: s + 2 * r / 6, y: -r }, { x: -2 * r / 6, y: -r }], o = Z(a, s, r, i);
  return o.attr("style", t.style), $(t, o), t.intersect = function(l) {
    return T.polygon(t, i, l);
  }, a;
}, "inv_trapezoid"), $r = g(async (e, t) => {
  const { shapeSvg: a, bbox: n } = await R(e, t, H(t, void 0), true), s = n.width + t.padding, r = n.height + t.padding, i = [{ x: 0, y: 0 }, { x: s + r / 2, y: 0 }, { x: s, y: -r / 2 }, { x: s + r / 2, y: -r }, { x: 0, y: -r }], o = Z(a, s, r, i);
  return o.attr("style", t.style), $(t, o), t.intersect = function(l) {
    return T.polygon(t, i, l);
  }, a;
}, "rect_right_inv_arrow"), Cr = g(async (e, t) => {
  const { shapeSvg: a, bbox: n } = await R(e, t, H(t, void 0), true), s = n.width + t.padding, r = s / 2, i = r / (2.5 + s / 50), o = n.height + i + t.padding, l = "M 0," + i + " a " + r + "," + i + " 0,0,0 " + s + " 0 a " + r + "," + i + " 0,0,0 " + -s + " 0 l 0," + o + " a " + r + "," + i + " 0,0,0 " + s + " 0 l 0," + -o, y = a.attr("label-offset-y", i).insert("path", ":first-child").attr("style", t.style).attr("d", l).attr("transform", "translate(" + -s / 2 + "," + -(o / 2 + i) + ")");
  return $(t, y), t.intersect = function(u) {
    const b = T.rect(t, u), x = b.x - t.x;
    if (r != 0 && (Math.abs(x) < t.width / 2 || Math.abs(x) == t.width / 2 && Math.abs(b.y - t.y) > t.height / 2 - i)) {
      let S = i * i * (1 - x * x / (r * r));
      S != 0 && (S = Math.sqrt(S)), S = i - S, u.y - t.y > 0 && (S = -S), b.y += S;
    }
    return b;
  }, a;
}, "cylinder"), Ir = g(async (e, t) => {
  const { shapeSvg: a, bbox: n, halfPadding: s } = await R(e, t, "node " + t.classes + " " + t.class, true), r = a.insert("rect", ":first-child"), i = t.positioned ? t.width : n.width + t.padding, o = t.positioned ? t.height : n.height + t.padding, l = t.positioned ? -i / 2 : -n.width / 2 - s, y = t.positioned ? -o / 2 : -n.height / 2 - s;
  if (r.attr("class", "basic label-container").attr("style", t.style).attr("rx", t.rx).attr("ry", t.ry).attr("x", l).attr("y", y).attr("width", i).attr("height", o), t.props) {
    const u = new Set(Object.keys(t.props));
    t.props.borders && (ct(r, t.props.borders, i, o), u.delete("borders")), u.forEach((b) => {
      L.warn(`Unknown node property ${b}`);
    });
  }
  return $(t, r), t.intersect = function(u) {
    return T.rect(t, u);
  }, a;
}, "rect"), Or = g(async (e, t) => {
  const { shapeSvg: a, bbox: n, halfPadding: s } = await R(e, t, "node " + t.classes, true), r = a.insert("rect", ":first-child"), i = t.positioned ? t.width : n.width + t.padding, o = t.positioned ? t.height : n.height + t.padding, l = t.positioned ? -i / 2 : -n.width / 2 - s, y = t.positioned ? -o / 2 : -n.height / 2 - s;
  if (r.attr("class", "basic cluster composite label-container").attr("style", t.style).attr("rx", t.rx).attr("ry", t.ry).attr("x", l).attr("y", y).attr("width", i).attr("height", o), t.props) {
    const u = new Set(Object.keys(t.props));
    t.props.borders && (ct(r, t.props.borders, i, o), u.delete("borders")), u.forEach((b) => {
      L.warn(`Unknown node property ${b}`);
    });
  }
  return $(t, r), t.intersect = function(u) {
    return T.rect(t, u);
  }, a;
}, "composite"), Br = g(async (e, t) => {
  const { shapeSvg: a } = await R(e, t, "label", true);
  L.trace("Classes = ", t.class);
  const n = a.insert("rect", ":first-child"), s = 0, r = 0;
  if (n.attr("width", s).attr("height", r), a.attr("class", "label edgeLabel"), t.props) {
    const i = new Set(Object.keys(t.props));
    t.props.borders && (ct(n, t.props.borders, s, r), i.delete("borders")), i.forEach((o) => {
      L.warn(`Unknown node property ${o}`);
    });
  }
  return $(t, n), t.intersect = function(i) {
    return T.rect(t, i);
  }, a;
}, "labelRect");
function ct(e, t, a, n) {
  const s = [], r = g((o) => {
    s.push(o, 0);
  }, "addBorder"), i = g((o) => {
    s.push(0, o);
  }, "skipBorder");
  t.includes("t") ? (L.debug("add top border"), r(a)) : i(a), t.includes("r") ? (L.debug("add right border"), r(n)) : i(n), t.includes("b") ? (L.debug("add bottom border"), r(a)) : i(a), t.includes("l") ? (L.debug("add left border"), r(n)) : i(n), e.attr("stroke-dasharray", s.join(" "));
}
g(ct, "applyNodePropertyBorders");
var zr = g((e, t) => {
  let a;
  t.classes ? a = "node " + t.classes : a = "node default";
  const n = e.insert("g").attr("class", a).attr("id", t.domId || t.id), s = n.insert("rect", ":first-child"), r = n.insert("line"), i = n.insert("g").attr("class", "label"), o = t.labelText.flat ? t.labelText.flat() : t.labelText;
  let l = "";
  typeof o == "object" ? l = o[0] : l = o, L.info("Label text abc79", l, o, typeof o == "object");
  const y = i.node().appendChild(j(l, t.labelStyle, true, true));
  let u = { width: 0, height: 0 };
  if (J(B().flowchart.htmlLabels)) {
    const v = y.children[0], k = O(y);
    u = v.getBoundingClientRect(), k.attr("width", u.width), k.attr("height", u.height);
  }
  L.info("Text 2", o);
  const b = o.slice(1, o.length);
  let x = y.getBBox();
  const S = i.node().appendChild(j(b.join ? b.join("<br/>") : b, t.labelStyle, true, true));
  if (J(B().flowchart.htmlLabels)) {
    const v = S.children[0], k = O(S);
    u = v.getBoundingClientRect(), k.attr("width", u.width), k.attr("height", u.height);
  }
  const w = t.padding / 2;
  return O(S).attr("transform", "translate( " + (u.width > x.width ? 0 : (x.width - u.width) / 2) + ", " + (x.height + w + 5) + ")"), O(y).attr("transform", "translate( " + (u.width < x.width ? 0 : -(x.width - u.width) / 2) + ", 0)"), u = i.node().getBBox(), i.attr("transform", "translate(" + -u.width / 2 + ", " + (-u.height / 2 - w + 3) + ")"), s.attr("class", "outer title-state").attr("x", -u.width / 2 - w).attr("y", -u.height / 2 - w).attr("width", u.width + t.padding).attr("height", u.height + t.padding), r.attr("class", "divider").attr("x1", -u.width / 2 - w).attr("x2", u.width / 2 + w).attr("y1", -u.height / 2 - w + x.height + w).attr("y2", -u.height / 2 - w + x.height + w), $(t, s), t.intersect = function(v) {
    return T.rect(t, v);
  }, n;
}, "rectWithTitle"), Ar = g(async (e, t) => {
  const { shapeSvg: a, bbox: n } = await R(e, t, H(t, void 0), true), s = n.height + t.padding, r = n.width + s / 4 + t.padding, i = a.insert("rect", ":first-child").attr("style", t.style).attr("rx", s / 2).attr("ry", s / 2).attr("x", -r / 2).attr("y", -s / 2).attr("width", r).attr("height", s);
  return $(t, i), t.intersect = function(o) {
    return T.rect(t, o);
  }, a;
}, "stadium"), Rr = g(async (e, t) => {
  const { shapeSvg: a, bbox: n, halfPadding: s } = await R(e, t, H(t, void 0), true), r = a.insert("circle", ":first-child");
  return r.attr("style", t.style).attr("rx", t.rx).attr("ry", t.ry).attr("r", n.width / 2 + s).attr("width", n.width + t.padding).attr("height", n.height + t.padding), L.info("Circle main"), $(t, r), t.intersect = function(i) {
    return L.info("Circle intersect", t, n.width / 2 + s, i), T.circle(t, n.width / 2 + s, i);
  }, a;
}, "circle"), Mr = g(async (e, t) => {
  const { shapeSvg: a, bbox: n, halfPadding: s } = await R(e, t, H(t, void 0), true), r = 5, i = a.insert("g", ":first-child"), o = i.insert("circle"), l = i.insert("circle");
  return i.attr("class", t.class), o.attr("style", t.style).attr("rx", t.rx).attr("ry", t.ry).attr("r", n.width / 2 + s + r).attr("width", n.width + t.padding + r * 2).attr("height", n.height + t.padding + r * 2), l.attr("style", t.style).attr("rx", t.rx).attr("ry", t.ry).attr("r", n.width / 2 + s).attr("width", n.width + t.padding).attr("height", n.height + t.padding), L.info("DoubleCircle main"), $(t, o), t.intersect = function(y) {
    return L.info("DoubleCircle intersect", t, n.width / 2 + s + r, y), T.circle(t, n.width / 2 + s + r, y);
  }, a;
}, "doublecircle"), Pr = g(async (e, t) => {
  const { shapeSvg: a, bbox: n } = await R(e, t, H(t, void 0), true), s = n.width + t.padding, r = n.height + t.padding, i = [{ x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: -r }, { x: 0, y: -r }, { x: 0, y: 0 }, { x: -8, y: 0 }, { x: s + 8, y: 0 }, { x: s + 8, y: -r }, { x: -8, y: -r }, { x: -8, y: 0 }], o = Z(a, s, r, i);
  return o.attr("style", t.style), $(t, o), t.intersect = function(l) {
    return T.polygon(t, i, l);
  }, a;
}, "subroutine"), Wr = g((e, t) => {
  const a = e.insert("g").attr("class", "node default").attr("id", t.domId || t.id), n = a.insert("circle", ":first-child");
  return n.attr("class", "state-start").attr("r", 7).attr("width", 14).attr("height", 14), $(t, n), t.intersect = function(s) {
    return T.circle(t, 7, s);
  }, a;
}, "start"), Pt = g((e, t, a) => {
  const n = e.insert("g").attr("class", "node default").attr("id", t.domId || t.id);
  let s = 70, r = 10;
  a === "LR" && (s = 10, r = 70);
  const i = n.append("rect").attr("x", -1 * s / 2).attr("y", -1 * r / 2).attr("width", s).attr("height", r).attr("class", "fork-join");
  return $(t, i), t.height = t.height + t.padding / 2, t.width = t.width + t.padding / 2, t.intersect = function(o) {
    return T.rect(t, o);
  }, n;
}, "forkJoin"), Xr = g((e, t) => {
  const a = e.insert("g").attr("class", "node default").attr("id", t.domId || t.id), n = a.insert("circle", ":first-child"), s = a.insert("circle", ":first-child");
  return s.attr("class", "state-start").attr("r", 7).attr("width", 14).attr("height", 14), n.attr("class", "state-end").attr("r", 5).attr("width", 10).attr("height", 10), $(t, s), t.intersect = function(r) {
    return T.circle(t, 7, r);
  }, a;
}, "end"), Fr = g((e, t) => {
  var a;
  const n = t.padding / 2, s = 4, r = 8;
  let i;
  t.classes ? i = "node " + t.classes : i = "node default";
  const o = e.insert("g").attr("class", i).attr("id", t.domId || t.id), l = o.insert("rect", ":first-child"), y = o.insert("line"), u = o.insert("line");
  let b = 0, x = s;
  const S = o.insert("g").attr("class", "label");
  let w = 0;
  const v = (a = t.classData.annotations) == null ? void 0 : a[0], k = t.classData.annotations[0] ? "\xAB" + t.classData.annotations[0] + "\xBB" : "", N = S.node().appendChild(j(k, t.labelStyle, true, true));
  let _ = N.getBBox();
  if (J(B().flowchart.htmlLabels)) {
    const m = N.children[0], h = O(N);
    _ = m.getBoundingClientRect(), h.attr("width", _.width), h.attr("height", _.height);
  }
  t.classData.annotations[0] && (x += _.height + s, b += _.width);
  let D = t.classData.label;
  t.classData.type !== void 0 && t.classData.type !== "" && (B().flowchart.htmlLabels ? D += "&lt;" + t.classData.type + "&gt;" : D += "<" + t.classData.type + ">");
  const c = S.node().appendChild(j(D, t.labelStyle, true, true));
  O(c).attr("class", "classTitle");
  let p = c.getBBox();
  if (J(B().flowchart.htmlLabels)) {
    const m = c.children[0], h = O(c);
    p = m.getBoundingClientRect(), h.attr("width", p.width), h.attr("height", p.height);
  }
  x += p.height + s, p.width > b && (b = p.width);
  const f = [];
  t.classData.members.forEach((m) => {
    const h = m.getDisplayDetails();
    let I = h.displayText;
    B().flowchart.htmlLabels && (I = I.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
    const M = S.node().appendChild(j(I, h.cssStyle ? h.cssStyle : t.labelStyle, true, true));
    let z = M.getBBox();
    if (J(B().flowchart.htmlLabels)) {
      const X = M.children[0], F = O(M);
      z = X.getBoundingClientRect(), F.attr("width", z.width), F.attr("height", z.height);
    }
    z.width > b && (b = z.width), x += z.height + s, f.push(M);
  }), x += r;
  const E = [];
  if (t.classData.methods.forEach((m) => {
    const h = m.getDisplayDetails();
    let I = h.displayText;
    B().flowchart.htmlLabels && (I = I.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
    const M = S.node().appendChild(j(I, h.cssStyle ? h.cssStyle : t.labelStyle, true, true));
    let z = M.getBBox();
    if (J(B().flowchart.htmlLabels)) {
      const X = M.children[0], F = O(M);
      z = X.getBoundingClientRect(), F.attr("width", z.width), F.attr("height", z.height);
    }
    z.width > b && (b = z.width), x += z.height + s, E.push(M);
  }), x += r, v) {
    let m = (b - _.width) / 2;
    O(N).attr("transform", "translate( " + (-1 * b / 2 + m) + ", " + -1 * x / 2 + ")"), w = _.height + s;
  }
  let d = (b - p.width) / 2;
  return O(c).attr("transform", "translate( " + (-1 * b / 2 + d) + ", " + (-1 * x / 2 + w) + ")"), w += p.height + s, y.attr("class", "divider").attr("x1", -b / 2 - n).attr("x2", b / 2 + n).attr("y1", -x / 2 - n + r + w).attr("y2", -x / 2 - n + r + w), w += r, f.forEach((m) => {
    O(m).attr("transform", "translate( " + -b / 2 + ", " + (-1 * x / 2 + w + r / 2) + ")");
    const h = m == null ? void 0 : m.getBBox();
    w += ((h == null ? void 0 : h.height) ?? 0) + s;
  }), w += r, u.attr("class", "divider").attr("x1", -b / 2 - n).attr("x2", b / 2 + n).attr("y1", -x / 2 - n + r + w).attr("y2", -x / 2 - n + r + w), w += r, E.forEach((m) => {
    O(m).attr("transform", "translate( " + -b / 2 + ", " + (-1 * x / 2 + w) + ")");
    const h = m == null ? void 0 : m.getBBox();
    w += ((h == null ? void 0 : h.height) ?? 0) + s;
  }), l.attr("style", t.style).attr("class", "outer title-state").attr("x", -b / 2 - n).attr("y", -(x / 2) - n).attr("width", b + t.padding).attr("height", x + t.padding), $(t, l), t.intersect = function(m) {
    return T.rect(t, m);
  }, o;
}, "class_box"), Wt = { rhombus: Mt, composite: Or, question: Mt, rect: Ir, labelRect: Br, rectWithTitle: zr, choice: Sr, circle: Rr, doublecircle: Mr, stadium: Ar, hexagon: kr, block_arrow: _r, rect_left_inv_arrow: vr, lean_right: Er, lean_left: Dr, trapezoid: Nr, inv_trapezoid: Tr, rect_right_inv_arrow: $r, cylinder: Cr, start: Wr, end: Xr, note: Lr, subroutine: Pr, fork: Pt, join: Pt, class_box: Fr }, ot = {}, re = g(async (e, t, a) => {
  let n, s;
  if (t.link) {
    let r;
    B().securityLevel === "sandbox" ? r = "_top" : t.linkTarget && (r = t.linkTarget || "_blank"), n = e.insert("svg:a").attr("xlink:href", t.link).attr("target", r), s = await Wt[t.shape](n, t, a);
  } else
    s = await Wt[t.shape](e, t, a), n = s;
  return t.tooltip && s.attr("title", t.tooltip), t.class && s.attr("class", "node default " + t.class), ot[t.id] = n, t.haveCallback && ot[t.id].attr("class", ot[t.id].attr("class") + " clickable"), n;
}, "insertNode"), Yr = g((e) => {
  const t = ot[e.id];
  L.trace("Transforming node", e.diff, e, "translate(" + (e.x - e.width / 2 - 5) + ", " + e.width / 2 + ")");
  const a = 8, n = e.diff || 0;
  return e.clusterNode ? t.attr("transform", "translate(" + (e.x + n - e.width / 2) + ", " + (e.y - e.height / 2 - a) + ")") : t.attr("transform", "translate(" + e.x + ", " + e.y + ")"), n;
}, "positionNode");
function Et(e, t, a = false) {
  var n, s, r;
  const i = e;
  let o = "default";
  (((n = i == null ? void 0 : i.classes) == null ? void 0 : n.length) || 0) > 0 && (o = ((i == null ? void 0 : i.classes) ?? []).join(" ")), o = o + " flowchart-label";
  let l = 0, y = "", u;
  switch (i.type) {
    case "round":
      l = 5, y = "rect";
      break;
    case "composite":
      l = 0, y = "composite", u = 0;
      break;
    case "square":
      y = "rect";
      break;
    case "diamond":
      y = "question";
      break;
    case "hexagon":
      y = "hexagon";
      break;
    case "block_arrow":
      y = "block_arrow";
      break;
    case "odd":
      y = "rect_left_inv_arrow";
      break;
    case "lean_right":
      y = "lean_right";
      break;
    case "lean_left":
      y = "lean_left";
      break;
    case "trapezoid":
      y = "trapezoid";
      break;
    case "inv_trapezoid":
      y = "inv_trapezoid";
      break;
    case "rect_left_inv_arrow":
      y = "rect_left_inv_arrow";
      break;
    case "circle":
      y = "circle";
      break;
    case "ellipse":
      y = "ellipse";
      break;
    case "stadium":
      y = "stadium";
      break;
    case "subroutine":
      y = "subroutine";
      break;
    case "cylinder":
      y = "cylinder";
      break;
    case "group":
      y = "rect";
      break;
    case "doublecircle":
      y = "doublecircle";
      break;
    default:
      y = "rect";
  }
  const b = ce((i == null ? void 0 : i.styles) ?? []), x = i.label, S = i.size ?? { width: 0, height: 0, x: 0, y: 0 };
  return { labelStyle: b.labelStyle, shape: y, labelText: x, rx: l, ry: l, class: o, style: b.style, id: i.id, directions: i.directions, width: S.width, height: S.height, x: S.x, y: S.y, positioned: a, intersect: void 0, type: i.type, padding: u ?? ((r = (s = at()) == null ? void 0 : s.block) == null ? void 0 : r.padding) ?? 0 };
}
g(Et, "getNodeFromBlock");
async function ae(e, t, a) {
  const n = Et(t, a, false);
  if (n.type === "group")
    return;
  const s = at(), r = await re(e, n, { config: s }), i = r.node().getBBox(), o = a.getBlock(n.id);
  o.size = { width: i.width, height: i.height, x: 0, y: 0, node: r }, a.setBlock(o), r.remove();
}
g(ae, "calculateBlockSize");
async function ie(e, t, a) {
  const n = Et(t, a, true);
  if (a.getBlock(n.id).type !== "space") {
    const s = at();
    await re(e, n, { config: s }), t.intersect = n == null ? void 0 : n.intersect, Yr(n);
  }
}
g(ie, "insertBlockPositioned");
async function ht(e, t, a, n) {
  for (const s of t)
    await n(e, s, a), s.children && await ht(e, s.children, a, n);
}
g(ht, "performOperations");
async function se(e, t, a) {
  await ht(e, t, a, ae);
}
g(se, "calculateBlockSizes");
async function ne(e, t, a) {
  await ht(e, t, a, ie);
}
g(ne, "insertBlocks");
async function oe(e, t, a, n, s) {
  const r = new Le({ multigraph: true, compound: true });
  r.setGraph({ rankdir: "TB", nodesep: 10, ranksep: 10, marginx: 8, marginy: 8 });
  for (const i of a)
    i.size && r.setNode(i.id, { width: i.size.width, height: i.size.height, intersect: i.intersect });
  for (const i of t)
    if (i.start && i.end) {
      const o = n.getBlock(i.start), l = n.getBlock(i.end);
      if (o != null && o.size && l != null && l.size) {
        const y = o.size, u = l.size, b = [{ x: y.x, y: y.y }, { x: y.x + (u.x - y.x) / 2, y: y.y + (u.y - y.y) / 2 }, { x: u.x, y: u.y }];
        hr(e, { v: i.start, w: i.end, name: i.id }, { ...i, arrowTypeEnd: i.arrowTypeEnd, arrowTypeStart: i.arrowTypeStart, points: b, classes: "edge-thickness-normal edge-pattern-solid flowchart-link LS-a1 LE-b1" }, void 0, "block", r, s), i.label && (await or(e, { ...i, label: i.label, labelStyle: "stroke: #333; stroke-width: 1.5px;fill:none;", arrowTypeEnd: i.arrowTypeEnd, arrowTypeStart: i.arrowTypeStart, points: b, classes: "edge-thickness-normal edge-pattern-solid flowchart-link LS-a1 LE-b1" }), lr({ ...i, x: b[1].x, y: b[1].y }, { originalPath: b }));
      }
    }
}
g(oe, "insertEdges");
var Hr = g(function(e, t) {
  return t.db.getClasses();
}, "getClasses"), Kr = g(async function(e, t, a, n) {
  const { securityLevel: s, block: r } = at(), i = n.db;
  let o;
  s === "sandbox" && (o = O("#i" + t));
  const l = s === "sandbox" ? O(o.nodes()[0].contentDocument.body) : O("body"), y = s === "sandbox" ? l.select(`[id="${t}"]`) : O(`[id="${t}"]`);
  rr(y, ["point", "circle", "cross"], n.type, t);
  const u = i.getBlocks(), b = i.getBlocksFlat(), x = i.getEdges(), S = y.insert("g").attr("class", "block");
  await se(S, u, i);
  const w = Zt(i);
  if (await ne(S, u, i), await oe(S, x, b, i, t), w) {
    const v = w, k = Math.max(1, Math.round(0.125 * (v.width / v.height))), N = v.height + k + 10, _ = v.width + 10, { useMaxWidth: D } = r;
    ye(y, N, _, !!D), L.debug("Here Bounds", w, v), y.attr("viewBox", `${v.x - 5} ${v.y - 5} ${v.width + 10} ${v.height + 10}`);
  }
}, "draw"), jr = { draw: Kr, getClasses: Hr }, ea = { parser: ke, db: Fe, renderer: jr, styles: He };
export {
  ea as diagram
};
