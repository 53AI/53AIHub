let a = [], d = [];
(() => {
  let t = "lc,34,7n,7,7b,19,,,,2,,2,,,20,b,1c,l,g,,2t,7,2,6,2,2,,4,z,,u,r,2j,b,1m,9,9,,o,4,,9,,3,,5,17,3,3b,f,,w,1j,,,,4,8,4,,3,7,a,2,t,,1m,,,,2,4,8,,9,,a,2,q,,2,2,1l,,4,2,4,2,2,3,3,,u,2,3,,b,2,1l,,4,5,,2,4,,k,2,m,6,,,1m,,,2,,4,8,,7,3,a,2,u,,1n,,,,c,,9,,14,,3,,1l,3,5,3,,4,7,2,b,2,t,,1m,,2,,2,,3,,5,2,7,2,b,2,s,2,1l,2,,,2,4,8,,9,,a,2,t,,20,,4,,2,3,,,8,,29,,2,7,c,8,2q,,2,9,b,6,22,2,r,,,,,,1j,e,,5,,2,5,b,,10,9,,2u,4,,6,,2,2,2,p,2,4,3,g,4,d,,2,2,6,,f,,jj,3,qa,3,t,3,t,2,u,2,1s,2,,7,8,,2,b,9,,19,3,3b,2,y,,3a,3,4,2,9,,6,3,63,2,2,,1m,,,7,,,,,2,8,6,a,2,,1c,h,1r,4,1c,7,,,5,,14,9,c,2,w,4,2,2,,3,1k,,,2,3,,,3,1m,8,2,2,48,3,,d,,7,4,,6,,3,2,5i,1m,,5,ek,,5f,x,2da,3,3x,,2o,w,fe,6,2x,2,n9w,4,,a,w,2,28,2,7k,,3,,4,,p,2,5,,47,2,q,i,d,,12,8,p,b,1a,3,1c,,2,4,2,2,13,,1v,6,2,2,2,2,c,,8,,1b,,1f,,,3,2,2,5,2,,,16,2,8,,6m,,2,,4,,fn4,,kh,g,g,g,a6,2,gt,,6a,,45,5,1ae,3,,2,5,4,14,3,4,,4l,2,fx,4,ar,2,49,b,4w,,1i,f,1k,3,1d,4,2,2,1x,3,10,5,,8,1q,,c,2,1g,9,a,4,2,,2n,3,2,,,2,6,,4g,,3,8,l,2,1l,2,,,,,m,,e,7,3,5,5f,8,2,3,,,n,,29,,2,6,,,2,,,2,,2,6j,,2,4,6,2,,2,r,2,2d,8,2,,,2,2y,,,,2,6,,,2t,3,2,4,,5,77,9,,2,6t,,a,2,,,4,,40,4,2,2,4,,w,a,14,6,2,4,8,,9,6,2,3,1a,d,,2,ba,7,,6,,,2a,m,2,7,,2,,2,3e,6,3,,,2,,7,,,20,2,3,,,,9n,2,f0b,5,1n,7,t4,,1r,4,29,,f5k,2,43q,,,3,4,5,8,8,2,7,u,4,44,3,1iz,1j,4,1e,8,,e,,m,5,,f,11s,7,,h,2,7,,2,,5,79,7,c5,4,15s,7,31,7,240,5,gx7k,2o,3k,6o".split(",").map((e) => e ? parseInt(e, 36) : 1);
  for (let e = 0, n = 0; e < t.length; e++)
    (e % 2 ? d : a).push(n = n + t[e]);
})();
function h(t) {
  if (t < 768)
    return false;
  for (let e = 0, n = a.length; ; ) {
    let r = e + n >> 1;
    if (t < a[r])
      n = r;
    else if (t >= d[r])
      e = r + 1;
    else
      return true;
    if (e == n)
      return false;
  }
}
function c(t) {
  return t >= 127462 && t <= 127487;
}
const g = 8205;
function w(t, e, n = true, r = true) {
  return (n ? b : k)(t, e, r);
}
function b(t, e, n) {
  if (e == t.length)
    return e;
  e && o(t.charCodeAt(e)) && m(t.charCodeAt(e - 1)) && e--;
  let r = u(t, e);
  for (e += x(r); e < t.length; ) {
    let f = u(t, e);
    if (r == g || f == g || n && h(f))
      e += x(f), r = f;
    else if (c(f)) {
      let l = 0, i = e - 2;
      for (; i >= 0 && c(u(t, i)); )
        l++, i -= 2;
      if (l % 2 == 0)
        break;
      e += 2;
    } else
      break;
  }
  return e;
}
function k(t, e, n) {
  for (; e > 0; ) {
    let r = b(t, e - 2, n);
    if (r < e)
      return r;
    e--;
  }
  return 0;
}
function u(t, e) {
  let n = t.charCodeAt(e);
  if (!m(n) || e + 1 == t.length)
    return n;
  let r = t.charCodeAt(e + 1);
  return o(r) ? (n - 55296 << 10) + (r - 56320) + 65536 : n;
}
function o(t) {
  return t >= 56320 && t < 57344;
}
function m(t) {
  return t >= 55296 && t < 56320;
}
function x(t) {
  return t < 65536 ? 1 : 2;
}
export {
  w as f
};
