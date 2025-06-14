import { au as isObject, k as isClient, ap as buildProps, az as definePropType, aA as mutable, ax as isNumber, y as defineComponent, aB as markRaw, aC as full_screen_default, aD as scale_to_original_default, aq as useLocale, am as useNamespace, aE as useZIndex, r as ref, aF as effectScope, s as shallowRef, N as computed, Y as watch, $ as nextTick, o as onMounted, aG as useEventListener, b as openBlock, h as createBlock, i as withCtx, f as createVNode, T as Transition, d as createBaseVNode, n as normalizeClass, O as unref, X as normalizeStyle, aH as ElFocusTrap, a1 as withModifiers, e as createCommentVNode, a4 as ElIcon, aI as close_default, c as createElementBlock, H as Fragment, aJ as arrow_left_default, aK as arrow_right_default, Z as renderSlot, B as createTextVNode, t as toDisplayString, aL as zoom_out_default, aM as zoom_in_default, al as resolveDynamicComponent, aN as refresh_left_default, aO as refresh_right_default, I as renderList, g as withDirectives, v as vShow, aP as ElTeleport, ao as _export_sfc, aQ as EVENT_CODE, aR as keysOf, as as withInstall, aS as useAttrs, aT as fromPairs, aU as useAttrs$1, l as isArray, aV as mergeProps, aW as normalizeProps, aX as guardReactiveProps, m as isElement, ab as isString, aY as getScrollContainer, aZ as useThrottleFn } from "./main-zTjO05wq.js";
import { d as debounce } from "./debounce-Aw5yKx-N.js";
var FUNC_ERROR_TEXT = "Expected a function";
function throttle(func, wait, options) {
  var leading = true, trailing = true;
  if (typeof func != "function") {
    throw new TypeError(FUNC_ERROR_TEXT);
  }
  if (isObject(options)) {
    leading = "leading" in options ? !!options.leading : leading;
    trailing = "trailing" in options ? !!options.trailing : trailing;
  }
  return debounce(func, wait, {
    "leading": leading,
    "maxWait": wait,
    "trailing": trailing
  });
}
const isInContainer = (el, container) => {
  if (!isClient || !el || !container)
    return false;
  const elRect = el.getBoundingClientRect();
  let containerRect;
  if (container instanceof Element) {
    containerRect = container.getBoundingClientRect();
  } else {
    containerRect = {
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      left: 0
    };
  }
  return elRect.top < containerRect.bottom && elRect.bottom > containerRect.top && elRect.right > containerRect.left && elRect.left < containerRect.right;
};
const imageViewerProps = buildProps({
  urlList: {
    type: definePropType(Array),
    default: () => mutable([])
  },
  zIndex: {
    type: Number
  },
  initialIndex: {
    type: Number,
    default: 0
  },
  infinite: {
    type: Boolean,
    default: true
  },
  hideOnClickModal: Boolean,
  teleported: Boolean,
  closeOnPressEscape: {
    type: Boolean,
    default: true
  },
  zoomRate: {
    type: Number,
    default: 1.2
  },
  minScale: {
    type: Number,
    default: 0.2
  },
  maxScale: {
    type: Number,
    default: 7
  },
  showProgress: {
    type: Boolean,
    default: false
  },
  crossorigin: {
    type: definePropType(String)
  }
});
const imageViewerEmits = {
  close: () => true,
  switch: (index) => isNumber(index),
  rotate: (deg) => isNumber(deg)
};
const __default__$1 = defineComponent({
  name: "ElImageViewer"
});
const _sfc_main$1 = /* @__PURE__ */ defineComponent({
  ...__default__$1,
  props: imageViewerProps,
  emits: imageViewerEmits,
  setup(__props, { expose, emit }) {
    var _a;
    const props = __props;
    const modes = {
      CONTAIN: {
        name: "contain",
        icon: markRaw(full_screen_default)
      },
      ORIGINAL: {
        name: "original",
        icon: markRaw(scale_to_original_default)
      }
    };
    let stopWheelListener;
    let prevOverflow = "";
    const { t } = useLocale();
    const ns = useNamespace("image-viewer");
    const { nextZIndex } = useZIndex();
    const wrapper = ref();
    const imgRefs = ref([]);
    const scopeEventListener = effectScope();
    const loading = ref(true);
    const activeIndex = ref(props.initialIndex);
    const mode = shallowRef(modes.CONTAIN);
    const transform = ref({
      scale: 1,
      deg: 0,
      offsetX: 0,
      offsetY: 0,
      enableTransition: false
    });
    const zIndex = ref((_a = props.zIndex) != null ? _a : nextZIndex());
    const isSingle = computed(() => {
      const { urlList } = props;
      return urlList.length <= 1;
    });
    const isFirst = computed(() => activeIndex.value === 0);
    const isLast = computed(() => activeIndex.value === props.urlList.length - 1);
    const currentImg = computed(() => props.urlList[activeIndex.value]);
    const arrowPrevKls = computed(() => [
      ns.e("btn"),
      ns.e("prev"),
      ns.is("disabled", !props.infinite && isFirst.value)
    ]);
    const arrowNextKls = computed(() => [
      ns.e("btn"),
      ns.e("next"),
      ns.is("disabled", !props.infinite && isLast.value)
    ]);
    const imgStyle = computed(() => {
      const { scale, deg, offsetX, offsetY, enableTransition } = transform.value;
      let translateX = offsetX / scale;
      let translateY = offsetY / scale;
      const radian = deg * Math.PI / 180;
      const cosRadian = Math.cos(radian);
      const sinRadian = Math.sin(radian);
      translateX = translateX * cosRadian + translateY * sinRadian;
      translateY = translateY * cosRadian - offsetX / scale * sinRadian;
      const style = {
        transform: `scale(${scale}) rotate(${deg}deg) translate(${translateX}px, ${translateY}px)`,
        transition: enableTransition ? "transform .3s" : ""
      };
      if (mode.value.name === modes.CONTAIN.name) {
        style.maxWidth = style.maxHeight = "100%";
      }
      return style;
    });
    const progress = computed(() => `${activeIndex.value + 1} / ${props.urlList.length}`);
    function hide() {
      unregisterEventListener();
      stopWheelListener == null ? void 0 : stopWheelListener();
      document.body.style.overflow = prevOverflow;
      emit("close");
    }
    function registerEventListener() {
      const keydownHandler = throttle((e) => {
        switch (e.code) {
          case EVENT_CODE.esc:
            props.closeOnPressEscape && hide();
            break;
          case EVENT_CODE.space:
            toggleMode();
            break;
          case EVENT_CODE.left:
            prev();
            break;
          case EVENT_CODE.up:
            handleActions("zoomIn");
            break;
          case EVENT_CODE.right:
            next();
            break;
          case EVENT_CODE.down:
            handleActions("zoomOut");
            break;
        }
      });
      const mousewheelHandler = throttle((e) => {
        const delta = e.deltaY || e.deltaX;
        handleActions(delta < 0 ? "zoomIn" : "zoomOut", {
          zoomRate: props.zoomRate,
          enableTransition: false
        });
      });
      scopeEventListener.run(() => {
        useEventListener(document, "keydown", keydownHandler);
        useEventListener(document, "wheel", mousewheelHandler);
      });
    }
    function unregisterEventListener() {
      scopeEventListener.stop();
    }
    function handleImgLoad() {
      loading.value = false;
    }
    function handleImgError(e) {
      loading.value = false;
      e.target.alt = t("el.image.error");
    }
    function handleMouseDown(e) {
      if (loading.value || e.button !== 0 || !wrapper.value)
        return;
      transform.value.enableTransition = false;
      const { offsetX, offsetY } = transform.value;
      const startX = e.pageX;
      const startY = e.pageY;
      const dragHandler = throttle((ev) => {
        transform.value = {
          ...transform.value,
          offsetX: offsetX + ev.pageX - startX,
          offsetY: offsetY + ev.pageY - startY
        };
      });
      const removeMousemove = useEventListener(document, "mousemove", dragHandler);
      useEventListener(document, "mouseup", () => {
        removeMousemove();
      });
      e.preventDefault();
    }
    function reset() {
      transform.value = {
        scale: 1,
        deg: 0,
        offsetX: 0,
        offsetY: 0,
        enableTransition: false
      };
    }
    function toggleMode() {
      if (loading.value)
        return;
      const modeNames = keysOf(modes);
      const modeValues = Object.values(modes);
      const currentMode = mode.value.name;
      const index = modeValues.findIndex((i) => i.name === currentMode);
      const nextIndex = (index + 1) % modeNames.length;
      mode.value = modes[modeNames[nextIndex]];
      reset();
    }
    function setActiveItem(index) {
      const len = props.urlList.length;
      activeIndex.value = (index + len) % len;
    }
    function prev() {
      if (isFirst.value && !props.infinite)
        return;
      setActiveItem(activeIndex.value - 1);
    }
    function next() {
      if (isLast.value && !props.infinite)
        return;
      setActiveItem(activeIndex.value + 1);
    }
    function handleActions(action, options = {}) {
      if (loading.value)
        return;
      const { minScale, maxScale } = props;
      const { zoomRate, rotateDeg, enableTransition } = {
        zoomRate: props.zoomRate,
        rotateDeg: 90,
        enableTransition: true,
        ...options
      };
      switch (action) {
        case "zoomOut":
          if (transform.value.scale > minScale) {
            transform.value.scale = Number.parseFloat((transform.value.scale / zoomRate).toFixed(3));
          }
          break;
        case "zoomIn":
          if (transform.value.scale < maxScale) {
            transform.value.scale = Number.parseFloat((transform.value.scale * zoomRate).toFixed(3));
          }
          break;
        case "clockwise":
          transform.value.deg += rotateDeg;
          emit("rotate", transform.value.deg);
          break;
        case "anticlockwise":
          transform.value.deg -= rotateDeg;
          emit("rotate", transform.value.deg);
          break;
      }
      transform.value.enableTransition = enableTransition;
    }
    function onFocusoutPrevented(event) {
      var _a2;
      if (((_a2 = event.detail) == null ? void 0 : _a2.focusReason) === "pointer") {
        event.preventDefault();
      }
    }
    function onCloseRequested() {
      if (props.closeOnPressEscape) {
        hide();
      }
    }
    function wheelHandler(e) {
      if (!e.ctrlKey)
        return;
      if (e.deltaY < 0) {
        e.preventDefault();
        return false;
      } else if (e.deltaY > 0) {
        e.preventDefault();
        return false;
      }
    }
    watch(currentImg, () => {
      nextTick(() => {
        const $img = imgRefs.value[0];
        if (!($img == null ? void 0 : $img.complete)) {
          loading.value = true;
        }
      });
    });
    watch(activeIndex, (val) => {
      reset();
      emit("switch", val);
    });
    onMounted(() => {
      registerEventListener();
      stopWheelListener = useEventListener("wheel", wheelHandler, {
        passive: false
      });
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    });
    expose({
      setActiveItem
    });
    return (_ctx, _cache) => {
      return openBlock(), createBlock(unref(ElTeleport), {
        to: "body",
        disabled: !_ctx.teleported
      }, {
        default: withCtx(() => [
          createVNode(Transition, {
            name: "viewer-fade",
            appear: ""
          }, {
            default: withCtx(() => [
              createBaseVNode("div", {
                ref_key: "wrapper",
                ref: wrapper,
                tabindex: -1,
                class: normalizeClass(unref(ns).e("wrapper")),
                style: normalizeStyle({ zIndex: zIndex.value })
              }, [
                createVNode(unref(ElFocusTrap), {
                  loop: "",
                  trapped: "",
                  "focus-trap-el": wrapper.value,
                  "focus-start-el": "container",
                  onFocusoutPrevented,
                  onReleaseRequested: onCloseRequested
                }, {
                  default: withCtx(() => [
                    createBaseVNode("div", {
                      class: normalizeClass(unref(ns).e("mask")),
                      onClick: withModifiers(($event) => _ctx.hideOnClickModal && hide(), ["self"])
                    }, null, 10, ["onClick"]),
                    createCommentVNode(" CLOSE "),
                    createBaseVNode("span", {
                      class: normalizeClass([unref(ns).e("btn"), unref(ns).e("close")]),
                      onClick: hide
                    }, [
                      createVNode(unref(ElIcon), null, {
                        default: withCtx(() => [
                          createVNode(unref(close_default))
                        ]),
                        _: 1
                      })
                    ], 2),
                    createCommentVNode(" ARROW "),
                    !unref(isSingle) ? (openBlock(), createElementBlock(Fragment, { key: 0 }, [
                      createBaseVNode("span", {
                        class: normalizeClass(unref(arrowPrevKls)),
                        onClick: prev
                      }, [
                        createVNode(unref(ElIcon), null, {
                          default: withCtx(() => [
                            createVNode(unref(arrow_left_default))
                          ]),
                          _: 1
                        })
                      ], 2),
                      createBaseVNode("span", {
                        class: normalizeClass(unref(arrowNextKls)),
                        onClick: next
                      }, [
                        createVNode(unref(ElIcon), null, {
                          default: withCtx(() => [
                            createVNode(unref(arrow_right_default))
                          ]),
                          _: 1
                        })
                      ], 2)
                    ], 64)) : createCommentVNode("v-if", true),
                    _ctx.showProgress ? (openBlock(), createElementBlock("div", {
                      key: 1,
                      class: normalizeClass([unref(ns).e("btn"), unref(ns).e("progress")])
                    }, [
                      renderSlot(_ctx.$slots, "progress", {
                        activeIndex: activeIndex.value,
                        total: _ctx.urlList.length
                      }, () => [
                        createTextVNode(toDisplayString(unref(progress)), 1)
                      ])
                    ], 2)) : createCommentVNode("v-if", true),
                    createCommentVNode(" ACTIONS "),
                    createBaseVNode("div", {
                      class: normalizeClass([unref(ns).e("btn"), unref(ns).e("actions")])
                    }, [
                      createBaseVNode("div", {
                        class: normalizeClass(unref(ns).e("actions__inner"))
                      }, [
                        renderSlot(_ctx.$slots, "toolbar", {
                          actions: handleActions,
                          prev,
                          next,
                          reset: toggleMode,
                          activeIndex: activeIndex.value
                        }, () => [
                          createVNode(unref(ElIcon), {
                            onClick: ($event) => handleActions("zoomOut")
                          }, {
                            default: withCtx(() => [
                              createVNode(unref(zoom_out_default))
                            ]),
                            _: 1
                          }, 8, ["onClick"]),
                          createVNode(unref(ElIcon), {
                            onClick: ($event) => handleActions("zoomIn")
                          }, {
                            default: withCtx(() => [
                              createVNode(unref(zoom_in_default))
                            ]),
                            _: 1
                          }, 8, ["onClick"]),
                          createBaseVNode("i", {
                            class: normalizeClass(unref(ns).e("actions__divider"))
                          }, null, 2),
                          createVNode(unref(ElIcon), { onClick: toggleMode }, {
                            default: withCtx(() => [
                              (openBlock(), createBlock(resolveDynamicComponent(unref(mode).icon)))
                            ]),
                            _: 1
                          }),
                          createBaseVNode("i", {
                            class: normalizeClass(unref(ns).e("actions__divider"))
                          }, null, 2),
                          createVNode(unref(ElIcon), {
                            onClick: ($event) => handleActions("anticlockwise")
                          }, {
                            default: withCtx(() => [
                              createVNode(unref(refresh_left_default))
                            ]),
                            _: 1
                          }, 8, ["onClick"]),
                          createVNode(unref(ElIcon), {
                            onClick: ($event) => handleActions("clockwise")
                          }, {
                            default: withCtx(() => [
                              createVNode(unref(refresh_right_default))
                            ]),
                            _: 1
                          }, 8, ["onClick"])
                        ])
                      ], 2)
                    ], 2),
                    createCommentVNode(" CANVAS "),
                    createBaseVNode("div", {
                      class: normalizeClass(unref(ns).e("canvas"))
                    }, [
                      (openBlock(true), createElementBlock(Fragment, null, renderList(_ctx.urlList, (url, i) => {
                        return withDirectives((openBlock(), createElementBlock("img", {
                          ref_for: true,
                          ref: (el) => imgRefs.value[i] = el,
                          key: url,
                          src: url,
                          style: normalizeStyle(unref(imgStyle)),
                          class: normalizeClass(unref(ns).e("img")),
                          crossorigin: _ctx.crossorigin,
                          onLoad: handleImgLoad,
                          onError: handleImgError,
                          onMousedown: handleMouseDown
                        }, null, 46, ["src", "crossorigin"])), [
                          [vShow, i === activeIndex.value]
                        ]);
                      }), 128))
                    ], 2),
                    renderSlot(_ctx.$slots, "default")
                  ]),
                  _: 3
                }, 8, ["focus-trap-el"])
              ], 6)
            ]),
            _: 3
          })
        ]),
        _: 3
      }, 8, ["disabled"]);
    };
  }
});
var ImageViewer = /* @__PURE__ */ _export_sfc(_sfc_main$1, [["__file", "image-viewer.vue"]]);
const ElImageViewer = withInstall(ImageViewer);
const imageProps = buildProps({
  hideOnClickModal: Boolean,
  src: {
    type: String,
    default: ""
  },
  fit: {
    type: String,
    values: ["", "contain", "cover", "fill", "none", "scale-down"],
    default: ""
  },
  loading: {
    type: String,
    values: ["eager", "lazy"]
  },
  lazy: Boolean,
  scrollContainer: {
    type: definePropType([String, Object])
  },
  previewSrcList: {
    type: definePropType(Array),
    default: () => mutable([])
  },
  previewTeleported: Boolean,
  zIndex: {
    type: Number
  },
  initialIndex: {
    type: Number,
    default: 0
  },
  infinite: {
    type: Boolean,
    default: true
  },
  closeOnPressEscape: {
    type: Boolean,
    default: true
  },
  zoomRate: {
    type: Number,
    default: 1.2
  },
  minScale: {
    type: Number,
    default: 0.2
  },
  maxScale: {
    type: Number,
    default: 7
  },
  showProgress: {
    type: Boolean,
    default: false
  },
  crossorigin: {
    type: definePropType(String)
  }
});
const imageEmits = {
  load: (evt) => evt instanceof Event,
  error: (evt) => evt instanceof Event,
  switch: (val) => isNumber(val),
  close: () => true,
  show: () => true
};
const __default__ = defineComponent({
  name: "ElImage",
  inheritAttrs: false
});
const _sfc_main = /* @__PURE__ */ defineComponent({
  ...__default__,
  props: imageProps,
  emits: imageEmits,
  setup(__props, { expose, emit }) {
    const props = __props;
    const { t } = useLocale();
    const ns = useNamespace("image");
    const rawAttrs = useAttrs();
    const containerAttrs = computed(() => {
      return fromPairs(Object.entries(rawAttrs).filter(([key]) => /^(data-|on[A-Z])/i.test(key) || ["id", "style"].includes(key)));
    });
    const imgAttrs = useAttrs$1({
      excludeListeners: true,
      excludeKeys: computed(() => {
        return Object.keys(containerAttrs.value);
      })
    });
    const imageSrc = ref();
    const hasLoadError = ref(false);
    const isLoading = ref(true);
    const showViewer = ref(false);
    const container = ref();
    const _scrollContainer = ref();
    const supportLoading = isClient && "loading" in HTMLImageElement.prototype;
    let stopScrollListener;
    const imageKls = computed(() => [
      ns.e("inner"),
      preview.value && ns.e("preview"),
      isLoading.value && ns.is("loading")
    ]);
    const imageStyle = computed(() => {
      const { fit } = props;
      if (isClient && fit) {
        return { objectFit: fit };
      }
      return {};
    });
    const preview = computed(() => {
      const { previewSrcList } = props;
      return isArray(previewSrcList) && previewSrcList.length > 0;
    });
    const imageIndex = computed(() => {
      const { previewSrcList, initialIndex } = props;
      let previewIndex = initialIndex;
      if (initialIndex > previewSrcList.length - 1) {
        previewIndex = 0;
      }
      return previewIndex;
    });
    const isManual = computed(() => {
      if (props.loading === "eager")
        return false;
      return !supportLoading && props.loading === "lazy" || props.lazy;
    });
    const loadImage = () => {
      if (!isClient)
        return;
      isLoading.value = true;
      hasLoadError.value = false;
      imageSrc.value = props.src;
    };
    function handleLoad(event) {
      isLoading.value = false;
      hasLoadError.value = false;
      emit("load", event);
    }
    function handleError(event) {
      isLoading.value = false;
      hasLoadError.value = true;
      emit("error", event);
    }
    function handleLazyLoad() {
      if (isInContainer(container.value, _scrollContainer.value)) {
        loadImage();
        removeLazyLoadListener();
      }
    }
    const lazyLoadHandler = useThrottleFn(handleLazyLoad, 200, true);
    async function addLazyLoadListener() {
      var _a;
      if (!isClient)
        return;
      await nextTick();
      const { scrollContainer } = props;
      if (isElement(scrollContainer)) {
        _scrollContainer.value = scrollContainer;
      } else if (isString(scrollContainer) && scrollContainer !== "") {
        _scrollContainer.value = (_a = document.querySelector(scrollContainer)) != null ? _a : void 0;
      } else if (container.value) {
        _scrollContainer.value = getScrollContainer(container.value);
      }
      if (_scrollContainer.value) {
        stopScrollListener = useEventListener(_scrollContainer, "scroll", lazyLoadHandler);
        setTimeout(() => handleLazyLoad(), 100);
      }
    }
    function removeLazyLoadListener() {
      if (!isClient || !_scrollContainer.value || !lazyLoadHandler)
        return;
      stopScrollListener == null ? void 0 : stopScrollListener();
      _scrollContainer.value = void 0;
    }
    function clickHandler() {
      if (!preview.value)
        return;
      showViewer.value = true;
      emit("show");
    }
    function closeViewer() {
      showViewer.value = false;
      emit("close");
    }
    function switchViewer(val) {
      emit("switch", val);
    }
    watch(() => props.src, () => {
      if (isManual.value) {
        isLoading.value = true;
        hasLoadError.value = false;
        removeLazyLoadListener();
        addLazyLoadListener();
      } else {
        loadImage();
      }
    });
    onMounted(() => {
      if (isManual.value) {
        addLazyLoadListener();
      } else {
        loadImage();
      }
    });
    expose({
      showPreview: clickHandler
    });
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("div", mergeProps({
        ref_key: "container",
        ref: container
      }, unref(containerAttrs), {
        class: [unref(ns).b(), _ctx.$attrs.class]
      }), [
        hasLoadError.value ? renderSlot(_ctx.$slots, "error", { key: 0 }, () => [
          createBaseVNode("div", {
            class: normalizeClass(unref(ns).e("error"))
          }, toDisplayString(unref(t)("el.image.error")), 3)
        ]) : (openBlock(), createElementBlock(Fragment, { key: 1 }, [
          imageSrc.value !== void 0 ? (openBlock(), createElementBlock("img", mergeProps({ key: 0 }, unref(imgAttrs), {
            src: imageSrc.value,
            loading: _ctx.loading,
            style: unref(imageStyle),
            class: unref(imageKls),
            crossorigin: _ctx.crossorigin,
            onClick: clickHandler,
            onLoad: handleLoad,
            onError: handleError
          }), null, 16, ["src", "loading", "crossorigin"])) : createCommentVNode("v-if", true),
          isLoading.value ? (openBlock(), createElementBlock("div", {
            key: 1,
            class: normalizeClass(unref(ns).e("wrapper"))
          }, [
            renderSlot(_ctx.$slots, "placeholder", {}, () => [
              createBaseVNode("div", {
                class: normalizeClass(unref(ns).e("placeholder"))
              }, null, 2)
            ])
          ], 2)) : createCommentVNode("v-if", true)
        ], 64)),
        unref(preview) ? (openBlock(), createElementBlock(Fragment, { key: 2 }, [
          showViewer.value ? (openBlock(), createBlock(unref(ElImageViewer), {
            key: 0,
            "z-index": _ctx.zIndex,
            "initial-index": unref(imageIndex),
            infinite: _ctx.infinite,
            "zoom-rate": _ctx.zoomRate,
            "min-scale": _ctx.minScale,
            "max-scale": _ctx.maxScale,
            "show-progress": _ctx.showProgress,
            "url-list": _ctx.previewSrcList,
            crossorigin: _ctx.crossorigin,
            "hide-on-click-modal": _ctx.hideOnClickModal,
            teleported: _ctx.previewTeleported,
            "close-on-press-escape": _ctx.closeOnPressEscape,
            onClose: closeViewer,
            onSwitch: switchViewer
          }, {
            progress: withCtx((progress) => [
              renderSlot(_ctx.$slots, "progress", normalizeProps(guardReactiveProps(progress)))
            ]),
            toolbar: withCtx((toolbar) => [
              renderSlot(_ctx.$slots, "toolbar", normalizeProps(guardReactiveProps(toolbar)))
            ]),
            default: withCtx(() => [
              _ctx.$slots.viewer ? (openBlock(), createElementBlock("div", { key: 0 }, [
                renderSlot(_ctx.$slots, "viewer")
              ])) : createCommentVNode("v-if", true)
            ]),
            _: 3
          }, 8, ["z-index", "initial-index", "infinite", "zoom-rate", "min-scale", "max-scale", "show-progress", "url-list", "crossorigin", "hide-on-click-modal", "teleported", "close-on-press-escape"])) : createCommentVNode("v-if", true)
        ], 64)) : createCommentVNode("v-if", true)
      ], 16);
    };
  }
});
var Image = /* @__PURE__ */ _export_sfc(_sfc_main, [["__file", "image.vue"]]);
const ElImage = withInstall(Image);
export {
  ElImage as E,
  throttle as t
};
