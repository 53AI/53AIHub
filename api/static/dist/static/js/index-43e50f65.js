import { Q as i, S as a, U as u } from "./index-6feda8be.js";
const c = (o, t, r) => a(o.subTree).filter((e) => {
  var d;
  return u(e) && ((d = e.type) == null ? void 0 : d.name) === t && !!e.component;
}).map((e) => e.component.uid).map((e) => r[e]).filter((e) => !!e), m = (o, t) => {
  const r = {}, n = i([]);
  return { children: n, addChild: (d) => {
    r[d.uid] = d, n.value = c(o, t, r);
  }, removeChild: (d) => {
    delete r[d], n.value = n.value.filter((s) => s.uid !== d);
  } };
};
export {
  m as u
};
