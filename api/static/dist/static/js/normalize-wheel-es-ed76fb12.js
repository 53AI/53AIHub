var N = false, o, s, f, u, c, b, l, p, w, m, E, v, x, O, X;
function a() {
  if (!N) {
    N = true;
    var e = navigator.userAgent, n = /(?:MSIE.(\d+\.\d+))|(?:(?:Firefox|GranParadiso|Iceweasel).(\d+\.\d+))|(?:Opera(?:.+Version.|.)(\d+\.\d+))|(?:AppleWebKit.(\d+(?:\.\d+)?))|(?:Trident\/\d+\.\d+.*rv:(\d+\.\d+))/.exec(e), t = /(Mac OS X)|(Windows)|(Linux)/.exec(e);
    if (v = /\b(iPhone|iP[ao]d)/.exec(e), x = /\b(iP[ao]d)/.exec(e), m = /Android/i.exec(e), O = /FBAN\/\w+;/i.exec(e), X = /Mobile/i.exec(e), E = !!/Win64/.exec(e), n) {
      o = n[1] ? parseFloat(n[1]) : n[5] ? parseFloat(n[5]) : NaN, o && document && document.documentMode && (o = document.documentMode);
      var r = /(?:Trident\/(\d+.\d+))/.exec(e);
      b = r ? parseFloat(r[1]) + 4 : o, s = n[2] ? parseFloat(n[2]) : NaN, f = n[3] ? parseFloat(n[3]) : NaN, u = n[4] ? parseFloat(n[4]) : NaN, u ? (n = /(?:Chrome\/(\d+\.\d+))/.exec(e), c = n && n[1] ? parseFloat(n[1]) : NaN) : c = NaN;
    } else
      o = s = f = c = u = NaN;
    if (t) {
      if (t[1]) {
        var i = /(?:Mac OS X (\d+(?:[._]\d+)?))/.exec(e);
        l = i ? parseFloat(i[1].replace("_", ".")) : true;
      } else
        l = false;
      p = !!t[2], w = !!t[3];
    } else
      l = p = w = false;
  }
}
var h = { ie: function() {
  return a() || o;
}, ieCompatibilityMode: function() {
  return a() || b > o;
}, ie64: function() {
  return h.ie() && E;
}, firefox: function() {
  return a() || s;
}, opera: function() {
  return a() || f;
}, webkit: function() {
  return a() || u;
}, safari: function() {
  return h.webkit();
}, chrome: function() {
  return a() || c;
}, windows: function() {
  return a() || p;
}, osx: function() {
  return a() || l;
}, linux: function() {
  return a() || w;
}, iphone: function() {
  return a() || v;
}, mobile: function() {
  return a() || v || x || m || X;
}, nativeApp: function() {
  return a() || O;
}, android: function() {
  return a() || m;
}, ipad: function() {
  return a() || x;
} }, I = h, d = !!(typeof window < "u" && window.document && window.document.createElement), S = { canUseDOM: d, canUseWorkers: typeof Worker < "u", canUseEventListeners: d && !!(window.addEventListener || window.attachEvent), canUseViewport: d && !!window.screen, isInWorker: !d }, A = S, U;
A.canUseDOM && (U = document.implementation && document.implementation.hasFeature && document.implementation.hasFeature("", "") !== true);
function W(e, n) {
  if (!A.canUseDOM || n && !("addEventListener" in document))
    return false;
  var t = "on" + e, r = t in document;
  if (!r) {
    var i = document.createElement("div");
    i.setAttribute(t, "return;"), r = typeof i[t] == "function";
  }
  return !r && U && e === "wheel" && (r = document.implementation.hasFeature("Events.wheel", "3.0")), r;
}
var k = W, M = 10, F = 40, D = 800;
function Y(e) {
  var n = 0, t = 0, r = 0, i = 0;
  return "detail" in e && (t = e.detail), "wheelDelta" in e && (t = -e.wheelDelta / 120), "wheelDeltaY" in e && (t = -e.wheelDeltaY / 120), "wheelDeltaX" in e && (n = -e.wheelDeltaX / 120), "axis" in e && e.axis === e.HORIZONTAL_AXIS && (n = t, t = 0), r = n * M, i = t * M, "deltaY" in e && (i = e.deltaY), "deltaX" in e && (r = e.deltaX), (r || i) && e.deltaMode && (e.deltaMode == 1 ? (r *= F, i *= F) : (r *= D, i *= D)), r && !n && (n = r < 1 ? -1 : 1), i && !t && (t = i < 1 ? -1 : 1), { spinX: n, spinY: t, pixelX: r, pixelY: i };
}
Y.getEventType = function() {
  return I.firefox() ? "DOMMouseScroll" : k("wheel") ? "wheel" : "mousewheel";
};
var y = Y;
/**
* Checks if an event is supported in the current execution environment.
*
* NOTE: This will not work correctly for non-generic events such as `change`,
* `reset`, `load`, `error`, and `select`.
*
* Borrows from Modernizr.
*
* @param {string} eventNameSuffix Event name, e.g. "click".
* @param {?boolean} capture Check if the capture phase is supported.
* @return {boolean} True if the event is supported.
* @internal
* @license Modernizr 3.0.0pre (Custom Build) | MIT
*/
export {
  y as Y
};
