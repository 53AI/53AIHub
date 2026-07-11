// 用用户提供的真实 repro 内容做端到端验证 (内联, 不依赖外部文件)
import { describe, expect, it } from "vitest";
import { splitMarkdownIntoChunks } from "./markdown";

const UNTITLED_1 = `<!-- NB/T 47014-2023 -->

6.4.1.4 力学性能试验和弯曲试验的取样要求:

a) 取样时,一般采用冷加工方法,当采用热加工方法取样时,则应去除热影响区;

b)允许避开焊接缺陷制取试样;

c) 试样去除焊缝余高前允许对试样进行冷校平;

d)板状对接焊缝试件上试样取样位置按图2所示;

c)管状对接焊缝试件上试样取样位置按图3所示。

![](http://192.168.1.250:9002/api/preview/d61e203dcdbf3468f64e68296bfd4db4.jpg)
<!-- <description>图像显示了一个简单的图表，由一个水平线和一系列垂直线组成，这些线从左到右排列。每条线都标有一个数字，从1到9，表示一个序列或列表。这些线是黑色的，背景是白色的，没有额外的元素或颜色。线条之间有明显的间距，它们的长度各不相同，表明它们代表不同的类别或类别。</description>
<text>牵引: 未载
牵引车: 未载
牵引车: 未载
牵引车: 未载
牵引车: 未载
牵引车: 未载
牵引车: 未载
牵引车: 未载
牵引车: 未载
牵引车: 未载
牵引车: 未载
牵引车: 未载
牵引车: 未载
牵引车: 未载
牵引车: 未载
牵引车: 未载
牵引车: 未载</text> -->

![](http://192.168.1.250:9002/api/preview/453dea14299e9cf09e9efcb723924e32.jpg)
<!-- <description>图像展示了一个简单的图表，由一个水平线和一系列垂直线组成，形成一个网格。 每个垂直线都标有一个数字，从1到9，表明这是一个数字序列或表。 线是黑色的，背景是白色的，使得数字清晰可读。 在网格上方，有一个水平线，上面有文本，但由于图像分辨率不高，无法辨认。 图像中没有其他可辨认的元素或背景信息。</description>
<text>牵引: 未牵引
牵引车: 一车
拖车: 二车
拖车三车: 三车
牵引车: 一车
牵引车二车: 三车
牵引车三车: 三车
牵引车四车: 三车
牵引车: 未牵引
牵引车二车: 三车
牵引车三车: 三车
牵引车四车: 三车</text> -->

a)不取侧考试样时

b)取侧考试样时

c)取纵向弯曲试样时

藏

<!-- 45 -->`;

describe("真实 repro: Untitled-1.md", () => {
  it("修复后所有 chunk 的 HTML 注释开闭配对平衡", () => {
    const chunks = splitMarkdownIntoChunks(UNTITLED_1, {
      maxChunkLength: 3000,
      maxChunkLines: 50,
      minChunkLength: 500,
    });
    for (const c of chunks) {
      const opens = (c.content.match(/<!--/g) || []).length;
      const closes = (c.content.match(/-->/g) || []).length;
      expect(opens).toBe(closes);
    }
  });
});
