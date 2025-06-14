import { d as M, o as x, c as y, S as X, T as H, a as v, Q as O, G as b, I, P as W } from "./@vue-3b855f7b.js";
const Y = {};
Y.getData = (t) => new Promise((e, i) => {
  let s = {};
  S(t).then((h) => {
    s.arrayBuffer = h;
    try {
      s.orientation = T(h);
    } catch {
      s.orientation = -1;
    }
    e(s);
  }).catch((h) => {
    i(h);
  });
});
function S(t) {
  let e = null;
  return new Promise((i, s) => {
    if (t.src)
      if (/^data\:/i.test(t.src))
        e = E(t.src), i(e);
      else if (/^blob\:/i.test(t.src)) {
        var h = new FileReader();
        h.onload = function(o) {
          e = o.target.result, i(e);
        }, L(t.src, function(o) {
          h.readAsArrayBuffer(o);
        });
      } else {
        var r = new XMLHttpRequest();
        r.onload = function() {
          if (this.status == 200 || this.status === 0)
            e = r.response, i(e);
          else
            throw "Could not load image";
          r = null;
        }, r.open("GET", t.src, true), r.responseType = "arraybuffer", r.send(null);
      }
    else
      s("img error");
  });
}
function L(t, e) {
  var i = new XMLHttpRequest();
  i.open("GET", t, true), i.responseType = "blob", i.onload = function(s) {
    (this.status == 200 || this.status === 0) && e(this.response);
  }, i.send();
}
function E(t, e) {
  e = e || t.match(/^data\:([^\;]+)\;base64,/mi)[1] || "", t = t.replace(/^data\:([^\;]+)\;base64,/gmi, "");
  for (var i = atob(t), s = i.length % 2 == 0 ? i.length : i.length + 1, h = new ArrayBuffer(s), r = new Uint16Array(h), o = 0; o < s; o++)
    r[o] = i.charCodeAt(o);
  return h;
}
function k(t, e, i) {
  var s = "", h;
  for (h = e, i += e; h < i; h++)
    s += String.fromCharCode(t.getUint8(h));
  return s;
}
function T(t) {
  var e = new DataView(t), i = e.byteLength, s, h, r, o, a, c, n, p, u, l;
  if (e.getUint8(0) === 255 && e.getUint8(1) === 216)
    for (u = 2; u < i; ) {
      if (e.getUint8(u) === 255 && e.getUint8(u + 1) === 225) {
        n = u;
        break;
      }
      u++;
    }
  if (n && (h = n + 4, r = n + 10, k(e, h, 4) === "Exif" && (c = e.getUint16(r), a = c === 18761, (a || c === 19789) && e.getUint16(r + 2, a) === 42 && (o = e.getUint32(r + 4, a), o >= 8 && (p = r + o)))), p) {
    for (i = e.getUint16(p, a), l = 0; l < i; l++)
      if (u = p + l * 12 + 2, e.getUint16(u, a) === 274) {
        u += 8, s = e.getUint16(u, a);
        break;
      }
  }
  return s;
}
const N = (t, e) => {
  const i = t.__vccOpts || t;
  for (const [s, h] of e)
    i[s] = h;
  return i;
}, A = M({ data: function() {
  return { w: 0, h: 0, scale: 1, x: 0, y: 0, loading: true, trueWidth: 0, trueHeight: 0, move: true, moveX: 0, moveY: 0, crop: false, cropping: false, cropW: 0, cropH: 0, cropOldW: 0, cropOldH: 0, canChangeX: false, canChangeY: false, changeCropTypeX: 1, changeCropTypeY: 1, cropX: 0, cropY: 0, cropChangeX: 0, cropChangeY: 0, cropOffsertX: 0, cropOffsertY: 0, support: "", touches: [], touchNow: false, rotate: 0, isIos: false, orientation: 0, imgs: "", coe: 0.2, scaling: false, scalingSet: "", coeStatus: "", isCanShow: true, imgIsQqualCrop: false };
}, props: { img: { type: [String, Blob, null, File], default: "" }, outputSize: { type: Number, default: 1 }, outputType: { type: String, default: "jpeg" }, info: { type: Boolean, default: true }, canScale: { type: Boolean, default: true }, autoCrop: { type: Boolean, default: false }, autoCropWidth: { type: [Number, String], default: 0 }, autoCropHeight: { type: [Number, String], default: 0 }, fixed: { type: Boolean, default: false }, fixedNumber: { type: Array, default: () => [1, 1] }, fixedBox: { type: Boolean, default: false }, full: { type: Boolean, default: false }, canMove: { type: Boolean, default: true }, canMoveBox: { type: Boolean, default: true }, original: { type: Boolean, default: false }, centerBox: { type: Boolean, default: false }, high: { type: Boolean, default: true }, infoTrue: { type: Boolean, default: false }, maxImgSize: { type: [Number, String], default: 2e3 }, enlarge: { type: [Number, String], default: 1 }, preW: { type: [Number, String], default: 0 }, mode: { type: String, default: "contain" }, limitMinSize: { type: [Number, Array, String], default: () => 10, validator: function(t) {
  return Array.isArray(t) ? Number(t[0]) >= 0 && Number(t[1]) >= 0 : Number(t) >= 0;
} }, fillColor: { type: String, default: "" } }, computed: { cropInfo() {
  let t = {};
  if (t.top = this.cropOffsertY > 21 ? "-21px" : "0px", t.width = this.cropW > 0 ? this.cropW : 0, t.height = this.cropH > 0 ? this.cropH : 0, this.infoTrue) {
    let e = 1;
    this.high && !this.full && (e = window.devicePixelRatio), this.enlarge !== 1 & !this.full && (e = Math.abs(Number(this.enlarge))), t.width = t.width * e, t.height = t.height * e, this.full && (t.width = t.width / this.scale, t.height = t.height / this.scale);
  }
  return t.width = t.width.toFixed(0), t.height = t.height.toFixed(0), t;
}, isIE() {
  return !!window.ActiveXObject || "ActiveXObject" in window;
}, passive() {
  return this.isIE ? null : { passive: false };
}, isRotateRightOrLeft() {
  return [1, -1, 3, -3].includes(this.rotate);
} }, watch: { img() {
  this.checkedImg();
}, imgs(t) {
  t !== "" && this.reload();
}, cropW() {
  this.showPreview();
}, cropH() {
  this.showPreview();
}, cropOffsertX() {
  this.showPreview();
}, cropOffsertY() {
  this.showPreview();
}, scale(t, e) {
  this.showPreview();
}, x() {
  this.showPreview();
}, y() {
  this.showPreview();
}, autoCrop(t) {
  t && this.goAutoCrop();
}, autoCropWidth() {
  this.autoCrop && this.goAutoCrop();
}, autoCropHeight() {
  this.autoCrop && this.goAutoCrop();
}, mode() {
  this.checkedImg();
}, rotate() {
  this.showPreview(), this.autoCrop ? this.goAutoCrop(this.cropW, this.cropH) : (this.cropW > 0 || this.cropH > 0) && this.goAutoCrop(this.cropW, this.cropH);
} }, methods: { getVersion(t) {
  var e = navigator.userAgent.split(" "), i = "";
  let s = 0;
  const h = new RegExp(t, "i");
  for (var r = 0; r < e.length; r++)
    h.test(e[r]) && (i = e[r]);
  return i ? s = i.split("/")[1].split(".") : s = ["0", "0", "0"], s;
}, checkOrientationImage(t, e, i, s) {
  if (this.getVersion("chrome")[0] >= 81)
    e = -1;
  else if (this.getVersion("safari")[0] >= 605) {
    const o = this.getVersion("version");
    o[0] > 13 && o[1] > 1 && (e = -1);
  } else {
    const o = navigator.userAgent.toLowerCase().match(/cpu iphone os (.*?) like mac os/);
    if (o) {
      let a = o[1];
      a = a.split("_"), (a[0] > 13 || a[0] >= 13 && a[1] >= 4) && (e = -1);
    }
  }
  let h = document.createElement("canvas"), r = h.getContext("2d");
  switch (r.save(), e) {
    case 2:
      h.width = i, h.height = s, r.translate(i, 0), r.scale(-1, 1);
      break;
    case 3:
      h.width = i, h.height = s, r.translate(i / 2, s / 2), r.rotate(180 * Math.PI / 180), r.translate(-i / 2, -s / 2);
      break;
    case 4:
      h.width = i, h.height = s, r.translate(0, s), r.scale(1, -1);
      break;
    case 5:
      h.height = i, h.width = s, r.rotate(0.5 * Math.PI), r.scale(1, -1);
      break;
    case 6:
      h.width = s, h.height = i, r.translate(s / 2, i / 2), r.rotate(90 * Math.PI / 180), r.translate(-i / 2, -s / 2);
      break;
    case 7:
      h.height = i, h.width = s, r.rotate(0.5 * Math.PI), r.translate(i, -s), r.scale(-1, 1);
      break;
    case 8:
      h.height = i, h.width = s, r.translate(s / 2, i / 2), r.rotate(-90 * Math.PI / 180), r.translate(-i / 2, -s / 2);
      break;
    default:
      h.width = i, h.height = s;
  }
  r.drawImage(t, 0, 0, i, s), r.restore(), h.toBlob((o) => {
    let a = URL.createObjectURL(o);
    URL.revokeObjectURL(this.imgs), this.imgs = a;
  }, "image/" + this.outputType, 1);
}, checkedImg() {
  if (this.img === null || this.img === "") {
    this.imgs = "", this.clearCrop();
    return;
  }
  this.loading = true, this.scale = 1, this.rotate = 0, this.imgIsQqualCrop = false, this.clearCrop();
  let t = new Image();
  if (t.onload = () => {
    if (this.img === "")
      return this.$emit("img-load", new Error("\u56FE\u7247\u4E0D\u80FD\u4E3A\u7A7A")), false;
    let i = t.width, s = t.height;
    Y.getData(t).then((h) => {
      this.orientation = h.orientation || 1;
      let r = Number(this.maxImgSize);
      if (!this.orientation && i < r & s < r) {
        this.imgs = this.img;
        return;
      }
      i > r && (s = s / i * r, i = r), s > r && (i = i / s * r, s = r), this.checkOrientationImage(t, this.orientation, i, s);
    }).catch((h) => {
      this.$emit("img-load", "error"), this.$emit("img-load-error", h);
    });
  }, t.onerror = (i) => {
    this.$emit("img-load", "error"), this.$emit("img-load-error", i);
  }, this.img.substr(0, 4) !== "data" && (t.crossOrigin = ""), this.isIE) {
    var e = new XMLHttpRequest();
    e.onload = function() {
      var i = URL.createObjectURL(this.response);
      t.src = i;
    }, e.open("GET", this.img, true), e.responseType = "blob", e.send();
  } else
    t.src = this.img;
}, startMove(t) {
  if (t.preventDefault(), this.move && !this.crop) {
    if (!this.canMove)
      return false;
    this.moveX = ("clientX" in t ? t.clientX : t.touches[0].clientX) - this.x, this.moveY = ("clientY" in t ? t.clientY : t.touches[0].clientY) - this.y, t.touches ? (window.addEventListener("touchmove", this.moveImg), window.addEventListener("touchend", this.leaveImg), t.touches.length == 2 && (this.touches = t.touches, window.addEventListener("touchmove", this.touchScale), window.addEventListener("touchend", this.cancelTouchScale))) : (window.addEventListener("mousemove", this.moveImg), window.addEventListener("mouseup", this.leaveImg)), this.$emit("img-moving", { moving: true, axis: this.getImgAxis() });
  } else
    this.cropping = true, window.addEventListener("mousemove", this.createCrop), window.addEventListener("mouseup", this.endCrop), window.addEventListener("touchmove", this.createCrop), window.addEventListener("touchend", this.endCrop), this.cropOffsertX = t.offsetX ? t.offsetX : t.touches[0].pageX - this.$refs.cropper.offsetLeft, this.cropOffsertY = t.offsetY ? t.offsetY : t.touches[0].pageY - this.$refs.cropper.offsetTop, this.cropX = "clientX" in t ? t.clientX : t.touches[0].clientX, this.cropY = "clientY" in t ? t.clientY : t.touches[0].clientY, this.cropChangeX = this.cropOffsertX, this.cropChangeY = this.cropOffsertY, this.cropW = 0, this.cropH = 0;
}, touchScale(t) {
  t.preventDefault();
  let e = this.scale;
  var i = { x: this.touches[0].clientX, y: this.touches[0].clientY }, s = { x: t.touches[0].clientX, y: t.touches[0].clientY }, h = { x: this.touches[1].clientX, y: this.touches[1].clientY }, r = { x: t.touches[1].clientX, y: t.touches[1].clientY }, o = Math.sqrt(Math.pow(i.x - h.x, 2) + Math.pow(i.y - h.y, 2)), a = Math.sqrt(Math.pow(s.x - r.x, 2) + Math.pow(s.y - r.y, 2)), c = a - o, n = 1;
  n = n / this.trueWidth > n / this.trueHeight ? n / this.trueHeight : n / this.trueWidth, n = n > 0.1 ? 0.1 : n;
  var p = n * c;
  if (!this.touchNow) {
    if (this.touchNow = true, c > 0 ? e += Math.abs(p) : c < 0 && e > Math.abs(p) && (e -= Math.abs(p)), this.touches = t.touches, setTimeout(() => {
      this.touchNow = false;
    }, 8), !this.checkoutImgAxis(this.x, this.y, e))
      return false;
    this.scale = e;
  }
}, cancelTouchScale(t) {
  window.removeEventListener("touchmove", this.touchScale);
}, moveImg(t) {
  if (t.preventDefault(), t.touches && t.touches.length === 2)
    return this.touches = t.touches, window.addEventListener("touchmove", this.touchScale), window.addEventListener("touchend", this.cancelTouchScale), window.removeEventListener("touchmove", this.moveImg), false;
  let e = "clientX" in t ? t.clientX : t.touches[0].clientX, i = "clientY" in t ? t.clientY : t.touches[0].clientY, s, h;
  s = e - this.moveX, h = i - this.moveY, this.$nextTick(() => {
    if (this.centerBox) {
      let r = this.getImgAxis(s, h, this.scale), o = this.getCropAxis(), a = this.trueHeight * this.scale, c = this.trueWidth * this.scale, n, p, u, l;
      switch (this.rotate) {
        case 1:
        case -1:
        case 3:
        case -3:
          n = this.cropOffsertX - this.trueWidth * (1 - this.scale) / 2 + (a - c) / 2, p = this.cropOffsertY - this.trueHeight * (1 - this.scale) / 2 + (c - a) / 2, u = n - a + this.cropW, l = p - c + this.cropH;
          break;
        default:
          n = this.cropOffsertX - this.trueWidth * (1 - this.scale) / 2, p = this.cropOffsertY - this.trueHeight * (1 - this.scale) / 2, u = n - c + this.cropW, l = p - a + this.cropH;
          break;
      }
      r.x1 >= o.x1 && (s = n), r.y1 >= o.y1 && (h = p), r.x2 <= o.x2 && (s = u), r.y2 <= o.y2 && (h = l);
    }
    this.x = s, this.y = h, this.$emit("img-moving", { moving: true, axis: this.getImgAxis() });
  });
}, leaveImg(t) {
  window.removeEventListener("mousemove", this.moveImg), window.removeEventListener("touchmove", this.moveImg), window.removeEventListener("mouseup", this.leaveImg), window.removeEventListener("touchend", this.leaveImg), this.$emit("img-moving", { moving: false, axis: this.getImgAxis() });
}, scaleImg() {
  this.canScale && window.addEventListener(this.support, this.changeSize, this.passive);
}, cancelScale() {
  this.canScale && window.removeEventListener(this.support, this.changeSize);
}, changeSize(t) {
  t.preventDefault();
  let e = this.scale;
  var i = t.deltaY || t.wheelDelta, s = navigator.userAgent.indexOf("Firefox");
  i = s > 0 ? i * 30 : i, this.isIE && (i = -i);
  var h = this.coe;
  h = h / this.trueWidth > h / this.trueHeight ? h / this.trueHeight : h / this.trueWidth;
  var r = h * i;
  r < 0 ? e += Math.abs(r) : e > Math.abs(r) && (e -= Math.abs(r));
  let o = r < 0 ? "add" : "reduce";
  if (o !== this.coeStatus && (this.coeStatus = o, this.coe = 0.2), this.scaling || (this.scalingSet = setTimeout(() => {
    this.scaling = false, this.coe = this.coe += 0.01;
  }, 50)), this.scaling = true, !this.checkoutImgAxis(this.x, this.y, e))
    return false;
  this.scale = e;
}, changeScale(t) {
  let e = this.scale;
  t = t || 1;
  var i = 20;
  if (i = i / this.trueWidth > i / this.trueHeight ? i / this.trueHeight : i / this.trueWidth, t = t * i, t > 0 ? e += Math.abs(t) : e > Math.abs(t) && (e -= Math.abs(t)), !this.checkoutImgAxis(this.x, this.y, e))
    return false;
  this.scale = e;
}, createCrop(t) {
  t.preventDefault();
  var e = "clientX" in t ? t.clientX : t.touches ? t.touches[0].clientX : 0, i = "clientY" in t ? t.clientY : t.touches ? t.touches[0].clientY : 0;
  this.$nextTick(() => {
    var s = e - this.cropX, h = i - this.cropY;
    if (s > 0 ? (this.cropW = s + this.cropChangeX > this.w ? this.w - this.cropChangeX : s, this.cropOffsertX = this.cropChangeX) : (this.cropW = this.w - this.cropChangeX + Math.abs(s) > this.w ? this.cropChangeX : Math.abs(s), this.cropOffsertX = this.cropChangeX + s > 0 ? this.cropChangeX + s : 0), !this.fixed)
      h > 0 ? (this.cropH = h + this.cropChangeY > this.h ? this.h - this.cropChangeY : h, this.cropOffsertY = this.cropChangeY) : (this.cropH = this.h - this.cropChangeY + Math.abs(h) > this.h ? this.cropChangeY : Math.abs(h), this.cropOffsertY = this.cropChangeY + h > 0 ? this.cropChangeY + h : 0);
    else {
      var r = this.cropW / this.fixedNumber[0] * this.fixedNumber[1];
      r + this.cropOffsertY > this.h ? (this.cropH = this.h - this.cropOffsertY, this.cropW = this.cropH / this.fixedNumber[1] * this.fixedNumber[0], s > 0 ? this.cropOffsertX = this.cropChangeX : this.cropOffsertX = this.cropChangeX - this.cropW) : this.cropH = r, this.cropOffsertY = this.cropOffsertY;
    }
  });
}, changeCropSize(t, e, i, s, h) {
  t.preventDefault(), window.addEventListener("mousemove", this.changeCropNow), window.addEventListener("mouseup", this.changeCropEnd), window.addEventListener("touchmove", this.changeCropNow), window.addEventListener("touchend", this.changeCropEnd), this.canChangeX = e, this.canChangeY = i, this.changeCropTypeX = s, this.changeCropTypeY = h, this.cropX = "clientX" in t ? t.clientX : t.touches[0].clientX, this.cropY = "clientY" in t ? t.clientY : t.touches[0].clientY, this.cropOldW = this.cropW, this.cropOldH = this.cropH, this.cropChangeX = this.cropOffsertX, this.cropChangeY = this.cropOffsertY, this.fixed && this.canChangeX && this.canChangeY && (this.canChangeY = 0), this.$emit("change-crop-size", { width: this.cropW, height: this.cropH });
}, changeCropNow(t) {
  t.preventDefault();
  var e = "clientX" in t ? t.clientX : t.touches ? t.touches[0].clientX : 0, i = "clientY" in t ? t.clientY : t.touches ? t.touches[0].clientY : 0;
  let s = this.w, h = this.h, r = 0, o = 0;
  if (this.centerBox) {
    let n = this.getImgAxis(), p = n.x2, u = n.y2;
    r = n.x1 > 0 ? n.x1 : 0, o = n.y1 > 0 ? n.y1 : 0, s > p && (s = p), h > u && (h = u);
  }
  const [a, c] = this.checkCropLimitSize();
  this.$nextTick(() => {
    var n = e - this.cropX, p = i - this.cropY;
    if (this.canChangeX && (this.changeCropTypeX === 1 ? this.cropOldW - n < a ? (this.cropW = a, this.cropOffsertX = this.cropOldW + this.cropChangeX - r - a) : this.cropOldW - n > 0 ? (this.cropW = s - this.cropChangeX - n <= s - r ? this.cropOldW - n : this.cropOldW + this.cropChangeX - r, this.cropOffsertX = s - this.cropChangeX - n <= s - r ? this.cropChangeX + n : r) : (this.cropW = Math.abs(n) + this.cropChangeX <= s ? Math.abs(n) - this.cropOldW : s - this.cropOldW - this.cropChangeX, this.cropOffsertX = this.cropChangeX + this.cropOldW) : this.changeCropTypeX === 2 && (this.cropOldW + n < a ? this.cropW = a : this.cropOldW + n > 0 ? (this.cropW = this.cropOldW + n + this.cropOffsertX <= s ? this.cropOldW + n : s - this.cropOffsertX, this.cropOffsertX = this.cropChangeX) : (this.cropW = s - this.cropChangeX + Math.abs(n + this.cropOldW) <= s - r ? Math.abs(n + this.cropOldW) : this.cropChangeX - r, this.cropOffsertX = s - this.cropChangeX + Math.abs(n + this.cropOldW) <= s - r ? this.cropChangeX - Math.abs(n + this.cropOldW) : r))), this.canChangeY && (this.changeCropTypeY === 1 ? this.cropOldH - p < c ? (this.cropH = c, this.cropOffsertY = this.cropOldH + this.cropChangeY - o - c) : this.cropOldH - p > 0 ? (this.cropH = h - this.cropChangeY - p <= h - o ? this.cropOldH - p : this.cropOldH + this.cropChangeY - o, this.cropOffsertY = h - this.cropChangeY - p <= h - o ? this.cropChangeY + p : o) : (this.cropH = Math.abs(p) + this.cropChangeY <= h ? Math.abs(p) - this.cropOldH : h - this.cropOldH - this.cropChangeY, this.cropOffsertY = this.cropChangeY + this.cropOldH) : this.changeCropTypeY === 2 && (this.cropOldH + p < c ? this.cropH = c : this.cropOldH + p > 0 ? (this.cropH = this.cropOldH + p + this.cropOffsertY <= h ? this.cropOldH + p : h - this.cropOffsertY, this.cropOffsertY = this.cropChangeY) : (this.cropH = h - this.cropChangeY + Math.abs(p + this.cropOldH) <= h - o ? Math.abs(p + this.cropOldH) : this.cropChangeY - o, this.cropOffsertY = h - this.cropChangeY + Math.abs(p + this.cropOldH) <= h - o ? this.cropChangeY - Math.abs(p + this.cropOldH) : o))), this.canChangeX && this.fixed) {
      var u = this.cropW / this.fixedNumber[0] * this.fixedNumber[1];
      u < c ? (this.cropH = c, this.cropW = this.fixedNumber[0] * c / this.fixedNumber[1], this.changeCropTypeX === 1 && (this.cropOffsertX = this.cropChangeX + (this.cropOldW - this.cropW))) : u + this.cropOffsertY > h ? (this.cropH = h - this.cropOffsertY, this.cropW = this.cropH / this.fixedNumber[1] * this.fixedNumber[0], this.changeCropTypeX === 1 && (this.cropOffsertX = this.cropChangeX + (this.cropOldW - this.cropW))) : this.cropH = u;
    }
    if (this.canChangeY && this.fixed) {
      var l = this.cropH / this.fixedNumber[1] * this.fixedNumber[0];
      l < a ? (this.cropW = a, this.cropH = this.fixedNumber[1] * a / this.fixedNumber[0], this.cropOffsertY = this.cropOldH + this.cropChangeY - this.cropH) : l + this.cropOffsertX > s ? (this.cropW = s - this.cropOffsertX, this.cropH = this.cropW / this.fixedNumber[0] * this.fixedNumber[1]) : this.cropW = l;
    }
  });
}, checkCropLimitSize() {
  let { cropW: t, cropH: e, limitMinSize: i } = this, s = new Array();
  return Array.isArray(i) ? s = i : s = [i, i], t = parseFloat(s[0]), e = parseFloat(s[1]), [t, e];
}, changeCropEnd(t) {
  window.removeEventListener("mousemove", this.changeCropNow), window.removeEventListener("mouseup", this.changeCropEnd), window.removeEventListener("touchmove", this.changeCropNow), window.removeEventListener("touchend", this.changeCropEnd);
}, calculateSize(t, e, i, s, h, r) {
  const o = t / e;
  let a = h, c = r;
  return a < i && (a = i, c = Math.ceil(a / o)), c < s && (c = s, a = Math.ceil(c * o), a < i && (a = i, c = Math.ceil(a / o))), a < h && (a = h, c = Math.ceil(a / o)), c < r && (c = r, a = Math.ceil(c * o)), { width: a, height: c };
}, endCrop() {
  this.cropW === 0 && this.cropH === 0 && (this.cropping = false);
  let [t, e] = this.checkCropLimitSize();
  const { width: i, height: s } = this.fixed ? this.calculateSize(this.fixedNumber[0], this.fixedNumber[1], t, e, this.cropW, this.cropH) : { width: t, height: e };
  i > this.cropW && (this.cropW = i, this.cropOffsertX + i > this.w && (this.cropOffsertX = this.w - i)), s > this.cropH && (this.cropH = s, this.cropOffsertY + s > this.h && (this.cropOffsertY = this.h - s)), window.removeEventListener("mousemove", this.createCrop), window.removeEventListener("mouseup", this.endCrop), window.removeEventListener("touchmove", this.createCrop), window.removeEventListener("touchend", this.endCrop);
}, startCrop() {
  this.crop = true;
}, stopCrop() {
  this.crop = false;
}, clearCrop() {
  this.cropping = false, this.cropW = 0, this.cropH = 0;
}, cropMove(t) {
  if (t.preventDefault(), !this.canMoveBox)
    return this.crop = false, this.startMove(t), false;
  if (t.touches && t.touches.length === 2)
    return this.crop = false, this.startMove(t), this.leaveCrop(), false;
  window.addEventListener("mousemove", this.moveCrop), window.addEventListener("mouseup", this.leaveCrop), window.addEventListener("touchmove", this.moveCrop), window.addEventListener("touchend", this.leaveCrop);
  let e = "clientX" in t ? t.clientX : t.touches[0].clientX, i = "clientY" in t ? t.clientY : t.touches[0].clientY, s, h;
  s = e - this.cropOffsertX, h = i - this.cropOffsertY, this.cropX = s, this.cropY = h, this.$emit("crop-moving", { moving: true, axis: this.getCropAxis() });
}, moveCrop(t, e) {
  let i = 0, s = 0;
  t && (t.preventDefault(), i = "clientX" in t ? t.clientX : t.touches[0].clientX, s = "clientY" in t ? t.clientY : t.touches[0].clientY), this.$nextTick(() => {
    let h, r, o = i - this.cropX, a = s - this.cropY;
    if (e && (o = this.cropOffsertX, a = this.cropOffsertY), o <= 0 ? h = 0 : o + this.cropW > this.w ? h = this.w - this.cropW : h = o, a <= 0 ? r = 0 : a + this.cropH > this.h ? r = this.h - this.cropH : r = a, this.centerBox) {
      let c = this.getImgAxis();
      h <= c.x1 && (h = c.x1), h + this.cropW > c.x2 && (h = c.x2 - this.cropW), r <= c.y1 && (r = c.y1), r + this.cropH > c.y2 && (r = c.y2 - this.cropH);
    }
    this.cropOffsertX = h, this.cropOffsertY = r, this.$emit("crop-moving", { moving: true, axis: this.getCropAxis() });
  });
}, getImgAxis(t, e, i) {
  t = t || this.x, e = e || this.y, i = i || this.scale;
  let s = { x1: 0, x2: 0, y1: 0, y2: 0 }, h = this.trueWidth * i, r = this.trueHeight * i;
  switch (this.rotate) {
    case 0:
      s.x1 = t + this.trueWidth * (1 - i) / 2, s.x2 = s.x1 + this.trueWidth * i, s.y1 = e + this.trueHeight * (1 - i) / 2, s.y2 = s.y1 + this.trueHeight * i;
      break;
    case 1:
    case -1:
    case 3:
    case -3:
      s.x1 = t + this.trueWidth * (1 - i) / 2 + (h - r) / 2, s.x2 = s.x1 + this.trueHeight * i, s.y1 = e + this.trueHeight * (1 - i) / 2 + (r - h) / 2, s.y2 = s.y1 + this.trueWidth * i;
      break;
    default:
      s.x1 = t + this.trueWidth * (1 - i) / 2, s.x2 = s.x1 + this.trueWidth * i, s.y1 = e + this.trueHeight * (1 - i) / 2, s.y2 = s.y1 + this.trueHeight * i;
      break;
  }
  return s;
}, getCropAxis() {
  let t = { x1: 0, x2: 0, y1: 0, y2: 0 };
  return t.x1 = this.cropOffsertX, t.x2 = t.x1 + this.cropW, t.y1 = this.cropOffsertY, t.y2 = t.y1 + this.cropH, t;
}, leaveCrop(t) {
  window.removeEventListener("mousemove", this.moveCrop), window.removeEventListener("mouseup", this.leaveCrop), window.removeEventListener("touchmove", this.moveCrop), window.removeEventListener("touchend", this.leaveCrop), this.$emit("crop-moving", { moving: false, axis: this.getCropAxis() });
}, getCropChecked(t) {
  let e = document.createElement("canvas"), i = e.getContext("2d"), s = new Image(), h = this.rotate, r = this.trueWidth, o = this.trueHeight, a = this.cropOffsertX, c = this.cropOffsertY;
  s.onload = () => {
    if (this.cropW !== 0) {
      let l = 1;
      this.high & !this.full && (l = window.devicePixelRatio), this.enlarge !== 1 & !this.full && (l = Math.abs(Number(this.enlarge)));
      let f = this.cropW * l, C = this.cropH * l, g = r * this.scale * l, d = o * this.scale * l, m = (this.x - a + this.trueWidth * (1 - this.scale) / 2) * l, w = (this.y - c + this.trueHeight * (1 - this.scale) / 2) * l;
      switch (u(f, C), i.save(), h) {
        case 0:
          this.full ? (u(f / this.scale, C / this.scale), i.drawImage(s, m / this.scale, w / this.scale, g / this.scale, d / this.scale)) : i.drawImage(s, m, w, g, d);
          break;
        case 1:
        case -3:
          this.full ? (u(f / this.scale, C / this.scale), m = m / this.scale + (g / this.scale - d / this.scale) / 2, w = w / this.scale + (d / this.scale - g / this.scale) / 2, i.rotate(h * 90 * Math.PI / 180), i.drawImage(s, w, -m - d / this.scale, g / this.scale, d / this.scale)) : (m = m + (g - d) / 2, w = w + (d - g) / 2, i.rotate(h * 90 * Math.PI / 180), i.drawImage(s, w, -m - d, g, d));
          break;
        case 2:
        case -2:
          this.full ? (u(f / this.scale, C / this.scale), i.rotate(h * 90 * Math.PI / 180), m = m / this.scale, w = w / this.scale, i.drawImage(s, -m - g / this.scale, -w - d / this.scale, g / this.scale, d / this.scale)) : (i.rotate(h * 90 * Math.PI / 180), i.drawImage(s, -m - g, -w - d, g, d));
          break;
        case 3:
        case -1:
          this.full ? (u(f / this.scale, C / this.scale), m = m / this.scale + (g / this.scale - d / this.scale) / 2, w = w / this.scale + (d / this.scale - g / this.scale) / 2, i.rotate(h * 90 * Math.PI / 180), i.drawImage(s, -w - g / this.scale, m, g / this.scale, d / this.scale)) : (m = m + (g - d) / 2, w = w + (d - g) / 2, i.rotate(h * 90 * Math.PI / 180), i.drawImage(s, -w - g, m, g, d));
          break;
        default:
          this.full ? (u(f / this.scale, C / this.scale), i.drawImage(s, m / this.scale, w / this.scale, g / this.scale, d / this.scale)) : i.drawImage(s, m, w, g, d);
      }
      i.restore();
    } else {
      let l = r * this.scale, f = o * this.scale;
      switch (i.save(), h) {
        case 0:
          u(l, f), i.drawImage(s, 0, 0, l, f);
          break;
        case 1:
        case -3:
          u(f, l), i.rotate(h * 90 * Math.PI / 180), i.drawImage(s, 0, -f, l, f);
          break;
        case 2:
        case -2:
          u(l, f), i.rotate(h * 90 * Math.PI / 180), i.drawImage(s, -l, -f, l, f);
          break;
        case 3:
        case -1:
          u(f, l), i.rotate(h * 90 * Math.PI / 180), i.drawImage(s, -l, 0, l, f);
          break;
        default:
          u(l, f), i.drawImage(s, 0, 0, l, f);
      }
      i.restore();
    }
    t(e);
  };
  var n = this.img.substr(0, 4);
  n !== "data" && (s.crossOrigin = "Anonymous"), s.src = this.imgs;
  const p = this.fillColor;
  function u(l, f) {
    e.width = Math.round(l), e.height = Math.round(f), p && (i.fillStyle = p, i.fillRect(0, 0, e.width, e.height));
  }
}, getCropData(t) {
  this.getCropChecked((e) => {
    t(e.toDataURL("image/" + this.outputType, this.outputSize));
  });
}, getCropBlob(t) {
  this.getCropChecked((e) => {
    e.toBlob((i) => t(i), "image/" + this.outputType, this.outputSize);
  });
}, showPreview() {
  if (this.isCanShow)
    this.isCanShow = false, setTimeout(() => {
      this.isCanShow = true;
    }, 16);
  else
    return false;
  let t = this.cropW, e = this.cropH, i = this.scale;
  var s = {};
  s.div = { width: `${t}px`, height: `${e}px` };
  let h = (this.x - this.cropOffsertX) / i, r = (this.y - this.cropOffsertY) / i, o = 0;
  s.w = t, s.h = e, s.url = this.imgs, s.img = { width: `${this.trueWidth}px`, height: `${this.trueHeight}px`, transform: `scale(${i})translate3d(${h}px, ${r}px, ${o}px)rotateZ(${this.rotate * 90}deg)` }, s.html = `
      <div class="show-preview" style="width: ${s.w}px; height: ${s.h}px,; overflow: hidden">
        <div style="width: ${t}px; height: ${e}px">
          <img src=${s.url} style="width: ${this.trueWidth}px; height: ${this.trueHeight}px; transform:
          scale(${i})translate3d(${h}px, ${r}px, ${o}px)rotateZ(${this.rotate * 90}deg)">
        </div>
      </div>`, this.$emit("real-time", s);
}, reload() {
  let t = new Image();
  t.onload = () => {
    this.w = parseFloat(window.getComputedStyle(this.$refs.cropper).width), this.h = parseFloat(window.getComputedStyle(this.$refs.cropper).height), this.trueWidth = t.width, this.trueHeight = t.height, this.original ? this.scale = 1 : this.scale = this.checkedMode(), this.$nextTick(() => {
      this.x = -(this.trueWidth - this.trueWidth * this.scale) / 2 + (this.w - this.trueWidth * this.scale) / 2, this.y = -(this.trueHeight - this.trueHeight * this.scale) / 2 + (this.h - this.trueHeight * this.scale) / 2, this.loading = false, this.autoCrop && this.goAutoCrop(), this.$emit("img-load", "success"), setTimeout(() => {
        this.showPreview();
      }, 20);
    });
  }, t.onerror = () => {
    this.$emit("img-load", "error");
  }, t.src = this.imgs;
}, checkedMode() {
  let t = 1, e = this.trueWidth, i = this.trueHeight;
  const s = this.mode.split(" ");
  switch (s[0]) {
    case "contain":
      this.trueWidth > this.w && (t = this.w / this.trueWidth), this.trueHeight * t > this.h && (t = this.h / this.trueHeight);
      break;
    case "cover":
      e = this.w, t = e / this.trueWidth, i = i * t, i < this.h && (i = this.h, t = i / this.trueHeight);
      break;
    default:
      try {
        let h = s[0];
        if (h.search("px") !== -1) {
          h = h.replace("px", ""), e = parseFloat(h);
          const r = e / this.trueWidth;
          let o = 1, a = s[1];
          a.search("px") !== -1 && (a = a.replace("px", ""), i = parseFloat(a), o = i / this.trueHeight), t = Math.min(r, o);
        }
        if (h.search("%") !== -1 && (h = h.replace("%", ""), e = parseFloat(h) / 100 * this.w, t = e / this.trueWidth), s.length === 2 && h === "auto") {
          let r = s[1];
          r.search("px") !== -1 && (r = r.replace("px", ""), i = parseFloat(r), t = i / this.trueHeight), r.search("%") !== -1 && (r = r.replace("%", ""), i = parseFloat(r) / 100 * this.h, t = i / this.trueHeight);
        }
      } catch {
        t = 1;
      }
  }
  return t;
}, goAutoCrop(t, e) {
  if (this.imgs === "" || this.imgs === null)
    return;
  this.clearCrop(), this.cropping = true;
  let i = this.w, s = this.h;
  if (this.centerBox) {
    const o = Math.abs(this.rotate) % 2 > 0;
    let a = (o ? this.trueHeight : this.trueWidth) * this.scale, c = (o ? this.trueWidth : this.trueHeight) * this.scale;
    i = a < i ? a : i, s = c < s ? c : s;
  }
  var h = t || parseFloat(this.autoCropWidth), r = e || parseFloat(this.autoCropHeight);
  (h === 0 || r === 0) && (h = i * 0.8, r = s * 0.8), h = h > i ? i : h, r = r > s ? s : r, this.fixed && (r = h / this.fixedNumber[0] * this.fixedNumber[1]), r > this.h && (r = this.h, h = r / this.fixedNumber[1] * this.fixedNumber[0]), this.changeCrop(h, r);
}, changeCrop(t, e) {
  if (this.centerBox) {
    let i = this.getImgAxis();
    t > i.x2 - i.x1 && (t = i.x2 - i.x1, e = t / this.fixedNumber[0] * this.fixedNumber[1]), e > i.y2 - i.y1 && (e = i.y2 - i.y1, t = e / this.fixedNumber[1] * this.fixedNumber[0]);
  }
  this.cropW = t, this.cropH = e, this.checkCropLimitSize(), this.$nextTick(() => {
    this.cropOffsertX = (this.w - this.cropW) / 2, this.cropOffsertY = (this.h - this.cropH) / 2, this.centerBox && this.moveCrop(null, true);
  });
}, refresh() {
  this.img, this.imgs = "", this.scale = 1, this.crop = false, this.rotate = 0, this.w = 0, this.h = 0, this.trueWidth = 0, this.trueHeight = 0, this.imgIsQqualCrop = false, this.clearCrop(), this.$nextTick(() => {
    this.checkedImg();
  });
}, rotateLeft() {
  this.rotate = this.rotate <= -3 ? 0 : this.rotate - 1;
}, rotateRight() {
  this.rotate = this.rotate >= 3 ? 0 : this.rotate + 1;
}, rotateClear() {
  this.rotate = 0;
}, checkoutImgAxis(t, e, i) {
  t = t || this.x, e = e || this.y, i = i || this.scale;
  let s = true;
  if (this.centerBox) {
    let h = this.getImgAxis(t, e, i), r = this.getCropAxis();
    h.x1 >= r.x1 && (s = false), h.x2 <= r.x2 && (s = false), h.y1 >= r.y1 && (s = false), h.y2 <= r.y2 && (s = false), s || this.changeImgScale(h, r, i);
  }
  return s;
}, changeImgScale(t, e, i) {
  let s = this.trueWidth, h = this.trueHeight, r = s * i, o = h * i;
  if (r >= this.cropW && o >= this.cropH)
    this.scale = i;
  else {
    const a = this.cropW / s, c = this.cropH / h, n = this.cropH <= h * a ? a : c;
    this.scale = n, r = s * n, o = h * n;
  }
  this.imgIsQqualCrop || (t.x1 >= e.x1 && (this.isRotateRightOrLeft ? this.x = e.x1 - (s - r) / 2 - (r - o) / 2 : this.x = e.x1 - (s - r) / 2), t.x2 <= e.x2 && (this.isRotateRightOrLeft ? this.x = e.x1 - (s - r) / 2 - (r - o) / 2 - o + this.cropW : this.x = e.x2 - (s - r) / 2 - r), t.y1 >= e.y1 && (this.isRotateRightOrLeft ? this.y = e.y1 - (h - o) / 2 - (o - r) / 2 : this.y = e.y1 - (h - o) / 2), t.y2 <= e.y2 && (this.isRotateRightOrLeft ? this.y = e.y2 - (h - o) / 2 - (o - r) / 2 - r : this.y = e.y2 - (h - o) / 2 - o)), (r < this.cropW || o < this.cropH) && (this.imgIsQqualCrop = true);
} }, mounted() {
  this.support = "onwheel" in document.createElement("div") ? "wheel" : document.onmousewheel !== void 0 ? "mousewheel" : "DOMMouseScroll";
  let t = this;
  var e = navigator.userAgent;
  this.isIOS = !!e.match(/\(i[^;]+;( U;)? CPU.+Mac OS X/), HTMLCanvasElement.prototype.toBlob || Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", { value: function(i, s, h) {
    for (var r = atob(this.toDataURL(s, h).split(",")[1]), o = r.length, a = new Uint8Array(o), c = 0; c < o; c++)
      a[c] = r.charCodeAt(c);
    i(new Blob([a], { type: t.type || "image/png" }));
  } }), this.showPreview(), this.checkedImg();
}, unmounted() {
  window.removeEventListener("mousemove", this.moveCrop), window.removeEventListener("mouseup", this.leaveCrop), window.removeEventListener("touchmove", this.moveCrop), window.removeEventListener("touchend", this.leaveCrop), this.cancelScale();
} }), $ = { key: 0, class: "cropper-box" }, z = ["src"], B = { class: "cropper-view-box" }, P = ["src"], R = { key: 1 };
function U(t, e, i, s, h, r) {
  return x(), y("div", { class: "vue-cropper", ref: "cropper", onMouseover: e[28] || (e[28] = (...o) => t.scaleImg && t.scaleImg(...o)), onMouseout: e[29] || (e[29] = (...o) => t.cancelScale && t.cancelScale(...o)) }, [t.imgs ? (x(), y("div", $, [X(v("div", { class: "cropper-box-canvas", style: O({ width: t.trueWidth + "px", height: t.trueHeight + "px", transform: "scale(" + t.scale + "," + t.scale + ") translate3d(" + t.x / t.scale + "px," + t.y / t.scale + "px,0)rotateZ(" + t.rotate * 90 + "deg)" }) }, [v("img", { src: t.imgs, alt: "cropper-img", ref: "cropperImg" }, null, 8, z)], 4), [[H, !t.loading]])])) : b("", true), v("div", { class: I(["cropper-drag-box", { "cropper-move": t.move && !t.crop, "cropper-crop": t.crop, "cropper-modal": t.cropping }]), onMousedown: e[0] || (e[0] = (...o) => t.startMove && t.startMove(...o)), onTouchstart: e[1] || (e[1] = (...o) => t.startMove && t.startMove(...o)) }, null, 34), X(v("div", { class: "cropper-crop-box", style: O({ width: t.cropW + "px", height: t.cropH + "px", transform: "translate3d(" + t.cropOffsertX + "px," + t.cropOffsertY + "px,0)" }) }, [v("span", B, [v("img", { style: O({ width: t.trueWidth + "px", height: t.trueHeight + "px", transform: "scale(" + t.scale + "," + t.scale + ") translate3d(" + (t.x - t.cropOffsertX) / t.scale + "px," + (t.y - t.cropOffsertY) / t.scale + "px,0)rotateZ(" + t.rotate * 90 + "deg)" }), src: t.imgs, alt: "cropper-img" }, null, 12, P)]), v("span", { class: "cropper-face cropper-move", onMousedown: e[2] || (e[2] = (...o) => t.cropMove && t.cropMove(...o)), onTouchstart: e[3] || (e[3] = (...o) => t.cropMove && t.cropMove(...o)) }, null, 32), t.info ? (x(), y("span", { key: 0, class: "crop-info", style: O({ top: t.cropInfo.top }) }, W(t.cropInfo.width) + " \xD7 " + W(t.cropInfo.height), 5)) : b("", true), t.fixedBox ? b("", true) : (x(), y("span", R, [v("span", { class: "crop-line line-w", onMousedown: e[4] || (e[4] = (o) => t.changeCropSize(o, false, true, 0, 1)), onTouchstart: e[5] || (e[5] = (o) => t.changeCropSize(o, false, true, 0, 1)) }, null, 32), v("span", { class: "crop-line line-a", onMousedown: e[6] || (e[6] = (o) => t.changeCropSize(o, true, false, 1, 0)), onTouchstart: e[7] || (e[7] = (o) => t.changeCropSize(o, true, false, 1, 0)) }, null, 32), v("span", { class: "crop-line line-s", onMousedown: e[8] || (e[8] = (o) => t.changeCropSize(o, false, true, 0, 2)), onTouchstart: e[9] || (e[9] = (o) => t.changeCropSize(o, false, true, 0, 2)) }, null, 32), v("span", { class: "crop-line line-d", onMousedown: e[10] || (e[10] = (o) => t.changeCropSize(o, true, false, 2, 0)), onTouchstart: e[11] || (e[11] = (o) => t.changeCropSize(o, true, false, 2, 0)) }, null, 32), v("span", { class: "crop-point point1", onMousedown: e[12] || (e[12] = (o) => t.changeCropSize(o, true, true, 1, 1)), onTouchstart: e[13] || (e[13] = (o) => t.changeCropSize(o, true, true, 1, 1)) }, null, 32), v("span", { class: "crop-point point2", onMousedown: e[14] || (e[14] = (o) => t.changeCropSize(o, false, true, 0, 1)), onTouchstart: e[15] || (e[15] = (o) => t.changeCropSize(o, false, true, 0, 1)) }, null, 32), v("span", { class: "crop-point point3", onMousedown: e[16] || (e[16] = (o) => t.changeCropSize(o, true, true, 2, 1)), onTouchstart: e[17] || (e[17] = (o) => t.changeCropSize(o, true, true, 2, 1)) }, null, 32), v("span", { class: "crop-point point4", onMousedown: e[18] || (e[18] = (o) => t.changeCropSize(o, true, false, 1, 0)), onTouchstart: e[19] || (e[19] = (o) => t.changeCropSize(o, true, false, 1, 0)) }, null, 32), v("span", { class: "crop-point point5", onMousedown: e[20] || (e[20] = (o) => t.changeCropSize(o, true, false, 2, 0)), onTouchstart: e[21] || (e[21] = (o) => t.changeCropSize(o, true, false, 2, 0)) }, null, 32), v("span", { class: "crop-point point6", onMousedown: e[22] || (e[22] = (o) => t.changeCropSize(o, true, true, 1, 2)), onTouchstart: e[23] || (e[23] = (o) => t.changeCropSize(o, true, true, 1, 2)) }, null, 32), v("span", { class: "crop-point point7", onMousedown: e[24] || (e[24] = (o) => t.changeCropSize(o, false, true, 0, 2)), onTouchstart: e[25] || (e[25] = (o) => t.changeCropSize(o, false, true, 0, 2)) }, null, 32), v("span", { class: "crop-point point8", onMousedown: e[26] || (e[26] = (o) => t.changeCropSize(o, true, true, 2, 2)), onTouchstart: e[27] || (e[27] = (o) => t.changeCropSize(o, true, true, 2, 2)) }, null, 32)]))], 4), [[H, t.cropping]])], 544);
}
const F = N(A, [["render", U], ["__scopeId", "data-v-a742df44"]]);
export {
  F as M
};
