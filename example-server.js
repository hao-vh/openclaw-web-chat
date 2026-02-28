/**
 * OpenClaw Web Chat Web 聊天室后端示例 (ES Module 版本)
 * 使用 Express + WebSocket
 * 
 * 这是一个简单的示例，展示如何与 OpenClaw Web Chat Channel Plugin 对接
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// 配置 - 使用 3001 端口避免冲突
const API_TOKEN = process.env.API_TOKEN || 'your-secret-token';
const PORT = process.env.PORT || 3001;

// 内存存储（生产环境使用数据库）
const messages = new Map();
const users = new Map();

// 中间件
app.use(express.json());

// 认证中间件
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const token = authHeader.slice(7);
  if (token !== API_TOKEN) {
    return res.status(403).json({ error: 'Invalid token' });
  }
  
  next();
}

// ========== HTTP API ==========

// 获取消息
app.get('/api/messages', authMiddleware, (req, res) => {
  const after = req.query.after;
  const allMessages = Array.from(messages.values());
  
  if (after) {
    const afterIndex = allMessages.findIndex(m => m.messageId === after);
    if (afterIndex !== -1) {
      return res.json(allMessages.slice(afterIndex + 1));
    }
  }
  
  // 默认返回最近50条
  res.json(allMessages.slice(-50));
});

// 发送消息
app.post('/api/messages', authMiddleware, (req, res) => {
  const { chatId, content, messageType = 'text', replyTo } = req.body;
  
  if (!chatId || !content) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  const messageId = `msg_${uuidv4()}`;
  const message = {
    messageId,
    chatId,
    senderId: 'openclaw_bot',
    senderName: 'OpenClaw',
    content,
    messageType,
    timestamp: Date.now(),
    replyTo: replyTo || null,
    isDirect: false,
  };
  
  messages.set(messageId, message);
  
  // 广播给所有连接的客户端
  broadcast(message);
  
  res.json({ success: true, messageId });
});

// ========== WebSocket ==========

const clients = new Set();

wss.on('connection', (ws, req) => {
  console.log('[WebSocket] New connection');
  
  // 认证 - 支持 URL query token (浏览器) 或 Header (服务器端)
  const url = new URL(req.url, 'http://localhost');
  const urlToken = url.searchParams.get('token');
  const authHeader = req.headers.authorization;
  
  let token = null;
  if (urlToken) {
    token = urlToken;  // 浏览器通过 URL 传递 token
  } else if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);  // 服务器端通过 Header
  }
  
  if (!token || token !== API_TOKEN) {
    ws.close(4001, 'Unauthorized');
    return;
  }
  
  clients.add(ws);
  
  ws.on('message', (data) => {
    try {
      const payload = JSON.parse(data.toString());
      handleWebSocketMessage(ws, payload);
    } catch (err) {
      console.error('[WebSocket] Invalid message:', err);
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Invalid message format'
      }));
    }
  });
  
  ws.on('close', () => {
    console.log('[WebSocket] Connection closed');
    clients.delete(ws);
  });
  
  ws.on('error', (err) => {
    console.error('[WebSocket] Error:', err);
  });
});

function handleWebSocketMessage(ws, payload) {
  console.log('[WebSocket] Received:', payload.type);
  
  if (payload.type === 'send_message') {
    const { chatId, content, messageType = 'text', replyTo } = payload.data;
    
    const messageId = `msg_${uuidv4()}`;
    const message = {
      messageId,
      chatId,
      senderId: 'openclaw_bot',
      senderName: 'OpenClaw',
      content,
      messageType,
      timestamp: Date.now(),
      replyTo: replyTo || null,
      isDirect: false,
    };
    
    messages.set(messageId, message);
    
    // 广播给所有客户端
    broadcast(message);
    
    // 发送响应
    ws.send(JSON.stringify({
      requestId: payload.requestId,
      success: true,
      messageId,
    }));
  }
}

function broadcast(message) {
  const data = JSON.stringify(message);
  clients.forEach((client) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(data);
    }
  });
}

// ========== 模拟用户消息（测试用）==========

// 每30秒模拟一条用户消息（测试用）
setInterval(() => {
  const messageId = `msg_${uuidv4()}`;
  const message = {
    messageId,
    chatId: 'room_1',
    senderId: 'user_123',
    senderName: '测试用户',
    content: '这是一条测试消息 ' + new Date().toLocaleTimeString(),
    messageType: 'text',
    timestamp: Date.now(),
    replyTo: null,
    isDirect: false,
  };
  
  messages.set(messageId, message);
  broadcast(message);
  console.log('[Test] Generated test message:', messageId);
}, 30000);

// ========== 启动服务 ==========

server.listen(PORT, () => {
  console.log(`🚀 OpenClaw Web Chat Chat Server running on port ${PORT}`);
  console.log(`📡 WebSocket: ws://localhost:${PORT}/ws`);
  console.log(`🌐 HTTP API: http://localhost:${PORT}/api`);
  console.log(`🔑 API Token: ${API_TOKEN}`);
});

// 简单的 Web 客户端页面
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>OpenClaw Web Chat Chat</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    #messages { border: 1px solid #ddd; height: 400px; overflow-y: auto; padding: 10px; margin: 20px 0; }
    .message { padding: 10px; margin: 5px 0; background: #f5f5f5; border-radius: 5px; }
    .message .sender { font-weight: bold; color: #333; }
    .message .time { font-size: 12px; color: #999; }
    #input-area { display: flex; gap: 10px; }
    #message-input { flex: 1; padding: 10px; }
    button { padding: 10px 20px; }
    #status { padding: 10px; margin: 10px 0; border-radius: 5px; }
    .connected { background: #d4edda; color: #155724; }
    .disconnected { background: #f8d7da; color: #721c24; }
  </style>
</head>
<body>
  <h1>🎉 OpenClaw Web Chat Chat Room</h1>
  <div id="status" class="disconnected">Disconnected</div>
  <div id="messages"></div>
  <div id="input-area">
    <input type="text" id="message-input" placeholder="Enter message..." />
    <button onclick="sendMessage()">Send</button>
  </div>
  
  <script>
    const ws = new WebSocket('ws://' + window.location.host + '/ws?token=your-secret-token');
    const statusDiv = document.getElementById('status');
    const messagesDiv = document.getElementById('messages');
    const input = document.getElementById('message-input');
    
    ws.onopen = () => {
      statusDiv.textContent = 'Connected';
      statusDiv.className = 'connected';
      console.log('Connected to WebSocket');
    };
    
    ws.onclose = () => {
      statusDiv.textContent = 'Disconnected';
      statusDiv.className = 'disconnected';
    };
    
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      displayMessage(msg);
    };
    
    function displayMessage(msg) {
      const div = document.createElement('div');
      div.className = 'message';
      div.innerHTML = \`
        <span class="sender">\${msg.senderName}</span>
        <span class="time">\${new Date(msg.timestamp).toLocaleTimeString()}</span>
        <div>\${msg.content}</div>
      \`;
      messagesDiv.appendChild(div);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
    
    function sendMessage() {
      const content = input.value.trim();
      if (!content) return;
      
      const msg = {
        messageId: 'msg_' + Date.now(),
        chatId: 'room_1',
        senderId: 'web_user',
        senderName: 'Web User',
        content: content,
        messageType: 'text',
        timestamp: Date.now(),
        isDirect: false
      };
      
      ws.send(JSON.stringify(msg));
      input.value = '';
    }
    
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
  </script>
</body>
</html>
  `);
});
