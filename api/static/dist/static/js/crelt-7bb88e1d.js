function s() {
  var r = arguments[0];
  typeof r == "string" && (r = document.createElement(r));
  var e = 1, t = arguments[1];
  if (t && typeof t == "object" && t.nodeType == null && !Array.isArray(t)) {
    for (var n in t)
      if (Object.prototype.hasOwnProperty.call(t, n)) {
        var o = t[n];
        typeof o == "string" ? r.setAttribute(n, o) : o != null && (r[n] = o);
      }
    e++;
  }
  for (; e < arguments.length; e++)
    f(r, arguments[e]);
  return r;
}
function f(r, e) {
  if (typeof e == "string")
    r.appendChild(document.createTextNode(e));
  else if (e != null)
    if (e.nodeType != null)
      r.appendChild(e);
    else if (Array.isArray(e))
      for (var t = 0; t < e.length; t++)
        f(r, e[t]);
    else
      throw new RangeError("Unsupported child node: " + e);
}
export {
  s as c
};
