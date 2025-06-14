import { _ as k, m as Ge, c as P1, b as ze, s as He, o as qe, a as Xe, g as Je, p as Ye, j as Ze, q as Qe, J as et, t as tt, l as Q, v as ee, u as se, x as st, y as it, n as rt, r as nt, z as at } from "./mermaid-j5R1o_wi-7b9be563.js";
import { b as ut, B as ot } from "./chunk-RZ5BOZE2-mpnkmZCx-b889ba51.js";
import { L as E1 } from "./helper-7WMIPux3-736d9956.js";
import { l as lt } from "./channel-BY04PUnR-6d826dde.js";
import "./index-7b696e01.js";
import "./copy-BS31ARP0-68b0a49d.js";
var ct = "flowchart-", te, ht = (te = class {
  constructor() {
    this.vertexCounter = 0, this.config = P1(), this.vertices = /* @__PURE__ */ new Map(), this.edges = [], this.classes = /* @__PURE__ */ new Map(), this.subGraphs = [], this.subGraphLookup = /* @__PURE__ */ new Map(), this.tooltips = /* @__PURE__ */ new Map(), this.subCount = 0, this.firstGraphFlag = true, this.secCount = -1, this.posCrossRef = [], this.funs = [], this.setAccTitle = ze, this.setAccDescription = He, this.setDiagramTitle = qe, this.getAccTitle = Xe, this.getAccDescription = Je, this.getDiagramTitle = Ye, this.funs.push(this.setupToolTips.bind(this)), this.addVertex = this.addVertex.bind(this), this.firstGraph = this.firstGraph.bind(this), this.setDirection = this.setDirection.bind(this), this.addSubGraph = this.addSubGraph.bind(this), this.addLink = this.addLink.bind(this), this.setLink = this.setLink.bind(this), this.updateLink = this.updateLink.bind(this), this.addClass = this.addClass.bind(this), this.setClass = this.setClass.bind(this), this.destructLink = this.destructLink.bind(this), this.setClickEvent = this.setClickEvent.bind(this), this.setTooltip = this.setTooltip.bind(this), this.updateLinkInterpolate = this.updateLinkInterpolate.bind(this), this.setClickFun = this.setClickFun.bind(this), this.bindFunctions = this.bindFunctions.bind(this), this.lex = { firstGraph: this.firstGraph.bind(this) }, this.clear(), this.setGen("gen-2");
  }
  sanitizeText(e) {
    return Ze.sanitizeText(e, this.config);
  }
  lookUpDomId(e) {
    for (const i of this.vertices.values())
      if (i.id === e)
        return i.domId;
    return e;
  }
  addVertex(e, i, r, a, n, d, h = {}, o) {
    var b, x;
    if (!e || e.trim().length === 0)
      return;
    let l;
    if (o !== void 0) {
      let A;
      o.includes(`
`) ? A = o + `
` : A = `{
` + o + `
}`, l = Qe(A, { schema: et });
    }
    const U = this.edges.find((A) => A.id === e);
    if (U) {
      const A = l;
      (A == null ? void 0 : A.animate) !== void 0 && (U.animate = A.animate), (A == null ? void 0 : A.animation) !== void 0 && (U.animation = A.animation);
      return;
    }
    let _, g = this.vertices.get(e);
    if (g === void 0 && (g = { id: e, labelType: "text", domId: ct + e + "-" + this.vertexCounter, styles: [], classes: [] }, this.vertices.set(e, g)), this.vertexCounter++, i !== void 0 ? (this.config = P1(), _ = this.sanitizeText(i.text.trim()), g.labelType = i.type, _.startsWith('"') && _.endsWith('"') && (_ = _.substring(1, _.length - 1)), g.text = _) : g.text === void 0 && (g.text = e), r !== void 0 && (g.type = r), a == null ? void 0 : a.forEach((A) => {
      g.styles.push(A);
    }), n == null ? void 0 : n.forEach((A) => {
      g.classes.push(A);
    }), d !== void 0 && (g.dir = d), g.props === void 0 ? g.props = h : h !== void 0 && Object.assign(g.props, h), l !== void 0) {
      if (l.shape) {
        if (l.shape !== l.shape.toLowerCase() || l.shape.includes("_"))
          throw new Error(`No such shape: ${l.shape}. Shape names should be lowercase.`);
        if (!tt(l.shape))
          throw new Error(`No such shape: ${l.shape}.`);
        g.type = l == null ? void 0 : l.shape;
      }
      l != null && l.label && (g.text = l == null ? void 0 : l.label), l != null && l.icon && (g.icon = l == null ? void 0 : l.icon, !((b = l.label) != null && b.trim()) && g.text === e && (g.text = "")), l != null && l.form && (g.form = l == null ? void 0 : l.form), l != null && l.pos && (g.pos = l == null ? void 0 : l.pos), l != null && l.img && (g.img = l == null ? void 0 : l.img, !((x = l.label) != null && x.trim()) && g.text === e && (g.text = "")), l != null && l.constraint && (g.constraint = l.constraint), l.w && (g.assetWidth = Number(l.w)), l.h && (g.assetHeight = Number(l.h));
    }
  }
  addSingleLink(e, i, r, a) {
    const n = { start: e, end: i, type: void 0, text: "", labelType: "text", classes: [], isUserDefinedId: false, interpolate: this.edges.defaultInterpolate };
    Q.info("abc78 Got edge...", n);
    const d = r.text;
    if (d !== void 0 && (n.text = this.sanitizeText(d.text.trim()), n.text.startsWith('"') && n.text.endsWith('"') && (n.text = n.text.substring(1, n.text.length - 1)), n.labelType = d.type), r !== void 0 && (n.type = r.type, n.stroke = r.stroke, n.length = r.length > 10 ? 10 : r.length), a && !this.edges.some((h) => h.id === a))
      n.id = a, n.isUserDefinedId = true;
    else {
      const h = this.edges.filter((o) => o.start === n.start && o.end === n.end);
      h.length === 0 ? n.id = ee(n.start, n.end, { counter: 0, prefix: "L" }) : n.id = ee(n.start, n.end, { counter: h.length + 1, prefix: "L" });
    }
    if (this.edges.length < (this.config.maxEdges ?? 500))
      Q.info("Pushing edge..."), this.edges.push(n);
    else
      throw new Error(`Edge limit exceeded. ${this.edges.length} edges found, but the limit is ${this.config.maxEdges}.

Initialize mermaid with maxEdges set to a higher number to allow more edges.
You cannot set this config via configuration inside the diagram as it is a secure config.
You have to call mermaid.initialize.`);
  }
  isLinkData(e) {
    return e !== null && typeof e == "object" && "id" in e && typeof e.id == "string";
  }
  addLink(e, i, r) {
    const a = this.isLinkData(r) ? r.id.replace("@", "") : void 0;
    Q.info("addLink", e, i, a);
    for (const n of e)
      for (const d of i) {
        const h = n === e[e.length - 1], o = d === i[0];
        h && o ? this.addSingleLink(n, d, r, a) : this.addSingleLink(n, d, r, void 0);
      }
  }
  updateLinkInterpolate(e, i) {
    e.forEach((r) => {
      r === "default" ? this.edges.defaultInterpolate = i : this.edges[r].interpolate = i;
    });
  }
  updateLink(e, i) {
    e.forEach((r) => {
      var a, n, d, h, o, b;
      if (typeof r == "number" && r >= this.edges.length)
        throw new Error(`The index ${r} for linkStyle is out of bounds. Valid indices for linkStyle are between 0 and ${this.edges.length - 1}. (Help: Ensure that the index is within the range of existing edges.)`);
      r === "default" ? this.edges.defaultStyle = i : (this.edges[r].style = i, (((n = (a = this.edges[r]) == null ? void 0 : a.style) == null ? void 0 : n.length) ?? 0) > 0 && !((h = (d = this.edges[r]) == null ? void 0 : d.style) != null && h.some((x) => x == null ? void 0 : x.startsWith("fill"))) && ((b = (o = this.edges[r]) == null ? void 0 : o.style) == null || b.push("fill:none")));
    });
  }
  addClass(e, i) {
    const r = i.join().replace(/\\,/g, "\xA7\xA7\xA7").replace(/,/g, ";").replace(/§§§/g, ",").split(";");
    e.split(",").forEach((a) => {
      let n = this.classes.get(a);
      n === void 0 && (n = { id: a, styles: [], textStyles: [] }, this.classes.set(a, n)), r == null ? void 0 : r.forEach((d) => {
        if (/color/.exec(d)) {
          const h = d.replace("fill", "bgFill");
          n.textStyles.push(h);
        }
        n.styles.push(d);
      });
    });
  }
  setDirection(e) {
    this.direction = e, /.*</.exec(this.direction) && (this.direction = "RL"), /.*\^/.exec(this.direction) && (this.direction = "BT"), /.*>/.exec(this.direction) && (this.direction = "LR"), /.*v/.exec(this.direction) && (this.direction = "TB"), this.direction === "TD" && (this.direction = "TB");
  }
  setClass(e, i) {
    for (const r of e.split(",")) {
      const a = this.vertices.get(r);
      a && a.classes.push(i);
      const n = this.edges.find((h) => h.id === r);
      n && n.classes.push(i);
      const d = this.subGraphLookup.get(r);
      d && d.classes.push(i);
    }
  }
  setTooltip(e, i) {
    if (i !== void 0) {
      i = this.sanitizeText(i);
      for (const r of e.split(","))
        this.tooltips.set(this.version === "gen-1" ? this.lookUpDomId(r) : r, i);
    }
  }
  setClickFun(e, i, r) {
    const a = this.lookUpDomId(e);
    if (P1().securityLevel !== "loose" || i === void 0)
      return;
    let n = [];
    if (typeof r == "string") {
      n = r.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
      for (let h = 0; h < n.length; h++) {
        let o = n[h].trim();
        o.startsWith('"') && o.endsWith('"') && (o = o.substr(1, o.length - 2)), n[h] = o;
      }
    }
    n.length === 0 && n.push(e);
    const d = this.vertices.get(e);
    d && (d.haveCallback = true, this.funs.push(() => {
      const h = document.querySelector(`[id="${a}"]`);
      h !== null && h.addEventListener("click", () => {
        se.runFunc(i, ...n);
      }, false);
    }));
  }
  setLink(e, i, r) {
    e.split(",").forEach((a) => {
      const n = this.vertices.get(a);
      n !== void 0 && (n.link = se.formatUrl(i, this.config), n.linkTarget = r);
    }), this.setClass(e, "clickable");
  }
  getTooltip(e) {
    return this.tooltips.get(e);
  }
  setClickEvent(e, i, r) {
    e.split(",").forEach((a) => {
      this.setClickFun(a, i, r);
    }), this.setClass(e, "clickable");
  }
  bindFunctions(e) {
    this.funs.forEach((i) => {
      i(e);
    });
  }
  getDirection() {
    var e;
    return (e = this.direction) == null ? void 0 : e.trim();
  }
  getVertices() {
    return this.vertices;
  }
  getEdges() {
    return this.edges;
  }
  getClasses() {
    return this.classes;
  }
  setupToolTips(e) {
    let i = E1(".mermaidTooltip");
    (i._groups || i)[0][0] === null && (i = E1("body").append("div").attr("class", "mermaidTooltip").style("opacity", 0)), E1(e).select("svg").selectAll("g.node").on("mouseover", (r) => {
      var a;
      const n = E1(r.currentTarget);
      if (n.attr("title") === null)
        return;
      const d = (a = r.currentTarget) == null ? void 0 : a.getBoundingClientRect();
      i.transition().duration(200).style("opacity", ".9"), i.text(n.attr("title")).style("left", window.scrollX + d.left + (d.right - d.left) / 2 + "px").style("top", window.scrollY + d.bottom + "px"), i.html(i.html().replace(/&lt;br\/&gt;/g, "<br/>")), n.classed("hover", true);
    }).on("mouseout", (r) => {
      i.transition().duration(500).style("opacity", 0), E1(r.currentTarget).classed("hover", false);
    });
  }
  clear(e = "gen-2") {
    this.vertices = /* @__PURE__ */ new Map(), this.classes = /* @__PURE__ */ new Map(), this.edges = [], this.funs = [this.setupToolTips.bind(this)], this.subGraphs = [], this.subGraphLookup = /* @__PURE__ */ new Map(), this.subCount = 0, this.tooltips = /* @__PURE__ */ new Map(), this.firstGraphFlag = true, this.version = e, this.config = P1(), st();
  }
  setGen(e) {
    this.version = e || "gen-2";
  }
  defaultStyle() {
    return "fill:#ffa;stroke: #f66; stroke-width: 3px; stroke-dasharray: 5, 5;fill:#ffa;stroke: #666;";
  }
  addSubGraph(e, i, r) {
    let a = e.text.trim(), n = r.text;
    e === r && /\s/.exec(r.text) && (a = void 0);
    const d = k((x) => {
      const l = { boolean: {}, number: {}, string: {} }, U = [];
      let _;
      return { nodeList: x.filter(function(g) {
        const A = typeof g;
        return g.stmt && g.stmt === "dir" ? (_ = g.value, false) : g.trim() === "" ? false : A in l ? l[A].hasOwnProperty(g) ? false : l[A][g] = true : U.includes(g) ? false : U.push(g);
      }), dir: _ };
    }, "uniq"), { nodeList: h, dir: o } = d(i.flat());
    if (this.version === "gen-1")
      for (let x = 0; x < h.length; x++)
        h[x] = this.lookUpDomId(h[x]);
    a = a ?? "subGraph" + this.subCount, n = n || "", n = this.sanitizeText(n), this.subCount = this.subCount + 1;
    const b = { id: a, nodes: h, title: n.trim(), classes: [], dir: o, labelType: r.type };
    return Q.info("Adding", b.id, b.nodes, b.dir), b.nodes = this.makeUniq(b, this.subGraphs).nodes, this.subGraphs.push(b), this.subGraphLookup.set(a, b), a;
  }
  getPosForId(e) {
    for (const [i, r] of this.subGraphs.entries())
      if (r.id === e)
        return i;
    return -1;
  }
  indexNodes2(e, i) {
    const r = this.subGraphs[i].nodes;
    if (this.secCount = this.secCount + 1, this.secCount > 2e3)
      return { result: false, count: 0 };
    if (this.posCrossRef[this.secCount] = i, this.subGraphs[i].id === e)
      return { result: true, count: 0 };
    let a = 0, n = 1;
    for (; a < r.length; ) {
      const d = this.getPosForId(r[a]);
      if (d >= 0) {
        const h = this.indexNodes2(e, d);
        if (h.result)
          return { result: true, count: n + h.count };
        n = n + h.count;
      }
      a = a + 1;
    }
    return { result: false, count: n };
  }
  getDepthFirstPos(e) {
    return this.posCrossRef[e];
  }
  indexNodes() {
    this.secCount = -1, this.subGraphs.length > 0 && this.indexNodes2("none", this.subGraphs.length - 1);
  }
  getSubGraphs() {
    return this.subGraphs;
  }
  firstGraph() {
    return this.firstGraphFlag ? (this.firstGraphFlag = false, true) : false;
  }
  destructStartLink(e) {
    let i = e.trim(), r = "arrow_open";
    switch (i[0]) {
      case "<":
        r = "arrow_point", i = i.slice(1);
        break;
      case "x":
        r = "arrow_cross", i = i.slice(1);
        break;
      case "o":
        r = "arrow_circle", i = i.slice(1);
        break;
    }
    let a = "normal";
    return i.includes("=") && (a = "thick"), i.includes(".") && (a = "dotted"), { type: r, stroke: a };
  }
  countChar(e, i) {
    const r = i.length;
    let a = 0;
    for (let n = 0; n < r; ++n)
      i[n] === e && ++a;
    return a;
  }
  destructEndLink(e) {
    const i = e.trim();
    let r = i.slice(0, -1), a = "arrow_open";
    switch (i.slice(-1)) {
      case "x":
        a = "arrow_cross", i.startsWith("x") && (a = "double_" + a, r = r.slice(1));
        break;
      case ">":
        a = "arrow_point", i.startsWith("<") && (a = "double_" + a, r = r.slice(1));
        break;
      case "o":
        a = "arrow_circle", i.startsWith("o") && (a = "double_" + a, r = r.slice(1));
        break;
    }
    let n = "normal", d = r.length - 1;
    r.startsWith("=") && (n = "thick"), r.startsWith("~") && (n = "invisible");
    const h = this.countChar(".", r);
    return h && (n = "dotted", d = h), { type: a, stroke: n, length: d };
  }
  destructLink(e, i) {
    const r = this.destructEndLink(e);
    let a;
    if (i) {
      if (a = this.destructStartLink(i), a.stroke !== r.stroke)
        return { type: "INVALID", stroke: "INVALID" };
      if (a.type === "arrow_open")
        a.type = r.type;
      else {
        if (a.type !== r.type)
          return { type: "INVALID", stroke: "INVALID" };
        a.type = "double_" + a.type;
      }
      return a.type === "double_arrow" && (a.type = "double_arrow_point"), a.length = r.length, a;
    }
    return r;
  }
  exists(e, i) {
    for (const r of e)
      if (r.nodes.includes(i))
        return true;
    return false;
  }
  makeUniq(e, i) {
    const r = [];
    return e.nodes.forEach((a, n) => {
      this.exists(i, a) || r.push(e.nodes[n]);
    }), { nodes: r };
  }
  getTypeFromVertex(e) {
    if (e.img)
      return "imageSquare";
    if (e.icon)
      return e.form === "circle" ? "iconCircle" : e.form === "square" ? "iconSquare" : e.form === "rounded" ? "iconRounded" : "icon";
    switch (e.type) {
      case "square":
      case void 0:
        return "squareRect";
      case "round":
        return "roundedRect";
      case "ellipse":
        return "ellipse";
      default:
        return e.type;
    }
  }
  findNode(e, i) {
    return e.find((r) => r.id === i);
  }
  destructEdgeType(e) {
    let i = "none", r = "arrow_point";
    switch (e) {
      case "arrow_point":
      case "arrow_circle":
      case "arrow_cross":
        r = e;
        break;
      case "double_arrow_point":
      case "double_arrow_circle":
      case "double_arrow_cross":
        i = e.replace("double_", ""), r = i;
        break;
    }
    return { arrowTypeStart: i, arrowTypeEnd: r };
  }
  addNodeFromVertex(e, i, r, a, n, d) {
    var h;
    const o = r.get(e.id), b = a.get(e.id) ?? false, x = this.findNode(i, e.id);
    if (x)
      x.cssStyles = e.styles, x.cssCompiledStyles = this.getCompiledStyles(e.classes), x.cssClasses = e.classes.join(" ");
    else {
      const l = { id: e.id, label: e.text, labelStyle: "", parentId: o, padding: ((h = n.flowchart) == null ? void 0 : h.padding) || 8, cssStyles: e.styles, cssCompiledStyles: this.getCompiledStyles(["default", "node", ...e.classes]), cssClasses: "default " + e.classes.join(" "), dir: e.dir, domId: e.domId, look: d, link: e.link, linkTarget: e.linkTarget, tooltip: this.getTooltip(e.id), icon: e.icon, pos: e.pos, img: e.img, assetWidth: e.assetWidth, assetHeight: e.assetHeight, constraint: e.constraint };
      b ? i.push({ ...l, isGroup: true, shape: "rect" }) : i.push({ ...l, isGroup: false, shape: this.getTypeFromVertex(e) });
    }
  }
  getCompiledStyles(e) {
    let i = [];
    for (const r of e) {
      const a = this.classes.get(r);
      a != null && a.styles && (i = [...i, ...a.styles ?? []].map((n) => n.trim())), a != null && a.textStyles && (i = [...i, ...a.textStyles ?? []].map((n) => n.trim()));
    }
    return i;
  }
  getData() {
    const e = P1(), i = [], r = [], a = this.getSubGraphs(), n = /* @__PURE__ */ new Map(), d = /* @__PURE__ */ new Map();
    for (let o = a.length - 1; o >= 0; o--) {
      const b = a[o];
      b.nodes.length > 0 && d.set(b.id, true);
      for (const x of b.nodes)
        n.set(x, b.id);
    }
    for (let o = a.length - 1; o >= 0; o--) {
      const b = a[o];
      i.push({ id: b.id, label: b.title, labelStyle: "", parentId: n.get(b.id), padding: 8, cssCompiledStyles: this.getCompiledStyles(b.classes), cssClasses: b.classes.join(" "), shape: "rect", dir: b.dir, isGroup: true, look: e.look });
    }
    this.getVertices().forEach((o) => {
      this.addNodeFromVertex(o, i, n, d, e, e.look || "classic");
    });
    const h = this.getEdges();
    return h.forEach((o, b) => {
      var x;
      const { arrowTypeStart: l, arrowTypeEnd: U } = this.destructEdgeType(o.type), _ = [...h.defaultStyle ?? []];
      o.style && _.push(...o.style);
      const g = { id: ee(o.start, o.end, { counter: b, prefix: "L" }, o.id), isUserDefinedId: o.isUserDefinedId, start: o.start, end: o.end, type: o.type ?? "normal", label: o.text, labelpos: "c", thickness: o.stroke, minlen: o.length, classes: (o == null ? void 0 : o.stroke) === "invisible" ? "" : "edge-thickness-normal edge-pattern-solid flowchart-link", arrowTypeStart: (o == null ? void 0 : o.stroke) === "invisible" || (o == null ? void 0 : o.type) === "arrow_open" ? "none" : l, arrowTypeEnd: (o == null ? void 0 : o.stroke) === "invisible" || (o == null ? void 0 : o.type) === "arrow_open" ? "none" : U, arrowheadStyle: "fill: #333", cssCompiledStyles: this.getCompiledStyles(o.classes), labelStyle: _, style: _, pattern: o.stroke, look: e.look, animate: o.animate, animation: o.animation, curve: o.interpolate || this.edges.defaultInterpolate || ((x = e.flowchart) == null ? void 0 : x.curve) };
      r.push(g);
    }), { nodes: i, edges: r, other: {}, config: e };
  }
  defaultConfig() {
    return it.flowchart;
  }
}, k(te, "FlowDB"), te), dt = k(function(e, i) {
  return i.db.getClasses();
}, "getClasses"), pt = k(async function(e, i, r, a) {
  var n;
  Q.info("REF0:"), Q.info("Drawing state diagram (v2)", i);
  const { securityLevel: d, flowchart: h, layout: o } = P1();
  let b;
  d === "sandbox" && (b = E1("#i" + i));
  const x = d === "sandbox" ? b.nodes()[0].contentDocument : document;
  Q.debug("Before getData: ");
  const l = a.db.getData();
  Q.debug("Data: ", l);
  const U = ut(i, d), _ = a.db.getDirection();
  l.type = a.type, l.layoutAlgorithm = rt(o), l.layoutAlgorithm === "dagre" && o === "elk" && Q.warn("flowchart-elk was moved to an external package in Mermaid v11. Please refer [release notes](https://github.com/mermaid-js/mermaid/releases/tag/v11.0.0) for more details. This diagram will be rendered using `dagre` layout as a fallback."), l.direction = _, l.nodeSpacing = (h == null ? void 0 : h.nodeSpacing) || 50, l.rankSpacing = (h == null ? void 0 : h.rankSpacing) || 50, l.markers = ["point", "circle", "cross"], l.diagramId = i, Q.debug("REF1:", l), await nt(l, U);
  const g = ((n = l.config.flowchart) == null ? void 0 : n.diagramPadding) ?? 8;
  se.insertTitle(U, "flowchartTitleText", (h == null ? void 0 : h.titleTopMargin) || 0, a.db.getDiagramTitle()), ot(U, g, "flowchart", (h == null ? void 0 : h.useMaxWidth) || false);
  for (const A of l.nodes) {
    const S = E1(`#${i} [id="${A.id}"]`);
    if (!S || !A.link)
      continue;
    const J = x.createElementNS("http://www.w3.org/2000/svg", "a");
    J.setAttributeNS("http://www.w3.org/2000/svg", "class", A.cssClasses), J.setAttributeNS("http://www.w3.org/2000/svg", "rel", "noopener"), d === "sandbox" ? J.setAttributeNS("http://www.w3.org/2000/svg", "target", "_top") : A.linkTarget && J.setAttributeNS("http://www.w3.org/2000/svg", "target", A.linkTarget);
    const g1 = S.insert(function() {
      return J;
    }, ":first-child"), A1 = S.select(".label-container");
    A1 && g1.append(function() {
      return A1.node();
    });
    const b1 = S.select(".label");
    b1 && g1.append(function() {
      return b1.node();
    });
  }
}, "draw"), gt = { getClasses: dt, draw: pt }, ie = function() {
  var e = k(function(Z, c, p, u) {
    for (p = p || {}, u = Z.length; u--; p[Z[u]] = c)
      ;
    return p;
  }, "o"), i = [1, 4], r = [1, 3], a = [1, 5], n = [1, 8, 9, 10, 11, 27, 34, 36, 38, 44, 60, 84, 85, 86, 87, 88, 89, 102, 105, 106, 109, 111, 114, 115, 116, 121, 122, 123, 124], d = [2, 2], h = [1, 13], o = [1, 14], b = [1, 15], x = [1, 16], l = [1, 23], U = [1, 25], _ = [1, 26], g = [1, 27], A = [1, 49], S = [1, 48], J = [1, 29], g1 = [1, 30], A1 = [1, 31], b1 = [1, 32], G1 = [1, 33], B = [1, 44], w = [1, 46], $ = [1, 42], L = [1, 47], I = [1, 43], R = [1, 50], N = [1, 45], P = [1, 51], G = [1, 52], O1 = [1, 34], U1 = [1, 35], M1 = [1, 36], V1 = [1, 37], d1 = [1, 57], D = [1, 8, 9, 10, 11, 27, 32, 34, 36, 38, 44, 60, 84, 85, 86, 87, 88, 89, 102, 105, 106, 109, 111, 114, 115, 116, 121, 122, 123, 124], e1 = [1, 61], t1 = [1, 60], s1 = [1, 62], m1 = [8, 9, 11, 75, 77, 78], re = [1, 78], x1 = [1, 91], C1 = [1, 96], D1 = [1, 95], T1 = [1, 92], S1 = [1, 88], F1 = [1, 94], _1 = [1, 90], v1 = [1, 97], B1 = [1, 93], w1 = [1, 98], $1 = [1, 89], k1 = [8, 9, 10, 11, 40, 75, 77, 78], M = [8, 9, 10, 11, 40, 46, 75, 77, 78], z = [8, 9, 10, 11, 29, 40, 44, 46, 48, 50, 52, 54, 56, 58, 60, 63, 65, 67, 68, 70, 75, 77, 78, 89, 102, 105, 106, 109, 111, 114, 115, 116], ne = [8, 9, 11, 44, 60, 75, 77, 78, 89, 102, 105, 106, 109, 111, 114, 115, 116], L1 = [44, 60, 89, 102, 105, 106, 109, 111, 114, 115, 116], ae = [1, 121], ue = [1, 122], W1 = [1, 124], K1 = [1, 123], oe = [44, 60, 62, 74, 89, 102, 105, 106, 109, 111, 114, 115, 116], le = [1, 133], ce = [1, 147], he = [1, 148], de = [1, 149], pe = [1, 150], ge = [1, 135], Ae = [1, 137], be = [1, 141], ke = [1, 142], ye = [1, 143], fe = [1, 144], Ee = [1, 145], me = [1, 146], xe = [1, 151], Ce = [1, 152], De = [1, 131], Te = [1, 132], Se = [1, 139], Fe = [1, 134], _e = [1, 138], ve = [1, 136], q1 = [8, 9, 10, 11, 27, 32, 34, 36, 38, 44, 60, 84, 85, 86, 87, 88, 89, 102, 105, 106, 109, 111, 114, 115, 116, 121, 122, 123, 124], Be = [1, 154], we = [1, 156], F = [8, 9, 11], H = [8, 9, 10, 11, 14, 44, 60, 89, 105, 106, 109, 111, 114, 115, 116], y = [1, 176], V = [1, 172], W = [1, 173], f = [1, 177], E = [1, 174], m = [1, 175], I1 = [77, 116, 119], T = [8, 9, 10, 11, 12, 14, 27, 29, 32, 44, 60, 75, 84, 85, 86, 87, 88, 89, 90, 105, 109, 111, 114, 115, 116], $e = [10, 106], p1 = [31, 49, 51, 53, 55, 57, 62, 64, 66, 67, 69, 71, 116, 117, 118], i1 = [1, 247], r1 = [1, 245], n1 = [1, 249], a1 = [1, 243], u1 = [1, 244], o1 = [1, 246], l1 = [1, 248], c1 = [1, 250], R1 = [1, 268], Le = [8, 9, 11, 106], Y = [8, 9, 10, 11, 60, 84, 105, 106, 109, 110, 111, 112], X1 = { trace: k(function() {
  }, "trace"), yy: {}, symbols_: { error: 2, start: 3, graphConfig: 4, document: 5, line: 6, statement: 7, SEMI: 8, NEWLINE: 9, SPACE: 10, EOF: 11, GRAPH: 12, NODIR: 13, DIR: 14, FirstStmtSeparator: 15, ending: 16, endToken: 17, spaceList: 18, spaceListNewline: 19, vertexStatement: 20, separator: 21, styleStatement: 22, linkStyleStatement: 23, classDefStatement: 24, classStatement: 25, clickStatement: 26, subgraph: 27, textNoTags: 28, SQS: 29, text: 30, SQE: 31, end: 32, direction: 33, acc_title: 34, acc_title_value: 35, acc_descr: 36, acc_descr_value: 37, acc_descr_multiline_value: 38, shapeData: 39, SHAPE_DATA: 40, link: 41, node: 42, styledVertex: 43, AMP: 44, vertex: 45, STYLE_SEPARATOR: 46, idString: 47, DOUBLECIRCLESTART: 48, DOUBLECIRCLEEND: 49, PS: 50, PE: 51, "(-": 52, "-)": 53, STADIUMSTART: 54, STADIUMEND: 55, SUBROUTINESTART: 56, SUBROUTINEEND: 57, VERTEX_WITH_PROPS_START: 58, "NODE_STRING[field]": 59, COLON: 60, "NODE_STRING[value]": 61, PIPE: 62, CYLINDERSTART: 63, CYLINDEREND: 64, DIAMOND_START: 65, DIAMOND_STOP: 66, TAGEND: 67, TRAPSTART: 68, TRAPEND: 69, INVTRAPSTART: 70, INVTRAPEND: 71, linkStatement: 72, arrowText: 73, TESTSTR: 74, START_LINK: 75, edgeText: 76, LINK: 77, LINK_ID: 78, edgeTextToken: 79, STR: 80, MD_STR: 81, textToken: 82, keywords: 83, STYLE: 84, LINKSTYLE: 85, CLASSDEF: 86, CLASS: 87, CLICK: 88, DOWN: 89, UP: 90, textNoTagsToken: 91, stylesOpt: 92, "idString[vertex]": 93, "idString[class]": 94, CALLBACKNAME: 95, CALLBACKARGS: 96, HREF: 97, LINK_TARGET: 98, "STR[link]": 99, "STR[tooltip]": 100, alphaNum: 101, DEFAULT: 102, numList: 103, INTERPOLATE: 104, NUM: 105, COMMA: 106, style: 107, styleComponent: 108, NODE_STRING: 109, UNIT: 110, BRKT: 111, PCT: 112, idStringToken: 113, MINUS: 114, MULT: 115, UNICODE_TEXT: 116, TEXT: 117, TAGSTART: 118, EDGE_TEXT: 119, alphaNumToken: 120, direction_tb: 121, direction_bt: 122, direction_rl: 123, direction_lr: 124, $accept: 0, $end: 1 }, terminals_: { 2: "error", 8: "SEMI", 9: "NEWLINE", 10: "SPACE", 11: "EOF", 12: "GRAPH", 13: "NODIR", 14: "DIR", 27: "subgraph", 29: "SQS", 31: "SQE", 32: "end", 34: "acc_title", 35: "acc_title_value", 36: "acc_descr", 37: "acc_descr_value", 38: "acc_descr_multiline_value", 40: "SHAPE_DATA", 44: "AMP", 46: "STYLE_SEPARATOR", 48: "DOUBLECIRCLESTART", 49: "DOUBLECIRCLEEND", 50: "PS", 51: "PE", 52: "(-", 53: "-)", 54: "STADIUMSTART", 55: "STADIUMEND", 56: "SUBROUTINESTART", 57: "SUBROUTINEEND", 58: "VERTEX_WITH_PROPS_START", 59: "NODE_STRING[field]", 60: "COLON", 61: "NODE_STRING[value]", 62: "PIPE", 63: "CYLINDERSTART", 64: "CYLINDEREND", 65: "DIAMOND_START", 66: "DIAMOND_STOP", 67: "TAGEND", 68: "TRAPSTART", 69: "TRAPEND", 70: "INVTRAPSTART", 71: "INVTRAPEND", 74: "TESTSTR", 75: "START_LINK", 77: "LINK", 78: "LINK_ID", 80: "STR", 81: "MD_STR", 84: "STYLE", 85: "LINKSTYLE", 86: "CLASSDEF", 87: "CLASS", 88: "CLICK", 89: "DOWN", 90: "UP", 93: "idString[vertex]", 94: "idString[class]", 95: "CALLBACKNAME", 96: "CALLBACKARGS", 97: "HREF", 98: "LINK_TARGET", 99: "STR[link]", 100: "STR[tooltip]", 102: "DEFAULT", 104: "INTERPOLATE", 105: "NUM", 106: "COMMA", 109: "NODE_STRING", 110: "UNIT", 111: "BRKT", 112: "PCT", 114: "MINUS", 115: "MULT", 116: "UNICODE_TEXT", 117: "TEXT", 118: "TAGSTART", 119: "EDGE_TEXT", 121: "direction_tb", 122: "direction_bt", 123: "direction_rl", 124: "direction_lr" }, productions_: [0, [3, 2], [5, 0], [5, 2], [6, 1], [6, 1], [6, 1], [6, 1], [6, 1], [4, 2], [4, 2], [4, 2], [4, 3], [16, 2], [16, 1], [17, 1], [17, 1], [17, 1], [15, 1], [15, 1], [15, 2], [19, 2], [19, 2], [19, 1], [19, 1], [18, 2], [18, 1], [7, 2], [7, 2], [7, 2], [7, 2], [7, 2], [7, 2], [7, 9], [7, 6], [7, 4], [7, 1], [7, 2], [7, 2], [7, 1], [21, 1], [21, 1], [21, 1], [39, 2], [39, 1], [20, 4], [20, 3], [20, 4], [20, 2], [20, 2], [20, 1], [42, 1], [42, 6], [42, 5], [43, 1], [43, 3], [45, 4], [45, 4], [45, 6], [45, 4], [45, 4], [45, 4], [45, 8], [45, 4], [45, 4], [45, 4], [45, 6], [45, 4], [45, 4], [45, 4], [45, 4], [45, 4], [45, 1], [41, 2], [41, 3], [41, 3], [41, 1], [41, 3], [41, 4], [76, 1], [76, 2], [76, 1], [76, 1], [72, 1], [72, 2], [73, 3], [30, 1], [30, 2], [30, 1], [30, 1], [83, 1], [83, 1], [83, 1], [83, 1], [83, 1], [83, 1], [83, 1], [83, 1], [83, 1], [83, 1], [83, 1], [28, 1], [28, 2], [28, 1], [28, 1], [24, 5], [25, 5], [26, 2], [26, 4], [26, 3], [26, 5], [26, 3], [26, 5], [26, 5], [26, 7], [26, 2], [26, 4], [26, 2], [26, 4], [26, 4], [26, 6], [22, 5], [23, 5], [23, 5], [23, 9], [23, 9], [23, 7], [23, 7], [103, 1], [103, 3], [92, 1], [92, 3], [107, 1], [107, 2], [108, 1], [108, 1], [108, 1], [108, 1], [108, 1], [108, 1], [108, 1], [108, 1], [113, 1], [113, 1], [113, 1], [113, 1], [113, 1], [113, 1], [113, 1], [113, 1], [113, 1], [113, 1], [113, 1], [82, 1], [82, 1], [82, 1], [82, 1], [91, 1], [91, 1], [91, 1], [91, 1], [91, 1], [91, 1], [91, 1], [91, 1], [91, 1], [91, 1], [91, 1], [79, 1], [79, 1], [120, 1], [120, 1], [120, 1], [120, 1], [120, 1], [120, 1], [120, 1], [120, 1], [120, 1], [120, 1], [120, 1], [47, 1], [47, 2], [101, 1], [101, 2], [33, 1], [33, 1], [33, 1], [33, 1]], performAction: k(function(Z, c, p, u, C, t, K) {
    var s = t.length - 1;
    switch (C) {
      case 2:
        this.$ = [];
        break;
      case 3:
        (!Array.isArray(t[s]) || t[s].length > 0) && t[s - 1].push(t[s]), this.$ = t[s - 1];
        break;
      case 4:
      case 183:
        this.$ = t[s];
        break;
      case 11:
        u.setDirection("TB"), this.$ = "TB";
        break;
      case 12:
        u.setDirection(t[s - 1]), this.$ = t[s - 1];
        break;
      case 27:
        this.$ = t[s - 1].nodes;
        break;
      case 28:
      case 29:
      case 30:
      case 31:
      case 32:
        this.$ = [];
        break;
      case 33:
        this.$ = u.addSubGraph(t[s - 6], t[s - 1], t[s - 4]);
        break;
      case 34:
        this.$ = u.addSubGraph(t[s - 3], t[s - 1], t[s - 3]);
        break;
      case 35:
        this.$ = u.addSubGraph(void 0, t[s - 1], void 0);
        break;
      case 37:
        this.$ = t[s].trim(), u.setAccTitle(this.$);
        break;
      case 38:
      case 39:
        this.$ = t[s].trim(), u.setAccDescription(this.$);
        break;
      case 43:
        this.$ = t[s - 1] + t[s];
        break;
      case 44:
        this.$ = t[s];
        break;
      case 45:
        u.addVertex(t[s - 1][t[s - 1].length - 1], void 0, void 0, void 0, void 0, void 0, void 0, t[s]), u.addLink(t[s - 3].stmt, t[s - 1], t[s - 2]), this.$ = { stmt: t[s - 1], nodes: t[s - 1].concat(t[s - 3].nodes) };
        break;
      case 46:
        u.addLink(t[s - 2].stmt, t[s], t[s - 1]), this.$ = { stmt: t[s], nodes: t[s].concat(t[s - 2].nodes) };
        break;
      case 47:
        u.addLink(t[s - 3].stmt, t[s - 1], t[s - 2]), this.$ = { stmt: t[s - 1], nodes: t[s - 1].concat(t[s - 3].nodes) };
        break;
      case 48:
        this.$ = { stmt: t[s - 1], nodes: t[s - 1] };
        break;
      case 49:
        u.addVertex(t[s - 1][t[s - 1].length - 1], void 0, void 0, void 0, void 0, void 0, void 0, t[s]), this.$ = { stmt: t[s - 1], nodes: t[s - 1], shapeData: t[s] };
        break;
      case 50:
        this.$ = { stmt: t[s], nodes: t[s] };
        break;
      case 51:
        this.$ = [t[s]];
        break;
      case 52:
        u.addVertex(t[s - 5][t[s - 5].length - 1], void 0, void 0, void 0, void 0, void 0, void 0, t[s - 4]), this.$ = t[s - 5].concat(t[s]);
        break;
      case 53:
        this.$ = t[s - 4].concat(t[s]);
        break;
      case 54:
        this.$ = t[s];
        break;
      case 55:
        this.$ = t[s - 2], u.setClass(t[s - 2], t[s]);
        break;
      case 56:
        this.$ = t[s - 3], u.addVertex(t[s - 3], t[s - 1], "square");
        break;
      case 57:
        this.$ = t[s - 3], u.addVertex(t[s - 3], t[s - 1], "doublecircle");
        break;
      case 58:
        this.$ = t[s - 5], u.addVertex(t[s - 5], t[s - 2], "circle");
        break;
      case 59:
        this.$ = t[s - 3], u.addVertex(t[s - 3], t[s - 1], "ellipse");
        break;
      case 60:
        this.$ = t[s - 3], u.addVertex(t[s - 3], t[s - 1], "stadium");
        break;
      case 61:
        this.$ = t[s - 3], u.addVertex(t[s - 3], t[s - 1], "subroutine");
        break;
      case 62:
        this.$ = t[s - 7], u.addVertex(t[s - 7], t[s - 1], "rect", void 0, void 0, void 0, Object.fromEntries([[t[s - 5], t[s - 3]]]));
        break;
      case 63:
        this.$ = t[s - 3], u.addVertex(t[s - 3], t[s - 1], "cylinder");
        break;
      case 64:
        this.$ = t[s - 3], u.addVertex(t[s - 3], t[s - 1], "round");
        break;
      case 65:
        this.$ = t[s - 3], u.addVertex(t[s - 3], t[s - 1], "diamond");
        break;
      case 66:
        this.$ = t[s - 5], u.addVertex(t[s - 5], t[s - 2], "hexagon");
        break;
      case 67:
        this.$ = t[s - 3], u.addVertex(t[s - 3], t[s - 1], "odd");
        break;
      case 68:
        this.$ = t[s - 3], u.addVertex(t[s - 3], t[s - 1], "trapezoid");
        break;
      case 69:
        this.$ = t[s - 3], u.addVertex(t[s - 3], t[s - 1], "inv_trapezoid");
        break;
      case 70:
        this.$ = t[s - 3], u.addVertex(t[s - 3], t[s - 1], "lean_right");
        break;
      case 71:
        this.$ = t[s - 3], u.addVertex(t[s - 3], t[s - 1], "lean_left");
        break;
      case 72:
        this.$ = t[s], u.addVertex(t[s]);
        break;
      case 73:
        t[s - 1].text = t[s], this.$ = t[s - 1];
        break;
      case 74:
      case 75:
        t[s - 2].text = t[s - 1], this.$ = t[s - 2];
        break;
      case 76:
        this.$ = t[s];
        break;
      case 77:
        var v = u.destructLink(t[s], t[s - 2]);
        this.$ = { type: v.type, stroke: v.stroke, length: v.length, text: t[s - 1] };
        break;
      case 78:
        var v = u.destructLink(t[s], t[s - 2]);
        this.$ = { type: v.type, stroke: v.stroke, length: v.length, text: t[s - 1], id: t[s - 3] };
        break;
      case 79:
        this.$ = { text: t[s], type: "text" };
        break;
      case 80:
        this.$ = { text: t[s - 1].text + "" + t[s], type: t[s - 1].type };
        break;
      case 81:
        this.$ = { text: t[s], type: "string" };
        break;
      case 82:
        this.$ = { text: t[s], type: "markdown" };
        break;
      case 83:
        var v = u.destructLink(t[s]);
        this.$ = { type: v.type, stroke: v.stroke, length: v.length };
        break;
      case 84:
        var v = u.destructLink(t[s]);
        this.$ = { type: v.type, stroke: v.stroke, length: v.length, id: t[s - 1] };
        break;
      case 85:
        this.$ = t[s - 1];
        break;
      case 86:
        this.$ = { text: t[s], type: "text" };
        break;
      case 87:
        this.$ = { text: t[s - 1].text + "" + t[s], type: t[s - 1].type };
        break;
      case 88:
        this.$ = { text: t[s], type: "string" };
        break;
      case 89:
      case 104:
        this.$ = { text: t[s], type: "markdown" };
        break;
      case 101:
        this.$ = { text: t[s], type: "text" };
        break;
      case 102:
        this.$ = { text: t[s - 1].text + "" + t[s], type: t[s - 1].type };
        break;
      case 103:
        this.$ = { text: t[s], type: "text" };
        break;
      case 105:
        this.$ = t[s - 4], u.addClass(t[s - 2], t[s]);
        break;
      case 106:
        this.$ = t[s - 4], u.setClass(t[s - 2], t[s]);
        break;
      case 107:
      case 115:
        this.$ = t[s - 1], u.setClickEvent(t[s - 1], t[s]);
        break;
      case 108:
      case 116:
        this.$ = t[s - 3], u.setClickEvent(t[s - 3], t[s - 2]), u.setTooltip(t[s - 3], t[s]);
        break;
      case 109:
        this.$ = t[s - 2], u.setClickEvent(t[s - 2], t[s - 1], t[s]);
        break;
      case 110:
        this.$ = t[s - 4], u.setClickEvent(t[s - 4], t[s - 3], t[s - 2]), u.setTooltip(t[s - 4], t[s]);
        break;
      case 111:
        this.$ = t[s - 2], u.setLink(t[s - 2], t[s]);
        break;
      case 112:
        this.$ = t[s - 4], u.setLink(t[s - 4], t[s - 2]), u.setTooltip(t[s - 4], t[s]);
        break;
      case 113:
        this.$ = t[s - 4], u.setLink(t[s - 4], t[s - 2], t[s]);
        break;
      case 114:
        this.$ = t[s - 6], u.setLink(t[s - 6], t[s - 4], t[s]), u.setTooltip(t[s - 6], t[s - 2]);
        break;
      case 117:
        this.$ = t[s - 1], u.setLink(t[s - 1], t[s]);
        break;
      case 118:
        this.$ = t[s - 3], u.setLink(t[s - 3], t[s - 2]), u.setTooltip(t[s - 3], t[s]);
        break;
      case 119:
        this.$ = t[s - 3], u.setLink(t[s - 3], t[s - 2], t[s]);
        break;
      case 120:
        this.$ = t[s - 5], u.setLink(t[s - 5], t[s - 4], t[s]), u.setTooltip(t[s - 5], t[s - 2]);
        break;
      case 121:
        this.$ = t[s - 4], u.addVertex(t[s - 2], void 0, void 0, t[s]);
        break;
      case 122:
        this.$ = t[s - 4], u.updateLink([t[s - 2]], t[s]);
        break;
      case 123:
        this.$ = t[s - 4], u.updateLink(t[s - 2], t[s]);
        break;
      case 124:
        this.$ = t[s - 8], u.updateLinkInterpolate([t[s - 6]], t[s - 2]), u.updateLink([t[s - 6]], t[s]);
        break;
      case 125:
        this.$ = t[s - 8], u.updateLinkInterpolate(t[s - 6], t[s - 2]), u.updateLink(t[s - 6], t[s]);
        break;
      case 126:
        this.$ = t[s - 6], u.updateLinkInterpolate([t[s - 4]], t[s]);
        break;
      case 127:
        this.$ = t[s - 6], u.updateLinkInterpolate(t[s - 4], t[s]);
        break;
      case 128:
      case 130:
        this.$ = [t[s]];
        break;
      case 129:
      case 131:
        t[s - 2].push(t[s]), this.$ = t[s - 2];
        break;
      case 133:
        this.$ = t[s - 1] + t[s];
        break;
      case 181:
        this.$ = t[s];
        break;
      case 182:
        this.$ = t[s - 1] + "" + t[s];
        break;
      case 184:
        this.$ = t[s - 1] + "" + t[s];
        break;
      case 185:
        this.$ = { stmt: "dir", value: "TB" };
        break;
      case 186:
        this.$ = { stmt: "dir", value: "BT" };
        break;
      case 187:
        this.$ = { stmt: "dir", value: "RL" };
        break;
      case 188:
        this.$ = { stmt: "dir", value: "LR" };
        break;
    }
  }, "anonymous"), table: [{ 3: 1, 4: 2, 9: i, 10: r, 12: a }, { 1: [3] }, e(n, d, { 5: 6 }), { 4: 7, 9: i, 10: r, 12: a }, { 4: 8, 9: i, 10: r, 12: a }, { 13: [1, 9], 14: [1, 10] }, { 1: [2, 1], 6: 11, 7: 12, 8: h, 9: o, 10: b, 11: x, 20: 17, 22: 18, 23: 19, 24: 20, 25: 21, 26: 22, 27: l, 33: 24, 34: U, 36: _, 38: g, 42: 28, 43: 38, 44: A, 45: 39, 47: 40, 60: S, 84: J, 85: g1, 86: A1, 87: b1, 88: G1, 89: B, 102: w, 105: $, 106: L, 109: I, 111: R, 113: 41, 114: N, 115: P, 116: G, 121: O1, 122: U1, 123: M1, 124: V1 }, e(n, [2, 9]), e(n, [2, 10]), e(n, [2, 11]), { 8: [1, 54], 9: [1, 55], 10: d1, 15: 53, 18: 56 }, e(D, [2, 3]), e(D, [2, 4]), e(D, [2, 5]), e(D, [2, 6]), e(D, [2, 7]), e(D, [2, 8]), { 8: e1, 9: t1, 11: s1, 21: 58, 41: 59, 72: 63, 75: [1, 64], 77: [1, 66], 78: [1, 65] }, { 8: e1, 9: t1, 11: s1, 21: 67 }, { 8: e1, 9: t1, 11: s1, 21: 68 }, { 8: e1, 9: t1, 11: s1, 21: 69 }, { 8: e1, 9: t1, 11: s1, 21: 70 }, { 8: e1, 9: t1, 11: s1, 21: 71 }, { 8: e1, 9: t1, 10: [1, 72], 11: s1, 21: 73 }, e(D, [2, 36]), { 35: [1, 74] }, { 37: [1, 75] }, e(D, [2, 39]), e(m1, [2, 50], { 18: 76, 39: 77, 10: d1, 40: re }), { 10: [1, 79] }, { 10: [1, 80] }, { 10: [1, 81] }, { 10: [1, 82] }, { 14: x1, 44: C1, 60: D1, 80: [1, 86], 89: T1, 95: [1, 83], 97: [1, 84], 101: 85, 105: S1, 106: F1, 109: _1, 111: v1, 114: B1, 115: w1, 116: $1, 120: 87 }, e(D, [2, 185]), e(D, [2, 186]), e(D, [2, 187]), e(D, [2, 188]), e(k1, [2, 51]), e(k1, [2, 54], { 46: [1, 99] }), e(M, [2, 72], { 113: 112, 29: [1, 100], 44: A, 48: [1, 101], 50: [1, 102], 52: [1, 103], 54: [1, 104], 56: [1, 105], 58: [1, 106], 60: S, 63: [1, 107], 65: [1, 108], 67: [1, 109], 68: [1, 110], 70: [1, 111], 89: B, 102: w, 105: $, 106: L, 109: I, 111: R, 114: N, 115: P, 116: G }), e(z, [2, 181]), e(z, [2, 142]), e(z, [2, 143]), e(z, [2, 144]), e(z, [2, 145]), e(z, [2, 146]), e(z, [2, 147]), e(z, [2, 148]), e(z, [2, 149]), e(z, [2, 150]), e(z, [2, 151]), e(z, [2, 152]), e(n, [2, 12]), e(n, [2, 18]), e(n, [2, 19]), { 9: [1, 113] }, e(ne, [2, 26], { 18: 114, 10: d1 }), e(D, [2, 27]), { 42: 115, 43: 38, 44: A, 45: 39, 47: 40, 60: S, 89: B, 102: w, 105: $, 106: L, 109: I, 111: R, 113: 41, 114: N, 115: P, 116: G }, e(D, [2, 40]), e(D, [2, 41]), e(D, [2, 42]), e(L1, [2, 76], { 73: 116, 62: [1, 118], 74: [1, 117] }), { 76: 119, 79: 120, 80: ae, 81: ue, 116: W1, 119: K1 }, { 75: [1, 125], 77: [1, 126] }, e(oe, [2, 83]), e(D, [2, 28]), e(D, [2, 29]), e(D, [2, 30]), e(D, [2, 31]), e(D, [2, 32]), { 10: le, 12: ce, 14: he, 27: de, 28: 127, 32: pe, 44: ge, 60: Ae, 75: be, 80: [1, 129], 81: [1, 130], 83: 140, 84: ke, 85: ye, 86: fe, 87: Ee, 88: me, 89: xe, 90: Ce, 91: 128, 105: De, 109: Te, 111: Se, 114: Fe, 115: _e, 116: ve }, e(q1, d, { 5: 153 }), e(D, [2, 37]), e(D, [2, 38]), e(m1, [2, 48], { 44: Be }), e(m1, [2, 49], { 18: 155, 10: d1, 40: we }), e(k1, [2, 44]), { 44: A, 47: 157, 60: S, 89: B, 102: w, 105: $, 106: L, 109: I, 111: R, 113: 41, 114: N, 115: P, 116: G }, { 102: [1, 158], 103: 159, 105: [1, 160] }, { 44: A, 47: 161, 60: S, 89: B, 102: w, 105: $, 106: L, 109: I, 111: R, 113: 41, 114: N, 115: P, 116: G }, { 44: A, 47: 162, 60: S, 89: B, 102: w, 105: $, 106: L, 109: I, 111: R, 113: 41, 114: N, 115: P, 116: G }, e(F, [2, 107], { 10: [1, 163], 96: [1, 164] }), { 80: [1, 165] }, e(F, [2, 115], { 120: 167, 10: [1, 166], 14: x1, 44: C1, 60: D1, 89: T1, 105: S1, 106: F1, 109: _1, 111: v1, 114: B1, 115: w1, 116: $1 }), e(F, [2, 117], { 10: [1, 168] }), e(H, [2, 183]), e(H, [2, 170]), e(H, [2, 171]), e(H, [2, 172]), e(H, [2, 173]), e(H, [2, 174]), e(H, [2, 175]), e(H, [2, 176]), e(H, [2, 177]), e(H, [2, 178]), e(H, [2, 179]), e(H, [2, 180]), { 44: A, 47: 169, 60: S, 89: B, 102: w, 105: $, 106: L, 109: I, 111: R, 113: 41, 114: N, 115: P, 116: G }, { 30: 170, 67: y, 80: V, 81: W, 82: 171, 116: f, 117: E, 118: m }, { 30: 178, 67: y, 80: V, 81: W, 82: 171, 116: f, 117: E, 118: m }, { 30: 180, 50: [1, 179], 67: y, 80: V, 81: W, 82: 171, 116: f, 117: E, 118: m }, { 30: 181, 67: y, 80: V, 81: W, 82: 171, 116: f, 117: E, 118: m }, { 30: 182, 67: y, 80: V, 81: W, 82: 171, 116: f, 117: E, 118: m }, { 30: 183, 67: y, 80: V, 81: W, 82: 171, 116: f, 117: E, 118: m }, { 109: [1, 184] }, { 30: 185, 67: y, 80: V, 81: W, 82: 171, 116: f, 117: E, 118: m }, { 30: 186, 65: [1, 187], 67: y, 80: V, 81: W, 82: 171, 116: f, 117: E, 118: m }, { 30: 188, 67: y, 80: V, 81: W, 82: 171, 116: f, 117: E, 118: m }, { 30: 189, 67: y, 80: V, 81: W, 82: 171, 116: f, 117: E, 118: m }, { 30: 190, 67: y, 80: V, 81: W, 82: 171, 116: f, 117: E, 118: m }, e(z, [2, 182]), e(n, [2, 20]), e(ne, [2, 25]), e(m1, [2, 46], { 39: 191, 18: 192, 10: d1, 40: re }), e(L1, [2, 73], { 10: [1, 193] }), { 10: [1, 194] }, { 30: 195, 67: y, 80: V, 81: W, 82: 171, 116: f, 117: E, 118: m }, { 77: [1, 196], 79: 197, 116: W1, 119: K1 }, e(I1, [2, 79]), e(I1, [2, 81]), e(I1, [2, 82]), e(I1, [2, 168]), e(I1, [2, 169]), { 76: 198, 79: 120, 80: ae, 81: ue, 116: W1, 119: K1 }, e(oe, [2, 84]), { 8: e1, 9: t1, 10: le, 11: s1, 12: ce, 14: he, 21: 200, 27: de, 29: [1, 199], 32: pe, 44: ge, 60: Ae, 75: be, 83: 140, 84: ke, 85: ye, 86: fe, 87: Ee, 88: me, 89: xe, 90: Ce, 91: 201, 105: De, 109: Te, 111: Se, 114: Fe, 115: _e, 116: ve }, e(T, [2, 101]), e(T, [2, 103]), e(T, [2, 104]), e(T, [2, 157]), e(T, [2, 158]), e(T, [2, 159]), e(T, [2, 160]), e(T, [2, 161]), e(T, [2, 162]), e(T, [2, 163]), e(T, [2, 164]), e(T, [2, 165]), e(T, [2, 166]), e(T, [2, 167]), e(T, [2, 90]), e(T, [2, 91]), e(T, [2, 92]), e(T, [2, 93]), e(T, [2, 94]), e(T, [2, 95]), e(T, [2, 96]), e(T, [2, 97]), e(T, [2, 98]), e(T, [2, 99]), e(T, [2, 100]), { 6: 11, 7: 12, 8: h, 9: o, 10: b, 11: x, 20: 17, 22: 18, 23: 19, 24: 20, 25: 21, 26: 22, 27: l, 32: [1, 202], 33: 24, 34: U, 36: _, 38: g, 42: 28, 43: 38, 44: A, 45: 39, 47: 40, 60: S, 84: J, 85: g1, 86: A1, 87: b1, 88: G1, 89: B, 102: w, 105: $, 106: L, 109: I, 111: R, 113: 41, 114: N, 115: P, 116: G, 121: O1, 122: U1, 123: M1, 124: V1 }, { 10: d1, 18: 203 }, { 44: [1, 204] }, e(k1, [2, 43]), { 10: [1, 205], 44: A, 60: S, 89: B, 102: w, 105: $, 106: L, 109: I, 111: R, 113: 112, 114: N, 115: P, 116: G }, { 10: [1, 206] }, { 10: [1, 207], 106: [1, 208] }, e($e, [2, 128]), { 10: [1, 209], 44: A, 60: S, 89: B, 102: w, 105: $, 106: L, 109: I, 111: R, 113: 112, 114: N, 115: P, 116: G }, { 10: [1, 210], 44: A, 60: S, 89: B, 102: w, 105: $, 106: L, 109: I, 111: R, 113: 112, 114: N, 115: P, 116: G }, { 80: [1, 211] }, e(F, [2, 109], { 10: [1, 212] }), e(F, [2, 111], { 10: [1, 213] }), { 80: [1, 214] }, e(H, [2, 184]), { 80: [1, 215], 98: [1, 216] }, e(k1, [2, 55], { 113: 112, 44: A, 60: S, 89: B, 102: w, 105: $, 106: L, 109: I, 111: R, 114: N, 115: P, 116: G }), { 31: [1, 217], 67: y, 82: 218, 116: f, 117: E, 118: m }, e(p1, [2, 86]), e(p1, [2, 88]), e(p1, [2, 89]), e(p1, [2, 153]), e(p1, [2, 154]), e(p1, [2, 155]), e(p1, [2, 156]), { 49: [1, 219], 67: y, 82: 218, 116: f, 117: E, 118: m }, { 30: 220, 67: y, 80: V, 81: W, 82: 171, 116: f, 117: E, 118: m }, { 51: [1, 221], 67: y, 82: 218, 116: f, 117: E, 118: m }, { 53: [1, 222], 67: y, 82: 218, 116: f, 117: E, 118: m }, { 55: [1, 223], 67: y, 82: 218, 116: f, 117: E, 118: m }, { 57: [1, 224], 67: y, 82: 218, 116: f, 117: E, 118: m }, { 60: [1, 225] }, { 64: [1, 226], 67: y, 82: 218, 116: f, 117: E, 118: m }, { 66: [1, 227], 67: y, 82: 218, 116: f, 117: E, 118: m }, { 30: 228, 67: y, 80: V, 81: W, 82: 171, 116: f, 117: E, 118: m }, { 31: [1, 229], 67: y, 82: 218, 116: f, 117: E, 118: m }, { 67: y, 69: [1, 230], 71: [1, 231], 82: 218, 116: f, 117: E, 118: m }, { 67: y, 69: [1, 233], 71: [1, 232], 82: 218, 116: f, 117: E, 118: m }, e(m1, [2, 45], { 18: 155, 10: d1, 40: we }), e(m1, [2, 47], { 44: Be }), e(L1, [2, 75]), e(L1, [2, 74]), { 62: [1, 234], 67: y, 82: 218, 116: f, 117: E, 118: m }, e(L1, [2, 77]), e(I1, [2, 80]), { 77: [1, 235], 79: 197, 116: W1, 119: K1 }, { 30: 236, 67: y, 80: V, 81: W, 82: 171, 116: f, 117: E, 118: m }, e(q1, d, { 5: 237 }), e(T, [2, 102]), e(D, [2, 35]), { 43: 238, 44: A, 45: 39, 47: 40, 60: S, 89: B, 102: w, 105: $, 106: L, 109: I, 111: R, 113: 41, 114: N, 115: P, 116: G }, { 10: d1, 18: 239 }, { 10: i1, 60: r1, 84: n1, 92: 240, 105: a1, 107: 241, 108: 242, 109: u1, 110: o1, 111: l1, 112: c1 }, { 10: i1, 60: r1, 84: n1, 92: 251, 104: [1, 252], 105: a1, 107: 241, 108: 242, 109: u1, 110: o1, 111: l1, 112: c1 }, { 10: i1, 60: r1, 84: n1, 92: 253, 104: [1, 254], 105: a1, 107: 241, 108: 242, 109: u1, 110: o1, 111: l1, 112: c1 }, { 105: [1, 255] }, { 10: i1, 60: r1, 84: n1, 92: 256, 105: a1, 107: 241, 108: 242, 109: u1, 110: o1, 111: l1, 112: c1 }, { 44: A, 47: 257, 60: S, 89: B, 102: w, 105: $, 106: L, 109: I, 111: R, 113: 41, 114: N, 115: P, 116: G }, e(F, [2, 108]), { 80: [1, 258] }, { 80: [1, 259], 98: [1, 260] }, e(F, [2, 116]), e(F, [2, 118], { 10: [1, 261] }), e(F, [2, 119]), e(M, [2, 56]), e(p1, [2, 87]), e(M, [2, 57]), { 51: [1, 262], 67: y, 82: 218, 116: f, 117: E, 118: m }, e(M, [2, 64]), e(M, [2, 59]), e(M, [2, 60]), e(M, [2, 61]), { 109: [1, 263] }, e(M, [2, 63]), e(M, [2, 65]), { 66: [1, 264], 67: y, 82: 218, 116: f, 117: E, 118: m }, e(M, [2, 67]), e(M, [2, 68]), e(M, [2, 70]), e(M, [2, 69]), e(M, [2, 71]), e([10, 44, 60, 89, 102, 105, 106, 109, 111, 114, 115, 116], [2, 85]), e(L1, [2, 78]), { 31: [1, 265], 67: y, 82: 218, 116: f, 117: E, 118: m }, { 6: 11, 7: 12, 8: h, 9: o, 10: b, 11: x, 20: 17, 22: 18, 23: 19, 24: 20, 25: 21, 26: 22, 27: l, 32: [1, 266], 33: 24, 34: U, 36: _, 38: g, 42: 28, 43: 38, 44: A, 45: 39, 47: 40, 60: S, 84: J, 85: g1, 86: A1, 87: b1, 88: G1, 89: B, 102: w, 105: $, 106: L, 109: I, 111: R, 113: 41, 114: N, 115: P, 116: G, 121: O1, 122: U1, 123: M1, 124: V1 }, e(k1, [2, 53]), { 43: 267, 44: A, 45: 39, 47: 40, 60: S, 89: B, 102: w, 105: $, 106: L, 109: I, 111: R, 113: 41, 114: N, 115: P, 116: G }, e(F, [2, 121], { 106: R1 }), e(Le, [2, 130], { 108: 269, 10: i1, 60: r1, 84: n1, 105: a1, 109: u1, 110: o1, 111: l1, 112: c1 }), e(Y, [2, 132]), e(Y, [2, 134]), e(Y, [2, 135]), e(Y, [2, 136]), e(Y, [2, 137]), e(Y, [2, 138]), e(Y, [2, 139]), e(Y, [2, 140]), e(Y, [2, 141]), e(F, [2, 122], { 106: R1 }), { 10: [1, 270] }, e(F, [2, 123], { 106: R1 }), { 10: [1, 271] }, e($e, [2, 129]), e(F, [2, 105], { 106: R1 }), e(F, [2, 106], { 113: 112, 44: A, 60: S, 89: B, 102: w, 105: $, 106: L, 109: I, 111: R, 114: N, 115: P, 116: G }), e(F, [2, 110]), e(F, [2, 112], { 10: [1, 272] }), e(F, [2, 113]), { 98: [1, 273] }, { 51: [1, 274] }, { 62: [1, 275] }, { 66: [1, 276] }, { 8: e1, 9: t1, 11: s1, 21: 277 }, e(D, [2, 34]), e(k1, [2, 52]), { 10: i1, 60: r1, 84: n1, 105: a1, 107: 278, 108: 242, 109: u1, 110: o1, 111: l1, 112: c1 }, e(Y, [2, 133]), { 14: x1, 44: C1, 60: D1, 89: T1, 101: 279, 105: S1, 106: F1, 109: _1, 111: v1, 114: B1, 115: w1, 116: $1, 120: 87 }, { 14: x1, 44: C1, 60: D1, 89: T1, 101: 280, 105: S1, 106: F1, 109: _1, 111: v1, 114: B1, 115: w1, 116: $1, 120: 87 }, { 98: [1, 281] }, e(F, [2, 120]), e(M, [2, 58]), { 30: 282, 67: y, 80: V, 81: W, 82: 171, 116: f, 117: E, 118: m }, e(M, [2, 66]), e(q1, d, { 5: 283 }), e(Le, [2, 131], { 108: 269, 10: i1, 60: r1, 84: n1, 105: a1, 109: u1, 110: o1, 111: l1, 112: c1 }), e(F, [2, 126], { 120: 167, 10: [1, 284], 14: x1, 44: C1, 60: D1, 89: T1, 105: S1, 106: F1, 109: _1, 111: v1, 114: B1, 115: w1, 116: $1 }), e(F, [2, 127], { 120: 167, 10: [1, 285], 14: x1, 44: C1, 60: D1, 89: T1, 105: S1, 106: F1, 109: _1, 111: v1, 114: B1, 115: w1, 116: $1 }), e(F, [2, 114]), { 31: [1, 286], 67: y, 82: 218, 116: f, 117: E, 118: m }, { 6: 11, 7: 12, 8: h, 9: o, 10: b, 11: x, 20: 17, 22: 18, 23: 19, 24: 20, 25: 21, 26: 22, 27: l, 32: [1, 287], 33: 24, 34: U, 36: _, 38: g, 42: 28, 43: 38, 44: A, 45: 39, 47: 40, 60: S, 84: J, 85: g1, 86: A1, 87: b1, 88: G1, 89: B, 102: w, 105: $, 106: L, 109: I, 111: R, 113: 41, 114: N, 115: P, 116: G, 121: O1, 122: U1, 123: M1, 124: V1 }, { 10: i1, 60: r1, 84: n1, 92: 288, 105: a1, 107: 241, 108: 242, 109: u1, 110: o1, 111: l1, 112: c1 }, { 10: i1, 60: r1, 84: n1, 92: 289, 105: a1, 107: 241, 108: 242, 109: u1, 110: o1, 111: l1, 112: c1 }, e(M, [2, 62]), e(D, [2, 33]), e(F, [2, 124], { 106: R1 }), e(F, [2, 125], { 106: R1 })], defaultActions: {}, parseError: k(function(Z, c) {
    if (c.recoverable)
      this.trace(Z);
    else {
      var p = new Error(Z);
      throw p.hash = c, p;
    }
  }, "parseError"), parse: k(function(Z) {
    var c = this, p = [0], u = [], C = [null], t = [], K = this.table, s = "", v = 0, Ie = 0, Ve = 2, Re = 1, We = t.slice.call(arguments, 1), O = Object.create(this.lexer), y1 = { yy: {} };
    for (var J1 in this.yy)
      Object.prototype.hasOwnProperty.call(this.yy, J1) && (y1.yy[J1] = this.yy[J1]);
    O.setInput(Z, y1.yy), y1.yy.lexer = O, y1.yy.parser = this, typeof O.yylloc > "u" && (O.yylloc = {});
    var Y1 = O.yylloc;
    t.push(Y1);
    var Ke = O.options && O.options.ranges;
    typeof y1.yy.parseError == "function" ? this.parseError = y1.yy.parseError : this.parseError = Object.getPrototypeOf(this).parseError;
    function je(q) {
      p.length = p.length - 2 * q, C.length = C.length - q, t.length = t.length - q;
    }
    k(je, "popStack");
    function Ne() {
      var q;
      return q = u.pop() || O.lex() || Re, typeof q != "number" && (q instanceof Array && (u = q, q = u.pop()), q = c.symbols_[q] || q), q;
    }
    k(Ne, "lex");
    for (var j, f1, X, Z1, N1 = {}, z1, h1, Pe, H1; ; ) {
      if (f1 = p[p.length - 1], this.defaultActions[f1] ? X = this.defaultActions[f1] : ((j === null || typeof j > "u") && (j = Ne()), X = K[f1] && K[f1][j]), typeof X > "u" || !X.length || !X[0]) {
        var Q1 = "";
        H1 = [];
        for (z1 in K[f1])
          this.terminals_[z1] && z1 > Ve && H1.push("'" + this.terminals_[z1] + "'");
        O.showPosition ? Q1 = "Parse error on line " + (v + 1) + `:
` + O.showPosition() + `
Expecting ` + H1.join(", ") + ", got '" + (this.terminals_[j] || j) + "'" : Q1 = "Parse error on line " + (v + 1) + ": Unexpected " + (j == Re ? "end of input" : "'" + (this.terminals_[j] || j) + "'"), this.parseError(Q1, { text: O.match, token: this.terminals_[j] || j, line: O.yylineno, loc: Y1, expected: H1 });
      }
      if (X[0] instanceof Array && X.length > 1)
        throw new Error("Parse Error: multiple actions possible at state: " + f1 + ", token: " + j);
      switch (X[0]) {
        case 1:
          p.push(j), C.push(O.yytext), t.push(O.yylloc), p.push(X[1]), j = null, Ie = O.yyleng, s = O.yytext, v = O.yylineno, Y1 = O.yylloc;
          break;
        case 2:
          if (h1 = this.productions_[X[1]][1], N1.$ = C[C.length - h1], N1._$ = { first_line: t[t.length - (h1 || 1)].first_line, last_line: t[t.length - 1].last_line, first_column: t[t.length - (h1 || 1)].first_column, last_column: t[t.length - 1].last_column }, Ke && (N1._$.range = [t[t.length - (h1 || 1)].range[0], t[t.length - 1].range[1]]), Z1 = this.performAction.apply(N1, [s, Ie, v, y1.yy, X[1], C, t].concat(We)), typeof Z1 < "u")
            return Z1;
          h1 && (p = p.slice(0, -1 * h1 * 2), C = C.slice(0, -1 * h1), t = t.slice(0, -1 * h1)), p.push(this.productions_[X[1]][0]), C.push(N1.$), t.push(N1._$), Pe = K[p[p.length - 2]][p[p.length - 1]], p.push(Pe);
          break;
        case 3:
          return true;
      }
    }
    return true;
  }, "parse") }, Me = function() {
    var Z = { EOF: 1, parseError: k(function(c, p) {
      if (this.yy.parser)
        this.yy.parser.parseError(c, p);
      else
        throw new Error(c);
    }, "parseError"), setInput: k(function(c, p) {
      return this.yy = p || this.yy || {}, this._input = c, this._more = this._backtrack = this.done = false, this.yylineno = this.yyleng = 0, this.yytext = this.matched = this.match = "", this.conditionStack = ["INITIAL"], this.yylloc = { first_line: 1, first_column: 0, last_line: 1, last_column: 0 }, this.options.ranges && (this.yylloc.range = [0, 0]), this.offset = 0, this;
    }, "setInput"), input: k(function() {
      var c = this._input[0];
      this.yytext += c, this.yyleng++, this.offset++, this.match += c, this.matched += c;
      var p = c.match(/(?:\r\n?|\n).*/g);
      return p ? (this.yylineno++, this.yylloc.last_line++) : this.yylloc.last_column++, this.options.ranges && this.yylloc.range[1]++, this._input = this._input.slice(1), c;
    }, "input"), unput: k(function(c) {
      var p = c.length, u = c.split(/(?:\r\n?|\n)/g);
      this._input = c + this._input, this.yytext = this.yytext.substr(0, this.yytext.length - p), this.offset -= p;
      var C = this.match.split(/(?:\r\n?|\n)/g);
      this.match = this.match.substr(0, this.match.length - 1), this.matched = this.matched.substr(0, this.matched.length - 1), u.length - 1 && (this.yylineno -= u.length - 1);
      var t = this.yylloc.range;
      return this.yylloc = { first_line: this.yylloc.first_line, last_line: this.yylineno + 1, first_column: this.yylloc.first_column, last_column: u ? (u.length === C.length ? this.yylloc.first_column : 0) + C[C.length - u.length].length - u[0].length : this.yylloc.first_column - p }, this.options.ranges && (this.yylloc.range = [t[0], t[0] + this.yyleng - p]), this.yyleng = this.yytext.length, this;
    }, "unput"), more: k(function() {
      return this._more = true, this;
    }, "more"), reject: k(function() {
      if (this.options.backtrack_lexer)
        this._backtrack = true;
      else
        return this.parseError("Lexical error on line " + (this.yylineno + 1) + `. You can only invoke reject() in the lexer when the lexer is of the backtracking persuasion (options.backtrack_lexer = true).
` + this.showPosition(), { text: "", token: null, line: this.yylineno });
      return this;
    }, "reject"), less: k(function(c) {
      this.unput(this.match.slice(c));
    }, "less"), pastInput: k(function() {
      var c = this.matched.substr(0, this.matched.length - this.match.length);
      return (c.length > 20 ? "..." : "") + c.substr(-20).replace(/\n/g, "");
    }, "pastInput"), upcomingInput: k(function() {
      var c = this.match;
      return c.length < 20 && (c += this._input.substr(0, 20 - c.length)), (c.substr(0, 20) + (c.length > 20 ? "..." : "")).replace(/\n/g, "");
    }, "upcomingInput"), showPosition: k(function() {
      var c = this.pastInput(), p = new Array(c.length + 1).join("-");
      return c + this.upcomingInput() + `
` + p + "^";
    }, "showPosition"), test_match: k(function(c, p) {
      var u, C, t;
      if (this.options.backtrack_lexer && (t = { yylineno: this.yylineno, yylloc: { first_line: this.yylloc.first_line, last_line: this.last_line, first_column: this.yylloc.first_column, last_column: this.yylloc.last_column }, yytext: this.yytext, match: this.match, matches: this.matches, matched: this.matched, yyleng: this.yyleng, offset: this.offset, _more: this._more, _input: this._input, yy: this.yy, conditionStack: this.conditionStack.slice(0), done: this.done }, this.options.ranges && (t.yylloc.range = this.yylloc.range.slice(0))), C = c[0].match(/(?:\r\n?|\n).*/g), C && (this.yylineno += C.length), this.yylloc = { first_line: this.yylloc.last_line, last_line: this.yylineno + 1, first_column: this.yylloc.last_column, last_column: C ? C[C.length - 1].length - C[C.length - 1].match(/\r?\n?/)[0].length : this.yylloc.last_column + c[0].length }, this.yytext += c[0], this.match += c[0], this.matches = c, this.yyleng = this.yytext.length, this.options.ranges && (this.yylloc.range = [this.offset, this.offset += this.yyleng]), this._more = false, this._backtrack = false, this._input = this._input.slice(c[0].length), this.matched += c[0], u = this.performAction.call(this, this.yy, this, p, this.conditionStack[this.conditionStack.length - 1]), this.done && this._input && (this.done = false), u)
        return u;
      if (this._backtrack) {
        for (var K in t)
          this[K] = t[K];
        return false;
      }
      return false;
    }, "test_match"), next: k(function() {
      if (this.done)
        return this.EOF;
      this._input || (this.done = true);
      var c, p, u, C;
      this._more || (this.yytext = "", this.match = "");
      for (var t = this._currentRules(), K = 0; K < t.length; K++)
        if (u = this._input.match(this.rules[t[K]]), u && (!p || u[0].length > p[0].length)) {
          if (p = u, C = K, this.options.backtrack_lexer) {
            if (c = this.test_match(u, t[K]), c !== false)
              return c;
            if (this._backtrack) {
              p = false;
              continue;
            } else
              return false;
          } else if (!this.options.flex)
            break;
        }
      return p ? (c = this.test_match(p, t[C]), c !== false ? c : false) : this._input === "" ? this.EOF : this.parseError("Lexical error on line " + (this.yylineno + 1) + `. Unrecognized text.
` + this.showPosition(), { text: "", token: null, line: this.yylineno });
    }, "next"), lex: k(function() {
      var c = this.next();
      return c || this.lex();
    }, "lex"), begin: k(function(c) {
      this.conditionStack.push(c);
    }, "begin"), popState: k(function() {
      var c = this.conditionStack.length - 1;
      return c > 0 ? this.conditionStack.pop() : this.conditionStack[0];
    }, "popState"), _currentRules: k(function() {
      return this.conditionStack.length && this.conditionStack[this.conditionStack.length - 1] ? this.conditions[this.conditionStack[this.conditionStack.length - 1]].rules : this.conditions.INITIAL.rules;
    }, "_currentRules"), topState: k(function(c) {
      return c = this.conditionStack.length - 1 - Math.abs(c || 0), c >= 0 ? this.conditionStack[c] : "INITIAL";
    }, "topState"), pushState: k(function(c) {
      this.begin(c);
    }, "pushState"), stateStackSize: k(function() {
      return this.conditionStack.length;
    }, "stateStackSize"), options: {}, performAction: k(function(c, p, u, C) {
      switch (u) {
        case 0:
          return this.begin("acc_title"), 34;
        case 1:
          return this.popState(), "acc_title_value";
        case 2:
          return this.begin("acc_descr"), 36;
        case 3:
          return this.popState(), "acc_descr_value";
        case 4:
          this.begin("acc_descr_multiline");
          break;
        case 5:
          this.popState();
          break;
        case 6:
          return "acc_descr_multiline_value";
        case 7:
          return this.pushState("shapeData"), p.yytext = "", 40;
        case 8:
          return this.pushState("shapeDataStr"), 40;
        case 9:
          return this.popState(), 40;
        case 10:
          const t = /\n\s*/g;
          return p.yytext = p.yytext.replace(t, "<br/>"), 40;
        case 11:
          return 40;
        case 12:
          this.popState();
          break;
        case 13:
          this.begin("callbackname");
          break;
        case 14:
          this.popState();
          break;
        case 15:
          this.popState(), this.begin("callbackargs");
          break;
        case 16:
          return 95;
        case 17:
          this.popState();
          break;
        case 18:
          return 96;
        case 19:
          return "MD_STR";
        case 20:
          this.popState();
          break;
        case 21:
          this.begin("md_string");
          break;
        case 22:
          return "STR";
        case 23:
          this.popState();
          break;
        case 24:
          this.pushState("string");
          break;
        case 25:
          return 84;
        case 26:
          return 102;
        case 27:
          return 85;
        case 28:
          return 104;
        case 29:
          return 86;
        case 30:
          return 87;
        case 31:
          return 97;
        case 32:
          this.begin("click");
          break;
        case 33:
          this.popState();
          break;
        case 34:
          return 88;
        case 35:
          return c.lex.firstGraph() && this.begin("dir"), 12;
        case 36:
          return c.lex.firstGraph() && this.begin("dir"), 12;
        case 37:
          return c.lex.firstGraph() && this.begin("dir"), 12;
        case 38:
          return 27;
        case 39:
          return 32;
        case 40:
          return 98;
        case 41:
          return 98;
        case 42:
          return 98;
        case 43:
          return 98;
        case 44:
          return this.popState(), 13;
        case 45:
          return this.popState(), 14;
        case 46:
          return this.popState(), 14;
        case 47:
          return this.popState(), 14;
        case 48:
          return this.popState(), 14;
        case 49:
          return this.popState(), 14;
        case 50:
          return this.popState(), 14;
        case 51:
          return this.popState(), 14;
        case 52:
          return this.popState(), 14;
        case 53:
          return this.popState(), 14;
        case 54:
          return this.popState(), 14;
        case 55:
          return 121;
        case 56:
          return 122;
        case 57:
          return 123;
        case 58:
          return 124;
        case 59:
          return 78;
        case 60:
          return 105;
        case 61:
          return 111;
        case 62:
          return 46;
        case 63:
          return 60;
        case 64:
          return 44;
        case 65:
          return 8;
        case 66:
          return 106;
        case 67:
          return 115;
        case 68:
          return this.popState(), 77;
        case 69:
          return this.pushState("edgeText"), 75;
        case 70:
          return 119;
        case 71:
          return this.popState(), 77;
        case 72:
          return this.pushState("thickEdgeText"), 75;
        case 73:
          return 119;
        case 74:
          return this.popState(), 77;
        case 75:
          return this.pushState("dottedEdgeText"), 75;
        case 76:
          return 119;
        case 77:
          return 77;
        case 78:
          return this.popState(), 53;
        case 79:
          return "TEXT";
        case 80:
          return this.pushState("ellipseText"), 52;
        case 81:
          return this.popState(), 55;
        case 82:
          return this.pushState("text"), 54;
        case 83:
          return this.popState(), 57;
        case 84:
          return this.pushState("text"), 56;
        case 85:
          return 58;
        case 86:
          return this.pushState("text"), 67;
        case 87:
          return this.popState(), 64;
        case 88:
          return this.pushState("text"), 63;
        case 89:
          return this.popState(), 49;
        case 90:
          return this.pushState("text"), 48;
        case 91:
          return this.popState(), 69;
        case 92:
          return this.popState(), 71;
        case 93:
          return 117;
        case 94:
          return this.pushState("trapText"), 68;
        case 95:
          return this.pushState("trapText"), 70;
        case 96:
          return 118;
        case 97:
          return 67;
        case 98:
          return 90;
        case 99:
          return "SEP";
        case 100:
          return 89;
        case 101:
          return 115;
        case 102:
          return 111;
        case 103:
          return 44;
        case 104:
          return 109;
        case 105:
          return 114;
        case 106:
          return 116;
        case 107:
          return this.popState(), 62;
        case 108:
          return this.pushState("text"), 62;
        case 109:
          return this.popState(), 51;
        case 110:
          return this.pushState("text"), 50;
        case 111:
          return this.popState(), 31;
        case 112:
          return this.pushState("text"), 29;
        case 113:
          return this.popState(), 66;
        case 114:
          return this.pushState("text"), 65;
        case 115:
          return "TEXT";
        case 116:
          return "QUOTE";
        case 117:
          return 9;
        case 118:
          return 10;
        case 119:
          return 11;
      }
    }, "anonymous"), rules: [/^(?:accTitle\s*:\s*)/, /^(?:(?!\n||)*[^\n]*)/, /^(?:accDescr\s*:\s*)/, /^(?:(?!\n||)*[^\n]*)/, /^(?:accDescr\s*\{\s*)/, /^(?:[\}])/, /^(?:[^\}]*)/, /^(?:@\{)/, /^(?:["])/, /^(?:["])/, /^(?:[^\"]+)/, /^(?:[^}^"]+)/, /^(?:\})/, /^(?:call[\s]+)/, /^(?:\([\s]*\))/, /^(?:\()/, /^(?:[^(]*)/, /^(?:\))/, /^(?:[^)]*)/, /^(?:[^`"]+)/, /^(?:[`]["])/, /^(?:["][`])/, /^(?:[^"]+)/, /^(?:["])/, /^(?:["])/, /^(?:style\b)/, /^(?:default\b)/, /^(?:linkStyle\b)/, /^(?:interpolate\b)/, /^(?:classDef\b)/, /^(?:class\b)/, /^(?:href[\s])/, /^(?:click[\s]+)/, /^(?:[\s\n])/, /^(?:[^\s\n]*)/, /^(?:flowchart-elk\b)/, /^(?:graph\b)/, /^(?:flowchart\b)/, /^(?:subgraph\b)/, /^(?:end\b\s*)/, /^(?:_self\b)/, /^(?:_blank\b)/, /^(?:_parent\b)/, /^(?:_top\b)/, /^(?:(\r?\n)*\s*\n)/, /^(?:\s*LR\b)/, /^(?:\s*RL\b)/, /^(?:\s*TB\b)/, /^(?:\s*BT\b)/, /^(?:\s*TD\b)/, /^(?:\s*BR\b)/, /^(?:\s*<)/, /^(?:\s*>)/, /^(?:\s*\^)/, /^(?:\s*v\b)/, /^(?:.*direction\s+TB[^\n]*)/, /^(?:.*direction\s+BT[^\n]*)/, /^(?:.*direction\s+RL[^\n]*)/, /^(?:.*direction\s+LR[^\n]*)/, /^(?:[^\s\"]+@(?=[^\{\"]))/, /^(?:[0-9]+)/, /^(?:#)/, /^(?::::)/, /^(?::)/, /^(?:&)/, /^(?:;)/, /^(?:,)/, /^(?:\*)/, /^(?:\s*[xo<]?--+[-xo>]\s*)/, /^(?:\s*[xo<]?--\s*)/, /^(?:[^-]|-(?!-)+)/, /^(?:\s*[xo<]?==+[=xo>]\s*)/, /^(?:\s*[xo<]?==\s*)/, /^(?:[^=]|=(?!))/, /^(?:\s*[xo<]?-?\.+-[xo>]?\s*)/, /^(?:\s*[xo<]?-\.\s*)/, /^(?:[^\.]|\.(?!))/, /^(?:\s*~~[\~]+\s*)/, /^(?:[-/\)][\)])/, /^(?:[^\(\)\[\]\{\}]|!\)+)/, /^(?:\(-)/, /^(?:\]\))/, /^(?:\(\[)/, /^(?:\]\])/, /^(?:\[\[)/, /^(?:\[\|)/, /^(?:>)/, /^(?:\)\])/, /^(?:\[\()/, /^(?:\)\)\))/, /^(?:\(\(\()/, /^(?:[\\(?=\])][\]])/, /^(?:\/(?=\])\])/, /^(?:\/(?!\])|\\(?!\])|[^\\\[\]\(\)\{\}\/]+)/, /^(?:\[\/)/, /^(?:\[\\)/, /^(?:<)/, /^(?:>)/, /^(?:\^)/, /^(?:\\\|)/, /^(?:v\b)/, /^(?:\*)/, /^(?:#)/, /^(?:&)/, /^(?:([A-Za-z0-9!"\#$%&'*+\.`?\\_\/]|-(?=[^\>\-\.])|(?!))+)/, /^(?:-)/, /^(?:[\u00AA\u00B5\u00BA\u00C0-\u00D6\u00D8-\u00F6]|[\u00F8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376\u0377]|[\u037A-\u037D\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5]|[\u03F7-\u0481\u048A-\u0527\u0531-\u0556\u0559\u0561-\u0587\u05D0-\u05EA]|[\u05F0-\u05F2\u0620-\u064A\u066E\u066F\u0671-\u06D3\u06D5\u06E5\u06E6\u06EE]|[\u06EF\u06FA-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07CA-\u07EA]|[\u07F4\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u08A0]|[\u08A2-\u08AC\u0904-\u0939\u093D\u0950\u0958-\u0961\u0971-\u0977]|[\u0979-\u097F\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2]|[\u09B6-\u09B9\u09BD\u09CE\u09DC\u09DD\u09DF-\u09E1\u09F0\u09F1\u0A05-\u0A0A]|[\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39]|[\u0A59-\u0A5C\u0A5E\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8]|[\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0\u0AE1\u0B05-\u0B0C]|[\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3D\u0B5C]|[\u0B5D\u0B5F-\u0B61\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99]|[\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0]|[\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C33\u0C35-\u0C39\u0C3D]|[\u0C58\u0C59\u0C60\u0C61\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3]|[\u0CB5-\u0CB9\u0CBD\u0CDE\u0CE0\u0CE1\u0CF1\u0CF2\u0D05-\u0D0C\u0D0E-\u0D10]|[\u0D12-\u0D3A\u0D3D\u0D4E\u0D60\u0D61\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1]|[\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32\u0E33\u0E40-\u0E46\u0E81]|[\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3]|[\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB0\u0EB2\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6]|[\u0EDC-\u0EDF\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A]|[\u103F\u1050-\u1055\u105A-\u105D\u1061\u1065\u1066\u106E-\u1070\u1075-\u1081]|[\u108E\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D]|[\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0]|[\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310]|[\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F4\u1401-\u166C]|[\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u1700-\u170C\u170E-\u1711]|[\u1720-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7]|[\u17DC\u1820-\u1877\u1880-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191C]|[\u1950-\u196D\u1970-\u1974\u1980-\u19AB\u19C1-\u19C7\u1A00-\u1A16]|[\u1A20-\u1A54\u1AA7\u1B05-\u1B33\u1B45-\u1B4B\u1B83-\u1BA0\u1BAE\u1BAF]|[\u1BBA-\u1BE5\u1C00-\u1C23\u1C4D-\u1C4F\u1C5A-\u1C7D\u1CE9-\u1CEC]|[\u1CEE-\u1CF1\u1CF5\u1CF6\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D]|[\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D]|[\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3]|[\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F]|[\u2090-\u209C\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128]|[\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2183\u2184]|[\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CEE\u2CF2\u2CF3]|[\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6]|[\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE]|[\u2DD0-\u2DD6\u2DD8-\u2DDE\u2E2F\u3005\u3006\u3031-\u3035\u303B\u303C]|[\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D]|[\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC]|[\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA61F\uA62A\uA62B]|[\uA640-\uA66E\uA67F-\uA697\uA6A0-\uA6E5\uA717-\uA71F\uA722-\uA788]|[\uA78B-\uA78E\uA790-\uA793\uA7A0-\uA7AA\uA7F8-\uA801\uA803-\uA805]|[\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8F2-\uA8F7\uA8FB]|[\uA90A-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF\uAA00-\uAA28]|[\uAA40-\uAA42\uAA44-\uAA4B\uAA60-\uAA76\uAA7A\uAA80-\uAAAF\uAAB1\uAAB5]|[\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4]|[\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E]|[\uABC0-\uABE2\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D]|[\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36]|[\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D]|[\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC]|[\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF]|[\uFFD2-\uFFD7\uFFDA-\uFFDC])/, /^(?:\|)/, /^(?:\|)/, /^(?:\))/, /^(?:\()/, /^(?:\])/, /^(?:\[)/, /^(?:(\}))/, /^(?:\{)/, /^(?:[^\[\]\(\)\{\}\|\"]+)/, /^(?:")/, /^(?:(\r?\n)+)/, /^(?:\s)/, /^(?:$)/], conditions: { shapeDataEndBracket: { rules: [21, 24, 77, 80, 82, 84, 88, 90, 94, 95, 108, 110, 112, 114], inclusive: false }, shapeDataStr: { rules: [9, 10, 21, 24, 77, 80, 82, 84, 88, 90, 94, 95, 108, 110, 112, 114], inclusive: false }, shapeData: { rules: [8, 11, 12, 21, 24, 77, 80, 82, 84, 88, 90, 94, 95, 108, 110, 112, 114], inclusive: false }, callbackargs: { rules: [17, 18, 21, 24, 77, 80, 82, 84, 88, 90, 94, 95, 108, 110, 112, 114], inclusive: false }, callbackname: { rules: [14, 15, 16, 21, 24, 77, 80, 82, 84, 88, 90, 94, 95, 108, 110, 112, 114], inclusive: false }, href: { rules: [21, 24, 77, 80, 82, 84, 88, 90, 94, 95, 108, 110, 112, 114], inclusive: false }, click: { rules: [21, 24, 33, 34, 77, 80, 82, 84, 88, 90, 94, 95, 108, 110, 112, 114], inclusive: false }, dottedEdgeText: { rules: [21, 24, 74, 76, 77, 80, 82, 84, 88, 90, 94, 95, 108, 110, 112, 114], inclusive: false }, thickEdgeText: { rules: [21, 24, 71, 73, 77, 80, 82, 84, 88, 90, 94, 95, 108, 110, 112, 114], inclusive: false }, edgeText: { rules: [21, 24, 68, 70, 77, 80, 82, 84, 88, 90, 94, 95, 108, 110, 112, 114], inclusive: false }, trapText: { rules: [21, 24, 77, 80, 82, 84, 88, 90, 91, 92, 93, 94, 95, 108, 110, 112, 114], inclusive: false }, ellipseText: { rules: [21, 24, 77, 78, 79, 80, 82, 84, 88, 90, 94, 95, 108, 110, 112, 114], inclusive: false }, text: { rules: [21, 24, 77, 80, 81, 82, 83, 84, 87, 88, 89, 90, 94, 95, 107, 108, 109, 110, 111, 112, 113, 114, 115], inclusive: false }, vertex: { rules: [21, 24, 77, 80, 82, 84, 88, 90, 94, 95, 108, 110, 112, 114], inclusive: false }, dir: { rules: [21, 24, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 77, 80, 82, 84, 88, 90, 94, 95, 108, 110, 112, 114], inclusive: false }, acc_descr_multiline: { rules: [5, 6, 21, 24, 77, 80, 82, 84, 88, 90, 94, 95, 108, 110, 112, 114], inclusive: false }, acc_descr: { rules: [3, 21, 24, 77, 80, 82, 84, 88, 90, 94, 95, 108, 110, 112, 114], inclusive: false }, acc_title: { rules: [1, 21, 24, 77, 80, 82, 84, 88, 90, 94, 95, 108, 110, 112, 114], inclusive: false }, md_string: { rules: [19, 20, 21, 24, 77, 80, 82, 84, 88, 90, 94, 95, 108, 110, 112, 114], inclusive: false }, string: { rules: [21, 22, 23, 24, 77, 80, 82, 84, 88, 90, 94, 95, 108, 110, 112, 114], inclusive: false }, INITIAL: { rules: [0, 2, 4, 7, 13, 21, 24, 25, 26, 27, 28, 29, 30, 31, 32, 35, 36, 37, 38, 39, 40, 41, 42, 43, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 72, 74, 75, 77, 80, 82, 84, 85, 86, 88, 90, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 108, 110, 112, 114, 116, 117, 118, 119], inclusive: true } } };
    return Z;
  }();
  X1.lexer = Me;
  function j1() {
    this.yy = {};
  }
  return k(j1, "Parser"), j1.prototype = X1, X1.Parser = j1, new j1();
}();
ie.parser = ie;
var Oe = ie, Ue = Object.assign({}, Oe);
Ue.parse = (e) => {
  const i = e.replace(/}\s*\n/g, `}
`);
  return Oe.parse(i);
};
var At = Ue, bt = k((e, i) => {
  const r = lt, a = r(e, "r"), n = r(e, "g"), d = r(e, "b");
  return at(a, n, d, i);
}, "fade"), kt = k((e) => `.label {
    font-family: ${e.fontFamily};
    color: ${e.nodeTextColor || e.textColor};
  }
  .cluster-label text {
    fill: ${e.titleColor};
  }
  .cluster-label span {
    color: ${e.titleColor};
  }
  .cluster-label span p {
    background-color: transparent;
  }

  .label text,span {
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
  .rough-node .label text , .node .label text, .image-shape .label, .icon-shape .label {
    text-anchor: middle;
  }
  // .flowchart-label .text-outer-tspan {
  //   text-anchor: middle;
  // }
  // .flowchart-label .text-inner-tspan {
  //   text-anchor: start;
  // }

  .node .katex path {
    fill: #000;
    stroke: #000;
    stroke-width: 1px;
  }

  .rough-node .label,.node .label, .image-shape .label, .icon-shape .label {
    text-align: center;
  }
  .node.clickable {
    cursor: pointer;
  }


  .root .anchor path {
    fill: ${e.lineColor} !important;
    stroke-width: 0;
    stroke: ${e.lineColor};
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
    p {
      background-color: ${e.edgeLabelBackground};
    }
    rect {
      opacity: 0.5;
      background-color: ${e.edgeLabelBackground};
      fill: ${e.edgeLabelBackground};
    }
    text-align: center;
  }

  /* For html labels only */
  .labelBkg {
    background-color: ${bt(e.edgeLabelBackground, 0.5)};
    // background-color:
  }

  .cluster rect {
    fill: ${e.clusterBkg};
    stroke: ${e.clusterBorder};
    stroke-width: 1px;
  }

  .cluster text {
    fill: ${e.titleColor};
  }

  .cluster span {
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

  rect.text {
    fill: none;
    stroke-width: 0;
  }

  .icon-shape, .image-shape {
    background-color: ${e.edgeLabelBackground};
    p {
      background-color: ${e.edgeLabelBackground};
      padding: 2px;
    }
    rect {
      opacity: 0.5;
      background-color: ${e.edgeLabelBackground};
      fill: ${e.edgeLabelBackground};
    }
    text-align: center;
  }
`, "getStyles"), yt = kt, Tt = { parser: At, get db() {
  return new ht();
}, renderer: gt, styles: yt, init: k((e) => {
  e.flowchart || (e.flowchart = {}), e.layout && Ge({ layout: e.layout }), e.flowchart.arrowMarkerAbsolute = e.arrowMarkerAbsolute, Ge({ flowchart: { arrowMarkerAbsolute: e.arrowMarkerAbsolute } });
}, "init") };
export {
  Tt as diagram
};
