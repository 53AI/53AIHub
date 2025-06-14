import { _ as n, i as x, S as c } from "./mermaid-j5R1o_wi-7b9be563.js";
var o = n((s, t) => {
  const r = s.append("rect");
  if (r.attr("x", t.x), r.attr("y", t.y), r.attr("fill", t.fill), r.attr("stroke", t.stroke), r.attr("width", t.width), r.attr("height", t.height), t.name && r.attr("name", t.name), t.rx && r.attr("rx", t.rx), t.ry && r.attr("ry", t.ry), t.attrs !== void 0)
    for (const a in t.attrs)
      r.attr(a, t.attrs[a]);
  return t.class && r.attr("class", t.class), r;
}, "drawRect"), d = n((s, t) => {
  const r = { x: t.startx, y: t.starty, width: t.stopx - t.startx, height: t.stopy - t.starty, fill: t.fill, stroke: t.stroke, class: "rect" };
  o(s, r).lower();
}, "drawBackgroundRect"), h = n((s, t) => {
  const r = t.text.replace(c, " "), a = s.append("text");
  a.attr("x", t.x), a.attr("y", t.y), a.attr("class", "legend"), a.style("text-anchor", t.anchor), t.class && a.attr("class", t.class);
  const e = a.append("tspan");
  return e.attr("x", t.x + t.textMargin * 2), e.text(r), a;
}, "drawText"), y = n((s, t, r, a) => {
  const e = s.append("image");
  e.attr("x", t), e.attr("y", r);
  const i = x.sanitizeUrl(a);
  e.attr("xlink:href", i);
}, "drawImage"), p = n((s, t, r, a) => {
  const e = s.append("use");
  e.attr("x", t), e.attr("y", r);
  const i = x.sanitizeUrl(a);
  e.attr("xlink:href", `#${i}`);
}, "drawEmbeddedImage"), g = n(() => ({ x: 0, y: 0, width: 100, height: 100, fill: "#EDF2AE", stroke: "#666", anchor: "start", rx: 0, ry: 0 }), "getNoteRect"), w = n(() => ({ x: 0, y: 0, width: 100, height: 100, "text-anchor": "start", style: "#666", textMargin: 0, rx: 0, ry: 0, tspan: true }), "getTextObj");
export {
  d,
  h as g,
  y as h,
  p as m,
  w as p,
  o as x,
  g as y
};
