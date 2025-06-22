function an(o, t, n = false) {
  let e;
  return (...i) => {
    const r = () => {
      o(...i);
    };
    if (clearTimeout(e), n) {
      const a = !e;
      e = setTimeout(() => {
        e = void 0;
      }, t), a && r();
    } else
      e = setTimeout(r, t);
  };
}
/**!
* Sortable 1.15.6
* @author	RubaXa   <trash@rubaxa.org>
* @author	owenm    <owen23355@gmail.com>
* @license MIT
*/
function se(o, t) {
  var n = Object.keys(o);
  if (Object.getOwnPropertySymbols) {
    var e = Object.getOwnPropertySymbols(o);
    t && (e = e.filter(function(i) {
      return Object.getOwnPropertyDescriptor(o, i).enumerable;
    })), n.push.apply(n, e);
  }
  return n;
}
function z(o) {
  for (var t = 1; t < arguments.length; t++) {
    var n = arguments[t] != null ? arguments[t] : {};
    t % 2 ? se(Object(n), true).forEach(function(e) {
      Me(o, e, n[e]);
    }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(o, Object.getOwnPropertyDescriptors(n)) : se(Object(n)).forEach(function(e) {
      Object.defineProperty(o, e, Object.getOwnPropertyDescriptor(n, e));
    });
  }
  return o;
}
function Mt(o) {
  "@babel/helpers - typeof";
  return typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? Mt = function(t) {
    return typeof t;
  } : Mt = function(t) {
    return t && typeof Symbol == "function" && t.constructor === Symbol && t !== Symbol.prototype ? "symbol" : typeof t;
  }, Mt(o);
}
function Me(o, t, n) {
  return t in o ? Object.defineProperty(o, t, { value: n, enumerable: true, configurable: true, writable: true }) : o[t] = n, o;
}
function q() {
  return q = Object.assign || function(o) {
    for (var t = 1; t < arguments.length; t++) {
      var n = arguments[t];
      for (var e in n)
        Object.prototype.hasOwnProperty.call(n, e) && (o[e] = n[e]);
    }
    return o;
  }, q.apply(this, arguments);
}
function Fe(o, t) {
  if (o == null)
    return {};
  var n = {}, e = Object.keys(o), i, r;
  for (r = 0; r < e.length; r++)
    i = e[r], !(t.indexOf(i) >= 0) && (n[i] = o[i]);
  return n;
}
function Re(o, t) {
  if (o == null)
    return {};
  var n = Fe(o, t), e, i;
  if (Object.getOwnPropertySymbols) {
    var r = Object.getOwnPropertySymbols(o);
    for (i = 0; i < r.length; i++)
      e = r[i], !(t.indexOf(e) >= 0) && Object.prototype.propertyIsEnumerable.call(o, e) && (n[e] = o[e]);
  }
  return n;
}
var Xe = "1.15.6";
function U(o) {
  if (typeof window < "u" && window.navigator)
    return !!navigator.userAgent.match(o);
}
var V = U(/(?:Trident.*rv[ :]?11\.|msie|iemobile|Windows Phone)/i), Ct = U(/Edge/i), ue = U(/firefox/i), wt = U(/safari/i) && !U(/chrome/i) && !U(/android/i), oe = U(/iP(ad|od|hone)/i), ve = U(/chrome/i) && U(/android/i), be = { capture: false, passive: false };
function v(o, t, n) {
  o.addEventListener(t, n, !V && be);
}
function m(o, t, n) {
  o.removeEventListener(t, n, !V && be);
}
function kt(o, t) {
  if (t) {
    if (t[0] === ">" && (t = t.substring(1)), o)
      try {
        if (o.matches)
          return o.matches(t);
        if (o.msMatchesSelector)
          return o.msMatchesSelector(t);
        if (o.webkitMatchesSelector)
          return o.webkitMatchesSelector(t);
      } catch {
        return false;
      }
    return false;
  }
}
function Ee(o) {
  return o.host && o !== document && o.host.nodeType ? o.host : o.parentNode;
}
function W(o, t, n, e) {
  if (o) {
    n = n || document;
    do {
      if (t != null && (t[0] === ">" ? o.parentNode === n && kt(o, t) : kt(o, t)) || e && o === n)
        return o;
      if (o === n)
        break;
    } while (o = Ee(o));
  }
  return null;
}
var fe = /\s+/g;
function R(o, t, n) {
  if (o && t)
    if (o.classList)
      o.classList[n ? "add" : "remove"](t);
    else {
      var e = (" " + o.className + " ").replace(fe, " ").replace(" " + t + " ", " ");
      o.className = (e + (n ? " " + t : "")).replace(fe, " ");
    }
}
function h(o, t, n) {
  var e = o && o.style;
  if (e) {
    if (n === void 0)
      return document.defaultView && document.defaultView.getComputedStyle ? n = document.defaultView.getComputedStyle(o, "") : o.currentStyle && (n = o.currentStyle), t === void 0 ? n : n[t];
    !(t in e) && t.indexOf("webkit") === -1 && (t = "-webkit-" + t), e[t] = n + (typeof n == "string" ? "" : "px");
  }
}
function ct(o, t) {
  var n = "";
  if (typeof o == "string")
    n = o;
  else
    do {
      var e = h(o, "transform");
      e && e !== "none" && (n = e + " " + n);
    } while (!t && (o = o.parentNode));
  var i = window.DOMMatrix || window.WebKitCSSMatrix || window.CSSMatrix || window.MSCSSMatrix;
  return i && new i(n);
}
function ye(o, t, n) {
  if (o) {
    var e = o.getElementsByTagName(t), i = 0, r = e.length;
    if (n)
      for (; i < r; i++)
        n(e[i], i);
    return e;
  }
  return [];
}
function L() {
  var o = document.scrollingElement;
  return o || document.documentElement;
}
function C(o, t, n, e, i) {
  if (!(!o.getBoundingClientRect && o !== window)) {
    var r, a, l, s, u, d, c;
    if (o !== window && o.parentNode && o !== L() ? (r = o.getBoundingClientRect(), a = r.top, l = r.left, s = r.bottom, u = r.right, d = r.height, c = r.width) : (a = 0, l = 0, s = window.innerHeight, u = window.innerWidth, d = window.innerHeight, c = window.innerWidth), (t || n) && o !== window && (i = i || o.parentNode, !V))
      do
        if (i && i.getBoundingClientRect && (h(i, "transform") !== "none" || n && h(i, "position") !== "static")) {
          var b = i.getBoundingClientRect();
          a -= b.top + parseInt(h(i, "border-top-width")), l -= b.left + parseInt(h(i, "border-left-width")), s = a + r.height, u = l + r.width;
          break;
        }
      while (i = i.parentNode);
    if (e && o !== window) {
      var w = ct(i || o), E = w && w.a, y = w && w.d;
      w && (a /= y, l /= E, c /= E, d /= y, s = a + d, u = l + c);
    }
    return { top: a, left: l, bottom: s, right: u, width: c, height: d };
  }
}
function ce(o, t, n) {
  for (var e = tt(o, true), i = C(o)[t]; e; ) {
    var r = C(e)[n], a = void 0;
    if (n === "top" || n === "left" ? a = i >= r : a = i <= r, !a)
      return e;
    if (e === L())
      break;
    e = tt(e, false);
  }
  return false;
}
function dt(o, t, n, e) {
  for (var i = 0, r = 0, a = o.children; r < a.length; ) {
    if (a[r].style.display !== "none" && a[r] !== p.ghost && (e || a[r] !== p.dragged) && W(a[r], n.draggable, o, false)) {
      if (i === t)
        return a[r];
      i++;
    }
    r++;
  }
  return null;
}
function ie(o, t) {
  for (var n = o.lastElementChild; n && (n === p.ghost || h(n, "display") === "none" || t && !kt(n, t)); )
    n = n.previousElementSibling;
  return n || null;
}
function Y(o, t) {
  var n = 0;
  if (!o || !o.parentNode)
    return -1;
  for (; o = o.previousElementSibling; )
    o.nodeName.toUpperCase() !== "TEMPLATE" && o !== p.clone && (!t || kt(o, t)) && n++;
  return n;
}
function de(o) {
  var t = 0, n = 0, e = L();
  if (o)
    do {
      var i = ct(o), r = i.a, a = i.d;
      t += o.scrollLeft * r, n += o.scrollTop * a;
    } while (o !== e && (o = o.parentNode));
  return [t, n];
}
function Ye(o, t) {
  for (var n in o)
    if (o.hasOwnProperty(n)) {
      for (var e in t)
        if (t.hasOwnProperty(e) && t[e] === o[n][e])
          return Number(n);
    }
  return -1;
}
function tt(o, t) {
  if (!o || !o.getBoundingClientRect)
    return L();
  var n = o, e = false;
  do
    if (n.clientWidth < n.scrollWidth || n.clientHeight < n.scrollHeight) {
      var i = h(n);
      if (n.clientWidth < n.scrollWidth && (i.overflowX == "auto" || i.overflowX == "scroll") || n.clientHeight < n.scrollHeight && (i.overflowY == "auto" || i.overflowY == "scroll")) {
        if (!n.getBoundingClientRect || n === document.body)
          return L();
        if (e || t)
          return n;
        e = true;
      }
    }
  while (n = n.parentNode);
  return L();
}
function ke(o, t) {
  if (o && t)
    for (var n in t)
      t.hasOwnProperty(n) && (o[n] = t[n]);
  return o;
}
function zt(o, t) {
  return Math.round(o.top) === Math.round(t.top) && Math.round(o.left) === Math.round(t.left) && Math.round(o.height) === Math.round(t.height) && Math.round(o.width) === Math.round(t.width);
}
var _t;
function we(o, t) {
  return function() {
    if (!_t) {
      var n = arguments, e = this;
      n.length === 1 ? o.call(e, n[0]) : o.apply(e, n), _t = setTimeout(function() {
        _t = void 0;
      }, t);
    }
  };
}
function Be() {
  clearTimeout(_t), _t = void 0;
}
function _e(o, t, n) {
  o.scrollLeft += t, o.scrollTop += n;
}
function De(o) {
  var t = window.Polymer, n = window.jQuery || window.Zepto;
  return t && t.dom ? t.dom(o).cloneNode(true) : n ? n(o).clone(true)[0] : o.cloneNode(true);
}
function Se(o, t, n) {
  var e = {};
  return Array.from(o.children).forEach(function(i) {
    var r, a, l, s;
    if (!(!W(i, t.draggable, o, false) || i.animated || i === n)) {
      var u = C(i);
      e.left = Math.min((r = e.left) !== null && r !== void 0 ? r : 1 / 0, u.left), e.top = Math.min((a = e.top) !== null && a !== void 0 ? a : 1 / 0, u.top), e.right = Math.max((l = e.right) !== null && l !== void 0 ? l : -1 / 0, u.right), e.bottom = Math.max((s = e.bottom) !== null && s !== void 0 ? s : -1 / 0, u.bottom);
    }
  }), e.width = e.right - e.left, e.height = e.bottom - e.top, e.x = e.left, e.y = e.top, e;
}
var N = "Sortable" + (/* @__PURE__ */ new Date()).getTime();
function He() {
  var o = [], t;
  return { captureAnimationState: function() {
    if (o = [], !!this.options.animation) {
      var e = [].slice.call(this.el.children);
      e.forEach(function(i) {
        if (!(h(i, "display") === "none" || i === p.ghost)) {
          o.push({ target: i, rect: C(i) });
          var r = z({}, o[o.length - 1].rect);
          if (i.thisAnimationDuration) {
            var a = ct(i, true);
            a && (r.top -= a.f, r.left -= a.e);
          }
          i.fromRect = r;
        }
      });
    }
  }, addAnimationState: function(e) {
    o.push(e);
  }, removeAnimationState: function(e) {
    o.splice(Ye(o, { target: e }), 1);
  }, animateAll: function(e) {
    var i = this;
    if (!this.options.animation) {
      clearTimeout(t), typeof e == "function" && e();
      return;
    }
    var r = false, a = 0;
    o.forEach(function(l) {
      var s = 0, u = l.target, d = u.fromRect, c = C(u), b = u.prevFromRect, w = u.prevToRect, E = l.rect, y = ct(u, true);
      y && (c.top -= y.f, c.left -= y.e), u.toRect = c, u.thisAnimationDuration && zt(b, c) && !zt(d, c) && (E.top - c.top) / (E.left - c.left) === (d.top - c.top) / (d.left - c.left) && (s = Ge(E, b, w, i.options)), zt(c, d) || (u.prevFromRect = d, u.prevToRect = c, s || (s = i.options.animation), i.animate(u, E, c, s)), s && (r = true, a = Math.max(a, s), clearTimeout(u.animationResetTimer), u.animationResetTimer = setTimeout(function() {
        u.animationTime = 0, u.prevFromRect = null, u.fromRect = null, u.prevToRect = null, u.thisAnimationDuration = null;
      }, s), u.thisAnimationDuration = s);
    }), clearTimeout(t), r ? t = setTimeout(function() {
      typeof e == "function" && e();
    }, a) : typeof e == "function" && e(), o = [];
  }, animate: function(e, i, r, a) {
    if (a) {
      h(e, "transition", ""), h(e, "transform", "");
      var l = ct(this.el), s = l && l.a, u = l && l.d, d = (i.left - r.left) / (s || 1), c = (i.top - r.top) / (u || 1);
      e.animatingX = !!d, e.animatingY = !!c, h(e, "transform", "translate3d(" + d + "px," + c + "px,0)"), this.forRepaintDummy = We(e), h(e, "transition", "transform " + a + "ms" + (this.options.easing ? " " + this.options.easing : "")), h(e, "transform", "translate3d(0,0,0)"), typeof e.animated == "number" && clearTimeout(e.animated), e.animated = setTimeout(function() {
        h(e, "transition", ""), h(e, "transform", ""), e.animated = false, e.animatingX = false, e.animatingY = false;
      }, a);
    }
  } };
}
function We(o) {
  return o.offsetWidth;
}
function Ge(o, t, n, e) {
  return Math.sqrt(Math.pow(t.top - o.top, 2) + Math.pow(t.left - o.left, 2)) / Math.sqrt(Math.pow(t.top - n.top, 2) + Math.pow(t.left - n.left, 2)) * e.animation;
}
var lt = [], jt = { initializeByDefault: true }, Ot = { mount: function(t) {
  for (var n in jt)
    jt.hasOwnProperty(n) && !(n in t) && (t[n] = jt[n]);
  lt.forEach(function(e) {
    if (e.pluginName === t.pluginName)
      throw "Sortable: Cannot mount plugin ".concat(t.pluginName, " more than once");
  }), lt.push(t);
}, pluginEvent: function(t, n, e) {
  var i = this;
  this.eventCanceled = false, e.cancel = function() {
    i.eventCanceled = true;
  };
  var r = t + "Global";
  lt.forEach(function(a) {
    n[a.pluginName] && (n[a.pluginName][r] && n[a.pluginName][r](z({ sortable: n }, e)), n.options[a.pluginName] && n[a.pluginName][t] && n[a.pluginName][t](z({ sortable: n }, e)));
  });
}, initializePlugins: function(t, n, e, i) {
  lt.forEach(function(l) {
    var s = l.pluginName;
    if (!(!t.options[s] && !l.initializeByDefault)) {
      var u = new l(t, n, t.options);
      u.sortable = t, u.options = t.options, t[s] = u, q(e, u.defaults);
    }
  });
  for (var r in t.options)
    if (t.options.hasOwnProperty(r)) {
      var a = this.modifyOption(t, r, t.options[r]);
      typeof a < "u" && (t.options[r] = a);
    }
}, getEventProperties: function(t, n) {
  var e = {};
  return lt.forEach(function(i) {
    typeof i.eventProperties == "function" && q(e, i.eventProperties.call(n[i.pluginName], t));
  }), e;
}, modifyOption: function(t, n, e) {
  var i;
  return lt.forEach(function(r) {
    t[r.pluginName] && r.optionListeners && typeof r.optionListeners[n] == "function" && (i = r.optionListeners[n].call(t[r.pluginName], e));
  }), i;
} };
function Le(o) {
  var t = o.sortable, n = o.rootEl, e = o.name, i = o.targetEl, r = o.cloneEl, a = o.toEl, l = o.fromEl, s = o.oldIndex, u = o.newIndex, d = o.oldDraggableIndex, c = o.newDraggableIndex, b = o.originalEvent, w = o.putSortable, E = o.extraEventProperties;
  if (t = t || n && n[N], !!t) {
    var y, k = t.options, j = "on" + e.charAt(0).toUpperCase() + e.substr(1);
    window.CustomEvent && !V && !Ct ? y = new CustomEvent(e, { bubbles: true, cancelable: true }) : (y = document.createEvent("Event"), y.initEvent(e, true, true)), y.to = a || n, y.from = l || n, y.item = i || n, y.clone = r, y.oldIndex = s, y.newIndex = u, y.oldDraggableIndex = d, y.newDraggableIndex = c, y.originalEvent = b, y.pullMode = w ? w.lastPutMode : void 0;
    var A = z(z({}, E), Ot.getEventProperties(e, t));
    for (var B in A)
      y[B] = A[B];
    n && n.dispatchEvent(y), k[j] && k[j].call(t, y);
  }
}
var ze = ["evt"], x = function(t, n) {
  var e = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {}, i = e.evt, r = Re(e, ze);
  Ot.pluginEvent.bind(p)(t, n, z({ dragEl: f, parentEl: S, ghostEl: g, rootEl: _, nextEl: at, lastDownEl: Ft, cloneEl: D, cloneHidden: J, dragStarted: bt, putSortable: O, activeSortable: p.active, originalEvent: i, oldIndex: ft, oldDraggableIndex: Dt, newIndex: X, newDraggableIndex: Q, hideGhostForTarget: Ie, unhideGhostForTarget: Ae, cloneNowHidden: function() {
    J = true;
  }, cloneNowShown: function() {
    J = false;
  }, dispatchSortableEvent: function(l) {
    P({ sortable: n, name: l, originalEvent: i });
  } }, r));
};
function P(o) {
  Le(z({ putSortable: O, cloneEl: D, targetEl: f, rootEl: _, oldIndex: ft, oldDraggableIndex: Dt, newIndex: X, newDraggableIndex: Q }, o));
}
var f, S, g, _, at, Ft, D, J, ft, X, Dt, Q, At, O, ut = false, Bt = false, Ht = [], it, H, $t, Ut, he, pe, bt, st, St, Tt = false, Pt = false, Rt, I, qt = [], Jt = false, Wt = [], Lt = typeof document < "u", xt = oe, ge = Ct || V ? "cssFloat" : "float", je = Lt && !ve && !oe && "draggable" in document.createElement("div"), Te = function() {
  if (Lt) {
    if (V)
      return false;
    var o = document.createElement("x");
    return o.style.cssText = "pointer-events:auto", o.style.pointerEvents === "auto";
  }
}(), Ce = function(t, n) {
  var e = h(t), i = parseInt(e.width) - parseInt(e.paddingLeft) - parseInt(e.paddingRight) - parseInt(e.borderLeftWidth) - parseInt(e.borderRightWidth), r = dt(t, 0, n), a = dt(t, 1, n), l = r && h(r), s = a && h(a), u = l && parseInt(l.marginLeft) + parseInt(l.marginRight) + C(r).width, d = s && parseInt(s.marginLeft) + parseInt(s.marginRight) + C(a).width;
  if (e.display === "flex")
    return e.flexDirection === "column" || e.flexDirection === "column-reverse" ? "vertical" : "horizontal";
  if (e.display === "grid")
    return e.gridTemplateColumns.split(" ").length <= 1 ? "vertical" : "horizontal";
  if (r && l.float && l.float !== "none") {
    var c = l.float === "left" ? "left" : "right";
    return a && (s.clear === "both" || s.clear === c) ? "vertical" : "horizontal";
  }
  return r && (l.display === "block" || l.display === "flex" || l.display === "table" || l.display === "grid" || u >= i && e[ge] === "none" || a && e[ge] === "none" && u + d > i) ? "vertical" : "horizontal";
}, $e = function(t, n, e) {
  var i = e ? t.left : t.top, r = e ? t.right : t.bottom, a = e ? t.width : t.height, l = e ? n.left : n.top, s = e ? n.right : n.bottom, u = e ? n.width : n.height;
  return i === l || r === s || i + a / 2 === l + u / 2;
}, Ue = function(t, n) {
  var e;
  return Ht.some(function(i) {
    var r = i[N].options.emptyInsertThreshold;
    if (!(!r || ie(i))) {
      var a = C(i), l = t >= a.left - r && t <= a.right + r, s = n >= a.top - r && n <= a.bottom + r;
      if (l && s)
        return e = i;
    }
  }), e;
}, Oe = function(t) {
  function n(r, a) {
    return function(l, s, u, d) {
      var c = l.options.group.name && s.options.group.name && l.options.group.name === s.options.group.name;
      if (r == null && (a || c))
        return true;
      if (r == null || r === false)
        return false;
      if (a && r === "clone")
        return r;
      if (typeof r == "function")
        return n(r(l, s, u, d), a)(l, s, u, d);
      var b = (a ? l : s).options.group.name;
      return r === true || typeof r == "string" && r === b || r.join && r.indexOf(b) > -1;
    };
  }
  var e = {}, i = t.group;
  (!i || Mt(i) != "object") && (i = { name: i }), e.name = i.name, e.checkPull = n(i.pull, true), e.checkPut = n(i.put), e.revertClone = i.revertClone, t.group = e;
}, Ie = function() {
  !Te && g && h(g, "display", "none");
}, Ae = function() {
  !Te && g && h(g, "display", "");
};
Lt && !ve && document.addEventListener("click", function(o) {
  if (Bt)
    return o.preventDefault(), o.stopPropagation && o.stopPropagation(), o.stopImmediatePropagation && o.stopImmediatePropagation(), Bt = false, false;
}, true);
var rt = function(t) {
  if (f) {
    t = t.touches ? t.touches[0] : t;
    var n = Ue(t.clientX, t.clientY);
    if (n) {
      var e = {};
      for (var i in t)
        t.hasOwnProperty(i) && (e[i] = t[i]);
      e.target = e.rootEl = n, e.preventDefault = void 0, e.stopPropagation = void 0, n[N]._onDragOver(e);
    }
  }
}, qe = function(t) {
  f && f.parentNode[N]._isOutsideThisEl(t.target);
};
function p(o, t) {
  if (!(o && o.nodeType && o.nodeType === 1))
    throw "Sortable: `el` must be an HTMLElement, not ".concat({}.toString.call(o));
  this.el = o, this.options = t = q({}, t), o[N] = this;
  var n = { group: null, sort: true, disabled: false, store: null, handle: null, draggable: /^[uo]l$/i.test(o.nodeName) ? ">li" : ">*", swapThreshold: 1, invertSwap: false, invertedSwapThreshold: null, removeCloneOnHide: true, direction: function() {
    return Ce(o, this.options);
  }, ghostClass: "sortable-ghost", chosenClass: "sortable-chosen", dragClass: "sortable-drag", ignore: "a, img", filter: null, preventOnFilter: true, animation: 0, easing: null, setData: function(a, l) {
    a.setData("Text", l.textContent);
  }, dropBubble: false, dragoverBubble: false, dataIdAttr: "data-id", delay: 0, delayOnTouchOnly: false, touchStartThreshold: (Number.parseInt ? Number : window).parseInt(window.devicePixelRatio, 10) || 1, forceFallback: false, fallbackClass: "sortable-fallback", fallbackOnBody: false, fallbackTolerance: 0, fallbackOffset: { x: 0, y: 0 }, supportPointer: p.supportPointer !== false && "PointerEvent" in window && (!wt || oe), emptyInsertThreshold: 5 };
  Ot.initializePlugins(this, o, n);
  for (var e in n)
    !(e in t) && (t[e] = n[e]);
  Oe(t);
  for (var i in this)
    i.charAt(0) === "_" && typeof this[i] == "function" && (this[i] = this[i].bind(this));
  this.nativeDraggable = t.forceFallback ? false : je, this.nativeDraggable && (this.options.touchStartThreshold = 1), t.supportPointer ? v(o, "pointerdown", this._onTapStart) : (v(o, "mousedown", this._onTapStart), v(o, "touchstart", this._onTapStart)), this.nativeDraggable && (v(o, "dragover", this), v(o, "dragenter", this)), Ht.push(this.el), t.store && t.store.get && this.sort(t.store.get(this) || []), q(this, He());
}
p.prototype = { constructor: p, _isOutsideThisEl: function(t) {
  !this.el.contains(t) && t !== this.el && (st = null);
}, _getDirection: function(t, n) {
  return typeof this.options.direction == "function" ? this.options.direction.call(this, t, n, f) : this.options.direction;
}, _onTapStart: function(t) {
  if (t.cancelable) {
    var n = this, e = this.el, i = this.options, r = i.preventOnFilter, a = t.type, l = t.touches && t.touches[0] || t.pointerType && t.pointerType === "touch" && t, s = (l || t).target, u = t.target.shadowRoot && (t.path && t.path[0] || t.composedPath && t.composedPath()[0]) || s, d = i.filter;
    if (nn(e), !f && !(/mousedown|pointerdown/.test(a) && t.button !== 0 || i.disabled) && !u.isContentEditable && !(!this.nativeDraggable && wt && s && s.tagName.toUpperCase() === "SELECT") && (s = W(s, i.draggable, e, false), !(s && s.animated) && Ft !== s)) {
      if (ft = Y(s), Dt = Y(s, i.draggable), typeof d == "function") {
        if (d.call(this, t, s, this)) {
          P({ sortable: n, rootEl: u, name: "filter", targetEl: s, toEl: e, fromEl: e }), x("filter", n, { evt: t }), r && t.preventDefault();
          return;
        }
      } else if (d && (d = d.split(",").some(function(c) {
        if (c = W(u, c.trim(), e, false), c)
          return P({ sortable: n, rootEl: c, name: "filter", targetEl: s, fromEl: e, toEl: e }), x("filter", n, { evt: t }), true;
      }), d)) {
        r && t.preventDefault();
        return;
      }
      i.handle && !W(u, i.handle, e, false) || this._prepareDragStart(t, l, s);
    }
  }
}, _prepareDragStart: function(t, n, e) {
  var i = this, r = i.el, a = i.options, l = r.ownerDocument, s;
  if (e && !f && e.parentNode === r) {
    var u = C(e);
    if (_ = r, f = e, S = f.parentNode, at = f.nextSibling, Ft = e, At = a.group, p.dragged = f, it = { target: f, clientX: (n || t).clientX, clientY: (n || t).clientY }, he = it.clientX - u.left, pe = it.clientY - u.top, this._lastX = (n || t).clientX, this._lastY = (n || t).clientY, f.style["will-change"] = "all", s = function() {
      if (x("delayEnded", i, { evt: t }), p.eventCanceled) {
        i._onDrop();
        return;
      }
      i._disableDelayedDragEvents(), !ue && i.nativeDraggable && (f.draggable = true), i._triggerDragStart(t, n), P({ sortable: i, name: "choose", originalEvent: t }), R(f, a.chosenClass, true);
    }, a.ignore.split(",").forEach(function(d) {
      ye(f, d.trim(), Vt);
    }), v(l, "dragover", rt), v(l, "mousemove", rt), v(l, "touchmove", rt), a.supportPointer ? (v(l, "pointerup", i._onDrop), !this.nativeDraggable && v(l, "pointercancel", i._onDrop)) : (v(l, "mouseup", i._onDrop), v(l, "touchend", i._onDrop), v(l, "touchcancel", i._onDrop)), ue && this.nativeDraggable && (this.options.touchStartThreshold = 4, f.draggable = true), x("delayStart", this, { evt: t }), a.delay && (!a.delayOnTouchOnly || n) && (!this.nativeDraggable || !(Ct || V))) {
      if (p.eventCanceled) {
        this._onDrop();
        return;
      }
      a.supportPointer ? (v(l, "pointerup", i._disableDelayedDrag), v(l, "pointercancel", i._disableDelayedDrag)) : (v(l, "mouseup", i._disableDelayedDrag), v(l, "touchend", i._disableDelayedDrag), v(l, "touchcancel", i._disableDelayedDrag)), v(l, "mousemove", i._delayedDragTouchMoveHandler), v(l, "touchmove", i._delayedDragTouchMoveHandler), a.supportPointer && v(l, "pointermove", i._delayedDragTouchMoveHandler), i._dragStartTimer = setTimeout(s, a.delay);
    } else
      s();
  }
}, _delayedDragTouchMoveHandler: function(t) {
  var n = t.touches ? t.touches[0] : t;
  Math.max(Math.abs(n.clientX - this._lastX), Math.abs(n.clientY - this._lastY)) >= Math.floor(this.options.touchStartThreshold / (this.nativeDraggable && window.devicePixelRatio || 1)) && this._disableDelayedDrag();
}, _disableDelayedDrag: function() {
  f && Vt(f), clearTimeout(this._dragStartTimer), this._disableDelayedDragEvents();
}, _disableDelayedDragEvents: function() {
  var t = this.el.ownerDocument;
  m(t, "mouseup", this._disableDelayedDrag), m(t, "touchend", this._disableDelayedDrag), m(t, "touchcancel", this._disableDelayedDrag), m(t, "pointerup", this._disableDelayedDrag), m(t, "pointercancel", this._disableDelayedDrag), m(t, "mousemove", this._delayedDragTouchMoveHandler), m(t, "touchmove", this._delayedDragTouchMoveHandler), m(t, "pointermove", this._delayedDragTouchMoveHandler);
}, _triggerDragStart: function(t, n) {
  n = n || t.pointerType == "touch" && t, !this.nativeDraggable || n ? this.options.supportPointer ? v(document, "pointermove", this._onTouchMove) : n ? v(document, "touchmove", this._onTouchMove) : v(document, "mousemove", this._onTouchMove) : (v(f, "dragend", this), v(_, "dragstart", this._onDragStart));
  try {
    document.selection ? Xt(function() {
      document.selection.empty();
    }) : window.getSelection().removeAllRanges();
  } catch {
  }
}, _dragStarted: function(t, n) {
  if (ut = false, _ && f) {
    x("dragStarted", this, { evt: n }), this.nativeDraggable && v(document, "dragover", qe);
    var e = this.options;
    !t && R(f, e.dragClass, false), R(f, e.ghostClass, true), p.active = this, t && this._appendGhost(), P({ sortable: this, name: "start", originalEvent: n });
  } else
    this._nulling();
}, _emulateDragOver: function() {
  if (H) {
    this._lastX = H.clientX, this._lastY = H.clientY, Ie();
    for (var t = document.elementFromPoint(H.clientX, H.clientY), n = t; t && t.shadowRoot && (t = t.shadowRoot.elementFromPoint(H.clientX, H.clientY), t !== n); )
      n = t;
    if (f.parentNode[N]._isOutsideThisEl(t), n)
      do {
        if (n[N]) {
          var e = void 0;
          if (e = n[N]._onDragOver({ clientX: H.clientX, clientY: H.clientY, target: t, rootEl: n }), e && !this.options.dragoverBubble)
            break;
        }
        t = n;
      } while (n = Ee(n));
    Ae();
  }
}, _onTouchMove: function(t) {
  if (it) {
    var n = this.options, e = n.fallbackTolerance, i = n.fallbackOffset, r = t.touches ? t.touches[0] : t, a = g && ct(g, true), l = g && a && a.a, s = g && a && a.d, u = xt && I && de(I), d = (r.clientX - it.clientX + i.x) / (l || 1) + (u ? u[0] - qt[0] : 0) / (l || 1), c = (r.clientY - it.clientY + i.y) / (s || 1) + (u ? u[1] - qt[1] : 0) / (s || 1);
    if (!p.active && !ut) {
      if (e && Math.max(Math.abs(r.clientX - this._lastX), Math.abs(r.clientY - this._lastY)) < e)
        return;
      this._onDragStart(t, true);
    }
    if (g) {
      a ? (a.e += d - ($t || 0), a.f += c - (Ut || 0)) : a = { a: 1, b: 0, c: 0, d: 1, e: d, f: c };
      var b = "matrix(".concat(a.a, ",").concat(a.b, ",").concat(a.c, ",").concat(a.d, ",").concat(a.e, ",").concat(a.f, ")");
      h(g, "webkitTransform", b), h(g, "mozTransform", b), h(g, "msTransform", b), h(g, "transform", b), $t = d, Ut = c, H = r;
    }
    t.cancelable && t.preventDefault();
  }
}, _appendGhost: function() {
  if (!g) {
    var t = this.options.fallbackOnBody ? document.body : _, n = C(f, true, xt, true, t), e = this.options;
    if (xt) {
      for (I = t; h(I, "position") === "static" && h(I, "transform") === "none" && I !== document; )
        I = I.parentNode;
      I !== document.body && I !== document.documentElement ? (I === document && (I = L()), n.top += I.scrollTop, n.left += I.scrollLeft) : I = L(), qt = de(I);
    }
    g = f.cloneNode(true), R(g, e.ghostClass, false), R(g, e.fallbackClass, true), R(g, e.dragClass, true), h(g, "transition", ""), h(g, "transform", ""), h(g, "box-sizing", "border-box"), h(g, "margin", 0), h(g, "top", n.top), h(g, "left", n.left), h(g, "width", n.width), h(g, "height", n.height), h(g, "opacity", "0.8"), h(g, "position", xt ? "absolute" : "fixed"), h(g, "zIndex", "100000"), h(g, "pointerEvents", "none"), p.ghost = g, t.appendChild(g), h(g, "transform-origin", he / parseInt(g.style.width) * 100 + "% " + pe / parseInt(g.style.height) * 100 + "%");
  }
}, _onDragStart: function(t, n) {
  var e = this, i = t.dataTransfer, r = e.options;
  if (x("dragStart", this, { evt: t }), p.eventCanceled) {
    this._onDrop();
    return;
  }
  x("setupClone", this), p.eventCanceled || (D = De(f), D.removeAttribute("id"), D.draggable = false, D.style["will-change"] = "", this._hideClone(), R(D, this.options.chosenClass, false), p.clone = D), e.cloneId = Xt(function() {
    x("clone", e), !p.eventCanceled && (e.options.removeCloneOnHide || _.insertBefore(D, f), e._hideClone(), P({ sortable: e, name: "clone" }));
  }), !n && R(f, r.dragClass, true), n ? (Bt = true, e._loopId = setInterval(e._emulateDragOver, 50)) : (m(document, "mouseup", e._onDrop), m(document, "touchend", e._onDrop), m(document, "touchcancel", e._onDrop), i && (i.effectAllowed = "move", r.setData && r.setData.call(e, i, f)), v(document, "drop", e), h(f, "transform", "translateZ(0)")), ut = true, e._dragStartId = Xt(e._dragStarted.bind(e, n, t)), v(document, "selectstart", e), bt = true, window.getSelection().removeAllRanges(), wt && h(document.body, "user-select", "none");
}, _onDragOver: function(t) {
  var n = this.el, e = t.target, i, r, a, l = this.options, s = l.group, u = p.active, d = At === s, c = l.sort, b = O || u, w, E = this, y = false;
  if (Jt)
    return;
  function k(vt, xe) {
    x(vt, E, z({ evt: t, isOwner: d, axis: w ? "vertical" : "horizontal", revert: a, dragRect: i, targetRect: r, canSort: c, fromSortable: b, target: e, completed: A, onMove: function(le, Ne) {
      return Nt(_, n, f, i, le, C(le), t, Ne);
    }, changed: B }, xe));
  }
  function j() {
    k("dragOverAnimationCapture"), E.captureAnimationState(), E !== b && b.captureAnimationState();
  }
  function A(vt) {
    return k("dragOverCompleted", { insertion: vt }), vt && (d ? u._hideClone() : u._showClone(E), E !== b && (R(f, O ? O.options.ghostClass : u.options.ghostClass, false), R(f, l.ghostClass, true)), O !== E && E !== p.active ? O = E : E === p.active && O && (O = null), b === E && (E._ignoreWhileAnimating = e), E.animateAll(function() {
      k("dragOverAnimationComplete"), E._ignoreWhileAnimating = null;
    }), E !== b && (b.animateAll(), b._ignoreWhileAnimating = null)), (e === f && !f.animated || e === n && !e.animated) && (st = null), !l.dragoverBubble && !t.rootEl && e !== document && (f.parentNode[N]._isOutsideThisEl(t.target), !vt && rt(t)), !l.dragoverBubble && t.stopPropagation && t.stopPropagation(), y = true;
  }
  function B() {
    X = Y(f), Q = Y(f, l.draggable), P({ sortable: E, name: "change", toEl: n, newIndex: X, newDraggableIndex: Q, originalEvent: t });
  }
  if (t.preventDefault !== void 0 && t.cancelable && t.preventDefault(), e = W(e, l.draggable, n, true), k("dragOver"), p.eventCanceled)
    return y;
  if (f.contains(t.target) || e.animated && e.animatingX && e.animatingY || E._ignoreWhileAnimating === e)
    return A(false);
  if (Bt = false, u && !l.disabled && (d ? c || (a = S !== _) : O === this || (this.lastPutMode = At.checkPull(this, u, f, t)) && s.checkPut(this, u, f, t))) {
    if (w = this._getDirection(t, e) === "vertical", i = C(f), k("dragOverValid"), p.eventCanceled)
      return y;
    if (a)
      return S = _, j(), this._hideClone(), k("revert"), p.eventCanceled || (at ? _.insertBefore(f, at) : _.appendChild(f)), A(true);
    var M = ie(n, l.draggable);
    if (!M || Qe(t, w, this) && !M.animated) {
      if (M === f)
        return A(false);
      if (M && n === t.target && (e = M), e && (r = C(e)), Nt(_, n, f, i, e, r, t, !!e) !== false)
        return j(), M && M.nextSibling ? n.insertBefore(f, M.nextSibling) : n.appendChild(f), S = n, B(), A(true);
    } else if (M && Ze(t, w, this)) {
      var et = dt(n, 0, l, true);
      if (et === f)
        return A(false);
      if (e = et, r = C(e), Nt(_, n, f, i, e, r, t, false) !== false)
        return j(), n.insertBefore(f, et), S = n, B(), A(true);
    } else if (e.parentNode === n) {
      r = C(e);
      var G = 0, nt, ht = f.parentNode !== n, F = !$e(f.animated && f.toRect || i, e.animated && e.toRect || r, w), pt = w ? "top" : "left", K = ce(e, "top", "top") || ce(f, "top", "top"), gt = K ? K.scrollTop : void 0;
      st !== e && (nt = r[pt], Tt = false, Pt = !F && l.invertSwap || ht), G = Je(t, e, r, w, F ? 1 : l.swapThreshold, l.invertedSwapThreshold == null ? l.swapThreshold : l.invertedSwapThreshold, Pt, st === e);
      var $;
      if (G !== 0) {
        var ot = Y(f);
        do
          ot -= G, $ = S.children[ot];
        while ($ && (h($, "display") === "none" || $ === g));
      }
      if (G === 0 || $ === e)
        return A(false);
      st = e, St = G;
      var mt = e.nextElementSibling, Z = false;
      Z = G === 1;
      var It = Nt(_, n, f, i, e, r, t, Z);
      if (It !== false)
        return (It === 1 || It === -1) && (Z = It === 1), Jt = true, setTimeout(Ke, 30), j(), Z && !mt ? n.appendChild(f) : e.parentNode.insertBefore(f, Z ? mt : e), K && _e(K, 0, gt - K.scrollTop), S = f.parentNode, nt !== void 0 && !Pt && (Rt = Math.abs(nt - C(e)[pt])), B(), A(true);
    }
    if (n.contains(f))
      return A(false);
  }
  return false;
}, _ignoreWhileAnimating: null, _offMoveEvents: function() {
  m(document, "mousemove", this._onTouchMove), m(document, "touchmove", this._onTouchMove), m(document, "pointermove", this._onTouchMove), m(document, "dragover", rt), m(document, "mousemove", rt), m(document, "touchmove", rt);
}, _offUpEvents: function() {
  var t = this.el.ownerDocument;
  m(t, "mouseup", this._onDrop), m(t, "touchend", this._onDrop), m(t, "pointerup", this._onDrop), m(t, "pointercancel", this._onDrop), m(t, "touchcancel", this._onDrop), m(document, "selectstart", this);
}, _onDrop: function(t) {
  var n = this.el, e = this.options;
  if (X = Y(f), Q = Y(f, e.draggable), x("drop", this, { evt: t }), S = f && f.parentNode, X = Y(f), Q = Y(f, e.draggable), p.eventCanceled) {
    this._nulling();
    return;
  }
  ut = false, Pt = false, Tt = false, clearInterval(this._loopId), clearTimeout(this._dragStartTimer), te(this.cloneId), te(this._dragStartId), this.nativeDraggable && (m(document, "drop", this), m(n, "dragstart", this._onDragStart)), this._offMoveEvents(), this._offUpEvents(), wt && h(document.body, "user-select", ""), h(f, "transform", ""), t && (bt && (t.cancelable && t.preventDefault(), !e.dropBubble && t.stopPropagation()), g && g.parentNode && g.parentNode.removeChild(g), (_ === S || O && O.lastPutMode !== "clone") && D && D.parentNode && D.parentNode.removeChild(D), f && (this.nativeDraggable && m(f, "dragend", this), Vt(f), f.style["will-change"] = "", bt && !ut && R(f, O ? O.options.ghostClass : this.options.ghostClass, false), R(f, this.options.chosenClass, false), P({ sortable: this, name: "unchoose", toEl: S, newIndex: null, newDraggableIndex: null, originalEvent: t }), _ !== S ? (X >= 0 && (P({ rootEl: S, name: "add", toEl: S, fromEl: _, originalEvent: t }), P({ sortable: this, name: "remove", toEl: S, originalEvent: t }), P({ rootEl: S, name: "sort", toEl: S, fromEl: _, originalEvent: t }), P({ sortable: this, name: "sort", toEl: S, originalEvent: t })), O && O.save()) : X !== ft && X >= 0 && (P({ sortable: this, name: "update", toEl: S, originalEvent: t }), P({ sortable: this, name: "sort", toEl: S, originalEvent: t })), p.active && ((X == null || X === -1) && (X = ft, Q = Dt), P({ sortable: this, name: "end", toEl: S, originalEvent: t }), this.save()))), this._nulling();
}, _nulling: function() {
  x("nulling", this), _ = f = S = g = at = D = Ft = J = it = H = bt = X = Q = ft = Dt = st = St = O = At = p.dragged = p.ghost = p.clone = p.active = null, Wt.forEach(function(t) {
    t.checked = true;
  }), Wt.length = $t = Ut = 0;
}, handleEvent: function(t) {
  switch (t.type) {
    case "drop":
    case "dragend":
      this._onDrop(t);
      break;
    case "dragenter":
    case "dragover":
      f && (this._onDragOver(t), Ve(t));
      break;
    case "selectstart":
      t.preventDefault();
      break;
  }
}, toArray: function() {
  for (var t = [], n, e = this.el.children, i = 0, r = e.length, a = this.options; i < r; i++)
    n = e[i], W(n, a.draggable, this.el, false) && t.push(n.getAttribute(a.dataIdAttr) || en(n));
  return t;
}, sort: function(t, n) {
  var e = {}, i = this.el;
  this.toArray().forEach(function(r, a) {
    var l = i.children[a];
    W(l, this.options.draggable, i, false) && (e[r] = l);
  }, this), n && this.captureAnimationState(), t.forEach(function(r) {
    e[r] && (i.removeChild(e[r]), i.appendChild(e[r]));
  }), n && this.animateAll();
}, save: function() {
  var t = this.options.store;
  t && t.set && t.set(this);
}, closest: function(t, n) {
  return W(t, n || this.options.draggable, this.el, false);
}, option: function(t, n) {
  var e = this.options;
  if (n === void 0)
    return e[t];
  var i = Ot.modifyOption(this, t, n);
  typeof i < "u" ? e[t] = i : e[t] = n, t === "group" && Oe(e);
}, destroy: function() {
  x("destroy", this);
  var t = this.el;
  t[N] = null, m(t, "mousedown", this._onTapStart), m(t, "touchstart", this._onTapStart), m(t, "pointerdown", this._onTapStart), this.nativeDraggable && (m(t, "dragover", this), m(t, "dragenter", this)), Array.prototype.forEach.call(t.querySelectorAll("[draggable]"), function(n) {
    n.removeAttribute("draggable");
  }), this._onDrop(), this._disableDelayedDragEvents(), Ht.splice(Ht.indexOf(this.el), 1), this.el = t = null;
}, _hideClone: function() {
  if (!J) {
    if (x("hideClone", this), p.eventCanceled)
      return;
    h(D, "display", "none"), this.options.removeCloneOnHide && D.parentNode && D.parentNode.removeChild(D), J = true;
  }
}, _showClone: function(t) {
  if (t.lastPutMode !== "clone") {
    this._hideClone();
    return;
  }
  if (J) {
    if (x("showClone", this), p.eventCanceled)
      return;
    f.parentNode == _ && !this.options.group.revertClone ? _.insertBefore(D, f) : at ? _.insertBefore(D, at) : _.appendChild(D), this.options.group.revertClone && this.animate(f, D), h(D, "display", ""), J = false;
  }
} };
function Ve(o) {
  o.dataTransfer && (o.dataTransfer.dropEffect = "move"), o.cancelable && o.preventDefault();
}
function Nt(o, t, n, e, i, r, a, l) {
  var s, u = o[N], d = u.options.onMove, c;
  return window.CustomEvent && !V && !Ct ? s = new CustomEvent("move", { bubbles: true, cancelable: true }) : (s = document.createEvent("Event"), s.initEvent("move", true, true)), s.to = t, s.from = o, s.dragged = n, s.draggedRect = e, s.related = i || t, s.relatedRect = r || C(t), s.willInsertAfter = l, s.originalEvent = a, o.dispatchEvent(s), d && (c = d.call(u, s, a)), c;
}
function Vt(o) {
  o.draggable = false;
}
function Ke() {
  Jt = false;
}
function Ze(o, t, n) {
  var e = C(dt(n.el, 0, n.options, true)), i = Se(n.el, n.options, g), r = 10;
  return t ? o.clientX < i.left - r || o.clientY < e.top && o.clientX < e.right : o.clientY < i.top - r || o.clientY < e.bottom && o.clientX < e.left;
}
function Qe(o, t, n) {
  var e = C(ie(n.el, n.options.draggable)), i = Se(n.el, n.options, g), r = 10;
  return t ? o.clientX > i.right + r || o.clientY > e.bottom && o.clientX > e.left : o.clientY > i.bottom + r || o.clientX > e.right && o.clientY > e.top;
}
function Je(o, t, n, e, i, r, a, l) {
  var s = e ? o.clientY : o.clientX, u = e ? n.height : n.width, d = e ? n.top : n.left, c = e ? n.bottom : n.right, b = false;
  if (!a) {
    if (l && Rt < u * i) {
      if (!Tt && (St === 1 ? s > d + u * r / 2 : s < c - u * r / 2) && (Tt = true), Tt)
        b = true;
      else if (St === 1 ? s < d + Rt : s > c - Rt)
        return -St;
    } else if (s > d + u * (1 - i) / 2 && s < c - u * (1 - i) / 2)
      return tn(t);
  }
  return b = b || a, b && (s < d + u * r / 2 || s > c - u * r / 2) ? s > d + u / 2 ? 1 : -1 : 0;
}
function tn(o) {
  return Y(f) < Y(o) ? 1 : -1;
}
function en(o) {
  for (var t = o.tagName + o.className + o.src + o.href + o.textContent, n = t.length, e = 0; n--; )
    e += t.charCodeAt(n);
  return e.toString(36);
}
function nn(o) {
  Wt.length = 0;
  for (var t = o.getElementsByTagName("input"), n = t.length; n--; ) {
    var e = t[n];
    e.checked && Wt.push(e);
  }
}
function Xt(o) {
  return setTimeout(o, 0);
}
function te(o) {
  return clearTimeout(o);
}
Lt && v(document, "touchmove", function(o) {
  (p.active || ut) && o.cancelable && o.preventDefault();
});
p.utils = { on: v, off: m, css: h, find: ye, is: function(t, n) {
  return !!W(t, n, t, false);
}, extend: ke, throttle: we, closest: W, toggleClass: R, clone: De, index: Y, nextTick: Xt, cancelNextTick: te, detectDirection: Ce, getChild: dt, expando: N };
p.get = function(o) {
  return o[N];
};
p.mount = function() {
  for (var o = arguments.length, t = new Array(o), n = 0; n < o; n++)
    t[n] = arguments[n];
  t[0].constructor === Array && (t = t[0]), t.forEach(function(e) {
    if (!e.prototype || !e.prototype.constructor)
      throw "Sortable: Mounted plugin must be a constructor function, not ".concat({}.toString.call(e));
    e.utils && (p.utils = z(z({}, p.utils), e.utils)), Ot.mount(e);
  });
};
p.create = function(o, t) {
  return new p(o, t);
};
p.version = Xe;
var T = [], Et, ee, ne = false, Kt, Zt, Gt, yt;
function on() {
  function o() {
    this.defaults = { scroll: true, forceAutoScrollFallback: false, scrollSensitivity: 30, scrollSpeed: 10, bubbleScroll: true };
    for (var t in this)
      t.charAt(0) === "_" && typeof this[t] == "function" && (this[t] = this[t].bind(this));
  }
  return o.prototype = { dragStarted: function(n) {
    var e = n.originalEvent;
    this.sortable.nativeDraggable ? v(document, "dragover", this._handleAutoScroll) : this.options.supportPointer ? v(document, "pointermove", this._handleFallbackAutoScroll) : e.touches ? v(document, "touchmove", this._handleFallbackAutoScroll) : v(document, "mousemove", this._handleFallbackAutoScroll);
  }, dragOverCompleted: function(n) {
    var e = n.originalEvent;
    !this.options.dragOverBubble && !e.rootEl && this._handleAutoScroll(e);
  }, drop: function() {
    this.sortable.nativeDraggable ? m(document, "dragover", this._handleAutoScroll) : (m(document, "pointermove", this._handleFallbackAutoScroll), m(document, "touchmove", this._handleFallbackAutoScroll), m(document, "mousemove", this._handleFallbackAutoScroll)), me(), Yt(), Be();
  }, nulling: function() {
    Gt = ee = Et = ne = yt = Kt = Zt = null, T.length = 0;
  }, _handleFallbackAutoScroll: function(n) {
    this._handleAutoScroll(n, true);
  }, _handleAutoScroll: function(n, e) {
    var i = this, r = (n.touches ? n.touches[0] : n).clientX, a = (n.touches ? n.touches[0] : n).clientY, l = document.elementFromPoint(r, a);
    if (Gt = n, e || this.options.forceAutoScrollFallback || Ct || V || wt) {
      Qt(n, this.options, l, e);
      var s = tt(l, true);
      ne && (!yt || r !== Kt || a !== Zt) && (yt && me(), yt = setInterval(function() {
        var u = tt(document.elementFromPoint(r, a), true);
        u !== s && (s = u, Yt()), Qt(n, i.options, u, e);
      }, 10), Kt = r, Zt = a);
    } else {
      if (!this.options.bubbleScroll || tt(l, true) === L()) {
        Yt();
        return;
      }
      Qt(n, this.options, tt(l, false), false);
    }
  } }, q(o, { pluginName: "scroll", initializeByDefault: true });
}
function Yt() {
  T.forEach(function(o) {
    clearInterval(o.pid);
  }), T = [];
}
function me() {
  clearInterval(yt);
}
var Qt = we(function(o, t, n, e) {
  if (t.scroll) {
    var i = (o.touches ? o.touches[0] : o).clientX, r = (o.touches ? o.touches[0] : o).clientY, a = t.scrollSensitivity, l = t.scrollSpeed, s = L(), u = false, d;
    ee !== n && (ee = n, Yt(), Et = t.scroll, d = t.scrollFn, Et === true && (Et = tt(n, true)));
    var c = 0, b = Et;
    do {
      var w = b, E = C(w), y = E.top, k = E.bottom, j = E.left, A = E.right, B = E.width, M = E.height, et = void 0, G = void 0, nt = w.scrollWidth, ht = w.scrollHeight, F = h(w), pt = w.scrollLeft, K = w.scrollTop;
      w === s ? (et = B < nt && (F.overflowX === "auto" || F.overflowX === "scroll" || F.overflowX === "visible"), G = M < ht && (F.overflowY === "auto" || F.overflowY === "scroll" || F.overflowY === "visible")) : (et = B < nt && (F.overflowX === "auto" || F.overflowX === "scroll"), G = M < ht && (F.overflowY === "auto" || F.overflowY === "scroll"));
      var gt = et && (Math.abs(A - i) <= a && pt + B < nt) - (Math.abs(j - i) <= a && !!pt), $ = G && (Math.abs(k - r) <= a && K + M < ht) - (Math.abs(y - r) <= a && !!K);
      if (!T[c])
        for (var ot = 0; ot <= c; ot++)
          T[ot] || (T[ot] = {});
      (T[c].vx != gt || T[c].vy != $ || T[c].el !== w) && (T[c].el = w, T[c].vx = gt, T[c].vy = $, clearInterval(T[c].pid), (gt != 0 || $ != 0) && (u = true, T[c].pid = setInterval((function() {
        e && this.layer === 0 && p.active._onTouchMove(Gt);
        var mt = T[this.layer].vy ? T[this.layer].vy * l : 0, Z = T[this.layer].vx ? T[this.layer].vx * l : 0;
        typeof d == "function" && d.call(p.dragged.parentNode[N], Z, mt, o, Gt, T[this.layer].el) !== "continue" || _e(T[this.layer].el, Z, mt);
      }).bind({ layer: c }), 24))), c++;
    } while (t.bubbleScroll && b !== s && (b = tt(b, false)));
    ne = u;
  }
}, 30), Pe = function(t) {
  var n = t.originalEvent, e = t.putSortable, i = t.dragEl, r = t.activeSortable, a = t.dispatchSortableEvent, l = t.hideGhostForTarget, s = t.unhideGhostForTarget;
  if (n) {
    var u = e || r;
    l();
    var d = n.changedTouches && n.changedTouches.length ? n.changedTouches[0] : n, c = document.elementFromPoint(d.clientX, d.clientY);
    s(), u && !u.el.contains(c) && (a("spill"), this.onSpill({ dragEl: i, putSortable: e }));
  }
};
function re() {
}
re.prototype = { startIndex: null, dragStart: function(t) {
  var n = t.oldDraggableIndex;
  this.startIndex = n;
}, onSpill: function(t) {
  var n = t.dragEl, e = t.putSortable;
  this.sortable.captureAnimationState(), e && e.captureAnimationState();
  var i = dt(this.sortable.el, this.startIndex, this.options);
  i ? this.sortable.el.insertBefore(n, i) : this.sortable.el.appendChild(n), this.sortable.animateAll(), e && e.animateAll();
}, drop: Pe };
q(re, { pluginName: "revertOnSpill" });
function ae() {
}
ae.prototype = { onSpill: function(t) {
  var n = t.dragEl, e = t.putSortable, i = e || this.sortable;
  i.captureAnimationState(), n.parentNode && n.parentNode.removeChild(n), i.animateAll();
}, drop: Pe };
q(ae, { pluginName: "removeOnSpill" });
p.mount(new on());
p.mount(ae, re);
export {
  p as S,
  an as d
};
