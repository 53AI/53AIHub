<div align="center">
  <a href="https://www.53ai.com/products/53AIHub"><img alt="製品紹介ページ" src="https://oss.ibos.cn/53ai/common/53AIHub_banner.png"></a>
</div>

<div align="center">
<a href="./README.md"><img alt="README（英語）" src="https://img.shields.io/badge/English-d9d9d9"></a>
<a href="./README_CN.md"><img alt="簡体字中国語README" src="https://img.shields.io/badge/简体中文-d9d9d9"></a>
<a href="./README_JA.md"><img alt="日本語README" src="https://img.shields.io/badge/日本語-d9d9d9"></a>
</div>

<div>
<a href="https://hub.53ai.com">クラウドサービス</a> ·
<a href="https://docs.53ai.com/%E5%85%A5%E9%97%A8/%E6%9C%AC%E5%9C%B0%E9%83%A8%E7%BD%B2">ローカル導入</a> ·
<a href="https://docs.53ai.com/">製品ドキュメント</a> ·
<a href="https://aihub.53ai.com">デモサイト</a>
</div>

**53AI Hub** は、**オープンソースのAIポータル**です。AIエージェント、プロンプト、AIツールの公開・運用を迅速に構築できます。**ByteDance Coze、Tencent Yuanqi、Dify、FastGPT、RAGFlow、53AI Studio**などの開発プラットフォーム、**Aliyun ModelScope、Tencent Cloud、Volcano Ark、Baidu Qianfan AppBuild**などのクラウドプラットフォームとシームレスに連携できます。技術的な統合作業を必要とせず、非技術者でもAIエージェントの運用に参加できるため、AI活用のハードルを大幅に下げることができます。

主な機能：

**1. プラットフォーム連携**：
主流のエージェント開発・クラウド・大規模言語モデル（LLM）との接続。サイトテンプレートやスタイルを選択し、UIをカスタマイズ可能。

**2. アプリケーション管理**：
AIエージェント、プロンプト、ツールの公開、管理、分類、順序、アクセス権限などを設定。

**3. ユーザー管理**：
登録ユーザーと内部ユーザーのログインや利用履歴を確認・管理。

**4. 独立導入**：
クラウドまたはローカル環境にワンクリックで導入可能。独自ドメインも設定可能。

## 製品比較

| 機能             | 53AI Hub                | NextChat     | lobehub      | Cherry Studio |
| ---------------- | ----------------------- | ------------ | ------------ | ------------- |
| UIカスタマイズ   | 多様なスタイル          | 固定スタイル | 固定スタイル | 固定スタイル  |
| アクセス制御     | 企業レベル              | なし         | なし         | なし          |
| エージェント統合 | ✅                      | ❌           | ❌           | ❌            |
| LLM統合          | ✅                      | ✅           | ✅           | ✅            |
| 登録ユーザー     | ✅                      | ✅           | ✅           | ✅            |
| 内部ユーザー     | ✅                      | ❌           | ❌           | ❌            |
| SSO対応          | WeCom、DingTalk、Feishu | ❌           | ❌           | ❌            |
| ローカル導入     | ✅                      | ✅           | ✅           | ✅            |
| AIナレッジベース | ✅                      | ❌           | ❌           | ❌            |
| AIワークベンチ   | ✅                      | ❌           | ❌           | ❌            |
| SKILL対応        | ✅                      | ❌           | ❌           | ❌            |

## 利用方法

* **クラウドサービス**
  [53AI Hubクラウドサービス](https://hub.53ai.com)から申請可能。無料版、標準版、企業版を提供。無料版では10個のAIエージェントと100人のユーザーが利用可能。
* **オープンソース版**
  [入門ガイド](https://docs.53ai.com/%E5%85%A5%E9%97%A8/%E6%AC%A2%E8%BF%8E%E4%BD%BF%E7%94%A8)を参照し、ローカルに迅速導入可能。[製品ドキュメント](https://docs.53ai.com)で詳細を確認。
* **企業向けカスタム版**
  WeCom、DingTalk、Feishuとの組織連携など企業向け機能に対応。カスタマイズのご希望は[メール](mailto:hub@53ai.com?subject=[GitHub]カスタマイズ要望)にてご相談ください。

## コミュニティ版の導入

### システム要件

最小構成：

* CPU：1コア以上
* メモリ：2GiB以上

### クイックインストール

まずは一行インストーラーを使う方法を推奨します。

```bash
sudo curl -fsSL https://download.53ai.com/install.sh | bash
```

スクリプト完了後、案内に従って初期設定を行い、その後 [`http://localhost:3000`](http://localhost:3000) にアクセスして管理画面を開けます。

### 代替: Docker インストール

Docker を使いたい場合は、[docker-compose.yml](docker/docker-compose.yaml) からも導入できます。事前に [Docker](https://docs.docker.com/get-docker/) と [Docker Compose](https://docs.docker.com/compose/install/) をインストールしてください。：

1. `git clone` でリポジトリをクローン
```bash
git clone https://github.com/53ai/53aihub.git
cd 53aihub
```
2. Docker Composeを実行
```bash
cd docker
docker compose up -d
```

### カスタム設定

`.env.example` を `.env` にコピーし、コメントを参考に必要な値を設定。`docker-compose.yaml`の内容も環境に応じて調整可能です。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=53AI/53AIhub&type=Date)](https://star-history.com/#53AI/53AIhub&Date)


## コミュニティへの参加

> 他言語翻訳の貢献者も募集中です。興味のある方はご連絡ください。

コード、アイデア、フィードバックの提供など、あらゆる形での貢献を歓迎します。

* [GitHub Discussion](https://github.com/53ai/53aihub/discussions)：アプリの共有や交流
* [GitHub Issues](https://github.com/53ai/53aihub/issues)：バグ報告・提案

## 認証取得

53AIは以下の国際認証を取得済み：

* **ISO/IEC 27001:2022 – 情報セキュリティマネジメントシステム**
* **ISO 9001:2015 – 品質マネジメントシステム**

## ライセンス

このリポジトリは [53AI オープンソースライセンス](https://docs.53ai.com/%E5%85%A5%E9%97%A8/%E5%BC%80%E6%BA%90%E8%AE%B8%E5%8F%AF%E5%8D%8F%E8%AE%AE) の下で提供されており、Apache 2.0をベースに追加制限が加えられています。

## フォローしよう

GitHubで53AI Hubにスターを付けると、最新のアップデート通知を受け取ることができます。
