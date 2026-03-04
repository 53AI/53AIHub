<div align="center">
  <a href="https://www.53ai.com/products/53AIHub"><img alt="产品介绍页" src="https://oss.ibos.cn/53ai/common/53AIHub_banner.png"></a>
</div>

<div align="center">
<a href="./README.md"><img alt="README in English" src="https://img.shields.io/badge/English-d9d9d9"></a>
<a href="./README_CN.md"><img alt="简体中文版自述文件" src="https://img.shields.io/badge/简体中文-d9d9d9"></a>
<a href="./README_JA.md"><img alt="日本語のREADME" src="https://img.shields.io/badge/日本語-d9d9d9"></a>

</div>
<div>
<a href="https://hub.53ai.com">云服务</a> ·
<a href="https://docs.53ai.com/%E5%85%A5%E9%97%A8/%E6%9C%AC%E5%9C%B0%E9%83%A8%E7%BD%B2">本地部署</a> ·
<a href="https://docs.53ai.com/">产品文档</a> ·
<a href="https://aihub.53ai.com">演示站</a>

</div>

**53AI Hub** 是一款**开源的AI门户**。它可以让你快速搭建一个运营级的AI门户，实现对智能体、提示词与AI工具的发布与运营。它支持无缝对接**字节扣子、腾讯元器、Dify、FastGPT、RAGFlow、53AI Studio**等智能体开发平台，以及**阿里百炼、腾讯云智能体开发平台、火山方舟、百度千帆 AppBuild**等云计算平台，让开发者和企业能够快速搭建生产运营级的 AI 门户，无需复杂的技术整合流程。即使是没有技术背景的人员，也能轻松参与智能体发布和运营，极大降低了 AI 应用落地的门槛。

以下是核心功能列表： </br> </br>

**1. 平台接入**:
主流的智能体开发平台、云计算平台、大模型平台的接入，可选择站点模板及风格，并进行自定义界面。

**2. 应用管理**:
支持智能体、提示词、AI工具的发布、管理、分组、排序、使用权限等设置。

**3.  用户运营**:
支持注册用户、内部用户两类用户的运营，可以管理和查看用户登录、使用记录,

**4. 独立部署**:
可在云平台及本地一键安装部署，支持绑定独立域名。

## 产品对比

<table style="width:100%;">
  <tr>
    <th align="center">功能</th>
    <th align="center">53AI Hub</th>
    <th align="center">NextChat</th>
    <th align="center">lobehub</th>
    <th align="center">Cherry Studio</th>
  </tr>
  <tr>
    <td align="center">自定义界面</td>
    <td align="center">多风格及样式</td>
    <td align="center">固定风格</td>
    <td align="center">固定风格</td>
    <td align="center">固定风格</td>
  </tr>
  <tr>
    <td align="center">使用权限</td>
    <td align="center">企业级权限</td>
    <td align="center">无</td>
    <td align="center">无</td>
    <td align="center">无</td>
  </tr>
  <tr>
    <td align="center">智能体接入</td>
    <td align="center">✅</td>
    <td align="center">❌</td>
    <td align="center">❌</td>
    <td align="center">❌</td>
  </tr>
  <tr>
    <td align="center">大模型接入</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
  </tr>
  <tr>
    <td align="center">注册用户</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
  </tr>
  <tr>
    <td align="center">内部用户</td>
    <td align="center">✅</td>
    <td align="center">❌</td>
    <td align="center">❌</td>
    <td align="center">❌</td>
  </tr>
  <tr>
    <td align="center">单点登录</td>
    <td align="center">企微、钉钉、飞书</td>
    <td align="center">❌</td>
    <td align="center">❌</td>
    <td align="center">❌</td>
  </tr>
  <tr>
    <td align="center">本地部署</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
  </tr>
</table>

## 使用方式

* **在线云服务 </br>**
  我们提供[ 53AI Hub 云服务](https://hub.53ai.com)，用户可以在线申请开通。云服务包含免费版、标准版和企业版，企业版提供了53AI Hub的全部功能，在免费版本中支持接入10个智能体及100个注册用户。
* **社区开源版</br>**
  通过[入门指南](https://docs.53ai.com/%E5%85%A5%E9%97%A8/%E6%AC%A2%E8%BF%8E%E4%BD%BF%E7%94%A8)快速进行本地部署，阅读[产品文档](https://docs.53ai.com)进行更深入的了解。
* **企业定制版</br>**
  我们提供可以企业定制版，具有包括不限于打通企微、钉钉、飞书组织架构等企业级产品特性，如果你需要个性化定制，也可以通过[电子邮件](mailto\:hub@53ai.com?subject=\[GitHub]个性定制)讨论你的个性化需求。 </br>

## 安装社区版

### 系统要求

53AI Hub 的最低安装配置：

* CPU >= 1 Core
* RAM >= 2 GiB

### 快速安装

安装 53AI Hub 社区版最简单方法是运行我们的 [docker-compose.yml](docker/docker-compose.yaml) 文件。在运行安装命令之前，请确保您的机器上安装了 [Docker](https://docs.docker.com/get-docker/) 和 [Docker Compose](https://docs.docker.com/compose/install/)：

1. 克隆仓库：
```bash
git clone https://github.com/53ai/53aihub.git
cd 53aihub
```
2. 运行安装命令：
```bash
cd docker
docker compose up -d
```

运行后，可以在浏览器上访问 [`http://localhost:3000`](http://localhost:3000) 进入 53AI Hub 并开始初始化配置操作，默认账号通常是`admin@53ai.com` 密码`admin888`。

### 自定义配置

如果您需要自定义配置，请参考 `.env.example`文件中的注释，复制一个改名为 `.env`并更新文件中对应的值。
此外，您可能需要根据您的具体部署环境和需求对 `docker-compose.yaml`文件本身进行调整，例如更改镜像版本、端口映射或卷挂载。完成任何更改后，请重新运行 `docker-compose up -d`。您可以在此处找到可用环境变量的完整列表。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=53AI/53AIhub&type=Date)](https://star-history.com/#53AI/53AIhub&Date)

## 参与项目

> 我们在寻找贡献者来帮助将 53AI Hub 翻译成英文之外的其他语言，如果您有兴趣参与，请通联系我们。

我们欢迎您为 53AI Hub做出贡献，包括不限于：提交代码、提交问题、你的新想法。我们也欢迎您在不同的活动、会议和社交媒体上分享 53AI Hub。

* [Github Discussion](https://github.com/53ai/53aihub/discussions)👉：分享您的应用程序并与社区交流。
* [GitHub Issues](https://github.com/53ai/53aihub/issues)👉：使用 53AI Hub 时遇到的错误和问题。

## 合规认证

53AI 已获取以下认证：

* **ISO/IEC 27001:2022  Information security management systems**
* **ISO 9001:2015 Quality management systems**

## 开源协议

本仓库遵循 [53AI Open Source License](https://docs.53ai.com/%E5%85%A5%E9%97%A8/%E5%BC%80%E6%BA%90%E8%AE%B8%E5%8F%AF%E5%8D%8F%E8%AE%AE) 开源协议，该许可证本质上是 Apache 2.0，但有一些额外的限制。

## 关注我们

在 GitHub 上给 53AI Hub Star，我们更新产品你将第一时间收到新版本更新的通知。

## 商务合作

联系人：杨先生

📮：hub@53ai.com

📱：18688881185 (非客服电话)

![.jpg](http://kmdev.53ai.com/api/preview/e884dbfe4ab8161ee268011111b900c3.jpg)

> 使用问题咨询，可以在官网首页底部加入用户交流群，也可邮件 hub@53ai.com
>
> 如果您需要更多开发和运营指导，可以联系购买商业版本及交付服务


