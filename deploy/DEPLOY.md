# OpenClaw Web Chat 部署指南

## 架构图

```
[本地电脑]                          [服务器 (xiaowu-iot.com)]
 OpenClaw Gateway                    Nginx (443)
 + web-chat plugin  ←─WebSocket─→   ├── /embed  → Node.js :3456
                                     ├── /ws     → WebSocket
                                     └── /admin  → Admin Dashboard

[用户浏览器]
 xiaowu-iot.com/aimason/
 └── <iframe src="https://chat.xiaowu-iot.com/embed">
```

## 1. 服务器部署

### 1.1 上传项目到服务器

```bash
# 在服务器上
mkdir -p /opt/openclaw-web-chat
cd /opt/openclaw-web-chat

# 方式一：git clone
git clone https://github.com/hao-vh/openclaw-web-chat.git .

# 方式二：从本地上传
# scp -r ./openclaw-web-chat/* user@your-server:/opt/openclaw-web-chat/
```

### 1.2 安装依赖

```bash
cd /opt/openclaw-web-chat
npm install --production
```

### 1.3 使用 PM2 管理进程

```bash
# 安装 PM2（如未安装）
npm install -g pm2

# 创建日志目录
sudo mkdir -p /var/log/openclaw-webchat

# 启动服务
pm2 start deploy/ecosystem.config.cjs

# 查看状态
pm2 status

# 开机自启
pm2 save
pm2 startup
```

### 1.4 配置 Nginx

```bash
# 复制 Nginx 配置（修改域名和 SSL 路径）
sudo cp deploy/nginx-webchat.conf /etc/nginx/sites-available/webchat
sudo ln -s /etc/nginx/sites-available/webchat /etc/nginx/sites-enabled/

# 编辑配置，修改:
#   - server_name 改为你的子域名
#   - ssl_certificate / ssl_certificate_key 改为实际证书路径
sudo nano /etc/nginx/sites-available/webchat

# 测试并重载
sudo nginx -t
sudo systemctl reload nginx
```

### 1.5 域名解析

在 DNS 中添加一条 A 记录：
- 主机记录: `chat`
- 记录值: 你服务器的 IP
- 类型: A

这样 `chat.xiaowu-iot.com` 就会指向你的服务器。

## 2. 网站嵌入

在 `https://xiaowu-iot.com/aimason/` 的 HTML 中添加 iframe：

```html
<!-- 在页面合适的位置添加 -->
<iframe
  src="https://chat.xiaowu-iot.com/embed"
  width="100%"
  height="600"
  style="border: none; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.1);"
  allow="microphone"
></iframe>
```

### iframe 参数

可以通过 URL 参数自定义：

| 参数 | 说明 | 示例 |
|------|------|------|
| title | 聊天窗口标题 | `?title=AIMason智能助手` |
| chatId | 聊天室ID | `?chatId=aimason` |
| botName | 机器人名称 | `?botName=小武AI` |

例如：
```html
<iframe
  src="https://chat.xiaowu-iot.com/embed?title=AIMason%E6%99%BA%E8%83%BD%E5%8A%A9%E6%89%8B&botName=%E5%B0%8F%E6%AD%A6AI"
  width="100%"
  height="600"
  style="border: none; border-radius: 12px;"
></iframe>
```

## 3. 本地 OpenClaw 配置

### 3.1 安装插件

```bash
cd openclaw-web-chat
bash install-web-chat.sh
```

### 3.2 修改配置

编辑 `~/.openclaw/openclaw.json`，将 WebSocket 地址指向服务器：

```json
{
  "channels": {
    "web-chat": {
      "enabled": true,
      "wsUrl": "wss://chat.xiaowu-iot.com/ws",
      "apiUrl": "https://chat.xiaowu-iot.com",
      "connectionMode": "websocket",
      "autoReconnect": true,
      "dmPolicy": "open",
      "groupPolicy": "open"
    }
  }
}
```

### 3.3 重启 Gateway

```bash
openclaw gateway restart
```

## 4. 验证

1. 访问 `https://chat.xiaowu-iot.com/embed` 确认聊天页面正常
2. 访问 `https://chat.xiaowu-iot.com/admin` 查看管理后台
3. 访问 `https://xiaowu-iot.com/aimason/` 确认 iframe 嵌入正常
4. 在聊天框发送消息，确认 AI 回复正常

## 5. 故障排查

```bash
# 查看 Node.js 日志
pm2 logs openclaw-webchat

# 查看 Nginx 日志
tail -f /var/log/nginx/error.log

# 测试 WebSocket 连接
wscat -c wss://chat.xiaowu-iot.com/ws

# 测试 API
curl https://chat.xiaowu-iot.com/admin/api/overview
```
