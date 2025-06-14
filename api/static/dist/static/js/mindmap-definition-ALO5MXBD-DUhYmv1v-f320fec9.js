import { _ as x, l as Q, ag as _t, M as Nt, c as st, G as At, T as Tt, E as J, h as tt, U as Lt, V as Ot, W as Dt } from "./mermaid-j5R1o_wi-7b9be563.js";
import { J as pt } from "./cytoscape.esm-Swd9B-1A-1060bb3e.js";
import { E as wt } from "./index-7b696e01.js";
import { L as It } from "./helper-7WMIPux3-736d9956.js";
import "./copy-BS31ARP0-68b0a49d.js";
var it = { exports: {} }, rt = { exports: {} }, nt = { exports: {} }, Ct = nt.exports, gt;
function Rt() {
  return gt || (gt = 1, function(D, R) {
    (function(p, T) {
      D.exports = T();
    })(Ct, function() {
      return function(p) {
        var T = {};
        function y(i) {
          if (T[i])
            return T[i].exports;
          var t = T[i] = { i, l: false, exports: {} };
          return p[i].call(t.exports, t, t.exports, y), t.l = true, t.exports;
        }
        return y.m = p, y.c = T, y.i = function(i) {
          return i;
        }, y.d = function(i, t, e) {
          y.o(i, t) || Object.defineProperty(i, t, { configurable: false, enumerable: true, get: e });
        }, y.n = function(i) {
          var t = i && i.__esModule ? function() {
            return i.default;
          } : function() {
            return i;
          };
          return y.d(t, "a", t), t;
        }, y.o = function(i, t) {
          return Object.prototype.hasOwnProperty.call(i, t);
        }, y.p = "", y(y.s = 26);
      }([function(p, T, y) {
        function i() {
        }
        i.QUALITY = 1, i.DEFAULT_CREATE_BENDS_AS_NEEDED = false, i.DEFAULT_INCREMENTAL = false, i.DEFAULT_ANIMATION_ON_LAYOUT = true, i.DEFAULT_ANIMATION_DURING_LAYOUT = false, i.DEFAULT_ANIMATION_PERIOD = 50, i.DEFAULT_UNIFORM_LEAF_NODE_SIZES = false, i.DEFAULT_GRAPH_MARGIN = 15, i.NODE_DIMENSIONS_INCLUDE_LABELS = false, i.SIMPLE_NODE_SIZE = 40, i.SIMPLE_NODE_HALF_SIZE = i.SIMPLE_NODE_SIZE / 2, i.EMPTY_COMPOUND_NODE_SIZE = 40, i.MIN_EDGE_LENGTH = 1, i.WORLD_BOUNDARY = 1e6, i.INITIAL_WORLD_BOUNDARY = i.WORLD_BOUNDARY / 1e3, i.WORLD_CENTER_X = 1200, i.WORLD_CENTER_Y = 900, p.exports = i;
      }, function(p, T, y) {
        var i = y(2), t = y(8), e = y(9);
        function r(h, s, f) {
          i.call(this, f), this.isOverlapingSourceAndTarget = false, this.vGraphObject = f, this.bendpoints = [], this.source = h, this.target = s;
        }
        r.prototype = Object.create(i.prototype);
        for (var a in i)
          r[a] = i[a];
        r.prototype.getSource = function() {
          return this.source;
        }, r.prototype.getTarget = function() {
          return this.target;
        }, r.prototype.isInterGraph = function() {
          return this.isInterGraph;
        }, r.prototype.getLength = function() {
          return this.length;
        }, r.prototype.isOverlapingSourceAndTarget = function() {
          return this.isOverlapingSourceAndTarget;
        }, r.prototype.getBendpoints = function() {
          return this.bendpoints;
        }, r.prototype.getLca = function() {
          return this.lca;
        }, r.prototype.getSourceInLca = function() {
          return this.sourceInLca;
        }, r.prototype.getTargetInLca = function() {
          return this.targetInLca;
        }, r.prototype.getOtherEnd = function(h) {
          if (this.source === h)
            return this.target;
          if (this.target === h)
            return this.source;
          throw "Node is not incident with this edge";
        }, r.prototype.getOtherEndInGraph = function(h, s) {
          for (var f = this.getOtherEnd(h), o = s.getGraphManager().getRoot(); ; ) {
            if (f.getOwner() == s)
              return f;
            if (f.getOwner() == o)
              break;
            f = f.getOwner().getParent();
          }
          return null;
        }, r.prototype.updateLength = function() {
          var h = new Array(4);
          this.isOverlapingSourceAndTarget = t.getIntersection(this.target.getRect(), this.source.getRect(), h), this.isOverlapingSourceAndTarget || (this.lengthX = h[0] - h[2], this.lengthY = h[1] - h[3], Math.abs(this.lengthX) < 1 && (this.lengthX = e.sign(this.lengthX)), Math.abs(this.lengthY) < 1 && (this.lengthY = e.sign(this.lengthY)), this.length = Math.sqrt(this.lengthX * this.lengthX + this.lengthY * this.lengthY));
        }, r.prototype.updateLengthSimple = function() {
          this.lengthX = this.target.getCenterX() - this.source.getCenterX(), this.lengthY = this.target.getCenterY() - this.source.getCenterY(), Math.abs(this.lengthX) < 1 && (this.lengthX = e.sign(this.lengthX)), Math.abs(this.lengthY) < 1 && (this.lengthY = e.sign(this.lengthY)), this.length = Math.sqrt(this.lengthX * this.lengthX + this.lengthY * this.lengthY);
        }, p.exports = r;
      }, function(p, T, y) {
        function i(t) {
          this.vGraphObject = t;
        }
        p.exports = i;
      }, function(p, T, y) {
        var i = y(2), t = y(10), e = y(13), r = y(0), a = y(16), h = y(4);
        function s(o, d, c, E) {
          c == null && E == null && (E = d), i.call(this, E), o.graphManager != null && (o = o.graphManager), this.estimatedSize = t.MIN_VALUE, this.inclusionTreeDepth = t.MAX_VALUE, this.vGraphObject = E, this.edges = [], this.graphManager = o, c != null && d != null ? this.rect = new e(d.x, d.y, c.width, c.height) : this.rect = new e();
        }
        s.prototype = Object.create(i.prototype);
        for (var f in i)
          s[f] = i[f];
        s.prototype.getEdges = function() {
          return this.edges;
        }, s.prototype.getChild = function() {
          return this.child;
        }, s.prototype.getOwner = function() {
          return this.owner;
        }, s.prototype.getWidth = function() {
          return this.rect.width;
        }, s.prototype.setWidth = function(o) {
          this.rect.width = o;
        }, s.prototype.getHeight = function() {
          return this.rect.height;
        }, s.prototype.setHeight = function(o) {
          this.rect.height = o;
        }, s.prototype.getCenterX = function() {
          return this.rect.x + this.rect.width / 2;
        }, s.prototype.getCenterY = function() {
          return this.rect.y + this.rect.height / 2;
        }, s.prototype.getCenter = function() {
          return new h(this.rect.x + this.rect.width / 2, this.rect.y + this.rect.height / 2);
        }, s.prototype.getLocation = function() {
          return new h(this.rect.x, this.rect.y);
        }, s.prototype.getRect = function() {
          return this.rect;
        }, s.prototype.getDiagonal = function() {
          return Math.sqrt(this.rect.width * this.rect.width + this.rect.height * this.rect.height);
        }, s.prototype.getHalfTheDiagonal = function() {
          return Math.sqrt(this.rect.height * this.rect.height + this.rect.width * this.rect.width) / 2;
        }, s.prototype.setRect = function(o, d) {
          this.rect.x = o.x, this.rect.y = o.y, this.rect.width = d.width, this.rect.height = d.height;
        }, s.prototype.setCenter = function(o, d) {
          this.rect.x = o - this.rect.width / 2, this.rect.y = d - this.rect.height / 2;
        }, s.prototype.setLocation = function(o, d) {
          this.rect.x = o, this.rect.y = d;
        }, s.prototype.moveBy = function(o, d) {
          this.rect.x += o, this.rect.y += d;
        }, s.prototype.getEdgeListToNode = function(o) {
          var d = [], c = this;
          return c.edges.forEach(function(E) {
            if (E.target == o) {
              if (E.source != c)
                throw "Incorrect edge source!";
              d.push(E);
            }
          }), d;
        }, s.prototype.getEdgesBetween = function(o) {
          var d = [], c = this;
          return c.edges.forEach(function(E) {
            if (!(E.source == c || E.target == c))
              throw "Incorrect edge source and/or target";
            (E.target == o || E.source == o) && d.push(E);
          }), d;
        }, s.prototype.getNeighborsList = function() {
          var o = /* @__PURE__ */ new Set(), d = this;
          return d.edges.forEach(function(c) {
            if (c.source == d)
              o.add(c.target);
            else {
              if (c.target != d)
                throw "Incorrect incidency!";
              o.add(c.source);
            }
          }), o;
        }, s.prototype.withChildren = function() {
          var o = /* @__PURE__ */ new Set(), d, c;
          if (o.add(this), this.child != null)
            for (var E = this.child.getNodes(), _ = 0; _ < E.length; _++)
              d = E[_], c = d.withChildren(), c.forEach(function(m) {
                o.add(m);
              });
          return o;
        }, s.prototype.getNoOfChildren = function() {
          var o = 0, d;
          if (this.child == null)
            o = 1;
          else
            for (var c = this.child.getNodes(), E = 0; E < c.length; E++)
              d = c[E], o += d.getNoOfChildren();
          return o == 0 && (o = 1), o;
        }, s.prototype.getEstimatedSize = function() {
          if (this.estimatedSize == t.MIN_VALUE)
            throw "assert failed";
          return this.estimatedSize;
        }, s.prototype.calcEstimatedSize = function() {
          return this.child == null ? this.estimatedSize = (this.rect.width + this.rect.height) / 2 : (this.estimatedSize = this.child.calcEstimatedSize(), this.rect.width = this.estimatedSize, this.rect.height = this.estimatedSize, this.estimatedSize);
        }, s.prototype.scatter = function() {
          var o, d, c = -r.INITIAL_WORLD_BOUNDARY, E = r.INITIAL_WORLD_BOUNDARY;
          o = r.WORLD_CENTER_X + a.nextDouble() * (E - c) + c;
          var _ = -r.INITIAL_WORLD_BOUNDARY, m = r.INITIAL_WORLD_BOUNDARY;
          d = r.WORLD_CENTER_Y + a.nextDouble() * (m - _) + _, this.rect.x = o, this.rect.y = d;
        }, s.prototype.updateBounds = function() {
          if (this.getChild() == null)
            throw "assert failed";
          if (this.getChild().getNodes().length != 0) {
            var o = this.getChild();
            if (o.updateBounds(true), this.rect.x = o.getLeft(), this.rect.y = o.getTop(), this.setWidth(o.getRight() - o.getLeft()), this.setHeight(o.getBottom() - o.getTop()), r.NODE_DIMENSIONS_INCLUDE_LABELS) {
              var d = o.getRight() - o.getLeft(), c = o.getBottom() - o.getTop();
              this.labelWidth > d && (this.rect.x -= (this.labelWidth - d) / 2, this.setWidth(this.labelWidth)), this.labelHeight > c && (this.labelPos == "center" ? this.rect.y -= (this.labelHeight - c) / 2 : this.labelPos == "top" && (this.rect.y -= this.labelHeight - c), this.setHeight(this.labelHeight));
            }
          }
        }, s.prototype.getInclusionTreeDepth = function() {
          if (this.inclusionTreeDepth == t.MAX_VALUE)
            throw "assert failed";
          return this.inclusionTreeDepth;
        }, s.prototype.transform = function(o) {
          var d = this.rect.x;
          d > r.WORLD_BOUNDARY ? d = r.WORLD_BOUNDARY : d < -r.WORLD_BOUNDARY && (d = -r.WORLD_BOUNDARY);
          var c = this.rect.y;
          c > r.WORLD_BOUNDARY ? c = r.WORLD_BOUNDARY : c < -r.WORLD_BOUNDARY && (c = -r.WORLD_BOUNDARY);
          var E = new h(d, c), _ = o.inverseTransformPoint(E);
          this.setLocation(_.x, _.y);
        }, s.prototype.getLeft = function() {
          return this.rect.x;
        }, s.prototype.getRight = function() {
          return this.rect.x + this.rect.width;
        }, s.prototype.getTop = function() {
          return this.rect.y;
        }, s.prototype.getBottom = function() {
          return this.rect.y + this.rect.height;
        }, s.prototype.getParent = function() {
          return this.owner == null ? null : this.owner.getParent();
        }, p.exports = s;
      }, function(p, T, y) {
        function i(t, e) {
          t == null && e == null ? (this.x = 0, this.y = 0) : (this.x = t, this.y = e);
        }
        i.prototype.getX = function() {
          return this.x;
        }, i.prototype.getY = function() {
          return this.y;
        }, i.prototype.setX = function(t) {
          this.x = t;
        }, i.prototype.setY = function(t) {
          this.y = t;
        }, i.prototype.getDifference = function(t) {
          return new DimensionD(this.x - t.x, this.y - t.y);
        }, i.prototype.getCopy = function() {
          return new i(this.x, this.y);
        }, i.prototype.translate = function(t) {
          return this.x += t.width, this.y += t.height, this;
        }, p.exports = i;
      }, function(p, T, y) {
        var i = y(2), t = y(10), e = y(0), r = y(6), a = y(3), h = y(1), s = y(13), f = y(12), o = y(11);
        function d(E, _, m) {
          i.call(this, m), this.estimatedSize = t.MIN_VALUE, this.margin = e.DEFAULT_GRAPH_MARGIN, this.edges = [], this.nodes = [], this.isConnected = false, this.parent = E, _ != null && _ instanceof r ? this.graphManager = _ : _ != null && _ instanceof Layout && (this.graphManager = _.graphManager);
        }
        d.prototype = Object.create(i.prototype);
        for (var c in i)
          d[c] = i[c];
        d.prototype.getNodes = function() {
          return this.nodes;
        }, d.prototype.getEdges = function() {
          return this.edges;
        }, d.prototype.getGraphManager = function() {
          return this.graphManager;
        }, d.prototype.getParent = function() {
          return this.parent;
        }, d.prototype.getLeft = function() {
          return this.left;
        }, d.prototype.getRight = function() {
          return this.right;
        }, d.prototype.getTop = function() {
          return this.top;
        }, d.prototype.getBottom = function() {
          return this.bottom;
        }, d.prototype.isConnected = function() {
          return this.isConnected;
        }, d.prototype.add = function(E, _, m) {
          if (_ == null && m == null) {
            var N = E;
            if (this.graphManager == null)
              throw "Graph has no graph mgr!";
            if (this.getNodes().indexOf(N) > -1)
              throw "Node already in graph!";
            return N.owner = this, this.getNodes().push(N), N;
          } else {
            var L = E;
            if (!(this.getNodes().indexOf(_) > -1 && this.getNodes().indexOf(m) > -1))
              throw "Source or target not in graph!";
            if (!(_.owner == m.owner && _.owner == this))
              throw "Both owners must be this graph!";
            return _.owner != m.owner ? null : (L.source = _, L.target = m, L.isInterGraph = false, this.getEdges().push(L), _.edges.push(L), m != _ && m.edges.push(L), L);
          }
        }, d.prototype.remove = function(E) {
          var _ = E;
          if (E instanceof a) {
            if (_ == null)
              throw "Node is null!";
            if (!(_.owner != null && _.owner == this))
              throw "Owner graph is invalid!";
            if (this.graphManager == null)
              throw "Owner graph manager is invalid!";
            for (var m = _.edges.slice(), N, L = m.length, g = 0; g < L; g++)
              N = m[g], N.isInterGraph ? this.graphManager.remove(N) : N.source.owner.remove(N);
            var O = this.nodes.indexOf(_);
            if (O == -1)
              throw "Node not in owner node list!";
            this.nodes.splice(O, 1);
          } else if (E instanceof h) {
            var N = E;
            if (N == null)
              throw "Edge is null!";
            if (!(N.source != null && N.target != null))
              throw "Source and/or target is null!";
            if (!(N.source.owner != null && N.target.owner != null && N.source.owner == this && N.target.owner == this))
              throw "Source and/or target owner is invalid!";
            var n = N.source.edges.indexOf(N), u = N.target.edges.indexOf(N);
            if (!(n > -1 && u > -1))
              throw "Source and/or target doesn't know this edge!";
            N.source.edges.splice(n, 1), N.target != N.source && N.target.edges.splice(u, 1);
            var O = N.source.owner.getEdges().indexOf(N);
            if (O == -1)
              throw "Not in owner's edge list!";
            N.source.owner.getEdges().splice(O, 1);
          }
        }, d.prototype.updateLeftTop = function() {
          for (var E = t.MAX_VALUE, _ = t.MAX_VALUE, m, N, L, g = this.getNodes(), O = g.length, n = 0; n < O; n++) {
            var u = g[n];
            m = u.getTop(), N = u.getLeft(), E > m && (E = m), _ > N && (_ = N);
          }
          return E == t.MAX_VALUE ? null : (g[0].getParent().paddingLeft != null ? L = g[0].getParent().paddingLeft : L = this.margin, this.left = _ - L, this.top = E - L, new f(this.left, this.top));
        }, d.prototype.updateBounds = function(E) {
          for (var _ = t.MAX_VALUE, m = -t.MAX_VALUE, N = t.MAX_VALUE, L = -t.MAX_VALUE, g, O, n, u, l, v = this.nodes, A = v.length, w = 0; w < A; w++) {
            var I = v[w];
            E && I.child != null && I.updateBounds(), g = I.getLeft(), O = I.getRight(), n = I.getTop(), u = I.getBottom(), _ > g && (_ = g), m < O && (m = O), N > n && (N = n), L < u && (L = u);
          }
          var C = new s(_, N, m - _, L - N);
          _ == t.MAX_VALUE && (this.left = this.parent.getLeft(), this.right = this.parent.getRight(), this.top = this.parent.getTop(), this.bottom = this.parent.getBottom()), v[0].getParent().paddingLeft != null ? l = v[0].getParent().paddingLeft : l = this.margin, this.left = C.x - l, this.right = C.x + C.width + l, this.top = C.y - l, this.bottom = C.y + C.height + l;
        }, d.calculateBounds = function(E) {
          for (var _ = t.MAX_VALUE, m = -t.MAX_VALUE, N = t.MAX_VALUE, L = -t.MAX_VALUE, g, O, n, u, l = E.length, v = 0; v < l; v++) {
            var A = E[v];
            g = A.getLeft(), O = A.getRight(), n = A.getTop(), u = A.getBottom(), _ > g && (_ = g), m < O && (m = O), N > n && (N = n), L < u && (L = u);
          }
          var w = new s(_, N, m - _, L - N);
          return w;
        }, d.prototype.getInclusionTreeDepth = function() {
          return this == this.graphManager.getRoot() ? 1 : this.parent.getInclusionTreeDepth();
        }, d.prototype.getEstimatedSize = function() {
          if (this.estimatedSize == t.MIN_VALUE)
            throw "assert failed";
          return this.estimatedSize;
        }, d.prototype.calcEstimatedSize = function() {
          for (var E = 0, _ = this.nodes, m = _.length, N = 0; N < m; N++) {
            var L = _[N];
            E += L.calcEstimatedSize();
          }
          return E == 0 ? this.estimatedSize = e.EMPTY_COMPOUND_NODE_SIZE : this.estimatedSize = E / Math.sqrt(this.nodes.length), this.estimatedSize;
        }, d.prototype.updateConnected = function() {
          var E = this;
          if (this.nodes.length == 0) {
            this.isConnected = true;
            return;
          }
          var _ = new o(), m = /* @__PURE__ */ new Set(), N = this.nodes[0], L, g, O = N.withChildren();
          for (O.forEach(function(w) {
            _.push(w), m.add(w);
          }); _.length !== 0; ) {
            N = _.shift(), L = N.getEdges();
            for (var n = L.length, u = 0; u < n; u++) {
              var l = L[u];
              if (g = l.getOtherEndInGraph(N, this), g != null && !m.has(g)) {
                var v = g.withChildren();
                v.forEach(function(w) {
                  _.push(w), m.add(w);
                });
              }
            }
          }
          if (this.isConnected = false, m.size >= this.nodes.length) {
            var A = 0;
            m.forEach(function(w) {
              w.owner == E && A++;
            }), A == this.nodes.length && (this.isConnected = true);
          }
        }, p.exports = d;
      }, function(p, T, y) {
        var i, t = y(1);
        function e(r) {
          i = y(5), this.layout = r, this.graphs = [], this.edges = [];
        }
        e.prototype.addRoot = function() {
          var r = this.layout.newGraph(), a = this.layout.newNode(null), h = this.add(r, a);
          return this.setRootGraph(h), this.rootGraph;
        }, e.prototype.add = function(r, a, h, s, f) {
          if (h == null && s == null && f == null) {
            if (r == null)
              throw "Graph is null!";
            if (a == null)
              throw "Parent node is null!";
            if (this.graphs.indexOf(r) > -1)
              throw "Graph already in this graph mgr!";
            if (this.graphs.push(r), r.parent != null)
              throw "Already has a parent!";
            if (a.child != null)
              throw "Already has a child!";
            return r.parent = a, a.child = r, r;
          } else {
            f = h, s = a, h = r;
            var o = s.getOwner(), d = f.getOwner();
            if (!(o != null && o.getGraphManager() == this))
              throw "Source not in this graph mgr!";
            if (!(d != null && d.getGraphManager() == this))
              throw "Target not in this graph mgr!";
            if (o == d)
              return h.isInterGraph = false, o.add(h, s, f);
            if (h.isInterGraph = true, h.source = s, h.target = f, this.edges.indexOf(h) > -1)
              throw "Edge already in inter-graph edge list!";
            if (this.edges.push(h), !(h.source != null && h.target != null))
              throw "Edge source and/or target is null!";
            if (!(h.source.edges.indexOf(h) == -1 && h.target.edges.indexOf(h) == -1))
              throw "Edge already in source and/or target incidency list!";
            return h.source.edges.push(h), h.target.edges.push(h), h;
          }
        }, e.prototype.remove = function(r) {
          if (r instanceof i) {
            var a = r;
            if (a.getGraphManager() != this)
              throw "Graph not in this graph mgr";
            if (!(a == this.rootGraph || a.parent != null && a.parent.graphManager == this))
              throw "Invalid parent node!";
            var h = [];
            h = h.concat(a.getEdges());
            for (var s, f = h.length, o = 0; o < f; o++)
              s = h[o], a.remove(s);
            var d = [];
            d = d.concat(a.getNodes());
            var c;
            f = d.length;
            for (var o = 0; o < f; o++)
              c = d[o], a.remove(c);
            a == this.rootGraph && this.setRootGraph(null);
            var E = this.graphs.indexOf(a);
            this.graphs.splice(E, 1), a.parent = null;
          } else if (r instanceof t) {
            if (s = r, s == null)
              throw "Edge is null!";
            if (!s.isInterGraph)
              throw "Not an inter-graph edge!";
            if (!(s.source != null && s.target != null))
              throw "Source and/or target is null!";
            if (!(s.source.edges.indexOf(s) != -1 && s.target.edges.indexOf(s) != -1))
              throw "Source and/or target doesn't know this edge!";
            var E = s.source.edges.indexOf(s);
            if (s.source.edges.splice(E, 1), E = s.target.edges.indexOf(s), s.target.edges.splice(E, 1), !(s.source.owner != null && s.source.owner.getGraphManager() != null))
              throw "Edge owner graph or owner graph manager is null!";
            if (s.source.owner.getGraphManager().edges.indexOf(s) == -1)
              throw "Not in owner graph manager's edge list!";
            var E = s.source.owner.getGraphManager().edges.indexOf(s);
            s.source.owner.getGraphManager().edges.splice(E, 1);
          }
        }, e.prototype.updateBounds = function() {
          this.rootGraph.updateBounds(true);
        }, e.prototype.getGraphs = function() {
          return this.graphs;
        }, e.prototype.getAllNodes = function() {
          if (this.allNodes == null) {
            for (var r = [], a = this.getGraphs(), h = a.length, s = 0; s < h; s++)
              r = r.concat(a[s].getNodes());
            this.allNodes = r;
          }
          return this.allNodes;
        }, e.prototype.resetAllNodes = function() {
          this.allNodes = null;
        }, e.prototype.resetAllEdges = function() {
          this.allEdges = null;
        }, e.prototype.resetAllNodesToApplyGravitation = function() {
          this.allNodesToApplyGravitation = null;
        }, e.prototype.getAllEdges = function() {
          if (this.allEdges == null) {
            var r = [], a = this.getGraphs();
            a.length;
            for (var h = 0; h < a.length; h++)
              r = r.concat(a[h].getEdges());
            r = r.concat(this.edges), this.allEdges = r;
          }
          return this.allEdges;
        }, e.prototype.getAllNodesToApplyGravitation = function() {
          return this.allNodesToApplyGravitation;
        }, e.prototype.setAllNodesToApplyGravitation = function(r) {
          if (this.allNodesToApplyGravitation != null)
            throw "assert failed";
          this.allNodesToApplyGravitation = r;
        }, e.prototype.getRoot = function() {
          return this.rootGraph;
        }, e.prototype.setRootGraph = function(r) {
          if (r.getGraphManager() != this)
            throw "Root not in this graph mgr!";
          this.rootGraph = r, r.parent == null && (r.parent = this.layout.newNode("Root node"));
        }, e.prototype.getLayout = function() {
          return this.layout;
        }, e.prototype.isOneAncestorOfOther = function(r, a) {
          if (!(r != null && a != null))
            throw "assert failed";
          if (r == a)
            return true;
          var h = r.getOwner(), s;
          do {
            if (s = h.getParent(), s == null)
              break;
            if (s == a)
              return true;
            if (h = s.getOwner(), h == null)
              break;
          } while (true);
          h = a.getOwner();
          do {
            if (s = h.getParent(), s == null)
              break;
            if (s == r)
              return true;
            if (h = s.getOwner(), h == null)
              break;
          } while (true);
          return false;
        }, e.prototype.calcLowestCommonAncestors = function() {
          for (var r, a, h, s, f, o = this.getAllEdges(), d = o.length, c = 0; c < d; c++) {
            if (r = o[c], a = r.source, h = r.target, r.lca = null, r.sourceInLca = a, r.targetInLca = h, a == h) {
              r.lca = a.getOwner();
              continue;
            }
            for (s = a.getOwner(); r.lca == null; ) {
              for (r.targetInLca = h, f = h.getOwner(); r.lca == null; ) {
                if (f == s) {
                  r.lca = f;
                  break;
                }
                if (f == this.rootGraph)
                  break;
                if (r.lca != null)
                  throw "assert failed";
                r.targetInLca = f.getParent(), f = r.targetInLca.getOwner();
              }
              if (s == this.rootGraph)
                break;
              r.lca == null && (r.sourceInLca = s.getParent(), s = r.sourceInLca.getOwner());
            }
            if (r.lca == null)
              throw "assert failed";
          }
        }, e.prototype.calcLowestCommonAncestor = function(r, a) {
          if (r == a)
            return r.getOwner();
          var h = r.getOwner();
          do {
            if (h == null)
              break;
            var s = a.getOwner();
            do {
              if (s == null)
                break;
              if (s == h)
                return s;
              s = s.getParent().getOwner();
            } while (true);
            h = h.getParent().getOwner();
          } while (true);
          return h;
        }, e.prototype.calcInclusionTreeDepths = function(r, a) {
          r == null && a == null && (r = this.rootGraph, a = 1);
          for (var h, s = r.getNodes(), f = s.length, o = 0; o < f; o++)
            h = s[o], h.inclusionTreeDepth = a, h.child != null && this.calcInclusionTreeDepths(h.child, a + 1);
        }, e.prototype.includesInvalidEdge = function() {
          for (var r, a = this.edges.length, h = 0; h < a; h++)
            if (r = this.edges[h], this.isOneAncestorOfOther(r.source, r.target))
              return true;
          return false;
        }, p.exports = e;
      }, function(p, T, y) {
        var i = y(0);
        function t() {
        }
        for (var e in i)
          t[e] = i[e];
        t.MAX_ITERATIONS = 2500, t.DEFAULT_EDGE_LENGTH = 50, t.DEFAULT_SPRING_STRENGTH = 0.45, t.DEFAULT_REPULSION_STRENGTH = 4500, t.DEFAULT_GRAVITY_STRENGTH = 0.4, t.DEFAULT_COMPOUND_GRAVITY_STRENGTH = 1, t.DEFAULT_GRAVITY_RANGE_FACTOR = 3.8, t.DEFAULT_COMPOUND_GRAVITY_RANGE_FACTOR = 1.5, t.DEFAULT_USE_SMART_IDEAL_EDGE_LENGTH_CALCULATION = true, t.DEFAULT_USE_SMART_REPULSION_RANGE_CALCULATION = true, t.DEFAULT_COOLING_FACTOR_INCREMENTAL = 0.3, t.COOLING_ADAPTATION_FACTOR = 0.33, t.ADAPTATION_LOWER_NODE_LIMIT = 1e3, t.ADAPTATION_UPPER_NODE_LIMIT = 5e3, t.MAX_NODE_DISPLACEMENT_INCREMENTAL = 100, t.MAX_NODE_DISPLACEMENT = t.MAX_NODE_DISPLACEMENT_INCREMENTAL * 3, t.MIN_REPULSION_DIST = t.DEFAULT_EDGE_LENGTH / 10, t.CONVERGENCE_CHECK_PERIOD = 100, t.PER_LEVEL_IDEAL_EDGE_LENGTH_FACTOR = 0.1, t.MIN_EDGE_LENGTH = 1, t.GRID_CALCULATION_CHECK_PERIOD = 10, p.exports = t;
      }, function(p, T, y) {
        var i = y(12);
        function t() {
        }
        t.calcSeparationAmount = function(e, r, a, h) {
          if (!e.intersects(r))
            throw "assert failed";
          var s = new Array(2);
          this.decideDirectionsForOverlappingNodes(e, r, s), a[0] = Math.min(e.getRight(), r.getRight()) - Math.max(e.x, r.x), a[1] = Math.min(e.getBottom(), r.getBottom()) - Math.max(e.y, r.y), e.getX() <= r.getX() && e.getRight() >= r.getRight() ? a[0] += Math.min(r.getX() - e.getX(), e.getRight() - r.getRight()) : r.getX() <= e.getX() && r.getRight() >= e.getRight() && (a[0] += Math.min(e.getX() - r.getX(), r.getRight() - e.getRight())), e.getY() <= r.getY() && e.getBottom() >= r.getBottom() ? a[1] += Math.min(r.getY() - e.getY(), e.getBottom() - r.getBottom()) : r.getY() <= e.getY() && r.getBottom() >= e.getBottom() && (a[1] += Math.min(e.getY() - r.getY(), r.getBottom() - e.getBottom()));
          var f = Math.abs((r.getCenterY() - e.getCenterY()) / (r.getCenterX() - e.getCenterX()));
          r.getCenterY() === e.getCenterY() && r.getCenterX() === e.getCenterX() && (f = 1);
          var o = f * a[0], d = a[1] / f;
          a[0] < d ? d = a[0] : o = a[1], a[0] = -1 * s[0] * (d / 2 + h), a[1] = -1 * s[1] * (o / 2 + h);
        }, t.decideDirectionsForOverlappingNodes = function(e, r, a) {
          e.getCenterX() < r.getCenterX() ? a[0] = -1 : a[0] = 1, e.getCenterY() < r.getCenterY() ? a[1] = -1 : a[1] = 1;
        }, t.getIntersection2 = function(e, r, a) {
          var h = e.getCenterX(), s = e.getCenterY(), f = r.getCenterX(), o = r.getCenterY();
          if (e.intersects(r))
            return a[0] = h, a[1] = s, a[2] = f, a[3] = o, true;
          var d = e.getX(), c = e.getY(), E = e.getRight(), _ = e.getX(), m = e.getBottom(), N = e.getRight(), L = e.getWidthHalf(), g = e.getHeightHalf(), O = r.getX(), n = r.getY(), u = r.getRight(), l = r.getX(), v = r.getBottom(), A = r.getRight(), w = r.getWidthHalf(), I = r.getHeightHalf(), C = false, S = false;
          if (h === f) {
            if (s > o)
              return a[0] = h, a[1] = c, a[2] = f, a[3] = v, false;
            if (s < o)
              return a[0] = h, a[1] = m, a[2] = f, a[3] = n, false;
          } else if (s === o) {
            if (h > f)
              return a[0] = d, a[1] = s, a[2] = u, a[3] = o, false;
            if (h < f)
              return a[0] = E, a[1] = s, a[2] = O, a[3] = o, false;
          } else {
            var U = e.height / e.width, b = r.height / r.width, M = (o - s) / (f - h), G = void 0, F = void 0, k = void 0, Y = void 0, X = void 0, P = void 0;
            if (-U === M ? h > f ? (a[0] = _, a[1] = m, C = true) : (a[0] = E, a[1] = c, C = true) : U === M && (h > f ? (a[0] = d, a[1] = c, C = true) : (a[0] = N, a[1] = m, C = true)), -b === M ? f > h ? (a[2] = l, a[3] = v, S = true) : (a[2] = u, a[3] = n, S = true) : b === M && (f > h ? (a[2] = O, a[3] = n, S = true) : (a[2] = A, a[3] = v, S = true)), C && S)
              return false;
            if (h > f ? s > o ? (G = this.getCardinalDirection(U, M, 4), F = this.getCardinalDirection(b, M, 2)) : (G = this.getCardinalDirection(-U, M, 3), F = this.getCardinalDirection(-b, M, 1)) : s > o ? (G = this.getCardinalDirection(-U, M, 1), F = this.getCardinalDirection(-b, M, 3)) : (G = this.getCardinalDirection(U, M, 2), F = this.getCardinalDirection(b, M, 4)), !C)
              switch (G) {
                case 1:
                  Y = c, k = h + -g / M, a[0] = k, a[1] = Y;
                  break;
                case 2:
                  k = N, Y = s + L * M, a[0] = k, a[1] = Y;
                  break;
                case 3:
                  Y = m, k = h + g / M, a[0] = k, a[1] = Y;
                  break;
                case 4:
                  k = _, Y = s + -L * M, a[0] = k, a[1] = Y;
                  break;
              }
            if (!S)
              switch (F) {
                case 1:
                  P = n, X = f + -I / M, a[2] = X, a[3] = P;
                  break;
                case 2:
                  X = A, P = o + w * M, a[2] = X, a[3] = P;
                  break;
                case 3:
                  P = v, X = f + I / M, a[2] = X, a[3] = P;
                  break;
                case 4:
                  X = l, P = o + -w * M, a[2] = X, a[3] = P;
                  break;
              }
          }
          return false;
        }, t.getCardinalDirection = function(e, r, a) {
          return e > r ? a : 1 + a % 4;
        }, t.getIntersection = function(e, r, a, h) {
          if (h == null)
            return this.getIntersection2(e, r, a);
          var s = e.x, f = e.y, o = r.x, d = r.y, c = a.x, E = a.y, _ = h.x, m = h.y, N = void 0, L = void 0, g = void 0, O = void 0, n = void 0, u = void 0, l = void 0, v = void 0, A = void 0;
          return g = d - f, n = s - o, l = o * f - s * d, O = m - E, u = c - _, v = _ * E - c * m, A = g * u - O * n, A === 0 ? null : (N = (n * v - u * l) / A, L = (O * l - g * v) / A, new i(N, L));
        }, t.angleOfVector = function(e, r, a, h) {
          var s = void 0;
          return e !== a ? (s = Math.atan((h - r) / (a - e)), a < e ? s += Math.PI : h < r && (s += this.TWO_PI)) : h < r ? s = this.ONE_AND_HALF_PI : s = this.HALF_PI, s;
        }, t.doIntersect = function(e, r, a, h) {
          var s = e.x, f = e.y, o = r.x, d = r.y, c = a.x, E = a.y, _ = h.x, m = h.y, N = (o - s) * (m - E) - (_ - c) * (d - f);
          if (N === 0)
            return false;
          var L = ((m - E) * (_ - s) + (c - _) * (m - f)) / N, g = ((f - d) * (_ - s) + (o - s) * (m - f)) / N;
          return 0 < L && L < 1 && 0 < g && g < 1;
        }, t.HALF_PI = 0.5 * Math.PI, t.ONE_AND_HALF_PI = 1.5 * Math.PI, t.TWO_PI = 2 * Math.PI, t.THREE_PI = 3 * Math.PI, p.exports = t;
      }, function(p, T, y) {
        function i() {
        }
        i.sign = function(t) {
          return t > 0 ? 1 : t < 0 ? -1 : 0;
        }, i.floor = function(t) {
          return t < 0 ? Math.ceil(t) : Math.floor(t);
        }, i.ceil = function(t) {
          return t < 0 ? Math.floor(t) : Math.ceil(t);
        }, p.exports = i;
      }, function(p, T, y) {
        function i() {
        }
        i.MAX_VALUE = 2147483647, i.MIN_VALUE = -2147483648, p.exports = i;
      }, function(p, T, y) {
        var i = function() {
          function s(f, o) {
            for (var d = 0; d < o.length; d++) {
              var c = o[d];
              c.enumerable = c.enumerable || false, c.configurable = true, "value" in c && (c.writable = true), Object.defineProperty(f, c.key, c);
            }
          }
          return function(f, o, d) {
            return o && s(f.prototype, o), d && s(f, d), f;
          };
        }();
        function t(s, f) {
          if (!(s instanceof f))
            throw new TypeError("Cannot call a class as a function");
        }
        var e = function(s) {
          return { value: s, next: null, prev: null };
        }, r = function(s, f, o, d) {
          return s !== null ? s.next = f : d.head = f, o !== null ? o.prev = f : d.tail = f, f.prev = s, f.next = o, d.length++, f;
        }, a = function(s, f) {
          var o = s.prev, d = s.next;
          return o !== null ? o.next = d : f.head = d, d !== null ? d.prev = o : f.tail = o, s.prev = s.next = null, f.length--, s;
        }, h = function() {
          function s(f) {
            var o = this;
            t(this, s), this.length = 0, this.head = null, this.tail = null, f == null ? void 0 : f.forEach(function(d) {
              return o.push(d);
            });
          }
          return i(s, [{ key: "size", value: function() {
            return this.length;
          } }, { key: "insertBefore", value: function(f, o) {
            return r(o.prev, e(f), o, this);
          } }, { key: "insertAfter", value: function(f, o) {
            return r(o, e(f), o.next, this);
          } }, { key: "insertNodeBefore", value: function(f, o) {
            return r(o.prev, f, o, this);
          } }, { key: "insertNodeAfter", value: function(f, o) {
            return r(o, f, o.next, this);
          } }, { key: "push", value: function(f) {
            return r(this.tail, e(f), null, this);
          } }, { key: "unshift", value: function(f) {
            return r(null, e(f), this.head, this);
          } }, { key: "remove", value: function(f) {
            return a(f, this);
          } }, { key: "pop", value: function() {
            return a(this.tail, this).value;
          } }, { key: "popNode", value: function() {
            return a(this.tail, this);
          } }, { key: "shift", value: function() {
            return a(this.head, this).value;
          } }, { key: "shiftNode", value: function() {
            return a(this.head, this);
          } }, { key: "get_object_at", value: function(f) {
            if (f <= this.length()) {
              for (var o = 1, d = this.head; o < f; )
                d = d.next, o++;
              return d.value;
            }
          } }, { key: "set_object_at", value: function(f, o) {
            if (f <= this.length()) {
              for (var d = 1, c = this.head; d < f; )
                c = c.next, d++;
              c.value = o;
            }
          } }]), s;
        }();
        p.exports = h;
      }, function(p, T, y) {
        function i(t, e, r) {
          this.x = null, this.y = null, t == null && e == null && r == null ? (this.x = 0, this.y = 0) : typeof t == "number" && typeof e == "number" && r == null ? (this.x = t, this.y = e) : t.constructor.name == "Point" && e == null && r == null && (r = t, this.x = r.x, this.y = r.y);
        }
        i.prototype.getX = function() {
          return this.x;
        }, i.prototype.getY = function() {
          return this.y;
        }, i.prototype.getLocation = function() {
          return new i(this.x, this.y);
        }, i.prototype.setLocation = function(t, e, r) {
          t.constructor.name == "Point" && e == null && r == null ? (r = t, this.setLocation(r.x, r.y)) : typeof t == "number" && typeof e == "number" && r == null && (parseInt(t) == t && parseInt(e) == e ? this.move(t, e) : (this.x = Math.floor(t + 0.5), this.y = Math.floor(e + 0.5)));
        }, i.prototype.move = function(t, e) {
          this.x = t, this.y = e;
        }, i.prototype.translate = function(t, e) {
          this.x += t, this.y += e;
        }, i.prototype.equals = function(t) {
          if (t.constructor.name == "Point") {
            var e = t;
            return this.x == e.x && this.y == e.y;
          }
          return this == t;
        }, i.prototype.toString = function() {
          return new i().constructor.name + "[x=" + this.x + ",y=" + this.y + "]";
        }, p.exports = i;
      }, function(p, T, y) {
        function i(t, e, r, a) {
          this.x = 0, this.y = 0, this.width = 0, this.height = 0, t != null && e != null && r != null && a != null && (this.x = t, this.y = e, this.width = r, this.height = a);
        }
        i.prototype.getX = function() {
          return this.x;
        }, i.prototype.setX = function(t) {
          this.x = t;
        }, i.prototype.getY = function() {
          return this.y;
        }, i.prototype.setY = function(t) {
          this.y = t;
        }, i.prototype.getWidth = function() {
          return this.width;
        }, i.prototype.setWidth = function(t) {
          this.width = t;
        }, i.prototype.getHeight = function() {
          return this.height;
        }, i.prototype.setHeight = function(t) {
          this.height = t;
        }, i.prototype.getRight = function() {
          return this.x + this.width;
        }, i.prototype.getBottom = function() {
          return this.y + this.height;
        }, i.prototype.intersects = function(t) {
          return !(this.getRight() < t.x || this.getBottom() < t.y || t.getRight() < this.x || t.getBottom() < this.y);
        }, i.prototype.getCenterX = function() {
          return this.x + this.width / 2;
        }, i.prototype.getMinX = function() {
          return this.getX();
        }, i.prototype.getMaxX = function() {
          return this.getX() + this.width;
        }, i.prototype.getCenterY = function() {
          return this.y + this.height / 2;
        }, i.prototype.getMinY = function() {
          return this.getY();
        }, i.prototype.getMaxY = function() {
          return this.getY() + this.height;
        }, i.prototype.getWidthHalf = function() {
          return this.width / 2;
        }, i.prototype.getHeightHalf = function() {
          return this.height / 2;
        }, p.exports = i;
      }, function(p, T, y) {
        var i = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(e) {
          return typeof e;
        } : function(e) {
          return e && typeof Symbol == "function" && e.constructor === Symbol && e !== Symbol.prototype ? "symbol" : typeof e;
        };
        function t() {
        }
        t.lastID = 0, t.createID = function(e) {
          return t.isPrimitive(e) ? e : (e.uniqueID != null || (e.uniqueID = t.getString(), t.lastID++), e.uniqueID);
        }, t.getString = function(e) {
          return e == null && (e = t.lastID), "Object#" + e;
        }, t.isPrimitive = function(e) {
          var r = typeof e > "u" ? "undefined" : i(e);
          return e == null || r != "object" && r != "function";
        }, p.exports = t;
      }, function(p, T, y) {
        function i(c) {
          if (Array.isArray(c)) {
            for (var E = 0, _ = Array(c.length); E < c.length; E++)
              _[E] = c[E];
            return _;
          } else
            return Array.from(c);
        }
        var t = y(0), e = y(6), r = y(3), a = y(1), h = y(5), s = y(4), f = y(17), o = y(27);
        function d(c) {
          o.call(this), this.layoutQuality = t.QUALITY, this.createBendsAsNeeded = t.DEFAULT_CREATE_BENDS_AS_NEEDED, this.incremental = t.DEFAULT_INCREMENTAL, this.animationOnLayout = t.DEFAULT_ANIMATION_ON_LAYOUT, this.animationDuringLayout = t.DEFAULT_ANIMATION_DURING_LAYOUT, this.animationPeriod = t.DEFAULT_ANIMATION_PERIOD, this.uniformLeafNodeSizes = t.DEFAULT_UNIFORM_LEAF_NODE_SIZES, this.edgeToDummyNodes = /* @__PURE__ */ new Map(), this.graphManager = new e(this), this.isLayoutFinished = false, this.isSubLayout = false, this.isRemoteUse = false, c != null && (this.isRemoteUse = c);
        }
        d.RANDOM_SEED = 1, d.prototype = Object.create(o.prototype), d.prototype.getGraphManager = function() {
          return this.graphManager;
        }, d.prototype.getAllNodes = function() {
          return this.graphManager.getAllNodes();
        }, d.prototype.getAllEdges = function() {
          return this.graphManager.getAllEdges();
        }, d.prototype.getAllNodesToApplyGravitation = function() {
          return this.graphManager.getAllNodesToApplyGravitation();
        }, d.prototype.newGraphManager = function() {
          var c = new e(this);
          return this.graphManager = c, c;
        }, d.prototype.newGraph = function(c) {
          return new h(null, this.graphManager, c);
        }, d.prototype.newNode = function(c) {
          return new r(this.graphManager, c);
        }, d.prototype.newEdge = function(c) {
          return new a(null, null, c);
        }, d.prototype.checkLayoutSuccess = function() {
          return this.graphManager.getRoot() == null || this.graphManager.getRoot().getNodes().length == 0 || this.graphManager.includesInvalidEdge();
        }, d.prototype.runLayout = function() {
          this.isLayoutFinished = false, this.tilingPreLayout && this.tilingPreLayout(), this.initParameters();
          var c;
          return this.checkLayoutSuccess() ? c = false : c = this.layout(), t.ANIMATE === "during" ? false : (c && (this.isSubLayout || this.doPostLayout()), this.tilingPostLayout && this.tilingPostLayout(), this.isLayoutFinished = true, c);
        }, d.prototype.doPostLayout = function() {
          this.incremental || this.transform(), this.update();
        }, d.prototype.update2 = function() {
          if (this.createBendsAsNeeded && (this.createBendpointsFromDummyNodes(), this.graphManager.resetAllEdges()), !this.isRemoteUse) {
            for (var c = this.graphManager.getAllEdges(), E = 0; E < c.length; E++)
              c[E];
            for (var _ = this.graphManager.getRoot().getNodes(), E = 0; E < _.length; E++)
              _[E];
            this.update(this.graphManager.getRoot());
          }
        }, d.prototype.update = function(c) {
          if (c == null)
            this.update2();
          else if (c instanceof r) {
            var E = c;
            if (E.getChild() != null)
              for (var _ = E.getChild().getNodes(), m = 0; m < _.length; m++)
                update(_[m]);
            if (E.vGraphObject != null) {
              var N = E.vGraphObject;
              N.update(E);
            }
          } else if (c instanceof a) {
            var L = c;
            if (L.vGraphObject != null) {
              var g = L.vGraphObject;
              g.update(L);
            }
          } else if (c instanceof h) {
            var O = c;
            if (O.vGraphObject != null) {
              var n = O.vGraphObject;
              n.update(O);
            }
          }
        }, d.prototype.initParameters = function() {
          this.isSubLayout || (this.layoutQuality = t.QUALITY, this.animationDuringLayout = t.DEFAULT_ANIMATION_DURING_LAYOUT, this.animationPeriod = t.DEFAULT_ANIMATION_PERIOD, this.animationOnLayout = t.DEFAULT_ANIMATION_ON_LAYOUT, this.incremental = t.DEFAULT_INCREMENTAL, this.createBendsAsNeeded = t.DEFAULT_CREATE_BENDS_AS_NEEDED, this.uniformLeafNodeSizes = t.DEFAULT_UNIFORM_LEAF_NODE_SIZES), this.animationDuringLayout && (this.animationOnLayout = false);
        }, d.prototype.transform = function(c) {
          if (c == null)
            this.transform(new s(0, 0));
          else {
            var E = new f(), _ = this.graphManager.getRoot().updateLeftTop();
            if (_ != null) {
              E.setWorldOrgX(c.x), E.setWorldOrgY(c.y), E.setDeviceOrgX(_.x), E.setDeviceOrgY(_.y);
              for (var m = this.getAllNodes(), N, L = 0; L < m.length; L++)
                N = m[L], N.transform(E);
            }
          }
        }, d.prototype.positionNodesRandomly = function(c) {
          if (c == null)
            this.positionNodesRandomly(this.getGraphManager().getRoot()), this.getGraphManager().getRoot().updateBounds(true);
          else
            for (var E, _, m = c.getNodes(), N = 0; N < m.length; N++)
              E = m[N], _ = E.getChild(), _ == null || _.getNodes().length == 0 ? E.scatter() : (this.positionNodesRandomly(_), E.updateBounds());
        }, d.prototype.getFlatForest = function() {
          for (var c = [], E = true, _ = this.graphManager.getRoot().getNodes(), m = true, N = 0; N < _.length; N++)
            _[N].getChild() != null && (m = false);
          if (!m)
            return c;
          var L = /* @__PURE__ */ new Set(), g = [], O = /* @__PURE__ */ new Map(), n = [];
          for (n = n.concat(_); n.length > 0 && E; ) {
            for (g.push(n[0]); g.length > 0 && E; ) {
              var u = g[0];
              g.splice(0, 1), L.add(u);
              for (var l = u.getEdges(), N = 0; N < l.length; N++) {
                var v = l[N].getOtherEnd(u);
                if (O.get(u) != v)
                  if (!L.has(v))
                    g.push(v), O.set(v, u);
                  else {
                    E = false;
                    break;
                  }
              }
            }
            if (!E)
              c = [];
            else {
              var A = [].concat(i(L));
              c.push(A);
              for (var N = 0; N < A.length; N++) {
                var w = A[N], I = n.indexOf(w);
                I > -1 && n.splice(I, 1);
              }
              L = /* @__PURE__ */ new Set(), O = /* @__PURE__ */ new Map();
            }
          }
          return c;
        }, d.prototype.createDummyNodesForBendpoints = function(c) {
          for (var E = [], _ = c.source, m = this.graphManager.calcLowestCommonAncestor(c.source, c.target), N = 0; N < c.bendpoints.length; N++) {
            var L = this.newNode(null);
            L.setRect(new Point(0, 0), new Dimension(1, 1)), m.add(L);
            var g = this.newEdge(null);
            this.graphManager.add(g, _, L), E.add(L), _ = L;
          }
          var g = this.newEdge(null);
          return this.graphManager.add(g, _, c.target), this.edgeToDummyNodes.set(c, E), c.isInterGraph() ? this.graphManager.remove(c) : m.remove(c), E;
        }, d.prototype.createBendpointsFromDummyNodes = function() {
          var c = [];
          c = c.concat(this.graphManager.getAllEdges()), c = [].concat(i(this.edgeToDummyNodes.keys())).concat(c);
          for (var E = 0; E < c.length; E++) {
            var _ = c[E];
            if (_.bendpoints.length > 0) {
              for (var m = this.edgeToDummyNodes.get(_), N = 0; N < m.length; N++) {
                var L = m[N], g = new s(L.getCenterX(), L.getCenterY()), O = _.bendpoints.get(N);
                O.x = g.x, O.y = g.y, L.getOwner().remove(L);
              }
              this.graphManager.add(_, _.source, _.target);
            }
          }
        }, d.transform = function(c, E, _, m) {
          if (_ != null && m != null) {
            var N = E;
            if (c <= 50) {
              var L = E / _;
              N -= (E - L) / 50 * (50 - c);
            } else {
              var g = E * m;
              N += (g - E) / 50 * (c - 50);
            }
            return N;
          } else {
            var O, n;
            return c <= 50 ? (O = 9 * E / 500, n = E / 10) : (O = 9 * E / 50, n = -8 * E), O * c + n;
          }
        }, d.findCenterOfTree = function(c) {
          var E = [];
          E = E.concat(c);
          var _ = [], m = /* @__PURE__ */ new Map(), N = false, L = null;
          (E.length == 1 || E.length == 2) && (N = true, L = E[0]);
          for (var g = 0; g < E.length; g++) {
            var O = E[g], n = O.getNeighborsList().size;
            m.set(O, O.getNeighborsList().size), n == 1 && _.push(O);
          }
          var u = [];
          for (u = u.concat(_); !N; ) {
            var l = [];
            l = l.concat(u), u = [];
            for (var g = 0; g < E.length; g++) {
              var O = E[g], v = E.indexOf(O);
              v >= 0 && E.splice(v, 1);
              var A = O.getNeighborsList();
              A.forEach(function(C) {
                if (_.indexOf(C) < 0) {
                  var S = m.get(C), U = S - 1;
                  U == 1 && u.push(C), m.set(C, U);
                }
              });
            }
            _ = _.concat(u), (E.length == 1 || E.length == 2) && (N = true, L = E[0]);
          }
          return L;
        }, d.prototype.setGraphManager = function(c) {
          this.graphManager = c;
        }, p.exports = d;
      }, function(p, T, y) {
        function i() {
        }
        i.seed = 1, i.x = 0, i.nextDouble = function() {
          return i.x = Math.sin(i.seed++) * 1e4, i.x - Math.floor(i.x);
        }, p.exports = i;
      }, function(p, T, y) {
        var i = y(4);
        function t(e, r) {
          this.lworldOrgX = 0, this.lworldOrgY = 0, this.ldeviceOrgX = 0, this.ldeviceOrgY = 0, this.lworldExtX = 1, this.lworldExtY = 1, this.ldeviceExtX = 1, this.ldeviceExtY = 1;
        }
        t.prototype.getWorldOrgX = function() {
          return this.lworldOrgX;
        }, t.prototype.setWorldOrgX = function(e) {
          this.lworldOrgX = e;
        }, t.prototype.getWorldOrgY = function() {
          return this.lworldOrgY;
        }, t.prototype.setWorldOrgY = function(e) {
          this.lworldOrgY = e;
        }, t.prototype.getWorldExtX = function() {
          return this.lworldExtX;
        }, t.prototype.setWorldExtX = function(e) {
          this.lworldExtX = e;
        }, t.prototype.getWorldExtY = function() {
          return this.lworldExtY;
        }, t.prototype.setWorldExtY = function(e) {
          this.lworldExtY = e;
        }, t.prototype.getDeviceOrgX = function() {
          return this.ldeviceOrgX;
        }, t.prototype.setDeviceOrgX = function(e) {
          this.ldeviceOrgX = e;
        }, t.prototype.getDeviceOrgY = function() {
          return this.ldeviceOrgY;
        }, t.prototype.setDeviceOrgY = function(e) {
          this.ldeviceOrgY = e;
        }, t.prototype.getDeviceExtX = function() {
          return this.ldeviceExtX;
        }, t.prototype.setDeviceExtX = function(e) {
          this.ldeviceExtX = e;
        }, t.prototype.getDeviceExtY = function() {
          return this.ldeviceExtY;
        }, t.prototype.setDeviceExtY = function(e) {
          this.ldeviceExtY = e;
        }, t.prototype.transformX = function(e) {
          var r = 0, a = this.lworldExtX;
          return a != 0 && (r = this.ldeviceOrgX + (e - this.lworldOrgX) * this.ldeviceExtX / a), r;
        }, t.prototype.transformY = function(e) {
          var r = 0, a = this.lworldExtY;
          return a != 0 && (r = this.ldeviceOrgY + (e - this.lworldOrgY) * this.ldeviceExtY / a), r;
        }, t.prototype.inverseTransformX = function(e) {
          var r = 0, a = this.ldeviceExtX;
          return a != 0 && (r = this.lworldOrgX + (e - this.ldeviceOrgX) * this.lworldExtX / a), r;
        }, t.prototype.inverseTransformY = function(e) {
          var r = 0, a = this.ldeviceExtY;
          return a != 0 && (r = this.lworldOrgY + (e - this.ldeviceOrgY) * this.lworldExtY / a), r;
        }, t.prototype.inverseTransformPoint = function(e) {
          var r = new i(this.inverseTransformX(e.x), this.inverseTransformY(e.y));
          return r;
        }, p.exports = t;
      }, function(p, T, y) {
        function i(o) {
          if (Array.isArray(o)) {
            for (var d = 0, c = Array(o.length); d < o.length; d++)
              c[d] = o[d];
            return c;
          } else
            return Array.from(o);
        }
        var t = y(15), e = y(7), r = y(0), a = y(8), h = y(9);
        function s() {
          t.call(this), this.useSmartIdealEdgeLengthCalculation = e.DEFAULT_USE_SMART_IDEAL_EDGE_LENGTH_CALCULATION, this.idealEdgeLength = e.DEFAULT_EDGE_LENGTH, this.springConstant = e.DEFAULT_SPRING_STRENGTH, this.repulsionConstant = e.DEFAULT_REPULSION_STRENGTH, this.gravityConstant = e.DEFAULT_GRAVITY_STRENGTH, this.compoundGravityConstant = e.DEFAULT_COMPOUND_GRAVITY_STRENGTH, this.gravityRangeFactor = e.DEFAULT_GRAVITY_RANGE_FACTOR, this.compoundGravityRangeFactor = e.DEFAULT_COMPOUND_GRAVITY_RANGE_FACTOR, this.displacementThresholdPerNode = 3 * e.DEFAULT_EDGE_LENGTH / 100, this.coolingFactor = e.DEFAULT_COOLING_FACTOR_INCREMENTAL, this.initialCoolingFactor = e.DEFAULT_COOLING_FACTOR_INCREMENTAL, this.totalDisplacement = 0, this.oldTotalDisplacement = 0, this.maxIterations = e.MAX_ITERATIONS;
        }
        s.prototype = Object.create(t.prototype);
        for (var f in t)
          s[f] = t[f];
        s.prototype.initParameters = function() {
          t.prototype.initParameters.call(this, arguments), this.totalIterations = 0, this.notAnimatedIterations = 0, this.useFRGridVariant = e.DEFAULT_USE_SMART_REPULSION_RANGE_CALCULATION, this.grid = [];
        }, s.prototype.calcIdealEdgeLengths = function() {
          for (var o, d, c, E, _, m, N = this.getGraphManager().getAllEdges(), L = 0; L < N.length; L++)
            o = N[L], o.idealLength = this.idealEdgeLength, o.isInterGraph && (c = o.getSource(), E = o.getTarget(), _ = o.getSourceInLca().getEstimatedSize(), m = o.getTargetInLca().getEstimatedSize(), this.useSmartIdealEdgeLengthCalculation && (o.idealLength += _ + m - 2 * r.SIMPLE_NODE_SIZE), d = o.getLca().getInclusionTreeDepth(), o.idealLength += e.DEFAULT_EDGE_LENGTH * e.PER_LEVEL_IDEAL_EDGE_LENGTH_FACTOR * (c.getInclusionTreeDepth() + E.getInclusionTreeDepth() - 2 * d));
        }, s.prototype.initSpringEmbedder = function() {
          var o = this.getAllNodes().length;
          this.incremental ? (o > e.ADAPTATION_LOWER_NODE_LIMIT && (this.coolingFactor = Math.max(this.coolingFactor * e.COOLING_ADAPTATION_FACTOR, this.coolingFactor - (o - e.ADAPTATION_LOWER_NODE_LIMIT) / (e.ADAPTATION_UPPER_NODE_LIMIT - e.ADAPTATION_LOWER_NODE_LIMIT) * this.coolingFactor * (1 - e.COOLING_ADAPTATION_FACTOR))), this.maxNodeDisplacement = e.MAX_NODE_DISPLACEMENT_INCREMENTAL) : (o > e.ADAPTATION_LOWER_NODE_LIMIT ? this.coolingFactor = Math.max(e.COOLING_ADAPTATION_FACTOR, 1 - (o - e.ADAPTATION_LOWER_NODE_LIMIT) / (e.ADAPTATION_UPPER_NODE_LIMIT - e.ADAPTATION_LOWER_NODE_LIMIT) * (1 - e.COOLING_ADAPTATION_FACTOR)) : this.coolingFactor = 1, this.initialCoolingFactor = this.coolingFactor, this.maxNodeDisplacement = e.MAX_NODE_DISPLACEMENT), this.maxIterations = Math.max(this.getAllNodes().length * 5, this.maxIterations), this.totalDisplacementThreshold = this.displacementThresholdPerNode * this.getAllNodes().length, this.repulsionRange = this.calcRepulsionRange();
        }, s.prototype.calcSpringForces = function() {
          for (var o = this.getAllEdges(), d, c = 0; c < o.length; c++)
            d = o[c], this.calcSpringForce(d, d.idealLength);
        }, s.prototype.calcRepulsionForces = function() {
          var o = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : true, d = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : false, c, E, _, m, N = this.getAllNodes(), L;
          if (this.useFRGridVariant)
            for (this.totalIterations % e.GRID_CALCULATION_CHECK_PERIOD == 1 && o && this.updateGrid(), L = /* @__PURE__ */ new Set(), c = 0; c < N.length; c++)
              _ = N[c], this.calculateRepulsionForceOfANode(_, L, o, d), L.add(_);
          else
            for (c = 0; c < N.length; c++)
              for (_ = N[c], E = c + 1; E < N.length; E++)
                m = N[E], _.getOwner() == m.getOwner() && this.calcRepulsionForce(_, m);
        }, s.prototype.calcGravitationalForces = function() {
          for (var o, d = this.getAllNodesToApplyGravitation(), c = 0; c < d.length; c++)
            o = d[c], this.calcGravitationalForce(o);
        }, s.prototype.moveNodes = function() {
          for (var o = this.getAllNodes(), d, c = 0; c < o.length; c++)
            d = o[c], d.move();
        }, s.prototype.calcSpringForce = function(o, d) {
          var c = o.getSource(), E = o.getTarget(), _, m, N, L;
          if (this.uniformLeafNodeSizes && c.getChild() == null && E.getChild() == null)
            o.updateLengthSimple();
          else if (o.updateLength(), o.isOverlapingSourceAndTarget)
            return;
          _ = o.getLength(), _ != 0 && (m = this.springConstant * (_ - d), N = m * (o.lengthX / _), L = m * (o.lengthY / _), c.springForceX += N, c.springForceY += L, E.springForceX -= N, E.springForceY -= L);
        }, s.prototype.calcRepulsionForce = function(o, d) {
          var c = o.getRect(), E = d.getRect(), _ = new Array(2), m = new Array(4), N, L, g, O, n, u, l;
          if (c.intersects(E)) {
            a.calcSeparationAmount(c, E, _, e.DEFAULT_EDGE_LENGTH / 2), u = 2 * _[0], l = 2 * _[1];
            var v = o.noOfChildren * d.noOfChildren / (o.noOfChildren + d.noOfChildren);
            o.repulsionForceX -= v * u, o.repulsionForceY -= v * l, d.repulsionForceX += v * u, d.repulsionForceY += v * l;
          } else
            this.uniformLeafNodeSizes && o.getChild() == null && d.getChild() == null ? (N = E.getCenterX() - c.getCenterX(), L = E.getCenterY() - c.getCenterY()) : (a.getIntersection(c, E, m), N = m[2] - m[0], L = m[3] - m[1]), Math.abs(N) < e.MIN_REPULSION_DIST && (N = h.sign(N) * e.MIN_REPULSION_DIST), Math.abs(L) < e.MIN_REPULSION_DIST && (L = h.sign(L) * e.MIN_REPULSION_DIST), g = N * N + L * L, O = Math.sqrt(g), n = this.repulsionConstant * o.noOfChildren * d.noOfChildren / g, u = n * N / O, l = n * L / O, o.repulsionForceX -= u, o.repulsionForceY -= l, d.repulsionForceX += u, d.repulsionForceY += l;
        }, s.prototype.calcGravitationalForce = function(o) {
          var d, c, E, _, m, N, L, g;
          d = o.getOwner(), c = (d.getRight() + d.getLeft()) / 2, E = (d.getTop() + d.getBottom()) / 2, _ = o.getCenterX() - c, m = o.getCenterY() - E, N = Math.abs(_) + o.getWidth() / 2, L = Math.abs(m) + o.getHeight() / 2, o.getOwner() == this.graphManager.getRoot() ? (g = d.getEstimatedSize() * this.gravityRangeFactor, (N > g || L > g) && (o.gravitationForceX = -this.gravityConstant * _, o.gravitationForceY = -this.gravityConstant * m)) : (g = d.getEstimatedSize() * this.compoundGravityRangeFactor, (N > g || L > g) && (o.gravitationForceX = -this.gravityConstant * _ * this.compoundGravityConstant, o.gravitationForceY = -this.gravityConstant * m * this.compoundGravityConstant));
        }, s.prototype.isConverged = function() {
          var o, d = false;
          return this.totalIterations > this.maxIterations / 3 && (d = Math.abs(this.totalDisplacement - this.oldTotalDisplacement) < 2), o = this.totalDisplacement < this.totalDisplacementThreshold, this.oldTotalDisplacement = this.totalDisplacement, o || d;
        }, s.prototype.animate = function() {
          this.animationDuringLayout && !this.isSubLayout && (this.notAnimatedIterations == this.animationPeriod ? (this.update(), this.notAnimatedIterations = 0) : this.notAnimatedIterations++);
        }, s.prototype.calcNoOfChildrenForAllNodes = function() {
          for (var o, d = this.graphManager.getAllNodes(), c = 0; c < d.length; c++)
            o = d[c], o.noOfChildren = o.getNoOfChildren();
        }, s.prototype.calcGrid = function(o) {
          var d = 0, c = 0;
          d = parseInt(Math.ceil((o.getRight() - o.getLeft()) / this.repulsionRange)), c = parseInt(Math.ceil((o.getBottom() - o.getTop()) / this.repulsionRange));
          for (var E = new Array(d), _ = 0; _ < d; _++)
            E[_] = new Array(c);
          for (var _ = 0; _ < d; _++)
            for (var m = 0; m < c; m++)
              E[_][m] = new Array();
          return E;
        }, s.prototype.addNodeToGrid = function(o, d, c) {
          var E = 0, _ = 0, m = 0, N = 0;
          E = parseInt(Math.floor((o.getRect().x - d) / this.repulsionRange)), _ = parseInt(Math.floor((o.getRect().width + o.getRect().x - d) / this.repulsionRange)), m = parseInt(Math.floor((o.getRect().y - c) / this.repulsionRange)), N = parseInt(Math.floor((o.getRect().height + o.getRect().y - c) / this.repulsionRange));
          for (var L = E; L <= _; L++)
            for (var g = m; g <= N; g++)
              this.grid[L][g].push(o), o.setGridCoordinates(E, _, m, N);
        }, s.prototype.updateGrid = function() {
          var o, d, c = this.getAllNodes();
          for (this.grid = this.calcGrid(this.graphManager.getRoot()), o = 0; o < c.length; o++)
            d = c[o], this.addNodeToGrid(d, this.graphManager.getRoot().getLeft(), this.graphManager.getRoot().getTop());
        }, s.prototype.calculateRepulsionForceOfANode = function(o, d, c, E) {
          if (this.totalIterations % e.GRID_CALCULATION_CHECK_PERIOD == 1 && c || E) {
            var _ = /* @__PURE__ */ new Set();
            o.surrounding = new Array();
            for (var m, N = this.grid, L = o.startX - 1; L < o.finishX + 2; L++)
              for (var g = o.startY - 1; g < o.finishY + 2; g++)
                if (!(L < 0 || g < 0 || L >= N.length || g >= N[0].length)) {
                  for (var O = 0; O < N[L][g].length; O++)
                    if (m = N[L][g][O], !(o.getOwner() != m.getOwner() || o == m) && !d.has(m) && !_.has(m)) {
                      var n = Math.abs(o.getCenterX() - m.getCenterX()) - (o.getWidth() / 2 + m.getWidth() / 2), u = Math.abs(o.getCenterY() - m.getCenterY()) - (o.getHeight() / 2 + m.getHeight() / 2);
                      n <= this.repulsionRange && u <= this.repulsionRange && _.add(m);
                    }
                }
            o.surrounding = [].concat(i(_));
          }
          for (L = 0; L < o.surrounding.length; L++)
            this.calcRepulsionForce(o, o.surrounding[L]);
        }, s.prototype.calcRepulsionRange = function() {
          return 0;
        }, p.exports = s;
      }, function(p, T, y) {
        var i = y(1), t = y(7);
        function e(a, h, s) {
          i.call(this, a, h, s), this.idealLength = t.DEFAULT_EDGE_LENGTH;
        }
        e.prototype = Object.create(i.prototype);
        for (var r in i)
          e[r] = i[r];
        p.exports = e;
      }, function(p, T, y) {
        var i = y(3);
        function t(r, a, h, s) {
          i.call(this, r, a, h, s), this.springForceX = 0, this.springForceY = 0, this.repulsionForceX = 0, this.repulsionForceY = 0, this.gravitationForceX = 0, this.gravitationForceY = 0, this.displacementX = 0, this.displacementY = 0, this.startX = 0, this.finishX = 0, this.startY = 0, this.finishY = 0, this.surrounding = [];
        }
        t.prototype = Object.create(i.prototype);
        for (var e in i)
          t[e] = i[e];
        t.prototype.setGridCoordinates = function(r, a, h, s) {
          this.startX = r, this.finishX = a, this.startY = h, this.finishY = s;
        }, p.exports = t;
      }, function(p, T, y) {
        function i(t, e) {
          this.width = 0, this.height = 0, t !== null && e !== null && (this.height = e, this.width = t);
        }
        i.prototype.getWidth = function() {
          return this.width;
        }, i.prototype.setWidth = function(t) {
          this.width = t;
        }, i.prototype.getHeight = function() {
          return this.height;
        }, i.prototype.setHeight = function(t) {
          this.height = t;
        }, p.exports = i;
      }, function(p, T, y) {
        var i = y(14);
        function t() {
          this.map = {}, this.keys = [];
        }
        t.prototype.put = function(e, r) {
          var a = i.createID(e);
          this.contains(a) || (this.map[a] = r, this.keys.push(e));
        }, t.prototype.contains = function(e) {
          return i.createID(e), this.map[e] != null;
        }, t.prototype.get = function(e) {
          var r = i.createID(e);
          return this.map[r];
        }, t.prototype.keySet = function() {
          return this.keys;
        }, p.exports = t;
      }, function(p, T, y) {
        var i = y(14);
        function t() {
          this.set = {};
        }
        t.prototype.add = function(e) {
          var r = i.createID(e);
          this.contains(r) || (this.set[r] = e);
        }, t.prototype.remove = function(e) {
          delete this.set[i.createID(e)];
        }, t.prototype.clear = function() {
          this.set = {};
        }, t.prototype.contains = function(e) {
          return this.set[i.createID(e)] == e;
        }, t.prototype.isEmpty = function() {
          return this.size() === 0;
        }, t.prototype.size = function() {
          return Object.keys(this.set).length;
        }, t.prototype.addAllTo = function(e) {
          for (var r = Object.keys(this.set), a = r.length, h = 0; h < a; h++)
            e.push(this.set[r[h]]);
        }, t.prototype.size = function() {
          return Object.keys(this.set).length;
        }, t.prototype.addAll = function(e) {
          for (var r = e.length, a = 0; a < r; a++) {
            var h = e[a];
            this.add(h);
          }
        }, p.exports = t;
      }, function(p, T, y) {
        var i = function() {
          function a(h, s) {
            for (var f = 0; f < s.length; f++) {
              var o = s[f];
              o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(h, o.key, o);
            }
          }
          return function(h, s, f) {
            return s && a(h.prototype, s), f && a(h, f), h;
          };
        }();
        function t(a, h) {
          if (!(a instanceof h))
            throw new TypeError("Cannot call a class as a function");
        }
        var e = y(11), r = function() {
          function a(h, s) {
            t(this, a), (s !== null || s !== void 0) && (this.compareFunction = this._defaultCompareFunction);
            var f = void 0;
            h instanceof e ? f = h.size() : f = h.length, this._quicksort(h, 0, f - 1);
          }
          return i(a, [{ key: "_quicksort", value: function(h, s, f) {
            if (s < f) {
              var o = this._partition(h, s, f);
              this._quicksort(h, s, o), this._quicksort(h, o + 1, f);
            }
          } }, { key: "_partition", value: function(h, s, f) {
            for (var o = this._get(h, s), d = s, c = f; ; ) {
              for (; this.compareFunction(o, this._get(h, c)); )
                c--;
              for (; this.compareFunction(this._get(h, d), o); )
                d++;
              if (d < c)
                this._swap(h, d, c), d++, c--;
              else
                return c;
            }
          } }, { key: "_get", value: function(h, s) {
            return h instanceof e ? h.get_object_at(s) : h[s];
          } }, { key: "_set", value: function(h, s, f) {
            h instanceof e ? h.set_object_at(s, f) : h[s] = f;
          } }, { key: "_swap", value: function(h, s, f) {
            var o = this._get(h, s);
            this._set(h, s, this._get(h, f)), this._set(h, f, o);
          } }, { key: "_defaultCompareFunction", value: function(h, s) {
            return s > h;
          } }]), a;
        }();
        p.exports = r;
      }, function(p, T, y) {
        var i = function() {
          function r(a, h) {
            for (var s = 0; s < h.length; s++) {
              var f = h[s];
              f.enumerable = f.enumerable || false, f.configurable = true, "value" in f && (f.writable = true), Object.defineProperty(a, f.key, f);
            }
          }
          return function(a, h, s) {
            return h && r(a.prototype, h), s && r(a, s), a;
          };
        }();
        function t(r, a) {
          if (!(r instanceof a))
            throw new TypeError("Cannot call a class as a function");
        }
        var e = function() {
          function r(a, h) {
            var s = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : 1, f = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : -1, o = arguments.length > 4 && arguments[4] !== void 0 ? arguments[4] : -1;
            t(this, r), this.sequence1 = a, this.sequence2 = h, this.match_score = s, this.mismatch_penalty = f, this.gap_penalty = o, this.iMax = a.length + 1, this.jMax = h.length + 1, this.grid = new Array(this.iMax);
            for (var d = 0; d < this.iMax; d++) {
              this.grid[d] = new Array(this.jMax);
              for (var c = 0; c < this.jMax; c++)
                this.grid[d][c] = 0;
            }
            this.tracebackGrid = new Array(this.iMax);
            for (var E = 0; E < this.iMax; E++) {
              this.tracebackGrid[E] = new Array(this.jMax);
              for (var _ = 0; _ < this.jMax; _++)
                this.tracebackGrid[E][_] = [null, null, null];
            }
            this.alignments = [], this.score = -1, this.computeGrids();
          }
          return i(r, [{ key: "getScore", value: function() {
            return this.score;
          } }, { key: "getAlignments", value: function() {
            return this.alignments;
          } }, { key: "computeGrids", value: function() {
            for (var a = 1; a < this.jMax; a++)
              this.grid[0][a] = this.grid[0][a - 1] + this.gap_penalty, this.tracebackGrid[0][a] = [false, false, true];
            for (var h = 1; h < this.iMax; h++)
              this.grid[h][0] = this.grid[h - 1][0] + this.gap_penalty, this.tracebackGrid[h][0] = [false, true, false];
            for (var s = 1; s < this.iMax; s++)
              for (var f = 1; f < this.jMax; f++) {
                var o = void 0;
                this.sequence1[s - 1] === this.sequence2[f - 1] ? o = this.grid[s - 1][f - 1] + this.match_score : o = this.grid[s - 1][f - 1] + this.mismatch_penalty;
                var d = this.grid[s - 1][f] + this.gap_penalty, c = this.grid[s][f - 1] + this.gap_penalty, E = [o, d, c], _ = this.arrayAllMaxIndexes(E);
                this.grid[s][f] = E[_[0]], this.tracebackGrid[s][f] = [_.includes(0), _.includes(1), _.includes(2)];
              }
            this.score = this.grid[this.iMax - 1][this.jMax - 1];
          } }, { key: "alignmentTraceback", value: function() {
            var a = [];
            for (a.push({ pos: [this.sequence1.length, this.sequence2.length], seq1: "", seq2: "" }); a[0]; ) {
              var h = a[0], s = this.tracebackGrid[h.pos[0]][h.pos[1]];
              s[0] && a.push({ pos: [h.pos[0] - 1, h.pos[1] - 1], seq1: this.sequence1[h.pos[0] - 1] + h.seq1, seq2: this.sequence2[h.pos[1] - 1] + h.seq2 }), s[1] && a.push({ pos: [h.pos[0] - 1, h.pos[1]], seq1: this.sequence1[h.pos[0] - 1] + h.seq1, seq2: "-" + h.seq2 }), s[2] && a.push({ pos: [h.pos[0], h.pos[1] - 1], seq1: "-" + h.seq1, seq2: this.sequence2[h.pos[1] - 1] + h.seq2 }), h.pos[0] === 0 && h.pos[1] === 0 && this.alignments.push({ sequence1: h.seq1, sequence2: h.seq2 }), a.shift();
            }
            return this.alignments;
          } }, { key: "getAllIndexes", value: function(a, h) {
            for (var s = [], f = -1; (f = a.indexOf(h, f + 1)) !== -1; )
              s.push(f);
            return s;
          } }, { key: "arrayAllMaxIndexes", value: function(a) {
            return this.getAllIndexes(a, Math.max.apply(null, a));
          } }]), r;
        }();
        p.exports = e;
      }, function(p, T, y) {
        var i = function() {
        };
        i.FDLayout = y(18), i.FDLayoutConstants = y(7), i.FDLayoutEdge = y(19), i.FDLayoutNode = y(20), i.DimensionD = y(21), i.HashMap = y(22), i.HashSet = y(23), i.IGeometry = y(8), i.IMath = y(9), i.Integer = y(10), i.Point = y(12), i.PointD = y(4), i.RandomSeed = y(16), i.RectangleD = y(13), i.Transform = y(17), i.UniqueIDGeneretor = y(14), i.Quicksort = y(24), i.LinkedList = y(11), i.LGraphObject = y(2), i.LGraph = y(5), i.LEdge = y(1), i.LGraphManager = y(6), i.LNode = y(3), i.Layout = y(15), i.LayoutConstants = y(0), i.NeedlemanWunsch = y(25), p.exports = i;
      }, function(p, T, y) {
        function i() {
          this.listeners = [];
        }
        var t = i.prototype;
        t.addListener = function(e, r) {
          this.listeners.push({ event: e, callback: r });
        }, t.removeListener = function(e, r) {
          for (var a = this.listeners.length; a >= 0; a--) {
            var h = this.listeners[a];
            h.event === e && h.callback === r && this.listeners.splice(a, 1);
          }
        }, t.emit = function(e, r) {
          for (var a = 0; a < this.listeners.length; a++) {
            var h = this.listeners[a];
            e === h.event && h.callback(r);
          }
        }, p.exports = i;
      }]);
    });
  }(nt)), nt.exports;
}
var xt = rt.exports, ut;
function Mt() {
  return ut || (ut = 1, function(D, R) {
    (function(p, T) {
      D.exports = T(Rt());
    })(xt, function(p) {
      return function(T) {
        var y = {};
        function i(t) {
          if (y[t])
            return y[t].exports;
          var e = y[t] = { i: t, l: false, exports: {} };
          return T[t].call(e.exports, e, e.exports, i), e.l = true, e.exports;
        }
        return i.m = T, i.c = y, i.i = function(t) {
          return t;
        }, i.d = function(t, e, r) {
          i.o(t, e) || Object.defineProperty(t, e, { configurable: false, enumerable: true, get: r });
        }, i.n = function(t) {
          var e = t && t.__esModule ? function() {
            return t.default;
          } : function() {
            return t;
          };
          return i.d(e, "a", e), e;
        }, i.o = function(t, e) {
          return Object.prototype.hasOwnProperty.call(t, e);
        }, i.p = "", i(i.s = 7);
      }([function(T, y) {
        T.exports = p;
      }, function(T, y, i) {
        var t = i(0).FDLayoutConstants;
        function e() {
        }
        for (var r in t)
          e[r] = t[r];
        e.DEFAULT_USE_MULTI_LEVEL_SCALING = false, e.DEFAULT_RADIAL_SEPARATION = t.DEFAULT_EDGE_LENGTH, e.DEFAULT_COMPONENT_SEPERATION = 60, e.TILE = true, e.TILING_PADDING_VERTICAL = 10, e.TILING_PADDING_HORIZONTAL = 10, e.TREE_REDUCTION_ON_INCREMENTAL = false, T.exports = e;
      }, function(T, y, i) {
        var t = i(0).FDLayoutEdge;
        function e(a, h, s) {
          t.call(this, a, h, s);
        }
        e.prototype = Object.create(t.prototype);
        for (var r in t)
          e[r] = t[r];
        T.exports = e;
      }, function(T, y, i) {
        var t = i(0).LGraph;
        function e(a, h, s) {
          t.call(this, a, h, s);
        }
        e.prototype = Object.create(t.prototype);
        for (var r in t)
          e[r] = t[r];
        T.exports = e;
      }, function(T, y, i) {
        var t = i(0).LGraphManager;
        function e(a) {
          t.call(this, a);
        }
        e.prototype = Object.create(t.prototype);
        for (var r in t)
          e[r] = t[r];
        T.exports = e;
      }, function(T, y, i) {
        var t = i(0).FDLayoutNode, e = i(0).IMath;
        function r(h, s, f, o) {
          t.call(this, h, s, f, o);
        }
        r.prototype = Object.create(t.prototype);
        for (var a in t)
          r[a] = t[a];
        r.prototype.move = function() {
          var h = this.graphManager.getLayout();
          this.displacementX = h.coolingFactor * (this.springForceX + this.repulsionForceX + this.gravitationForceX) / this.noOfChildren, this.displacementY = h.coolingFactor * (this.springForceY + this.repulsionForceY + this.gravitationForceY) / this.noOfChildren, Math.abs(this.displacementX) > h.coolingFactor * h.maxNodeDisplacement && (this.displacementX = h.coolingFactor * h.maxNodeDisplacement * e.sign(this.displacementX)), Math.abs(this.displacementY) > h.coolingFactor * h.maxNodeDisplacement && (this.displacementY = h.coolingFactor * h.maxNodeDisplacement * e.sign(this.displacementY)), this.child == null ? this.moveBy(this.displacementX, this.displacementY) : this.child.getNodes().length == 0 ? this.moveBy(this.displacementX, this.displacementY) : this.propogateDisplacementToChildren(this.displacementX, this.displacementY), h.totalDisplacement += Math.abs(this.displacementX) + Math.abs(this.displacementY), this.springForceX = 0, this.springForceY = 0, this.repulsionForceX = 0, this.repulsionForceY = 0, this.gravitationForceX = 0, this.gravitationForceY = 0, this.displacementX = 0, this.displacementY = 0;
        }, r.prototype.propogateDisplacementToChildren = function(h, s) {
          for (var f = this.getChild().getNodes(), o, d = 0; d < f.length; d++)
            o = f[d], o.getChild() == null ? (o.moveBy(h, s), o.displacementX += h, o.displacementY += s) : o.propogateDisplacementToChildren(h, s);
        }, r.prototype.setPred1 = function(h) {
          this.pred1 = h;
        }, r.prototype.getPred1 = function() {
          return pred1;
        }, r.prototype.getPred2 = function() {
          return pred2;
        }, r.prototype.setNext = function(h) {
          this.next = h;
        }, r.prototype.getNext = function() {
          return next;
        }, r.prototype.setProcessed = function(h) {
          this.processed = h;
        }, r.prototype.isProcessed = function() {
          return processed;
        }, T.exports = r;
      }, function(T, y, i) {
        var t = i(0).FDLayout, e = i(4), r = i(3), a = i(5), h = i(2), s = i(1), f = i(0).FDLayoutConstants, o = i(0).LayoutConstants, d = i(0).Point, c = i(0).PointD, E = i(0).Layout, _ = i(0).Integer, m = i(0).IGeometry, N = i(0).LGraph, L = i(0).Transform;
        function g() {
          t.call(this), this.toBeTiled = {};
        }
        g.prototype = Object.create(t.prototype);
        for (var O in t)
          g[O] = t[O];
        g.prototype.newGraphManager = function() {
          var n = new e(this);
          return this.graphManager = n, n;
        }, g.prototype.newGraph = function(n) {
          return new r(null, this.graphManager, n);
        }, g.prototype.newNode = function(n) {
          return new a(this.graphManager, n);
        }, g.prototype.newEdge = function(n) {
          return new h(null, null, n);
        }, g.prototype.initParameters = function() {
          t.prototype.initParameters.call(this, arguments), this.isSubLayout || (s.DEFAULT_EDGE_LENGTH < 10 ? this.idealEdgeLength = 10 : this.idealEdgeLength = s.DEFAULT_EDGE_LENGTH, this.useSmartIdealEdgeLengthCalculation = s.DEFAULT_USE_SMART_IDEAL_EDGE_LENGTH_CALCULATION, this.springConstant = f.DEFAULT_SPRING_STRENGTH, this.repulsionConstant = f.DEFAULT_REPULSION_STRENGTH, this.gravityConstant = f.DEFAULT_GRAVITY_STRENGTH, this.compoundGravityConstant = f.DEFAULT_COMPOUND_GRAVITY_STRENGTH, this.gravityRangeFactor = f.DEFAULT_GRAVITY_RANGE_FACTOR, this.compoundGravityRangeFactor = f.DEFAULT_COMPOUND_GRAVITY_RANGE_FACTOR, this.prunedNodesAll = [], this.growTreeIterations = 0, this.afterGrowthIterations = 0, this.isTreeGrowing = false, this.isGrowthFinished = false, this.coolingCycle = 0, this.maxCoolingCycle = this.maxIterations / f.CONVERGENCE_CHECK_PERIOD, this.finalTemperature = f.CONVERGENCE_CHECK_PERIOD / this.maxIterations, this.coolingAdjuster = 1);
        }, g.prototype.layout = function() {
          var n = o.DEFAULT_CREATE_BENDS_AS_NEEDED;
          return n && (this.createBendpoints(), this.graphManager.resetAllEdges()), this.level = 0, this.classicLayout();
        }, g.prototype.classicLayout = function() {
          if (this.nodesWithGravity = this.calculateNodesToApplyGravitationTo(), this.graphManager.setAllNodesToApplyGravitation(this.nodesWithGravity), this.calcNoOfChildrenForAllNodes(), this.graphManager.calcLowestCommonAncestors(), this.graphManager.calcInclusionTreeDepths(), this.graphManager.getRoot().calcEstimatedSize(), this.calcIdealEdgeLengths(), this.incremental) {
            if (s.TREE_REDUCTION_ON_INCREMENTAL) {
              this.reduceTrees(), this.graphManager.resetAllNodesToApplyGravitation();
              var n = new Set(this.getAllNodes()), u = this.nodesWithGravity.filter(function(v) {
                return n.has(v);
              });
              this.graphManager.setAllNodesToApplyGravitation(u);
            }
          } else {
            var l = this.getFlatForest();
            if (l.length > 0)
              this.positionNodesRadially(l);
            else {
              this.reduceTrees(), this.graphManager.resetAllNodesToApplyGravitation();
              var n = new Set(this.getAllNodes()), u = this.nodesWithGravity.filter(function(w) {
                return n.has(w);
              });
              this.graphManager.setAllNodesToApplyGravitation(u), this.positionNodesRandomly();
            }
          }
          return this.initSpringEmbedder(), this.runSpringEmbedder(), true;
        }, g.prototype.tick = function() {
          if (this.totalIterations++, this.totalIterations === this.maxIterations && !this.isTreeGrowing && !this.isGrowthFinished)
            if (this.prunedNodesAll.length > 0)
              this.isTreeGrowing = true;
            else
              return true;
          if (this.totalIterations % f.CONVERGENCE_CHECK_PERIOD == 0 && !this.isTreeGrowing && !this.isGrowthFinished) {
            if (this.isConverged())
              if (this.prunedNodesAll.length > 0)
                this.isTreeGrowing = true;
              else
                return true;
            this.coolingCycle++, this.layoutQuality == 0 ? this.coolingAdjuster = this.coolingCycle : this.layoutQuality == 1 && (this.coolingAdjuster = this.coolingCycle / 3), this.coolingFactor = Math.max(this.initialCoolingFactor - Math.pow(this.coolingCycle, Math.log(100 * (this.initialCoolingFactor - this.finalTemperature)) / Math.log(this.maxCoolingCycle)) / 100 * this.coolingAdjuster, this.finalTemperature), this.animationPeriod = Math.ceil(this.initialAnimationPeriod * Math.sqrt(this.coolingFactor));
          }
          if (this.isTreeGrowing) {
            if (this.growTreeIterations % 10 == 0)
              if (this.prunedNodesAll.length > 0) {
                this.graphManager.updateBounds(), this.updateGrid(), this.growTree(this.prunedNodesAll), this.graphManager.resetAllNodesToApplyGravitation();
                var n = new Set(this.getAllNodes()), u = this.nodesWithGravity.filter(function(A) {
                  return n.has(A);
                });
                this.graphManager.setAllNodesToApplyGravitation(u), this.graphManager.updateBounds(), this.updateGrid(), this.coolingFactor = f.DEFAULT_COOLING_FACTOR_INCREMENTAL;
              } else
                this.isTreeGrowing = false, this.isGrowthFinished = true;
            this.growTreeIterations++;
          }
          if (this.isGrowthFinished) {
            if (this.isConverged())
              return true;
            this.afterGrowthIterations % 10 == 0 && (this.graphManager.updateBounds(), this.updateGrid()), this.coolingFactor = f.DEFAULT_COOLING_FACTOR_INCREMENTAL * ((100 - this.afterGrowthIterations) / 100), this.afterGrowthIterations++;
          }
          var l = !this.isTreeGrowing && !this.isGrowthFinished, v = this.growTreeIterations % 10 == 1 && this.isTreeGrowing || this.afterGrowthIterations % 10 == 1 && this.isGrowthFinished;
          return this.totalDisplacement = 0, this.graphManager.updateBounds(), this.calcSpringForces(), this.calcRepulsionForces(l, v), this.calcGravitationalForces(), this.moveNodes(), this.animate(), false;
        }, g.prototype.getPositionsData = function() {
          for (var n = this.graphManager.getAllNodes(), u = {}, l = 0; l < n.length; l++) {
            var v = n[l].rect, A = n[l].id;
            u[A] = { id: A, x: v.getCenterX(), y: v.getCenterY(), w: v.width, h: v.height };
          }
          return u;
        }, g.prototype.runSpringEmbedder = function() {
          this.initialAnimationPeriod = 25, this.animationPeriod = this.initialAnimationPeriod;
          var n = false;
          if (f.ANIMATE === "during")
            this.emit("layoutstarted");
          else {
            for (; !n; )
              n = this.tick();
            this.graphManager.updateBounds();
          }
        }, g.prototype.calculateNodesToApplyGravitationTo = function() {
          var n = [], u, l = this.graphManager.getGraphs(), v = l.length, A;
          for (A = 0; A < v; A++)
            u = l[A], u.updateConnected(), u.isConnected || (n = n.concat(u.getNodes()));
          return n;
        }, g.prototype.createBendpoints = function() {
          var n = [];
          n = n.concat(this.graphManager.getAllEdges());
          var u = /* @__PURE__ */ new Set(), l;
          for (l = 0; l < n.length; l++) {
            var v = n[l];
            if (!u.has(v)) {
              var A = v.getSource(), w = v.getTarget();
              if (A == w)
                v.getBendpoints().push(new c()), v.getBendpoints().push(new c()), this.createDummyNodesForBendpoints(v), u.add(v);
              else {
                var I = [];
                if (I = I.concat(A.getEdgeListToNode(w)), I = I.concat(w.getEdgeListToNode(A)), !u.has(I[0])) {
                  if (I.length > 1) {
                    var C;
                    for (C = 0; C < I.length; C++) {
                      var S = I[C];
                      S.getBendpoints().push(new c()), this.createDummyNodesForBendpoints(S);
                    }
                  }
                  I.forEach(function(U) {
                    u.add(U);
                  });
                }
              }
            }
            if (u.size == n.length)
              break;
          }
        }, g.prototype.positionNodesRadially = function(n) {
          for (var u = new d(0, 0), l = Math.ceil(Math.sqrt(n.length)), v = 0, A = 0, w = 0, I = new c(0, 0), C = 0; C < n.length; C++) {
            C % l == 0 && (w = 0, A = v, C != 0 && (A += s.DEFAULT_COMPONENT_SEPERATION), v = 0);
            var S = n[C], U = E.findCenterOfTree(S);
            u.x = w, u.y = A, I = g.radialLayout(S, U, u), I.y > v && (v = Math.floor(I.y)), w = Math.floor(I.x + s.DEFAULT_COMPONENT_SEPERATION);
          }
          this.transform(new c(o.WORLD_CENTER_X - I.x / 2, o.WORLD_CENTER_Y - I.y / 2));
        }, g.radialLayout = function(n, u, l) {
          var v = Math.max(this.maxDiagonalInTree(n), s.DEFAULT_RADIAL_SEPARATION);
          g.branchRadialLayout(u, null, 0, 359, 0, v);
          var A = N.calculateBounds(n), w = new L();
          w.setDeviceOrgX(A.getMinX()), w.setDeviceOrgY(A.getMinY()), w.setWorldOrgX(l.x), w.setWorldOrgY(l.y);
          for (var I = 0; I < n.length; I++) {
            var C = n[I];
            C.transform(w);
          }
          var S = new c(A.getMaxX(), A.getMaxY());
          return w.inverseTransformPoint(S);
        }, g.branchRadialLayout = function(n, u, l, v, A, w) {
          var I = (v - l + 1) / 2;
          I < 0 && (I += 180);
          var C = (I + l) % 360, S = C * m.TWO_PI / 360, U = A * Math.cos(S), b = A * Math.sin(S);
          n.setCenter(U, b);
          var M = [];
          M = M.concat(n.getEdges());
          var G = M.length;
          u != null && G--;
          for (var F = 0, k = M.length, Y, X = n.getEdgesBetween(u); X.length > 1; ) {
            var P = X[0];
            X.splice(0, 1);
            var B = M.indexOf(P);
            B >= 0 && M.splice(B, 1), k--, G--;
          }
          u != null ? Y = (M.indexOf(X[0]) + 1) % k : Y = 0;
          for (var $ = Math.abs(v - l) / G, W = Y; F != G; W = ++W % k) {
            var q = M[W].getOtherEnd(n);
            if (q != u) {
              var Z = (l + F * $) % 360, j = (Z + $) % 360;
              g.branchRadialLayout(q, n, Z, j, A + w, w), F++;
            }
          }
        }, g.maxDiagonalInTree = function(n) {
          for (var u = _.MIN_VALUE, l = 0; l < n.length; l++) {
            var v = n[l], A = v.getDiagonal();
            A > u && (u = A);
          }
          return u;
        }, g.prototype.calcRepulsionRange = function() {
          return 2 * (this.level + 1) * this.idealEdgeLength;
        }, g.prototype.groupZeroDegreeMembers = function() {
          var n = this, u = {};
          this.memberGroups = {}, this.idToDummyNode = {};
          for (var l = [], v = this.graphManager.getAllNodes(), A = 0; A < v.length; A++) {
            var w = v[A], I = w.getParent();
            this.getNodeDegreeWithChildren(w) === 0 && (I.id == null || !this.getToBeTiled(I)) && l.push(w);
          }
          for (var A = 0; A < l.length; A++) {
            var w = l[A], C = w.getParent().id;
            typeof u[C] > "u" && (u[C] = []), u[C] = u[C].concat(w);
          }
          Object.keys(u).forEach(function(S) {
            if (u[S].length > 1) {
              var U = "DummyCompound_" + S;
              n.memberGroups[U] = u[S];
              var b = u[S][0].getParent(), M = new a(n.graphManager);
              M.id = U, M.paddingLeft = b.paddingLeft || 0, M.paddingRight = b.paddingRight || 0, M.paddingBottom = b.paddingBottom || 0, M.paddingTop = b.paddingTop || 0, n.idToDummyNode[U] = M;
              var G = n.getGraphManager().add(n.newGraph(), M), F = b.getChild();
              F.add(M);
              for (var k = 0; k < u[S].length; k++) {
                var Y = u[S][k];
                F.remove(Y), G.add(Y);
              }
            }
          });
        }, g.prototype.clearCompounds = function() {
          var n = {}, u = {};
          this.performDFSOnCompounds();
          for (var l = 0; l < this.compoundOrder.length; l++)
            u[this.compoundOrder[l].id] = this.compoundOrder[l], n[this.compoundOrder[l].id] = [].concat(this.compoundOrder[l].getChild().getNodes()), this.graphManager.remove(this.compoundOrder[l].getChild()), this.compoundOrder[l].child = null;
          this.graphManager.resetAllNodes(), this.tileCompoundMembers(n, u);
        }, g.prototype.clearZeroDegreeMembers = function() {
          var n = this, u = this.tiledZeroDegreePack = [];
          Object.keys(this.memberGroups).forEach(function(l) {
            var v = n.idToDummyNode[l];
            u[l] = n.tileNodes(n.memberGroups[l], v.paddingLeft + v.paddingRight), v.rect.width = u[l].width, v.rect.height = u[l].height;
          });
        }, g.prototype.repopulateCompounds = function() {
          for (var n = this.compoundOrder.length - 1; n >= 0; n--) {
            var u = this.compoundOrder[n], l = u.id, v = u.paddingLeft, A = u.paddingTop;
            this.adjustLocations(this.tiledMemberPack[l], u.rect.x, u.rect.y, v, A);
          }
        }, g.prototype.repopulateZeroDegreeMembers = function() {
          var n = this, u = this.tiledZeroDegreePack;
          Object.keys(u).forEach(function(l) {
            var v = n.idToDummyNode[l], A = v.paddingLeft, w = v.paddingTop;
            n.adjustLocations(u[l], v.rect.x, v.rect.y, A, w);
          });
        }, g.prototype.getToBeTiled = function(n) {
          var u = n.id;
          if (this.toBeTiled[u] != null)
            return this.toBeTiled[u];
          var l = n.getChild();
          if (l == null)
            return this.toBeTiled[u] = false, false;
          for (var v = l.getNodes(), A = 0; A < v.length; A++) {
            var w = v[A];
            if (this.getNodeDegree(w) > 0)
              return this.toBeTiled[u] = false, false;
            if (w.getChild() == null) {
              this.toBeTiled[w.id] = false;
              continue;
            }
            if (!this.getToBeTiled(w))
              return this.toBeTiled[u] = false, false;
          }
          return this.toBeTiled[u] = true, true;
        }, g.prototype.getNodeDegree = function(n) {
          n.id;
          for (var u = n.getEdges(), l = 0, v = 0; v < u.length; v++) {
            var A = u[v];
            A.getSource().id !== A.getTarget().id && (l = l + 1);
          }
          return l;
        }, g.prototype.getNodeDegreeWithChildren = function(n) {
          var u = this.getNodeDegree(n);
          if (n.getChild() == null)
            return u;
          for (var l = n.getChild().getNodes(), v = 0; v < l.length; v++) {
            var A = l[v];
            u += this.getNodeDegreeWithChildren(A);
          }
          return u;
        }, g.prototype.performDFSOnCompounds = function() {
          this.compoundOrder = [], this.fillCompexOrderByDFS(this.graphManager.getRoot().getNodes());
        }, g.prototype.fillCompexOrderByDFS = function(n) {
          for (var u = 0; u < n.length; u++) {
            var l = n[u];
            l.getChild() != null && this.fillCompexOrderByDFS(l.getChild().getNodes()), this.getToBeTiled(l) && this.compoundOrder.push(l);
          }
        }, g.prototype.adjustLocations = function(n, u, l, v, A) {
          u += v, l += A;
          for (var w = u, I = 0; I < n.rows.length; I++) {
            var C = n.rows[I];
            u = w;
            for (var S = 0, U = 0; U < C.length; U++) {
              var b = C[U];
              b.rect.x = u, b.rect.y = l, u += b.rect.width + n.horizontalPadding, b.rect.height > S && (S = b.rect.height);
            }
            l += S + n.verticalPadding;
          }
        }, g.prototype.tileCompoundMembers = function(n, u) {
          var l = this;
          this.tiledMemberPack = [], Object.keys(n).forEach(function(v) {
            var A = u[v];
            l.tiledMemberPack[v] = l.tileNodes(n[v], A.paddingLeft + A.paddingRight), A.rect.width = l.tiledMemberPack[v].width, A.rect.height = l.tiledMemberPack[v].height;
          });
        }, g.prototype.tileNodes = function(n, u) {
          var l = s.TILING_PADDING_VERTICAL, v = s.TILING_PADDING_HORIZONTAL, A = { rows: [], rowWidth: [], rowHeight: [], width: 0, height: u, verticalPadding: l, horizontalPadding: v };
          n.sort(function(C, S) {
            return C.rect.width * C.rect.height > S.rect.width * S.rect.height ? -1 : C.rect.width * C.rect.height < S.rect.width * S.rect.height ? 1 : 0;
          });
          for (var w = 0; w < n.length; w++) {
            var I = n[w];
            A.rows.length == 0 ? this.insertNodeToRow(A, I, 0, u) : this.canAddHorizontal(A, I.rect.width, I.rect.height) ? this.insertNodeToRow(A, I, this.getShortestRowIndex(A), u) : this.insertNodeToRow(A, I, A.rows.length, u), this.shiftToLastRow(A);
          }
          return A;
        }, g.prototype.insertNodeToRow = function(n, u, l, v) {
          var A = v;
          if (l == n.rows.length) {
            var w = [];
            n.rows.push(w), n.rowWidth.push(A), n.rowHeight.push(0);
          }
          var I = n.rowWidth[l] + u.rect.width;
          n.rows[l].length > 0 && (I += n.horizontalPadding), n.rowWidth[l] = I, n.width < I && (n.width = I);
          var C = u.rect.height;
          l > 0 && (C += n.verticalPadding);
          var S = 0;
          C > n.rowHeight[l] && (S = n.rowHeight[l], n.rowHeight[l] = C, S = n.rowHeight[l] - S), n.height += S, n.rows[l].push(u);
        }, g.prototype.getShortestRowIndex = function(n) {
          for (var u = -1, l = Number.MAX_VALUE, v = 0; v < n.rows.length; v++)
            n.rowWidth[v] < l && (u = v, l = n.rowWidth[v]);
          return u;
        }, g.prototype.getLongestRowIndex = function(n) {
          for (var u = -1, l = Number.MIN_VALUE, v = 0; v < n.rows.length; v++)
            n.rowWidth[v] > l && (u = v, l = n.rowWidth[v]);
          return u;
        }, g.prototype.canAddHorizontal = function(n, u, l) {
          var v = this.getShortestRowIndex(n);
          if (v < 0)
            return true;
          var A = n.rowWidth[v];
          if (A + n.horizontalPadding + u <= n.width)
            return true;
          var w = 0;
          n.rowHeight[v] < l && v > 0 && (w = l + n.verticalPadding - n.rowHeight[v]);
          var I;
          n.width - A >= u + n.horizontalPadding ? I = (n.height + w) / (A + u + n.horizontalPadding) : I = (n.height + w) / n.width, w = l + n.verticalPadding;
          var C;
          return n.width < u ? C = (n.height + w) / u : C = (n.height + w) / n.width, C < 1 && (C = 1 / C), I < 1 && (I = 1 / I), I < C;
        }, g.prototype.shiftToLastRow = function(n) {
          var u = this.getLongestRowIndex(n), l = n.rowWidth.length - 1, v = n.rows[u], A = v[v.length - 1], w = A.width + n.horizontalPadding;
          if (n.width - n.rowWidth[l] > w && u != l) {
            v.splice(-1, 1), n.rows[l].push(A), n.rowWidth[u] = n.rowWidth[u] - w, n.rowWidth[l] = n.rowWidth[l] + w, n.width = n.rowWidth[instance.getLongestRowIndex(n)];
            for (var I = Number.MIN_VALUE, C = 0; C < v.length; C++)
              v[C].height > I && (I = v[C].height);
            u > 0 && (I += n.verticalPadding);
            var S = n.rowHeight[u] + n.rowHeight[l];
            n.rowHeight[u] = I, n.rowHeight[l] < A.height + n.verticalPadding && (n.rowHeight[l] = A.height + n.verticalPadding);
            var U = n.rowHeight[u] + n.rowHeight[l];
            n.height += U - S, this.shiftToLastRow(n);
          }
        }, g.prototype.tilingPreLayout = function() {
          s.TILE && (this.groupZeroDegreeMembers(), this.clearCompounds(), this.clearZeroDegreeMembers());
        }, g.prototype.tilingPostLayout = function() {
          s.TILE && (this.repopulateZeroDegreeMembers(), this.repopulateCompounds());
        }, g.prototype.reduceTrees = function() {
          for (var n = [], u = true, l; u; ) {
            var v = this.graphManager.getAllNodes(), A = [];
            u = false;
            for (var w = 0; w < v.length; w++)
              l = v[w], l.getEdges().length == 1 && !l.getEdges()[0].isInterGraph && l.getChild() == null && (A.push([l, l.getEdges()[0], l.getOwner()]), u = true);
            if (u == true) {
              for (var I = [], C = 0; C < A.length; C++)
                A[C][0].getEdges().length == 1 && (I.push(A[C]), A[C][0].getOwner().remove(A[C][0]));
              n.push(I), this.graphManager.resetAllNodes(), this.graphManager.resetAllEdges();
            }
          }
          this.prunedNodesAll = n;
        }, g.prototype.growTree = function(n) {
          for (var u = n.length, l = n[u - 1], v, A = 0; A < l.length; A++)
            v = l[A], this.findPlaceforPrunedNode(v), v[2].add(v[0]), v[2].add(v[1], v[1].source, v[1].target);
          n.splice(n.length - 1, 1), this.graphManager.resetAllNodes(), this.graphManager.resetAllEdges();
        }, g.prototype.findPlaceforPrunedNode = function(n) {
          var u, l, v = n[0];
          v == n[1].source ? l = n[1].target : l = n[1].source;
          var A = l.startX, w = l.finishX, I = l.startY, C = l.finishY, S = 0, U = 0, b = 0, M = 0, G = [S, b, U, M];
          if (I > 0)
            for (var F = A; F <= w; F++)
              G[0] += this.grid[F][I - 1].length + this.grid[F][I].length - 1;
          if (w < this.grid.length - 1)
            for (var F = I; F <= C; F++)
              G[1] += this.grid[w + 1][F].length + this.grid[w][F].length - 1;
          if (C < this.grid[0].length - 1)
            for (var F = A; F <= w; F++)
              G[2] += this.grid[F][C + 1].length + this.grid[F][C].length - 1;
          if (A > 0)
            for (var F = I; F <= C; F++)
              G[3] += this.grid[A - 1][F].length + this.grid[A][F].length - 1;
          for (var k = _.MAX_VALUE, Y, X, P = 0; P < G.length; P++)
            G[P] < k ? (k = G[P], Y = 1, X = P) : G[P] == k && Y++;
          if (Y == 3 && k == 0)
            G[0] == 0 && G[1] == 0 && G[2] == 0 ? u = 1 : G[0] == 0 && G[1] == 0 && G[3] == 0 ? u = 0 : G[0] == 0 && G[2] == 0 && G[3] == 0 ? u = 3 : G[1] == 0 && G[2] == 0 && G[3] == 0 && (u = 2);
          else if (Y == 2 && k == 0) {
            var B = Math.floor(Math.random() * 2);
            G[0] == 0 && G[1] == 0 ? B == 0 ? u = 0 : u = 1 : G[0] == 0 && G[2] == 0 ? B == 0 ? u = 0 : u = 2 : G[0] == 0 && G[3] == 0 ? B == 0 ? u = 0 : u = 3 : G[1] == 0 && G[2] == 0 ? B == 0 ? u = 1 : u = 2 : G[1] == 0 && G[3] == 0 ? B == 0 ? u = 1 : u = 3 : B == 0 ? u = 2 : u = 3;
          } else if (Y == 4 && k == 0) {
            var B = Math.floor(Math.random() * 4);
            u = B;
          } else
            u = X;
          u == 0 ? v.setCenter(l.getCenterX(), l.getCenterY() - l.getHeight() / 2 - f.DEFAULT_EDGE_LENGTH - v.getHeight() / 2) : u == 1 ? v.setCenter(l.getCenterX() + l.getWidth() / 2 + f.DEFAULT_EDGE_LENGTH + v.getWidth() / 2, l.getCenterY()) : u == 2 ? v.setCenter(l.getCenterX(), l.getCenterY() + l.getHeight() / 2 + f.DEFAULT_EDGE_LENGTH + v.getHeight() / 2) : v.setCenter(l.getCenterX() - l.getWidth() / 2 - f.DEFAULT_EDGE_LENGTH - v.getWidth() / 2, l.getCenterY());
        }, T.exports = g;
      }, function(T, y, i) {
        var t = {};
        t.layoutBase = i(0), t.CoSEConstants = i(1), t.CoSEEdge = i(2), t.CoSEGraph = i(3), t.CoSEGraphManager = i(4), t.CoSELayout = i(6), t.CoSENode = i(5), T.exports = t;
      }]);
    });
  }(rt)), rt.exports;
}
var Gt = it.exports, dt;
function St() {
  return dt || (dt = 1, function(D, R) {
    (function(p, T) {
      D.exports = T(Mt());
    })(Gt, function(p) {
      return function(T) {
        var y = {};
        function i(t) {
          if (y[t])
            return y[t].exports;
          var e = y[t] = { i: t, l: false, exports: {} };
          return T[t].call(e.exports, e, e.exports, i), e.l = true, e.exports;
        }
        return i.m = T, i.c = y, i.i = function(t) {
          return t;
        }, i.d = function(t, e, r) {
          i.o(t, e) || Object.defineProperty(t, e, { configurable: false, enumerable: true, get: r });
        }, i.n = function(t) {
          var e = t && t.__esModule ? function() {
            return t.default;
          } : function() {
            return t;
          };
          return i.d(e, "a", e), e;
        }, i.o = function(t, e) {
          return Object.prototype.hasOwnProperty.call(t, e);
        }, i.p = "", i(i.s = 1);
      }([function(T, y) {
        T.exports = p;
      }, function(T, y, i) {
        var t = i(0).layoutBase.LayoutConstants, e = i(0).layoutBase.FDLayoutConstants, r = i(0).CoSEConstants, a = i(0).CoSELayout, h = i(0).CoSENode, s = i(0).layoutBase.PointD, f = i(0).layoutBase.DimensionD, o = { ready: function() {
        }, stop: function() {
        }, quality: "default", nodeDimensionsIncludeLabels: false, refresh: 30, fit: true, padding: 10, randomize: true, nodeRepulsion: 4500, idealEdgeLength: 50, edgeElasticity: 0.45, nestingFactor: 0.1, gravity: 0.25, numIter: 2500, tile: true, animate: "end", animationDuration: 500, tilingPaddingVertical: 10, tilingPaddingHorizontal: 10, gravityRangeCompound: 1.5, gravityCompound: 1, gravityRange: 3.8, initialEnergyOnIncremental: 0.5 };
        function d(m, N) {
          var L = {};
          for (var g in m)
            L[g] = m[g];
          for (var g in N)
            L[g] = N[g];
          return L;
        }
        function c(m) {
          this.options = d(o, m), E(this.options);
        }
        var E = function(m) {
          m.nodeRepulsion != null && (r.DEFAULT_REPULSION_STRENGTH = e.DEFAULT_REPULSION_STRENGTH = m.nodeRepulsion), m.idealEdgeLength != null && (r.DEFAULT_EDGE_LENGTH = e.DEFAULT_EDGE_LENGTH = m.idealEdgeLength), m.edgeElasticity != null && (r.DEFAULT_SPRING_STRENGTH = e.DEFAULT_SPRING_STRENGTH = m.edgeElasticity), m.nestingFactor != null && (r.PER_LEVEL_IDEAL_EDGE_LENGTH_FACTOR = e.PER_LEVEL_IDEAL_EDGE_LENGTH_FACTOR = m.nestingFactor), m.gravity != null && (r.DEFAULT_GRAVITY_STRENGTH = e.DEFAULT_GRAVITY_STRENGTH = m.gravity), m.numIter != null && (r.MAX_ITERATIONS = e.MAX_ITERATIONS = m.numIter), m.gravityRange != null && (r.DEFAULT_GRAVITY_RANGE_FACTOR = e.DEFAULT_GRAVITY_RANGE_FACTOR = m.gravityRange), m.gravityCompound != null && (r.DEFAULT_COMPOUND_GRAVITY_STRENGTH = e.DEFAULT_COMPOUND_GRAVITY_STRENGTH = m.gravityCompound), m.gravityRangeCompound != null && (r.DEFAULT_COMPOUND_GRAVITY_RANGE_FACTOR = e.DEFAULT_COMPOUND_GRAVITY_RANGE_FACTOR = m.gravityRangeCompound), m.initialEnergyOnIncremental != null && (r.DEFAULT_COOLING_FACTOR_INCREMENTAL = e.DEFAULT_COOLING_FACTOR_INCREMENTAL = m.initialEnergyOnIncremental), m.quality == "draft" ? t.QUALITY = 0 : m.quality == "proof" ? t.QUALITY = 2 : t.QUALITY = 1, r.NODE_DIMENSIONS_INCLUDE_LABELS = e.NODE_DIMENSIONS_INCLUDE_LABELS = t.NODE_DIMENSIONS_INCLUDE_LABELS = m.nodeDimensionsIncludeLabels, r.DEFAULT_INCREMENTAL = e.DEFAULT_INCREMENTAL = t.DEFAULT_INCREMENTAL = !m.randomize, r.ANIMATE = e.ANIMATE = t.ANIMATE = m.animate, r.TILE = m.tile, r.TILING_PADDING_VERTICAL = typeof m.tilingPaddingVertical == "function" ? m.tilingPaddingVertical.call() : m.tilingPaddingVertical, r.TILING_PADDING_HORIZONTAL = typeof m.tilingPaddingHorizontal == "function" ? m.tilingPaddingHorizontal.call() : m.tilingPaddingHorizontal;
        };
        c.prototype.run = function() {
          var m, N, L = this.options;
          this.idToLNode = {};
          var g = this.layout = new a(), O = this;
          O.stopped = false, this.cy = this.options.cy, this.cy.trigger({ type: "layoutstart", layout: this });
          var n = g.newGraphManager();
          this.gm = n;
          var u = this.options.eles.nodes(), l = this.options.eles.edges();
          this.root = n.addRoot(), this.processChildrenList(this.root, this.getTopMostNodes(u), g);
          for (var v = 0; v < l.length; v++) {
            var A = l[v], w = this.idToLNode[A.data("source")], I = this.idToLNode[A.data("target")];
            if (w !== I && w.getEdgesBetween(I).length == 0) {
              var C = n.add(g.newEdge(), w, I);
              C.id = A.id();
            }
          }
          var S = function(b, M) {
            typeof b == "number" && (b = M);
            var G = b.data("id"), F = O.idToLNode[G];
            return { x: F.getRect().getCenterX(), y: F.getRect().getCenterY() };
          }, U = function b() {
            for (var M = function() {
              L.fit && L.cy.fit(L.eles, L.padding), m || (m = true, O.cy.one("layoutready", L.ready), O.cy.trigger({ type: "layoutready", layout: O }));
            }, G = O.options.refresh, F, k = 0; k < G && !F; k++)
              F = O.stopped || O.layout.tick();
            if (F) {
              g.checkLayoutSuccess() && !g.isSubLayout && g.doPostLayout(), g.tilingPostLayout && g.tilingPostLayout(), g.isLayoutFinished = true, O.options.eles.nodes().positions(S), M(), O.cy.one("layoutstop", O.options.stop), O.cy.trigger({ type: "layoutstop", layout: O }), N && cancelAnimationFrame(N), m = false;
              return;
            }
            var Y = O.layout.getPositionsData();
            L.eles.nodes().positions(function(X, P) {
              if (typeof X == "number" && (X = P), !X.isParent()) {
                for (var B = X.id(), $ = Y[B], W = X; $ == null && ($ = Y[W.data("parent")] || Y["DummyCompound_" + W.data("parent")], Y[B] = $, W = W.parent()[0], W != null); )
                  ;
                return $ != null ? { x: $.x, y: $.y } : { x: X.position("x"), y: X.position("y") };
              }
            }), M(), N = requestAnimationFrame(b);
          };
          return g.addListener("layoutstarted", function() {
            O.options.animate === "during" && (N = requestAnimationFrame(U));
          }), g.runLayout(), this.options.animate !== "during" && (O.options.eles.nodes().not(":parent").layoutPositions(O, O.options, S), m = false), this;
        }, c.prototype.getTopMostNodes = function(m) {
          for (var N = {}, L = 0; L < m.length; L++)
            N[m[L].id()] = true;
          var g = m.filter(function(O, n) {
            typeof O == "number" && (O = n);
            for (var u = O.parent()[0]; u != null; ) {
              if (N[u.id()])
                return false;
              u = u.parent()[0];
            }
            return true;
          });
          return g;
        }, c.prototype.processChildrenList = function(m, N, L) {
          for (var g = N.length, O = 0; O < g; O++) {
            var n = N[O], u = n.children(), l, v = n.layoutDimensions({ nodeDimensionsIncludeLabels: this.options.nodeDimensionsIncludeLabels });
            if (n.outerWidth() != null && n.outerHeight() != null ? l = m.add(new h(L.graphManager, new s(n.position("x") - v.w / 2, n.position("y") - v.h / 2), new f(parseFloat(v.w), parseFloat(v.h)))) : l = m.add(new h(this.graphManager)), l.id = n.data("id"), l.paddingLeft = parseInt(n.css("padding")), l.paddingTop = parseInt(n.css("padding")), l.paddingRight = parseInt(n.css("padding")), l.paddingBottom = parseInt(n.css("padding")), this.options.nodeDimensionsIncludeLabels && n.isParent()) {
              var A = n.boundingBox({ includeLabels: true, includeNodes: false }).w, w = n.boundingBox({ includeLabels: true, includeNodes: false }).h, I = n.css("text-halign");
              l.labelWidth = A, l.labelHeight = w, l.labelPos = I;
            }
            if (this.idToLNode[n.data("id")] = l, isNaN(l.rect.x) && (l.rect.x = 0), isNaN(l.rect.y) && (l.rect.y = 0), u != null && u.length > 0) {
              var C;
              C = L.getGraphManager().add(L.newGraph(), l), this.processChildrenList(C, u, L);
            }
          }
        }, c.prototype.stop = function() {
          return this.stopped = true, this;
        };
        var _ = function(m) {
          m("layout", "cose-bilkent", c);
        };
        typeof cytoscape < "u" && _(cytoscape), T.exports = _;
      }]);
    });
  }(it)), it.exports;
}
var bt = St();
const Ft = wt(bt);
var ot = function() {
  var D = x(function(L, g, O, n) {
    for (O = O || {}, n = L.length; n--; O[L[n]] = g)
      ;
    return O;
  }, "o"), R = [1, 4], p = [1, 13], T = [1, 12], y = [1, 15], i = [1, 16], t = [1, 20], e = [1, 19], r = [6, 7, 8], a = [1, 26], h = [1, 24], s = [1, 25], f = [6, 7, 11], o = [1, 6, 13, 15, 16, 19, 22], d = [1, 33], c = [1, 34], E = [1, 6, 7, 11, 13, 15, 16, 19, 22], _ = { trace: x(function() {
  }, "trace"), yy: {}, symbols_: { error: 2, start: 3, mindMap: 4, spaceLines: 5, SPACELINE: 6, NL: 7, MINDMAP: 8, document: 9, stop: 10, EOF: 11, statement: 12, SPACELIST: 13, node: 14, ICON: 15, CLASS: 16, nodeWithId: 17, nodeWithoutId: 18, NODE_DSTART: 19, NODE_DESCR: 20, NODE_DEND: 21, NODE_ID: 22, $accept: 0, $end: 1 }, terminals_: { 2: "error", 6: "SPACELINE", 7: "NL", 8: "MINDMAP", 11: "EOF", 13: "SPACELIST", 15: "ICON", 16: "CLASS", 19: "NODE_DSTART", 20: "NODE_DESCR", 21: "NODE_DEND", 22: "NODE_ID" }, productions_: [0, [3, 1], [3, 2], [5, 1], [5, 2], [5, 2], [4, 2], [4, 3], [10, 1], [10, 1], [10, 1], [10, 2], [10, 2], [9, 3], [9, 2], [12, 2], [12, 2], [12, 2], [12, 1], [12, 1], [12, 1], [12, 1], [12, 1], [14, 1], [14, 1], [18, 3], [17, 1], [17, 4]], performAction: x(function(L, g, O, n, u, l, v) {
    var A = l.length - 1;
    switch (u) {
      case 6:
      case 7:
        return n;
      case 8:
        n.getLogger().trace("Stop NL ");
        break;
      case 9:
        n.getLogger().trace("Stop EOF ");
        break;
      case 11:
        n.getLogger().trace("Stop NL2 ");
        break;
      case 12:
        n.getLogger().trace("Stop EOF2 ");
        break;
      case 15:
        n.getLogger().info("Node: ", l[A].id), n.addNode(l[A - 1].length, l[A].id, l[A].descr, l[A].type);
        break;
      case 16:
        n.getLogger().trace("Icon: ", l[A]), n.decorateNode({ icon: l[A] });
        break;
      case 17:
      case 21:
        n.decorateNode({ class: l[A] });
        break;
      case 18:
        n.getLogger().trace("SPACELIST");
        break;
      case 19:
        n.getLogger().trace("Node: ", l[A].id), n.addNode(0, l[A].id, l[A].descr, l[A].type);
        break;
      case 20:
        n.decorateNode({ icon: l[A] });
        break;
      case 25:
        n.getLogger().trace("node found ..", l[A - 2]), this.$ = { id: l[A - 1], descr: l[A - 1], type: n.getType(l[A - 2], l[A]) };
        break;
      case 26:
        this.$ = { id: l[A], descr: l[A], type: n.nodeType.DEFAULT };
        break;
      case 27:
        n.getLogger().trace("node found ..", l[A - 3]), this.$ = { id: l[A - 3], descr: l[A - 1], type: n.getType(l[A - 2], l[A]) };
        break;
    }
  }, "anonymous"), table: [{ 3: 1, 4: 2, 5: 3, 6: [1, 5], 8: R }, { 1: [3] }, { 1: [2, 1] }, { 4: 6, 6: [1, 7], 7: [1, 8], 8: R }, { 6: p, 7: [1, 10], 9: 9, 12: 11, 13: T, 14: 14, 15: y, 16: i, 17: 17, 18: 18, 19: t, 22: e }, D(r, [2, 3]), { 1: [2, 2] }, D(r, [2, 4]), D(r, [2, 5]), { 1: [2, 6], 6: p, 12: 21, 13: T, 14: 14, 15: y, 16: i, 17: 17, 18: 18, 19: t, 22: e }, { 6: p, 9: 22, 12: 11, 13: T, 14: 14, 15: y, 16: i, 17: 17, 18: 18, 19: t, 22: e }, { 6: a, 7: h, 10: 23, 11: s }, D(f, [2, 22], { 17: 17, 18: 18, 14: 27, 15: [1, 28], 16: [1, 29], 19: t, 22: e }), D(f, [2, 18]), D(f, [2, 19]), D(f, [2, 20]), D(f, [2, 21]), D(f, [2, 23]), D(f, [2, 24]), D(f, [2, 26], { 19: [1, 30] }), { 20: [1, 31] }, { 6: a, 7: h, 10: 32, 11: s }, { 1: [2, 7], 6: p, 12: 21, 13: T, 14: 14, 15: y, 16: i, 17: 17, 18: 18, 19: t, 22: e }, D(o, [2, 14], { 7: d, 11: c }), D(E, [2, 8]), D(E, [2, 9]), D(E, [2, 10]), D(f, [2, 15]), D(f, [2, 16]), D(f, [2, 17]), { 20: [1, 35] }, { 21: [1, 36] }, D(o, [2, 13], { 7: d, 11: c }), D(E, [2, 11]), D(E, [2, 12]), { 21: [1, 37] }, D(f, [2, 25]), D(f, [2, 27])], defaultActions: { 2: [2, 1], 6: [2, 2] }, parseError: x(function(L, g) {
    if (g.recoverable)
      this.trace(L);
    else {
      var O = new Error(L);
      throw O.hash = g, O;
    }
  }, "parseError"), parse: x(function(L) {
    var g = this, O = [0], n = [], u = [null], l = [], v = this.table, A = "", w = 0, I = 0, C = 2, S = 1, U = l.slice.call(arguments, 1), b = Object.create(this.lexer), M = { yy: {} };
    for (var G in this.yy)
      Object.prototype.hasOwnProperty.call(this.yy, G) && (M.yy[G] = this.yy[G]);
    b.setInput(L, M.yy), M.yy.lexer = b, M.yy.parser = this, typeof b.yylloc > "u" && (b.yylloc = {});
    var F = b.yylloc;
    l.push(F);
    var k = b.options && b.options.ranges;
    typeof M.yy.parseError == "function" ? this.parseError = M.yy.parseError : this.parseError = Object.getPrototypeOf(this).parseError;
    function Y(V) {
      O.length = O.length - 2 * V, u.length = u.length - V, l.length = l.length - V;
    }
    x(Y, "popStack");
    function X() {
      var V;
      return V = n.pop() || b.lex() || S, typeof V != "number" && (V instanceof Array && (n = V, V = n.pop()), V = g.symbols_[V] || V), V;
    }
    x(X, "lex");
    for (var P, B, $, W, q = {}, Z, j, ct, K; ; ) {
      if (B = O[O.length - 1], this.defaultActions[B] ? $ = this.defaultActions[B] : ((P === null || typeof P > "u") && (P = X()), $ = v[B] && v[B][P]), typeof $ > "u" || !$.length || !$[0]) {
        var et = "";
        K = [];
        for (Z in v[B])
          this.terminals_[Z] && Z > C && K.push("'" + this.terminals_[Z] + "'");
        b.showPosition ? et = "Parse error on line " + (w + 1) + `:
` + b.showPosition() + `
Expecting ` + K.join(", ") + ", got '" + (this.terminals_[P] || P) + "'" : et = "Parse error on line " + (w + 1) + ": Unexpected " + (P == S ? "end of input" : "'" + (this.terminals_[P] || P) + "'"), this.parseError(et, { text: b.match, token: this.terminals_[P] || P, line: b.yylineno, loc: F, expected: K });
      }
      if ($[0] instanceof Array && $.length > 1)
        throw new Error("Parse Error: multiple actions possible at state: " + B + ", token: " + P);
      switch ($[0]) {
        case 1:
          O.push(P), u.push(b.yytext), l.push(b.yylloc), O.push($[1]), P = null, I = b.yyleng, A = b.yytext, w = b.yylineno, F = b.yylloc;
          break;
        case 2:
          if (j = this.productions_[$[1]][1], q.$ = u[u.length - j], q._$ = { first_line: l[l.length - (j || 1)].first_line, last_line: l[l.length - 1].last_line, first_column: l[l.length - (j || 1)].first_column, last_column: l[l.length - 1].last_column }, k && (q._$.range = [l[l.length - (j || 1)].range[0], l[l.length - 1].range[1]]), W = this.performAction.apply(q, [A, I, w, M.yy, $[1], u, l].concat(U)), typeof W < "u")
            return W;
          j && (O = O.slice(0, -1 * j * 2), u = u.slice(0, -1 * j), l = l.slice(0, -1 * j)), O.push(this.productions_[$[1]][0]), u.push(q.$), l.push(q._$), ct = v[O[O.length - 2]][O[O.length - 1]], O.push(ct);
          break;
        case 3:
          return true;
      }
    }
    return true;
  }, "parse") }, m = function() {
    var L = { EOF: 1, parseError: x(function(g, O) {
      if (this.yy.parser)
        this.yy.parser.parseError(g, O);
      else
        throw new Error(g);
    }, "parseError"), setInput: x(function(g, O) {
      return this.yy = O || this.yy || {}, this._input = g, this._more = this._backtrack = this.done = false, this.yylineno = this.yyleng = 0, this.yytext = this.matched = this.match = "", this.conditionStack = ["INITIAL"], this.yylloc = { first_line: 1, first_column: 0, last_line: 1, last_column: 0 }, this.options.ranges && (this.yylloc.range = [0, 0]), this.offset = 0, this;
    }, "setInput"), input: x(function() {
      var g = this._input[0];
      this.yytext += g, this.yyleng++, this.offset++, this.match += g, this.matched += g;
      var O = g.match(/(?:\r\n?|\n).*/g);
      return O ? (this.yylineno++, this.yylloc.last_line++) : this.yylloc.last_column++, this.options.ranges && this.yylloc.range[1]++, this._input = this._input.slice(1), g;
    }, "input"), unput: x(function(g) {
      var O = g.length, n = g.split(/(?:\r\n?|\n)/g);
      this._input = g + this._input, this.yytext = this.yytext.substr(0, this.yytext.length - O), this.offset -= O;
      var u = this.match.split(/(?:\r\n?|\n)/g);
      this.match = this.match.substr(0, this.match.length - 1), this.matched = this.matched.substr(0, this.matched.length - 1), n.length - 1 && (this.yylineno -= n.length - 1);
      var l = this.yylloc.range;
      return this.yylloc = { first_line: this.yylloc.first_line, last_line: this.yylineno + 1, first_column: this.yylloc.first_column, last_column: n ? (n.length === u.length ? this.yylloc.first_column : 0) + u[u.length - n.length].length - n[0].length : this.yylloc.first_column - O }, this.options.ranges && (this.yylloc.range = [l[0], l[0] + this.yyleng - O]), this.yyleng = this.yytext.length, this;
    }, "unput"), more: x(function() {
      return this._more = true, this;
    }, "more"), reject: x(function() {
      if (this.options.backtrack_lexer)
        this._backtrack = true;
      else
        return this.parseError("Lexical error on line " + (this.yylineno + 1) + `. You can only invoke reject() in the lexer when the lexer is of the backtracking persuasion (options.backtrack_lexer = true).
` + this.showPosition(), { text: "", token: null, line: this.yylineno });
      return this;
    }, "reject"), less: x(function(g) {
      this.unput(this.match.slice(g));
    }, "less"), pastInput: x(function() {
      var g = this.matched.substr(0, this.matched.length - this.match.length);
      return (g.length > 20 ? "..." : "") + g.substr(-20).replace(/\n/g, "");
    }, "pastInput"), upcomingInput: x(function() {
      var g = this.match;
      return g.length < 20 && (g += this._input.substr(0, 20 - g.length)), (g.substr(0, 20) + (g.length > 20 ? "..." : "")).replace(/\n/g, "");
    }, "upcomingInput"), showPosition: x(function() {
      var g = this.pastInput(), O = new Array(g.length + 1).join("-");
      return g + this.upcomingInput() + `
` + O + "^";
    }, "showPosition"), test_match: x(function(g, O) {
      var n, u, l;
      if (this.options.backtrack_lexer && (l = { yylineno: this.yylineno, yylloc: { first_line: this.yylloc.first_line, last_line: this.last_line, first_column: this.yylloc.first_column, last_column: this.yylloc.last_column }, yytext: this.yytext, match: this.match, matches: this.matches, matched: this.matched, yyleng: this.yyleng, offset: this.offset, _more: this._more, _input: this._input, yy: this.yy, conditionStack: this.conditionStack.slice(0), done: this.done }, this.options.ranges && (l.yylloc.range = this.yylloc.range.slice(0))), u = g[0].match(/(?:\r\n?|\n).*/g), u && (this.yylineno += u.length), this.yylloc = { first_line: this.yylloc.last_line, last_line: this.yylineno + 1, first_column: this.yylloc.last_column, last_column: u ? u[u.length - 1].length - u[u.length - 1].match(/\r?\n?/)[0].length : this.yylloc.last_column + g[0].length }, this.yytext += g[0], this.match += g[0], this.matches = g, this.yyleng = this.yytext.length, this.options.ranges && (this.yylloc.range = [this.offset, this.offset += this.yyleng]), this._more = false, this._backtrack = false, this._input = this._input.slice(g[0].length), this.matched += g[0], n = this.performAction.call(this, this.yy, this, O, this.conditionStack[this.conditionStack.length - 1]), this.done && this._input && (this.done = false), n)
        return n;
      if (this._backtrack) {
        for (var v in l)
          this[v] = l[v];
        return false;
      }
      return false;
    }, "test_match"), next: x(function() {
      if (this.done)
        return this.EOF;
      this._input || (this.done = true);
      var g, O, n, u;
      this._more || (this.yytext = "", this.match = "");
      for (var l = this._currentRules(), v = 0; v < l.length; v++)
        if (n = this._input.match(this.rules[l[v]]), n && (!O || n[0].length > O[0].length)) {
          if (O = n, u = v, this.options.backtrack_lexer) {
            if (g = this.test_match(n, l[v]), g !== false)
              return g;
            if (this._backtrack) {
              O = false;
              continue;
            } else
              return false;
          } else if (!this.options.flex)
            break;
        }
      return O ? (g = this.test_match(O, l[u]), g !== false ? g : false) : this._input === "" ? this.EOF : this.parseError("Lexical error on line " + (this.yylineno + 1) + `. Unrecognized text.
` + this.showPosition(), { text: "", token: null, line: this.yylineno });
    }, "next"), lex: x(function() {
      var g = this.next();
      return g || this.lex();
    }, "lex"), begin: x(function(g) {
      this.conditionStack.push(g);
    }, "begin"), popState: x(function() {
      var g = this.conditionStack.length - 1;
      return g > 0 ? this.conditionStack.pop() : this.conditionStack[0];
    }, "popState"), _currentRules: x(function() {
      return this.conditionStack.length && this.conditionStack[this.conditionStack.length - 1] ? this.conditions[this.conditionStack[this.conditionStack.length - 1]].rules : this.conditions.INITIAL.rules;
    }, "_currentRules"), topState: x(function(g) {
      return g = this.conditionStack.length - 1 - Math.abs(g || 0), g >= 0 ? this.conditionStack[g] : "INITIAL";
    }, "topState"), pushState: x(function(g) {
      this.begin(g);
    }, "pushState"), stateStackSize: x(function() {
      return this.conditionStack.length;
    }, "stateStackSize"), options: { "case-insensitive": true }, performAction: x(function(g, O, n, u) {
      switch (n) {
        case 0:
          return g.getLogger().trace("Found comment", O.yytext), 6;
        case 1:
          return 8;
        case 2:
          this.begin("CLASS");
          break;
        case 3:
          return this.popState(), 16;
        case 4:
          this.popState();
          break;
        case 5:
          g.getLogger().trace("Begin icon"), this.begin("ICON");
          break;
        case 6:
          return g.getLogger().trace("SPACELINE"), 6;
        case 7:
          return 7;
        case 8:
          return 15;
        case 9:
          g.getLogger().trace("end icon"), this.popState();
          break;
        case 10:
          return g.getLogger().trace("Exploding node"), this.begin("NODE"), 19;
        case 11:
          return g.getLogger().trace("Cloud"), this.begin("NODE"), 19;
        case 12:
          return g.getLogger().trace("Explosion Bang"), this.begin("NODE"), 19;
        case 13:
          return g.getLogger().trace("Cloud Bang"), this.begin("NODE"), 19;
        case 14:
          return this.begin("NODE"), 19;
        case 15:
          return this.begin("NODE"), 19;
        case 16:
          return this.begin("NODE"), 19;
        case 17:
          return this.begin("NODE"), 19;
        case 18:
          return 13;
        case 19:
          return 22;
        case 20:
          return 11;
        case 21:
          this.begin("NSTR2");
          break;
        case 22:
          return "NODE_DESCR";
        case 23:
          this.popState();
          break;
        case 24:
          g.getLogger().trace("Starting NSTR"), this.begin("NSTR");
          break;
        case 25:
          return g.getLogger().trace("description:", O.yytext), "NODE_DESCR";
        case 26:
          this.popState();
          break;
        case 27:
          return this.popState(), g.getLogger().trace("node end ))"), "NODE_DEND";
        case 28:
          return this.popState(), g.getLogger().trace("node end )"), "NODE_DEND";
        case 29:
          return this.popState(), g.getLogger().trace("node end ...", O.yytext), "NODE_DEND";
        case 30:
          return this.popState(), g.getLogger().trace("node end (("), "NODE_DEND";
        case 31:
          return this.popState(), g.getLogger().trace("node end (-"), "NODE_DEND";
        case 32:
          return this.popState(), g.getLogger().trace("node end (-"), "NODE_DEND";
        case 33:
          return this.popState(), g.getLogger().trace("node end (("), "NODE_DEND";
        case 34:
          return this.popState(), g.getLogger().trace("node end (("), "NODE_DEND";
        case 35:
          return g.getLogger().trace("Long description:", O.yytext), 20;
        case 36:
          return g.getLogger().trace("Long description:", O.yytext), 20;
      }
    }, "anonymous"), rules: [/^(?:\s*%%.*)/i, /^(?:mindmap\b)/i, /^(?::::)/i, /^(?:.+)/i, /^(?:\n)/i, /^(?:::icon\()/i, /^(?:[\s]+[\n])/i, /^(?:[\n]+)/i, /^(?:[^\)]+)/i, /^(?:\))/i, /^(?:-\))/i, /^(?:\(-)/i, /^(?:\)\))/i, /^(?:\))/i, /^(?:\(\()/i, /^(?:\{\{)/i, /^(?:\()/i, /^(?:\[)/i, /^(?:[\s]+)/i, /^(?:[^\(\[\n\)\{\}]+)/i, /^(?:$)/i, /^(?:["][`])/i, /^(?:[^`"]+)/i, /^(?:[`]["])/i, /^(?:["])/i, /^(?:[^"]+)/i, /^(?:["])/i, /^(?:[\)]\))/i, /^(?:[\)])/i, /^(?:[\]])/i, /^(?:\}\})/i, /^(?:\(-)/i, /^(?:-\))/i, /^(?:\(\()/i, /^(?:\()/i, /^(?:[^\)\]\(\}]+)/i, /^(?:.+(?!\(\())/i], conditions: { CLASS: { rules: [3, 4], inclusive: false }, ICON: { rules: [8, 9], inclusive: false }, NSTR2: { rules: [22, 23], inclusive: false }, NSTR: { rules: [25, 26], inclusive: false }, NODE: { rules: [21, 24, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36], inclusive: false }, INITIAL: { rules: [0, 1, 2, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], inclusive: true } } };
    return L;
  }();
  _.lexer = m;
  function N() {
    this.yy = {};
  }
  return x(N, "Parser"), N.prototype = _, _.Parser = N, new N();
}();
ot.parser = ot;
var Pt = ot, z = [], ft = 0, at = {}, Ut = x(() => {
  z = [], ft = 0, at = {};
}, "clear"), kt = x(function(D) {
  for (let R = z.length - 1; R >= 0; R--)
    if (z[R].level < D)
      return z[R];
  return null;
}, "getParent"), Yt = x(() => z.length > 0 ? z[0] : null, "getMindmap"), Xt = x((D, R, p, T) => {
  var y, i;
  Q.info("addNode", D, R, p, T);
  const t = st();
  let e = ((y = t.mindmap) == null ? void 0 : y.padding) ?? J.mindmap.padding;
  switch (T) {
    case H.ROUNDED_RECT:
    case H.RECT:
    case H.HEXAGON:
      e *= 2;
  }
  const r = { id: ft++, nodeId: tt(R, t), level: D, descr: tt(p, t), type: T, children: [], width: ((i = t.mindmap) == null ? void 0 : i.maxNodeWidth) ?? J.mindmap.maxNodeWidth, padding: e }, a = kt(D);
  if (a)
    a.children.push(r), z.push(r);
  else if (z.length === 0)
    z.push(r);
  else
    throw new Error('There can be only one root. No parent could be found for ("' + r.descr + '")');
}, "addNode"), H = { DEFAULT: 0, NO_BORDER: 0, ROUNDED_RECT: 1, RECT: 2, CIRCLE: 3, CLOUD: 4, BANG: 5, HEXAGON: 6 }, Bt = x((D, R) => {
  switch (Q.debug("In get type", D, R), D) {
    case "[":
      return H.RECT;
    case "(":
      return R === ")" ? H.ROUNDED_RECT : H.CLOUD;
    case "((":
      return H.CIRCLE;
    case ")":
      return H.CLOUD;
    case "))":
      return H.BANG;
    case "{{":
      return H.HEXAGON;
    default:
      return H.DEFAULT;
  }
}, "getType"), $t = x((D, R) => {
  at[D] = R;
}, "setElementForId"), Ht = x((D) => {
  if (!D)
    return;
  const R = st(), p = z[z.length - 1];
  D.icon && (p.icon = tt(D.icon, R)), D.class && (p.class = tt(D.class, R));
}, "decorateNode"), Wt = x((D) => {
  switch (D) {
    case H.DEFAULT:
      return "no-border";
    case H.RECT:
      return "rect";
    case H.ROUNDED_RECT:
      return "rounded-rect";
    case H.CIRCLE:
      return "circle";
    case H.CLOUD:
      return "cloud";
    case H.BANG:
      return "bang";
    case H.HEXAGON:
      return "hexgon";
    default:
      return "no-border";
  }
}, "type2Str"), Vt = x(() => Q, "getLogger"), jt = x((D) => at[D], "getElementById"), zt = { clear: Ut, addNode: Xt, getMindmap: Yt, nodeType: H, getType: Bt, setElementForId: $t, decorateNode: Ht, type2Str: Wt, getLogger: Vt, getElementById: jt }, qt = zt, Zt = 12, Qt = x(function(D, R, p, T) {
  R.append("path").attr("id", "node-" + p.id).attr("class", "node-bkg node-" + D.type2Str(p.type)).attr("d", `M0 ${p.height - 5} v${-p.height + 2 * 5} q0,-5 5,-5 h${p.width - 2 * 5} q5,0 5,5 v${p.height - 5} H0 Z`), R.append("line").attr("class", "node-line-" + T).attr("x1", 0).attr("y1", p.height).attr("x2", p.width).attr("y2", p.height);
}, "defaultBkg"), Kt = x(function(D, R, p) {
  R.append("rect").attr("id", "node-" + p.id).attr("class", "node-bkg node-" + D.type2Str(p.type)).attr("height", p.height).attr("width", p.width);
}, "rectBkg"), Jt = x(function(D, R, p) {
  const T = p.width, y = p.height, i = 0.15 * T, t = 0.25 * T, e = 0.35 * T, r = 0.2 * T;
  R.append("path").attr("id", "node-" + p.id).attr("class", "node-bkg node-" + D.type2Str(p.type)).attr("d", `M0 0 a${i},${i} 0 0,1 ${T * 0.25},${-1 * T * 0.1}
      a${e},${e} 1 0,1 ${T * 0.4},${-1 * T * 0.1}
      a${t},${t} 1 0,1 ${T * 0.35},${1 * T * 0.2}

      a${i},${i} 1 0,1 ${T * 0.15},${1 * y * 0.35}
      a${r},${r} 1 0,1 ${-1 * T * 0.15},${1 * y * 0.65}

      a${t},${i} 1 0,1 ${-1 * T * 0.25},${T * 0.15}
      a${e},${e} 1 0,1 ${-1 * T * 0.5},0
      a${i},${i} 1 0,1 ${-1 * T * 0.25},${-1 * T * 0.15}

      a${i},${i} 1 0,1 ${-1 * T * 0.1},${-1 * y * 0.35}
      a${r},${r} 1 0,1 ${T * 0.1},${-1 * y * 0.65}

    H0 V0 Z`);
}, "cloudBkg"), te = x(function(D, R, p) {
  const T = p.width, y = p.height, i = 0.15 * T;
  R.append("path").attr("id", "node-" + p.id).attr("class", "node-bkg node-" + D.type2Str(p.type)).attr("d", `M0 0 a${i},${i} 1 0,0 ${T * 0.25},${-1 * y * 0.1}
      a${i},${i} 1 0,0 ${T * 0.25},0
      a${i},${i} 1 0,0 ${T * 0.25},0
      a${i},${i} 1 0,0 ${T * 0.25},${1 * y * 0.1}

      a${i},${i} 1 0,0 ${T * 0.15},${1 * y * 0.33}
      a${i * 0.8},${i * 0.8} 1 0,0 0,${1 * y * 0.34}
      a${i},${i} 1 0,0 ${-1 * T * 0.15},${1 * y * 0.33}

      a${i},${i} 1 0,0 ${-1 * T * 0.25},${y * 0.15}
      a${i},${i} 1 0,0 ${-1 * T * 0.25},0
      a${i},${i} 1 0,0 ${-1 * T * 0.25},0
      a${i},${i} 1 0,0 ${-1 * T * 0.25},${-1 * y * 0.15}

      a${i},${i} 1 0,0 ${-1 * T * 0.1},${-1 * y * 0.33}
      a${i * 0.8},${i * 0.8} 1 0,0 0,${-1 * y * 0.34}
      a${i},${i} 1 0,0 ${T * 0.1},${-1 * y * 0.33}

    H0 V0 Z`);
}, "bangBkg"), ee = x(function(D, R, p) {
  R.append("circle").attr("id", "node-" + p.id).attr("class", "node-bkg node-" + D.type2Str(p.type)).attr("r", p.width / 2);
}, "circleBkg");
function yt(D, R, p, T, y) {
  return D.insert("polygon", ":first-child").attr("points", T.map(function(i) {
    return i.x + "," + i.y;
  }).join(" ")).attr("transform", "translate(" + (y.width - R) / 2 + ", " + p + ")");
}
x(yt, "insertPolygonShape");
var ie = x(function(D, R, p) {
  const T = p.height, y = T / 4, i = p.width - p.padding + 2 * y, t = [{ x: y, y: 0 }, { x: i - y, y: 0 }, { x: i, y: -T / 2 }, { x: i - y, y: -T }, { x: y, y: -T }, { x: 0, y: -T / 2 }];
  yt(R, i, T, t, p);
}, "hexagonBkg"), re = x(function(D, R, p) {
  R.append("rect").attr("id", "node-" + p.id).attr("class", "node-bkg node-" + D.type2Str(p.type)).attr("height", p.height).attr("rx", p.padding).attr("ry", p.padding).attr("width", p.width);
}, "roundedRectBkg"), ne = x(async function(D, R, p, T, y) {
  const i = y.htmlLabels, t = T % (Zt - 1), e = R.append("g");
  p.section = t;
  let r = "section-" + t;
  t < 0 && (r += " section-root"), e.attr("class", (p.class ? p.class + " " : "") + "mindmap-node " + r);
  const a = e.append("g"), h = e.append("g"), s = p.descr.replace(/(<br\/*>)/g, `
`);
  await _t(h, s, { useHtmlLabels: i, width: p.width, classes: "mindmap-node-label" }, y), i || h.attr("dy", "1em").attr("alignment-baseline", "middle").attr("dominant-baseline", "middle").attr("text-anchor", "middle");
  const f = h.node().getBBox(), [o] = Nt(y.fontSize);
  if (p.height = f.height + o * 1.1 * 0.5 + p.padding, p.width = f.width + 2 * p.padding, p.icon)
    if (p.type === D.nodeType.CIRCLE)
      p.height += 50, p.width += 50, e.append("foreignObject").attr("height", "50px").attr("width", p.width).attr("style", "text-align: center;").append("div").attr("class", "icon-container").append("i").attr("class", "node-icon-" + t + " " + p.icon), h.attr("transform", "translate(" + p.width / 2 + ", " + (p.height / 2 - 1.5 * p.padding) + ")");
    else {
      p.width += 50;
      const d = p.height;
      p.height = Math.max(d, 60);
      const c = Math.abs(p.height - d);
      e.append("foreignObject").attr("width", "60px").attr("height", p.height).attr("style", "text-align: center;margin-top:" + c / 2 + "px;").append("div").attr("class", "icon-container").append("i").attr("class", "node-icon-" + t + " " + p.icon), h.attr("transform", "translate(" + (25 + p.width / 2) + ", " + (c / 2 + p.padding / 2) + ")");
    }
  else if (i) {
    const d = (p.width - f.width) / 2, c = (p.height - f.height) / 2;
    h.attr("transform", "translate(" + d + ", " + c + ")");
  } else {
    const d = p.width / 2, c = p.padding / 2;
    h.attr("transform", "translate(" + d + ", " + c + ")");
  }
  switch (p.type) {
    case D.nodeType.DEFAULT:
      Qt(D, a, p, t);
      break;
    case D.nodeType.ROUNDED_RECT:
      re(D, a, p, t);
      break;
    case D.nodeType.RECT:
      Kt(D, a, p, t);
      break;
    case D.nodeType.CIRCLE:
      a.attr("transform", "translate(" + p.width / 2 + ", " + +p.height / 2 + ")"), ee(D, a, p, t);
      break;
    case D.nodeType.CLOUD:
      Jt(D, a, p, t);
      break;
    case D.nodeType.BANG:
      te(D, a, p, t);
      break;
    case D.nodeType.HEXAGON:
      ie(D, a, p, t);
      break;
  }
  return D.setElementForId(p.id, e), p.height;
}, "drawNode"), oe = x(function(D, R) {
  const p = D.getElementById(R.id), T = R.x || 0, y = R.y || 0;
  p.attr("transform", "translate(" + T + "," + y + ")");
}, "positionNode");
pt.use(Ft);
async function ht(D, R, p, T, y) {
  await ne(D, R, p, T, y), p.children && await Promise.all(p.children.map((i, t) => ht(D, R, i, T < 0 ? t : T, y)));
}
x(ht, "drawNodes");
function Et(D, R) {
  R.edges().map((p, T) => {
    const y = p.data();
    if (p[0]._private.bodyBounds) {
      const i = p[0]._private.rscratch;
      Q.trace("Edge: ", T, y), D.insert("path").attr("d", `M ${i.startX},${i.startY} L ${i.midX},${i.midY} L${i.endX},${i.endY} `).attr("class", "edge section-edge-" + y.section + " edge-depth-" + y.depth);
    }
  });
}
x(Et, "drawEdges");
function lt(D, R, p, T) {
  R.add({ group: "nodes", data: { id: D.id.toString(), labelText: D.descr, height: D.height, width: D.width, level: T, nodeId: D.id, padding: D.padding, type: D.type }, position: { x: D.x, y: D.y } }), D.children && D.children.forEach((y) => {
    lt(y, R, p, T + 1), R.add({ group: "edges", data: { id: `${D.id}_${y.id}`, source: D.id, target: y.id, depth: T, section: y.section } });
  });
}
x(lt, "addNodes");
function mt(D, R) {
  return new Promise((p) => {
    const T = It("body").append("div").attr("id", "cy").attr("style", "display:none"), y = pt({ container: document.getElementById("cy"), style: [{ selector: "edge", style: { "curve-style": "bezier" } }] });
    T.remove(), lt(D, y, R, 0), y.nodes().forEach(function(i) {
      i.layoutDimensions = () => {
        const t = i.data();
        return { w: t.width, h: t.height };
      };
    }), y.layout({ name: "cose-bilkent", quality: "proof", styleEnabled: false, animate: false }).run(), y.ready((i) => {
      Q.info("Ready", i), p(y);
    });
  });
}
x(mt, "layoutMindmap");
function vt(D, R) {
  R.nodes().map((p, T) => {
    const y = p.data();
    y.x = p.position().x, y.y = p.position().y, oe(D, y);
    const i = D.getElementById(y.nodeId);
    Q.info("Id:", T, "Position: (", p.position().x, ", ", p.position().y, ")", y), i.attr("transform", `translate(${p.position().x - y.width / 2}, ${p.position().y - y.height / 2})`), i.attr("attr", `apa-${T})`);
  });
}
x(vt, "positionNodes");
var se = x(async (D, R, p, T) => {
  var y, i;
  Q.debug(`Rendering mindmap diagram
` + D);
  const t = T.db, e = t.getMindmap();
  if (!e)
    return;
  const r = st();
  r.htmlLabels = false;
  const a = At(R), h = a.append("g");
  h.attr("class", "mindmap-edges");
  const s = a.append("g");
  s.attr("class", "mindmap-nodes"), await ht(t, s, e, -1, r);
  const f = await mt(e, r);
  Et(h, f), vt(t, f), Tt(void 0, a, ((y = r.mindmap) == null ? void 0 : y.padding) ?? J.mindmap.padding, ((i = r.mindmap) == null ? void 0 : i.useMaxWidth) ?? J.mindmap.useMaxWidth);
}, "draw"), ae = { draw: se }, he = x((D) => {
  let R = "";
  for (let p = 0; p < D.THEME_COLOR_LIMIT; p++)
    D["lineColor" + p] = D["lineColor" + p] || D["cScaleInv" + p], Lt(D["lineColor" + p]) ? D["lineColor" + p] = Ot(D["lineColor" + p], 20) : D["lineColor" + p] = Dt(D["lineColor" + p], 20);
  for (let p = 0; p < D.THEME_COLOR_LIMIT; p++) {
    const T = "" + (17 - 3 * p);
    R += `
    .section-${p - 1} rect, .section-${p - 1} path, .section-${p - 1} circle, .section-${p - 1} polygon, .section-${p - 1} path  {
      fill: ${D["cScale" + p]};
    }
    .section-${p - 1} text {
     fill: ${D["cScaleLabel" + p]};
    }
    .node-icon-${p - 1} {
      font-size: 40px;
      color: ${D["cScaleLabel" + p]};
    }
    .section-edge-${p - 1}{
      stroke: ${D["cScale" + p]};
    }
    .edge-depth-${p - 1}{
      stroke-width: ${T};
    }
    .section-${p - 1} line {
      stroke: ${D["cScaleInv" + p]} ;
      stroke-width: 3;
    }

    .disabled, .disabled circle, .disabled text {
      fill: lightgray;
    }
    .disabled text {
      fill: #efefef;
    }
    `;
  }
  return R;
}, "genSections"), le = x((D) => `
  .edge {
    stroke-width: 3;
  }
  ${he(D)}
  .section-root rect, .section-root path, .section-root circle, .section-root polygon  {
    fill: ${D.git0};
  }
  .section-root text {
    fill: ${D.gitBranchLabel0};
  }
  .icon-container {
    height:100%;
    display: flex;
    justify-content: center;
    align-items: center;
  }
  .edge {
    fill: none;
  }
  .mindmap-node-label {
    dy: 1em;
    alignment-baseline: middle;
    text-anchor: middle;
    dominant-baseline: middle;
    text-align: center;
  }
`, "getStyles"), ce = le, ye = { db: qt, renderer: ae, parser: Pt, styles: ce };
export {
  ye as diagram
};
