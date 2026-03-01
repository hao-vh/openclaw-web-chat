# OpenClaw Web Chat Plugin for OpenClaw

OpenClaw Web Chat (OpenClaw Web Chat) 是一个 OpenClaw Channel Plugin，将 Web 聊天室连接到 OpenClaw AI Agent。

## 特性

- 🚀 WebSocket 实时通信
- 💬 群聊 & 私聊支持
- 🤖 AI Agent 自动回复
- 🔄 连接自动重连
- 📡 HTTP 备用模式

## 快速开始

### 1. 安装

```bash
# 克隆仓库
git clone https://github.com/your-repo/web-chat-plugin.git
cd web-chat-plugin

# 一键安装
bash install-web-chat.sh
```

### 2. 启动测试服务器

```bash
node test-server.js
```

### 3. 打开浏览器

访问 http://localhost:3456，开始聊天！

## 详细文档

- [完整教程](TUTORIAL.md) - 安装、配置、故障排查
- [API 文档](TUTORIAL.md#api-文档) - 协议说明

## 架构

```
┌─────────────┐      WebSocket       ┌─────────────┐
│  Web 聊天室  │ ◄──────────────────► │  OpenClaw Web Chat     │
│  (Port 3456)│                      │  Plugin     │
└─────────────┘                      └──────┬──────┘
                                            │
                                    OpenClaw Gateway
                                            │
                                       ┌────┴────┐
                                       │  AI     │
                                       │  Agent  │
                                       └─────────┘
```

## 技术栈

- TypeScript
- OpenClaw Plugin SDK
- WebSocket (ws)
- Express.js

## 许可证

MIT
