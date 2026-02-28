# XiaoWu Plugin 安装使用教程

XiaoWu 是一个 OpenClaw Channel Plugin，让 AI Agent 能够通过 WebSocket 连接到自定义 Web 聊天室，实现双向通信。

## 功能特性

- ✅ WebSocket 实时通信
- ✅ HTTP API 备用模式
- ✅ 群聊和私聊支持
- ✅ AI Agent 自动回复
- ✅ 连接自动重连
- ✅ 消息历史记录

---

## 快速安装

### 方法一：一键安装脚本（推荐）

```bash
# 下载插件包并解压
git clone https://github.com/your-repo/xiaowu-plugin.git
cd xiaowu-plugin

# 运行安装脚本
bash install-xiaowu.sh
```

### 方法二：手动安装

#### 1. 复制插件文件

```bash
# 创建插件目录
mkdir -p ~/.openclaw/extensions/xiaowu

# 复制插件文件（根据实际路径调整）
cp -r /path/to/xiaowu-plugin/* ~/.openclaw/extensions/xiaowu/
```

#### 2. 安装依赖

```bash
cd ~/.openclaw/extensions/xiaowu
npm install
```

#### 3. 配置 OpenClaw

编辑 `~/.openclaw/openclaw.json`，添加以下内容：

```json
{
  "plugins": {
    "entries": {
      "xiaowu": {
        "enabled": true
      }
    },
    "installs": {
      "xiaowu": {
        "source": "local",
        "sourcePath": "/home/your-username/.openclaw/extensions/xiaowu",
        "version": "1.3.0"
      }
    }
  },
  "channels": {
    "xiaowu": {
      "enabled": true,
      "wsUrl": "ws://localhost:3456/ws",
      "apiUrl": "http://localhost:3456",
      "connectionMode": "websocket",
      "autoReconnect": true,
      "dmPolicy": "open",
      "groupPolicy": "open"
    }
  }
}
```

#### 4. 重启 Gateway

```bash
openclaw gateway restart
```

---

## 启动测试服务器

### 方式一：使用示例服务器

```bash
cd ~/.openclaw/extensions/xiaowu
node example-server.js
```

### 方式二：使用完整测试服务器

```bash
cd ~/.openclaw/extensions/xiaowu
node test-server.js
```

服务器启动后：
- Web 界面: http://localhost:3456
- WebSocket: ws://localhost:3456/ws
- API: http://localhost:3456/api/messages

---

## 使用指南

### 1. 打开 Web 聊天室

在浏览器中访问：http://localhost:3456

你会看到一个简洁的聊天界面，可以：
- 发送消息
- 查看历史记录
- 接收 AI 回复

### 2. 发送消息

在输入框中输入消息，按回车或点击发送按钮。

AI 会自动收到消息并回复。

### 3. 查看 AI 回复

AI 的回复会显示在聊天界面中，与普通消息区分显示。

---

## 配置说明

### 基本配置

```json
{
  "channels": {
    "xiaowu": {
      "enabled": true,              // 启用/禁用
      "wsUrl": "ws://localhost:3456/ws",  // WebSocket 地址
      "apiUrl": "http://localhost:3456",  // HTTP API 地址
      "connectionMode": "websocket",      // 连接模式: websocket 或 http
      "autoReconnect": true,              // 自动重连
      "dmPolicy": "open",                 // 私聊策略: open/pairing/allowlist
      "groupPolicy": "open"               // 群聊策略: open/allowlist/disabled
    }
  }
}
```

### 高级配置

#### 多账号配置

```json
{
  "channels": {
    "xiaowu": {
      "enabled": true,
      "accounts": {
        "account1": {
          "enabled": true,
          "name": "测试服务器1",
          "wsUrl": "ws://localhost:3456/ws",
          "apiUrl": "http://localhost:3456"
        },
        "account2": {
          "enabled": true,
          "name": "测试服务器2",
          "wsUrl": "ws://192.168.1.100:3456/ws",
          "apiUrl": "http://192.168.1.100:3456"
        }
      }
    }
  }
}
```

#### HTTP 轮询模式

如果不方便使用 WebSocket，可以切换到 HTTP 轮询模式：

```json
{
  "channels": {
    "xiaowu": {
      "enabled": true,
      "connectionMode": "http",
      "apiUrl": "http://localhost:3456",
      "pollInterval": 3000    // 轮询间隔（毫秒）
    }
  }
}
```

---

## 故障排查

### 问题1：WebSocket 连接失败

**症状**：日志显示 `WebSocket error: Error: connect ECONNREFUSED`

**解决**：
1. 检查测试服务器是否运行：`curl http://localhost:3456/api/messages`
2. 检查端口是否正确：`ss -tlnp | grep 3456`
3. 检查防火墙设置

### 问题2：收不到 AI 回复

**症状**：消息发送成功，但没有收到 AI 回复

**解决**：
1. 检查 Gateway 日志：`tail -f /tmp/openclaw/openclaw-*.log | grep xiaowu`
2. 确认 Agent 配置正确
3. 检查是否有路由配置错误

### 问题3：插件加载失败

**症状**：Gateway 启动时报错 `plugin xiaowu not found`

**解决**：
1. 检查插件路径是否正确
2. 确认 `plugins.installs.xiaowu.sourcePath` 指向正确的目录
3. 运行 `openclaw doctor` 检查配置

---

## API 文档

### 发送消息

```bash
curl -X POST http://localhost:3456/api/messages \
  -H 'Content-Type: application/json' \
  -d '{
    "chatId": "room_1",
    "senderId": "user_001",
    "senderName": "张三",
    "content": "你好！",
    "messageType": "text"
  }'
```

### 获取消息历史

```bash
curl http://localhost:3456/api/messages
```

### WebSocket 协议

**连接**：
```javascript
const ws = new WebSocket('ws://localhost:3456/ws');
```

**发送消息**：
```javascript
ws.send(JSON.stringify({
  type: 'send_message',
  requestId: 'req_123',
  data: {
    chatId: 'room_1',
    content: '你好！'
  }
}));
```

**接收消息**：
```javascript
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('收到消息:', data);
};
```

---

## 开发指南

### 项目结构

```
xiaowu/
├── index.ts              # 插件入口
├── src/
│   ├── channel.ts        # Channel 配置
│   ├── monitor.ts        # 消息监听
│   ├── outbound.ts       # 消息发送
│   ├── send.ts           # 发送逻辑
│   ├── client.ts         # WebSocket/HTTP 客户端
│   ├── runtime.ts        # 运行时管理
│   ├── accounts.ts       # 账号管理
│   ├── targets.ts        # 目标解析
│   └── types.ts          # 类型定义
├── example-server.js     # 示例服务器
└── test-server.js        # 完整测试服务器
```

### 自定义开发

你可以基于 XiaoWu 插件开发自己的聊天集成：

1. 修改 `client.ts` 适配你的消息协议
2. 修改 `types.ts` 定义你的消息格式
3. 更新 `channel.ts` 的配置选项

---

## 参考资源

- OpenClaw 文档: https://docs.openclaw.ai
- Feishu Plugin 参考: https://github.com/m1heng/clawdbot-feishu
- WebSocket 文档: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket

---

## 许可证

MIT License

---

## 贡献

欢迎提交 Issue 和 Pull Request！
