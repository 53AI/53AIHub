import { m as r } from "./index-6feda8be.js";
const u = 100, v = 600, E = { beforeMount(l, s) {
  const e = s.value, { interval: i = u, delay: c = v } = r(e) ? {} : e;
  let t, n;
  const o = () => r(e) ? e() : e.handler(), a = () => {
    n && (clearTimeout(n), n = void 0), t && (clearInterval(t), t = void 0);
  };
  l.addEventListener("mousedown", (d) => {
    d.button === 0 && (a(), o(), document.addEventListener("mouseup", () => a(), { once: true }), n = setTimeout(() => {
      t = setInterval(() => {
        o();
      }, i);
    }, c));
  });
} };
export {
  E as v
};
