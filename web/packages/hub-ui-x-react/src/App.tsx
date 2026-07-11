import React, { useState } from "react";
import "./App.css";
import {
  BubbleList,
  BubbleAssistant,
  BubbleUser,
  Sender,
  Icon,
} from "../packages";
import { useProcessStream } from "./hooks/useProcessStream";

const userAvatar = "/avatar.png";
const assistantAvatar = "/avatar.png";

const App: React.FC = () => {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([
    /*
    {
      id: 11111,
      content: "",
      type: "received",
      streaming: true,
      time: new Date(Date.now() - 3600000),
    },*/
    {
      id: 1,
      content: "*天气查询*你好，这是一条普通消息",
      type: "sent",
      time: new Date(Date.now() - 3600000),
    },
    {
      id: 10,
      reasoningExpanded: true,
      content: `当前问题可能因内容未收录、解析中或权限限制无法解答。`,
      reasoning: ``,
      suggestions: [
        {
          id: 1,
          content:
            "你好，我是行业洞察大师，专注于行业动态。无论你有什么问题，我都会尽我所能为你提供帮助和支持。",
        },
        {
          id: 2,
          content:
            "asdfsdfsdfsdfdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsasdfasdfadfasdfasdfasfasdfasdfasdfadfasfadfasdfsdfsdfsdfdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsasdfasdfadfasdfasdfasfasdfasdfasdfadfasfadfasdfsdfsdfsdfdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsasdfasdfadfasdfasdfasfasdfasdfasdfadfasfadfasdfsdfsdfsdfdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsasdfasdfadfasdfasdfasfasdfasdfasdfadfasfadfasdfsdfsdfsdfdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsdsasdfasdfadfasdfasdfasfasdfasdfasdfadfasfadf",
        },
      ],
      type: "received",
      time: new Date(Date.now() - 3600000),
    },
    {
      id: 2,
      content: `以下是广州市 **2025年11月18日（星期二）** 的天气预报表格：

| **时间** | **天气状况** | **温度** | **体感温度** | **风力** | **风向** | **降雨概率** | **湿度** | **紫外线** | **空气质量** |
|----------|--------------|----------|--------------|----------|----------|--------------|----------|------------|--------------|
| 06:00    | 阴天         | 12℃      | 10℃          | 北风5级  | 西北偏北 | 10%          | 65%      | 弱         | 优 (AQI 30)  |
| 09:00    | 阴天         | 13℃      | 11℃          | 北风6级  | 西北偏北 | 20%          | 63%      | 弱         | 优 (AQI 32)  |
| 12:00    | 多云         | 15℃      | 13℃          | 北风7级  | 正北     | 30%          | 60%      | 中等       | 良 (AQI 45)  |
| 15:00    | 多云         | 14℃      | 12℃          | 北风6级  | 正北     | 20%          | 62%      | 弱         | 良 (AQI 40)  |
| 18:00    | 阴天         | 13℃      | 11℃          | 北风5级  | 西北偏北 | 10%          | 67%      | 弱         | 优 (AQI 35)  |
| 21:00    | 阴天         | 12℃      | 10℃          | 北风4级  | 西北偏北 | 5%           | 70%      | 无         | 优 (AQI 30)  |

### **天气重点提示**：
1. **大幅降温**：最低温12℃，最高仅15℃，体感温度更低，注意防寒保暖。
2. **大风天气**：白天阵风可达7级，户外活动需注意安全。
3. **局部小雨**：降雨概率最高30%，建议随身携带雨具。
4. **空气质量**：整体优良，适合户外活动。

数据来源：广州市气象台、中国天气网。`,
      type: "received",
      time: new Date(Date.now() - 1800000),
    },
    // 引用格式容错测试数据（见 引用格式容错兼容方案.md）
    {
      id: 20,
      content: `这是一段带多种引用格式的测试内容。

标准格式 [Source:1-5] 应被识别。
空格干扰 [Source: 1 - 5] 应被识别。
双冒号 [Source::2-3] 应被识别。
小写 [source:1-2] 应被识别。
中文冒号 [Source：3-4] 应被识别。
非标连字符 [Source:1—5] 应被识别。
旧格式 [Source_A_1] 与 [Source:a-2] 兜底识别。

以上引用标签均可点击，hover 时可在控制台查看 data。`,
      type: "received",
      time: new Date(Date.now() - 120000),
      rag_stats: {
        type: "doc",
        chunks: [
          { source_key: "[Source:1-5]", content: "Chunk 内容：来源1 第5段" },
          {
            source_key: "[Source: 1 - 5]",
            content: "Chunk 内容：来源1 第5段（带空格）",
          },
          { source_key: "[Source::2-3]", content: "Chunk 内容：来源2 第3段" },
          { source_key: "[source:1-2]", content: "Chunk 内容：来源1 第2段" },
          { source_key: "[Source：3-4]", content: "Chunk 内容：来源3 第4段" },
          {
            source_key: "[Source:1—5]",
            content: "Chunk 内容：来源1 第5段（长横）",
          },
          { source_key: "[Source_A_1]", content: "Chunk 内容：旧格式 A_1" },
          { source_key: "[Source:a-2]", content: "Chunk 内容：旧格式 a-2" },
        ],
      },
    },
    {
      id: 4578,
      content: `\`\`\`mermaid
mindmap
  root((单页产品手册.pdf))
    产品系列型号
      CO2-S1601/T200-50/T300-50
      CO2-T300 / CO2-T400 / CO2-D200
      CO2-G10 / D30 / D55 / D30I / D55I
      CO2-H120 / H200 / H180I
    机器特点
      激光功率大 幅面大 切割效率高
      单模激光 热影响小 不易烧边
      一体化设计 稳定性与可靠性高
      大光斑CO2激光 多项专利技术
      软件控制功率 连续可调
    技术参数Specifications
      激光特性
        CO₂激光
        波长：10.6μm / 10.64um / 9.3um
      功率参数
        最大功率：160W至400W
        功率稳定度：±5%
      加工性能
        打标范围：50mm*50mm至650mm*650mm
        雕刻/打标速度：≤7000mm/s或≤5m/s
        重复精度：±0.01mm至±0.06mm
        最小线宽：0.01mm至0.16mm
        最小字符：1mm
      物理与控制系统
        冷却方式：水冷或风冷
        焦距范围：默认软件调焦 可定制
        控制方式：支持多种文件与字体格式
        主机/外形尺寸
    主要应用场景与适用产品
      适用材料
        非金属材料：真皮 木材 纸张 塑料等
        电子元器件：PCB 柔性线路板 半导体等
        其他材料：工艺礼品 食品包装 陶瓷等
      应用样品举例
        眼镜腿表面雕刻
        手机中框拉丝效果打标
        雪糕棒打标
    激光加工优势
      加工模式先进 效率高
      成本低 全自动 易操作
      标记清晰 不易磨损
      符合环保要求
\`\`\``,
      type: "received",
      time: new Date(Date.now() - 1800000),
    },
  ]);

  // 模拟流式输出的函数
  const simulateStreamingOutput = async (
    messageId: number,
    fullContent: string,
  ) => {
    const chunkSize = 10; // 每次输出的字符数
    let currentContent = "";

    for (let i = 0; i < fullContent.length; i += chunkSize) {
      currentContent += fullContent.slice(i, i + chunkSize);
      const messageIndex = messages.findIndex((msg) => msg.id === messageId);
      if (messageIndex !== -1) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId ? { ...msg, content: currentContent } : msg,
          ),
        );
      }
      // 模拟打字速度
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // 流式输出完成后，更新消息状态
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId ? { ...msg, streaming: false } : msg,
      ),
    );
  };

  const httpRequest = async (file: any) => {
    return new Promise((resolve, reject) => {
      // return {
      //   id: 1,
      //   name: file.name,
      //   size: file.size,
      //   type: file.type,
      //   url: file.url,
      //   mime_type: file.type,
      //   created_at: new Date(),
      //   updated_at: new Date(),
      // }

      reject(new Error("无权限上传"));
    });
  };

  const renderSource = (sourceType: string, sourceNumber: number) => {
    return sourceType + "-" + sourceNumber;
  };

  const sendMessage = (content: string) => {
    if (!content.trim()) return;

    setMessages((prev) => [
      ...prev,
      {
        id: Date.now(),
        content,
        type: "sent",
        time: new Date(),
      },
    ]);

    content = `

以下是一个简单的流程图示例（mermaid格式1）：
以下是一个简单的流程图示例（mermaid格式2）：
以下是一个简单的流程图示例（mermaid格式3）：
以下是一个简单的流程图示例（mermaid格式4）：
以下是一个简单的流程图示例（mermaid格式5）：
以下是一个简单的流程图示例（mermaid格式6）：
以下是一个简单的流程图示例（mermaid格式7）：
以下是一个简单的流程图示例（mermaid格式8）：
以下是一个简单的流程图示例（mermaid格式9）：
以下是一个简单的流程图示例（mermaid格式10）：
以下是一个简单的流程图示例（mermaid格式11）：
以下是一个简单的流程图示例（mermaid格式12）：
以下是一个简单的流程图示例（mermaid格式13）：
以下是一个简单的流程图示例（mermaid格式14）：
以下是一个简单的流程图示例（mermaid格式15）：
以下是一个简单的流程图示例（mermaid格式16）：
以下是一个简单的流程图示例（mermaid格式17）：
以下是一个简单的流程图示例（mermaid格式18）：
以下是一个简单的流程图示例（mermaid格式19）：
以下是一个简单的流程图示例（mermaid格式20）：
以下是一个简单的流程图示例（mermaid格式21）：
以下是一个简单的流程图示例（mermaid格式22）：

\`\`\`mermaid
graph TD
    A[开始] --> B(输入用户名和密码)
    B --> C{验证通过?}
    C -->|是| D[进入欢迎页面]
    C -->|否| E[显示错误提示]
    D --> F{选择操作}
    F --> G[查看个人资料]
    F --> H[修改设置]
    G --> I[结束]
    H --> I
    E --> B
\`\`\`

以下是一个简单的流程图示例（mermaid格式23）：
以下是一个简单的流程图示例（mermaid格式24）：
以下是一个简单的流程图示例（mermaid格式25）：
以下是一个简单的流程图示例（mermaid格式26）：
以下是一个简单的流程图示例（mermaid格式27）：
以下是一个简单的流程图示例（mermaid格式28）：
以下是一个简单的流程图示例（mermaid格式29）：
以下是一个简单的流程图示例（mermaid格式30）：
以下是一个简单的流程图示例（mermaid格式31）：
以下是一个简单的流程图示例（mermaid格式32）：
以下是一个简单的流程图示例（mermaid格式33）：
以下是一个简单的流程图示例（mermaid格式34）：
以下是一个简单的流程图示例（mermaid格式35）：
以下是一个简单的流程图示例（mermaid格式36）：
以下是一个简单的流程图示例（mermaid格式37）：
以下是一个简单的流程图示例（mermaid格式38）：
以下是一个简单的流程图示例（mermaid格式39）：
以下是一个简单的流程图示例（mermaid格式40）：
以下是一个简单的流程图示例（mermaid格式41）：
以下是一个简单的流程图示例（mermaid格式42）：
1234
    `;
    const messageId = Date.now() + 1;
    setMessages((prev) => [
      ...prev,
      {
        id: messageId,
        content: "",
        type: "received",
        time: new Date(),
        streaming: true,
        // error: true,
        // showErrorDetails: false,
      },
    ]);

    // 启动流式输出
    simulateStreamingOutput(messageId, content);
  };

  const handleSuggestion = (content: string) => {
    setMessage(content);
  };

  // 在组件顶层调用 useProcessStream
  const stream = useProcessStream();

  /** 流式输出演示：解析 stream.txt 格式的 SSE，拼接 content 并更新技能运行项与状态（开始/运行中/完成） */
  const runStreamDemo = async () => {
    stream.reset();
    const msgId = Date.now();
    setMessages((prev) => [
      ...prev,
      {
        id: msgId,
        content: "",
        streaming: true,
        type: "received",
        time: new Date(),
      },
    ]);

    try {
      const res = await fetch("/stream.txt");
      const raw = await res.text();
      const lines = raw.split(/\n/).filter((s) => s.trim());
      for (const line of lines) {
        stream.pushLine(line);
        // 更新消息内容
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === msgId);
          if (idx !== -1) {
            const {
              skillRunItems: items,
              content,
              streamStatus,
            } = stream.getLatestState();
            const skillRunBlock =
              items.length > 0
                ? "```skill-run\n" +
                  JSON.stringify(
                    items.map(({ _toolCallId, ...rest }: any) => rest),
                  ) +
                  "\n```\n\n"
                : "";
            const newContent = skillRunBlock + content;
            const newStreaming = streamStatus !== "completed";
            return prev.map((m) =>
              m.id === msgId
                ? { ...m, content: newContent, streaming: newStreaming }
                : m,
            );
          }
          return prev;
        });
        await new Promise((r) => setTimeout(r, 800));
      }
    } catch (_) {
      stream.pushLine("data: [DONE]");
    }

    // 最终检查并更新状态
    setMessages((prev) => {
      const msg = prev.find((m) => m.id === msgId);
      if (msg?.streaming) {
        return prev.map((m) =>
          m.id === msgId ? { ...m, streaming: false } : m,
        );
      }
      return prev;
    });
  };

  const handleSourceReferenceHover = (data: any) => {
    console.log(data);
  };

  const handleSourceReferenceClick = (data: any) => {
    console.log(data);
  };

  const handleShowErrorDetails = (message: any) => {
    if (!message.showErrorDetails) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === message.id ? { ...m, showErrorDetails: true } : m,
        ),
      );
    }
  };

  return (
    <div className="app-container">
      <div className="chat-box">
        <h2 className="chat-title">Bubble 组件</h2>
        <div className="chat-messages">
          <BubbleList
            messages={messages}
            mainClass="chat-messages-list"
            header={
              <BubbleAssistant
                content="我是原生助手sdfsssssssssssssssssssssssssssssssssssssdfasfasfadfasdfadfasdf速度发斯蒂芬爱的色放"
                type="welcome"
                suggestions={[
                  { id: 1, content: "我是原生助手1" },
                  { id: 2, content: "我是原生助手2" },
                  {
                    id: 3,
                    content:
                      "我是原生助手3手动阀双法防sdffffffffffffffffffffffffffffffffffffffffffffffffffffffffs沙发上阿道夫阿斯蒂芬阿斯蒂芬阿斯蒂芬是的",
                  },
                ]}
                onSuggestion={handleSuggestion}
              />
            }
            renderItem={(message: any, index: number) => {
              if (message.type === "sent") {
                return (
                  <BubbleUser
                    key={message.id}
                    content={message.content}
                    avatar={userAvatar}
                    contentBefore={<span>123213</span>}
                    menu={<Icon name="copy" />}
                  />
                );
              } else {
                return (
                  <BubbleAssistant
                    key={message.id}
                    content={message.content}
                    reasoning={message.reasoning}
                    avatar={assistantAvatar}
                    reasoningExpanded={message.reasoningExpanded}
                    streaming={message.streaming}
                    renderSource={renderSource}
                    sourceEnabled
                    onSuggestion={handleSuggestion}
                    onSourceReferenceClick={handleSourceReferenceClick}
                    showError={message.error}
                    error={
                      <div style={{ color: "#333" }}>
                        智能体报错，请检查智能体相关配置！
                        <span
                          style={{
                            color: "blue",
                            cursor: "pointer",
                            textDecoration: "underline",
                          }}
                          onClick={() => handleShowErrorDetails(message)}
                        >
                          点击查看详情
                        </span>
                        {message.showErrorDetails && (
                          <div
                            style={{ marginTop: "8px", whiteSpace: "pre-wrap" }}
                          >
                            {message.content}
                          </div>
                        )}
                      </div>
                    }
                    menu={
                      <>
                        <Icon name="copy" />
                        <Icon name="refresh" />
                      </>
                    }
                  />
                );
              }
            }}
          />
        </div>
      </div>

      <div className="sender-box">
        <h2 className="sender-title">Sender 组件</h2>
        <Sender
          value={message}
          onChange={setMessage}
          enableUpload
          allowSendWithFiles
          httpRequest={httpRequest}
          placeholder="请输入消息..."
          maxLength={500}
          enableDragUpload
          allowMultiple
          onSend={sendMessage}
          extras={
            <button
              type="button"
              className="stream-demo-btn"
              onClick={runStreamDemo}
            >
              流式演示
            </button>
          }
        />
      </div>
    </div>
  );
};

export default App;
