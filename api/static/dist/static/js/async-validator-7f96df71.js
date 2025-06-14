function R() {
  return R = Object.assign ? Object.assign.bind() : function(i) {
    for (var e = 1; e < arguments.length; e++) {
      var r = arguments[e];
      for (var n in r)
        Object.prototype.hasOwnProperty.call(r, n) && (i[n] = r[n]);
    }
    return i;
  }, R.apply(this, arguments);
}
function ee(i, e) {
  i.prototype = Object.create(e.prototype), i.prototype.constructor = i, T(i, e);
}
function U(i) {
  return U = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function(r) {
    return r.__proto__ || Object.getPrototypeOf(r);
  }, U(i);
}
function T(i, e) {
  return T = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function(n, t) {
    return n.__proto__ = t, n;
  }, T(i, e);
}
function re() {
  if (typeof Reflect > "u" || !Reflect.construct || Reflect.construct.sham)
    return false;
  if (typeof Proxy == "function")
    return true;
  try {
    return Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {
    })), true;
  } catch {
    return false;
  }
}
function M(i, e, r) {
  return re() ? M = Reflect.construct.bind() : M = function(t, f, a) {
    var s = [null];
    s.push.apply(s, f);
    var d = Function.bind.apply(t, s), w = new d();
    return a && T(w, a.prototype), w;
  }, M.apply(null, arguments);
}
function ne(i) {
  return Function.toString.call(i).indexOf("[native code]") !== -1;
}
function J(i) {
  var e = typeof Map == "function" ? /* @__PURE__ */ new Map() : void 0;
  return J = function(n) {
    if (n === null || !ne(n))
      return n;
    if (typeof n != "function")
      throw new TypeError("Super expression must either be null or a function");
    if (typeof e < "u") {
      if (e.has(n))
        return e.get(n);
      e.set(n, t);
    }
    function t() {
      return M(n, arguments, U(this).constructor);
    }
    return t.prototype = Object.create(n.prototype, { constructor: { value: t, enumerable: false, writable: true, configurable: true } }), T(t, n);
  }, J(i);
}
var te = /%[sdj%]/g, ie = function() {
};
typeof process < "u" && process.env;
function W(i) {
  if (!i || !i.length)
    return null;
  var e = {};
  return i.forEach(function(r) {
    var n = r.field;
    e[n] = e[n] || [], e[n].push(r);
  }), e;
}
function F(i) {
  for (var e = arguments.length, r = new Array(e > 1 ? e - 1 : 0), n = 1; n < e; n++)
    r[n - 1] = arguments[n];
  var t = 0, f = r.length;
  if (typeof i == "function")
    return i.apply(null, r);
  if (typeof i == "string") {
    var a = i.replace(te, function(s) {
      if (s === "%%")
        return "%";
      if (t >= f)
        return s;
      switch (s) {
        case "%s":
          return String(r[t++]);
        case "%d":
          return Number(r[t++]);
        case "%j":
          try {
            return JSON.stringify(r[t++]);
          } catch {
            return "[Circular]";
          }
          break;
        default:
          return s;
      }
    });
    return a;
  }
  return i;
}
function ae(i) {
  return i === "string" || i === "url" || i === "hex" || i === "email" || i === "date" || i === "pattern";
}
function v(i, e) {
  return !!(i == null || e === "array" && Array.isArray(i) && !i.length || ae(e) && typeof i == "string" && !i);
}
function fe(i, e, r) {
  var n = [], t = 0, f = i.length;
  function a(s) {
    n.push.apply(n, s || []), t++, t === f && r(n);
  }
  i.forEach(function(s) {
    e(s, a);
  });
}
function G(i, e, r) {
  var n = 0, t = i.length;
  function f(a) {
    if (a && a.length) {
      r(a);
      return;
    }
    var s = n;
    n = n + 1, s < t ? e(i[s], f) : r([]);
  }
  f([]);
}
function se(i) {
  var e = [];
  return Object.keys(i).forEach(function(r) {
    e.push.apply(e, i[r] || []);
  }), e;
}
var K = function(i) {
  ee(e, i);
  function e(r, n) {
    var t;
    return t = i.call(this, "Async Validation Error") || this, t.errors = r, t.fields = n, t;
  }
  return e;
}(J(Error));
function oe(i, e, r, n, t) {
  if (e.first) {
    var f = new Promise(function(l, O) {
      var x = function(o) {
        return n(o), o.length ? O(new K(o, W(o))) : l(t);
      }, u = se(i);
      G(u, r, x);
    });
    return f.catch(function(l) {
      return l;
    }), f;
  }
  var a = e.firstFields === true ? Object.keys(i) : e.firstFields || [], s = Object.keys(i), d = s.length, w = 0, h = [], m = new Promise(function(l, O) {
    var x = function(g) {
      if (h.push.apply(h, g), w++, w === d)
        return n(h), h.length ? O(new K(h, W(h))) : l(t);
    };
    s.length || (n(h), l(t)), s.forEach(function(u) {
      var g = i[u];
      a.indexOf(u) !== -1 ? G(g, r, x) : fe(g, r, x);
    });
  });
  return m.catch(function(l) {
    return l;
  }), m;
}
function de(i) {
  return !!(i && i.message !== void 0);
}
function ue(i, e) {
  for (var r = i, n = 0; n < e.length; n++) {
    if (r == null)
      return r;
    r = r[e[n]];
  }
  return r;
}
function H(i, e) {
  return function(r) {
    var n;
    return i.fullFields ? n = ue(e, i.fullFields) : n = e[r.field || i.fullField], de(r) ? (r.field = r.field || i.fullField, r.fieldValue = n, r) : { message: typeof r == "function" ? r() : r, fieldValue: n, field: r.field || i.fullField };
  };
}
function Q(i, e) {
  if (e) {
    for (var r in e)
      if (e.hasOwnProperty(r)) {
        var n = e[r];
        typeof n == "object" && typeof i[r] == "object" ? i[r] = R({}, i[r], n) : i[r] = n;
      }
  }
  return i;
}
var C = function(e, r, n, t, f, a) {
  e.required && (!n.hasOwnProperty(e.field) || v(r, a || e.type)) && t.push(F(f.messages.required, e.fullField));
}, ce = function(e, r, n, t, f) {
  (/^\s+$/.test(r) || r === "") && t.push(F(f.messages.whitespace, e.fullField));
}, $, pe = function() {
  if ($)
    return $;
  var i = "[a-fA-F\\d:]", e = function(y) {
    return y && y.includeBoundaries ? "(?:(?<=\\s|^)(?=" + i + ")|(?<=" + i + ")(?=\\s|$))" : "";
  }, r = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)){3}", n = "[a-fA-F\\d]{1,4}", t = (`
(?:
(?:` + n + ":){7}(?:" + n + `|:)|                                    // 1:2:3:4:5:6:7::  1:2:3:4:5:6:7:8
(?:` + n + ":){6}(?:" + r + "|:" + n + `|:)|                             // 1:2:3:4:5:6::    1:2:3:4:5:6::8   1:2:3:4:5:6::8  1:2:3:4:5:6::1.2.3.4
(?:` + n + ":){5}(?::" + r + "|(?::" + n + `){1,2}|:)|                   // 1:2:3:4:5::      1:2:3:4:5::7:8   1:2:3:4:5::8    1:2:3:4:5::7:1.2.3.4
(?:` + n + ":){4}(?:(?::" + n + "){0,1}:" + r + "|(?::" + n + `){1,3}|:)| // 1:2:3:4::        1:2:3:4::6:7:8   1:2:3:4::8      1:2:3:4::6:7:1.2.3.4
(?:` + n + ":){3}(?:(?::" + n + "){0,2}:" + r + "|(?::" + n + `){1,4}|:)| // 1:2:3::          1:2:3::5:6:7:8   1:2:3::8        1:2:3::5:6:7:1.2.3.4
(?:` + n + ":){2}(?:(?::" + n + "){0,3}:" + r + "|(?::" + n + `){1,5}|:)| // 1:2::            1:2::4:5:6:7:8   1:2::8          1:2::4:5:6:7:1.2.3.4
(?:` + n + ":){1}(?:(?::" + n + "){0,4}:" + r + "|(?::" + n + `){1,6}|:)| // 1::              1::3:4:5:6:7:8   1::8            1::3:4:5:6:7:1.2.3.4
(?::(?:(?::` + n + "){0,5}:" + r + "|(?::" + n + `){1,7}|:))             // ::2:3:4:5:6:7:8  ::2:3:4:5:6:7:8  ::8             ::1.2.3.4
)(?:%[0-9a-zA-Z]{1,})?                                             // %eth0            %1
`).replace(/\s*\/\/.*$/gm, "").replace(/\n/g, "").trim(), f = new RegExp("(?:^" + r + "$)|(?:^" + t + "$)"), a = new RegExp("^" + r + "$"), s = new RegExp("^" + t + "$"), d = function(y) {
    return y && y.exact ? f : new RegExp("(?:" + e(y) + r + e(y) + ")|(?:" + e(y) + t + e(y) + ")", "g");
  };
  d.v4 = function(p) {
    return p && p.exact ? a : new RegExp("" + e(p) + r + e(p), "g");
  }, d.v6 = function(p) {
    return p && p.exact ? s : new RegExp("" + e(p) + t + e(p), "g");
  };
  var w = "(?:(?:[a-z]+:)?//)", h = "(?:\\S+(?::\\S*)?@)?", m = d.v4().source, l = d.v6().source, O = "(?:(?:[a-z\\u00a1-\\uffff0-9][-_]*)*[a-z\\u00a1-\\uffff0-9]+)", x = "(?:\\.(?:[a-z\\u00a1-\\uffff0-9]-*)*[a-z\\u00a1-\\uffff0-9]+)*", u = "(?:\\.(?:[a-z\\u00a1-\\uffff]{2,}))", g = "(?::\\d{2,5})?", o = '(?:[/?#][^\\s"]*)?', A = "(?:" + w + "|www\\.)" + h + "(?:localhost|" + m + "|" + l + "|" + O + x + u + ")" + g + o;
  return $ = new RegExp("(?:^" + A + "$)", "i"), $;
}, X = { email: /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]+\.)+[a-zA-Z\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]{2,}))$/, hex: /^#?([a-f0-9]{6}|[a-f0-9]{3})$/i }, D = { integer: function(e) {
  return D.number(e) && parseInt(e, 10) === e;
}, float: function(e) {
  return D.number(e) && !D.integer(e);
}, array: function(e) {
  return Array.isArray(e);
}, regexp: function(e) {
  if (e instanceof RegExp)
    return true;
  try {
    return !!new RegExp(e);
  } catch {
    return false;
  }
}, date: function(e) {
  return typeof e.getTime == "function" && typeof e.getMonth == "function" && typeof e.getYear == "function" && !isNaN(e.getTime());
}, number: function(e) {
  return isNaN(e) ? false : typeof e == "number";
}, object: function(e) {
  return typeof e == "object" && !D.array(e);
}, method: function(e) {
  return typeof e == "function";
}, email: function(e) {
  return typeof e == "string" && e.length <= 320 && !!e.match(X.email);
}, url: function(e) {
  return typeof e == "string" && e.length <= 2048 && !!e.match(pe());
}, hex: function(e) {
  return typeof e == "string" && !!e.match(X.hex);
} }, ye = function(e, r, n, t, f) {
  if (e.required && r === void 0) {
    C(e, r, n, t, f);
    return;
  }
  var a = ["integer", "float", "array", "regexp", "object", "method", "email", "number", "date", "url", "hex"], s = e.type;
  a.indexOf(s) > -1 ? D[s](r) || t.push(F(f.messages.types[s], e.fullField, e.type)) : s && typeof r !== e.type && t.push(F(f.messages.types[s], e.fullField, e.type));
}, ge = function(e, r, n, t, f) {
  var a = typeof e.len == "number", s = typeof e.min == "number", d = typeof e.max == "number", w = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g, h = r, m = null, l = typeof r == "number", O = typeof r == "string", x = Array.isArray(r);
  if (l ? m = "number" : O ? m = "string" : x && (m = "array"), !m)
    return false;
  x && (h = r.length), O && (h = r.replace(w, "_").length), a ? h !== e.len && t.push(F(f.messages[m].len, e.fullField, e.len)) : s && !d && h < e.min ? t.push(F(f.messages[m].min, e.fullField, e.min)) : d && !s && h > e.max ? t.push(F(f.messages[m].max, e.fullField, e.max)) : s && d && (h < e.min || h > e.max) && t.push(F(f.messages[m].range, e.fullField, e.min, e.max));
}, N = "enum", he = function(e, r, n, t, f) {
  e[N] = Array.isArray(e[N]) ? e[N] : [], e[N].indexOf(r) === -1 && t.push(F(f.messages[N], e.fullField, e[N].join(", ")));
}, ve = function(e, r, n, t, f) {
  if (e.pattern) {
    if (e.pattern instanceof RegExp)
      e.pattern.lastIndex = 0, e.pattern.test(r) || t.push(F(f.messages.pattern.mismatch, e.fullField, r, e.pattern));
    else if (typeof e.pattern == "string") {
      var a = new RegExp(e.pattern);
      a.test(r) || t.push(F(f.messages.pattern.mismatch, e.fullField, r, e.pattern));
    }
  }
}, c = { required: C, whitespace: ce, type: ye, range: ge, enum: he, pattern: ve }, me = function(e, r, n, t, f) {
  var a = [], s = e.required || !e.required && t.hasOwnProperty(e.field);
  if (s) {
    if (v(r, "string") && !e.required)
      return n();
    c.required(e, r, t, a, f, "string"), v(r, "string") || (c.type(e, r, t, a, f), c.range(e, r, t, a, f), c.pattern(e, r, t, a, f), e.whitespace === true && c.whitespace(e, r, t, a, f));
  }
  n(a);
}, le = function(e, r, n, t, f) {
  var a = [], s = e.required || !e.required && t.hasOwnProperty(e.field);
  if (s) {
    if (v(r) && !e.required)
      return n();
    c.required(e, r, t, a, f), r !== void 0 && c.type(e, r, t, a, f);
  }
  n(a);
}, we = function(e, r, n, t, f) {
  var a = [], s = e.required || !e.required && t.hasOwnProperty(e.field);
  if (s) {
    if (r === "" && (r = void 0), v(r) && !e.required)
      return n();
    c.required(e, r, t, a, f), r !== void 0 && (c.type(e, r, t, a, f), c.range(e, r, t, a, f));
  }
  n(a);
}, qe = function(e, r, n, t, f) {
  var a = [], s = e.required || !e.required && t.hasOwnProperty(e.field);
  if (s) {
    if (v(r) && !e.required)
      return n();
    c.required(e, r, t, a, f), r !== void 0 && c.type(e, r, t, a, f);
  }
  n(a);
}, be = function(e, r, n, t, f) {
  var a = [], s = e.required || !e.required && t.hasOwnProperty(e.field);
  if (s) {
    if (v(r) && !e.required)
      return n();
    c.required(e, r, t, a, f), v(r) || c.type(e, r, t, a, f);
  }
  n(a);
}, Fe = function(e, r, n, t, f) {
  var a = [], s = e.required || !e.required && t.hasOwnProperty(e.field);
  if (s) {
    if (v(r) && !e.required)
      return n();
    c.required(e, r, t, a, f), r !== void 0 && (c.type(e, r, t, a, f), c.range(e, r, t, a, f));
  }
  n(a);
}, xe = function(e, r, n, t, f) {
  var a = [], s = e.required || !e.required && t.hasOwnProperty(e.field);
  if (s) {
    if (v(r) && !e.required)
      return n();
    c.required(e, r, t, a, f), r !== void 0 && (c.type(e, r, t, a, f), c.range(e, r, t, a, f));
  }
  n(a);
}, Oe = function(e, r, n, t, f) {
  var a = [], s = e.required || !e.required && t.hasOwnProperty(e.field);
  if (s) {
    if (r == null && !e.required)
      return n();
    c.required(e, r, t, a, f, "array"), r != null && (c.type(e, r, t, a, f), c.range(e, r, t, a, f));
  }
  n(a);
}, Ee = function(e, r, n, t, f) {
  var a = [], s = e.required || !e.required && t.hasOwnProperty(e.field);
  if (s) {
    if (v(r) && !e.required)
      return n();
    c.required(e, r, t, a, f), r !== void 0 && c.type(e, r, t, a, f);
  }
  n(a);
}, Ae = "enum", Pe = function(e, r, n, t, f) {
  var a = [], s = e.required || !e.required && t.hasOwnProperty(e.field);
  if (s) {
    if (v(r) && !e.required)
      return n();
    c.required(e, r, t, a, f), r !== void 0 && c[Ae](e, r, t, a, f);
  }
  n(a);
}, je = function(e, r, n, t, f) {
  var a = [], s = e.required || !e.required && t.hasOwnProperty(e.field);
  if (s) {
    if (v(r, "string") && !e.required)
      return n();
    c.required(e, r, t, a, f), v(r, "string") || c.pattern(e, r, t, a, f);
  }
  n(a);
}, _e = function(e, r, n, t, f) {
  var a = [], s = e.required || !e.required && t.hasOwnProperty(e.field);
  if (s) {
    if (v(r, "date") && !e.required)
      return n();
    if (c.required(e, r, t, a, f), !v(r, "date")) {
      var d;
      r instanceof Date ? d = r : d = new Date(r), c.type(e, d, t, a, f), d && c.range(e, d.getTime(), t, a, f);
    }
  }
  n(a);
}, Re = function(e, r, n, t, f) {
  var a = [], s = Array.isArray(r) ? "array" : typeof r;
  c.required(e, r, t, a, f, s), n(a);
}, B = function(e, r, n, t, f) {
  var a = e.type, s = [], d = e.required || !e.required && t.hasOwnProperty(e.field);
  if (d) {
    if (v(r, a) && !e.required)
      return n();
    c.required(e, r, t, s, f, a), v(r, a) || c.type(e, r, t, s, f);
  }
  n(s);
}, Ne = function(e, r, n, t, f) {
  var a = [], s = e.required || !e.required && t.hasOwnProperty(e.field);
  if (s) {
    if (v(r) && !e.required)
      return n();
    c.required(e, r, t, a, f);
  }
  n(a);
}, S = { string: me, method: le, number: we, boolean: qe, regexp: be, integer: Fe, float: xe, array: Oe, object: Ee, enum: Pe, pattern: je, date: _e, url: B, hex: B, email: B, required: Re, any: Ne };
function Z() {
  return { default: "Validation error on field %s", required: "%s is required", enum: "%s must be one of %s", whitespace: "%s cannot be empty", date: { format: "%s date %s is invalid for format %s", parse: "%s date could not be parsed, %s is invalid ", invalid: "%s date %s is invalid" }, types: { string: "%s is not a %s", method: "%s is not a %s (function)", array: "%s is not an %s", object: "%s is not an %s", number: "%s is not a %s", date: "%s is not a %s", boolean: "%s is not a %s", integer: "%s is not an %s", float: "%s is not a %s", regexp: "%s is not a valid %s", email: "%s is not a valid %s", url: "%s is not a valid %s", hex: "%s is not a valid %s" }, string: { len: "%s must be exactly %s characters", min: "%s must be at least %s characters", max: "%s cannot be longer than %s characters", range: "%s must be between %s and %s characters" }, number: { len: "%s must equal %s", min: "%s cannot be less than %s", max: "%s cannot be greater than %s", range: "%s must be between %s and %s" }, array: { len: "%s must be exactly %s in length", min: "%s cannot be less than %s in length", max: "%s cannot be greater than %s in length", range: "%s must be between %s and %s in length" }, pattern: { mismatch: "%s value %s does not match pattern %s" }, clone: function() {
    var e = JSON.parse(JSON.stringify(this));
    return e.clone = this.clone, e;
  } };
}
var I = Z(), L = function() {
  function i(r) {
    this.rules = null, this._messages = I, this.define(r);
  }
  var e = i.prototype;
  return e.define = function(n) {
    var t = this;
    if (!n)
      throw new Error("Cannot configure a schema with no rules");
    if (typeof n != "object" || Array.isArray(n))
      throw new Error("Rules must be an object");
    this.rules = {}, Object.keys(n).forEach(function(f) {
      var a = n[f];
      t.rules[f] = Array.isArray(a) ? a : [a];
    });
  }, e.messages = function(n) {
    return n && (this._messages = Q(Z(), n)), this._messages;
  }, e.validate = function(n, t, f) {
    var a = this;
    t === void 0 && (t = {}), f === void 0 && (f = function() {
    });
    var s = n, d = t, w = f;
    if (typeof d == "function" && (w = d, d = {}), !this.rules || Object.keys(this.rules).length === 0)
      return w && w(null, s), Promise.resolve(s);
    function h(u) {
      var g = [], o = {};
      function A(y) {
        if (Array.isArray(y)) {
          var b;
          g = (b = g).concat.apply(b, y);
        } else
          g.push(y);
      }
      for (var p = 0; p < u.length; p++)
        A(u[p]);
      g.length ? (o = W(g), w(g, o)) : w(null, s);
    }
    if (d.messages) {
      var m = this.messages();
      m === I && (m = Z()), Q(m, d.messages), d.messages = m;
    } else
      d.messages = this.messages();
    var l = {}, O = d.keys || Object.keys(this.rules);
    O.forEach(function(u) {
      var g = a.rules[u], o = s[u];
      g.forEach(function(A) {
        var p = A;
        typeof p.transform == "function" && (s === n && (s = R({}, s)), o = s[u] = p.transform(o)), typeof p == "function" ? p = { validator: p } : p = R({}, p), p.validator = a.getValidationMethod(p), p.validator && (p.field = u, p.fullField = p.fullField || u, p.type = a.getType(p), l[u] = l[u] || [], l[u].push({ rule: p, value: o, source: s, field: u }));
      });
    });
    var x = {};
    return oe(l, d, function(u, g) {
      var _a;
      var o = u.rule, A = (o.type === "object" || o.type === "array") && (typeof o.fields == "object" || typeof o.defaultField == "object");
      A = A && (o.required || !o.required && u.value), o.field = u.field;
      function p(q, _) {
        return R({}, _, { fullField: o.fullField + "." + q, fullFields: o.fullFields ? [].concat(o.fullFields, [q]) : [q] });
      }
      function y(q) {
        q === void 0 && (q = []);
        var _ = Array.isArray(q) ? q : [q];
        !d.suppressWarning && _.length && i.warning("async-validator:", _), _.length && o.message !== void 0 && (_ = [].concat(o.message));
        var P = _.map(H(o, s));
        if (d.first && P.length)
          return x[o.field] = 1, g(P);
        if (!A)
          g(P);
        else {
          if (o.required && !u.value)
            return o.message !== void 0 ? P = [].concat(o.message).map(H(o, s)) : d.error && (P = [d.error(o, F(d.messages.required, o.field))]), g(P);
          var V = {};
          o.defaultField && Object.keys(u.value).map(function(j) {
            V[j] = o.defaultField;
          }), V = R({}, V, u.rule.fields);
          var Y = {};
          Object.keys(V).forEach(function(j) {
            var E = V[j], k = Array.isArray(E) ? E : [E];
            Y[j] = k.map(p.bind(null, j));
          });
          var z = new i(Y);
          z.messages(d.messages), u.rule.options && (u.rule.options.messages = d.messages, u.rule.options.error = d.error), z.validate(u.value, u.rule.options || d, function(j) {
            var E = [];
            P && P.length && E.push.apply(E, P), j && j.length && E.push.apply(E, j), g(E.length ? E : null);
          });
        }
      }
      var b;
      if (o.asyncValidator)
        b = o.asyncValidator(o, u.value, y, u.source, d);
      else if (o.validator) {
        try {
          b = o.validator(o, u.value, y, u.source, d);
        } catch (q) {
          (_a = console.error) == null ? void 0 : _a.call(console, q), d.suppressValidatorError || setTimeout(function() {
            throw q;
          }, 0), y(q.message);
        }
        b === true ? y() : b === false ? y(typeof o.message == "function" ? o.message(o.fullField || o.field) : o.message || (o.fullField || o.field) + " fails") : b instanceof Array ? y(b) : b instanceof Error && y(b.message);
      }
      b && b.then && b.then(function() {
        return y();
      }, function(q) {
        return y(q);
      });
    }, function(u) {
      h(u);
    }, s);
  }, e.getType = function(n) {
    if (n.type === void 0 && n.pattern instanceof RegExp && (n.type = "pattern"), typeof n.validator != "function" && n.type && !S.hasOwnProperty(n.type))
      throw new Error(F("Unknown rule type %s", n.type));
    return n.type || "string";
  }, e.getValidationMethod = function(n) {
    if (typeof n.validator == "function")
      return n.validator;
    var t = Object.keys(n), f = t.indexOf("message");
    return f !== -1 && t.splice(f, 1), t.length === 1 && t[0] === "required" ? S.required : S[this.getType(n)] || void 0;
  }, i;
}();
L.register = function(e, r) {
  if (typeof r != "function")
    throw new Error("Cannot register a validator by type, validator is not a function");
  S[e] = r;
};
L.warning = ie;
L.messages = I;
L.validators = S;
export {
  L as S
};
