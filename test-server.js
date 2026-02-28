/**
 * OpenClaw Web Chat Test Server - 快速测试用的 Web 聊天室
 * 
 * 使用方法:
 * 1. node test-server.js
 * 2. 打开 http://localhost:3000
 * 3. 配置 web-chat plugin 连接到 ws://localhost:3000/ws
 */

import { WebSocketServer } from 'ws';
import http from 'http';
import { v4 as uuidv4 } from 'uuid';

const PORT = 3456;
const WS_PATH = '/ws';

// 内存存储
const messages = [];
const clients = new Map(); // ws -> { userId, userName }
const rooms = new Map(); // roomId -> Set<ws>

// 创建 HTTP 服务器
const server = http.createServer((req, res) => {
  // 简单的 CORS 支持
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // API: 获取消息
  if (req.url === '/api/messages' && req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const after = url.searchParams.get('after');

    let result = messages;
    if (after) {
      const afterIndex = messages.findIndex(m => m.messageId === after);
      if (afterIndex !== -1) {
        result = messages.slice(afterIndex + 1);
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result.slice(-50))); // 返回最近50条
    return;
  }

  // API: 发送消息
  if (req.url === '/api/messages' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const message = {
          messageId: `msg_${uuidv4()}`,
          chatId: data.chatId || 'room_1',
          senderId: data.senderId || 'api_user',
          senderName: data.senderName || 'API User',
          content: data.content,
          messageType: data.messageType || 'text',
          timestamp: Date.now(),
          isDirect: data.isDirect || false,
          replyTo: data.replyTo || null,
        };

        messages.push(message);
        broadcast(message);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, messageId: message.messageId }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Web 界面
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getHtmlPage());
    return;
  }

  // API: OpenClaw Web Chat Plugin 发送回复到 Web 聊天室
  if (req.url === '/api/send' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const message = {
          messageId: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
          chatId: data.chatId || 'room_1',
          senderId: data.senderId || 'ai_assistant',
          senderName: data.senderName || 'AI助手',
          content: data.content,
          messageType: data.messageType || 'text',
          timestamp: Date.now(),
          isDirect: data.isDirect || false,
          replyTo: data.replyTo || null,
        };

        messages.push(message);
        broadcast(message);
        
        console.log('[OpenClaw Web Chat] AI回复已广播:', message.content.slice(0, 50));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, messageId: message.messageId }));
      } catch (err) {
        console.error('[OpenClaw Web Chat] 处理AI回复失败:', err);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // API: OpenClaw Web Chat Plugin 发送回复到 Web 聊天室
  if (req.url === '/api/send' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const message = {
          messageId: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
          chatId: data.chatId || 'room_1',
          senderId: data.senderId || 'ai_assistant',
          senderName: data.senderName || 'AI助手',
          content: data.content,
          messageType: data.messageType || 'text',
          timestamp: Date.now(),
          isDirect: data.isDirect || false,
          replyTo: data.replyTo || null,
        };

        messages.push(message);
        broadcast(message);
        
        console.log('[OpenClaw Web Chat] AI回复已广播:', message.content.slice(0, 50));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, messageId: message.messageId }));
      } catch (err) {
        console.error('[OpenClaw Web Chat] 处理AI回复失败:', err);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

// 创建 WebSocket 服务器
const wss = new WebSocketServer({
  server,
  path: WS_PATH,
});

wss.on('connection', (ws, req) => {
  console.log('[TestServer] WebSocket 客户端连接');

  const clientInfo = {
    userId: `user_${uuidv4().slice(0, 8)}`,
    userName: `User_${Math.floor(Math.random() * 1000)}`,
    joinedAt: Date.now(),
  };
  clients.set(ws, clientInfo);

  // 发送欢迎消息
  ws.send(JSON.stringify({
    type: 'system',
    message: `欢迎 ${clientInfo.userName}! 连接成功`,
  }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleWebSocketMessage(ws, msg, clientInfo);
    } catch (err) {
      console.error('[TestServer] 消息解析错误:', err);
      ws.send(JSON.stringify({
        type: 'error',
        message: '消息格式错误',
      }));
    }
  });

  ws.on('close', () => {
    console.log('[TestServer] WebSocket 客户端断开');
    clients.delete(ws);
    // 从所有房间移除
    rooms.forEach((members, roomId) => {
      if (members.has(ws)) {
        members.delete(ws);
      }
    });
  });

  ws.on('error', (err) => {
    console.error('[TestServer] WebSocket 错误:', err);
  });
});

/**
 * 处理 WebSocket 消息
 */
function handleWebSocketMessage(ws, msg, clientInfo) {
  console.log('[TestServer] 收到消息:', msg);

  // 处理 OpenClaw Web Chat Plugin 协议
  if (msg.type === 'send_message') {
    // 发送消息请求
    const message = {
      messageId: `msg_${uuidv4()}`,
      chatId: msg.data?.chatId || 'room_1',
      senderId: clientInfo.userId,
      senderName: clientInfo.userName,
      content: msg.data?.content || '',
      messageType: msg.data?.messageType || 'text',
      timestamp: Date.now(),
      isDirect: msg.data?.chatId?.startsWith('user:') || false,
      replyTo: msg.data?.replyTo || null,
    };

    messages.push(message);

    // 广播给所有客户端（除了发送者）
    broadcast(message);

    // 发送响应
    ws.send(JSON.stringify({
      requestId: msg.requestId,
      success: true,
      messageId: message.messageId,
    }));

    console.log('[TestServer] 消息已广播:', message.content);
    return;
  }

  // 处理原生 OpenClaw Web Chat 消息格式（不带 type 包装）
  if (msg.messageId && msg.content) {
    const message = {
      messageId: msg.messageId,
      chatId: msg.chatId || 'room_1',
      senderId: clientInfo.userId,
      senderName: clientInfo.userName,
      content: msg.content,
      messageType: msg.messageType || 'text',
      timestamp: Date.now(),
      isDirect: msg.isDirect || false,
      replyTo: msg.replyTo || null,
    };

    messages.push(message);
    broadcast(message);
    return;
  }

  // 处理聊天命令
  if (msg.type === 'join') {
    const roomId = msg.roomId || 'room_1';
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(ws);

    ws.send(JSON.stringify({
      type: 'system',
      message: `已加入房间: ${roomId}`,
    }));
    return;
  }

  if (msg.type === 'chat') {
    const message = {
      messageId: `msg_${uuidv4()}`,
      chatId: msg.roomId || 'room_1',
      senderId: clientInfo.userId,
      senderName: clientInfo.userName,
      content: msg.content,
      messageType: 'text',
      timestamp: Date.now(),
      isDirect: false,
    };

    messages.push(message);
    broadcast(message);
    return;
  }
}

/**
 * 广播消息
 */
function broadcast(message, excludeWs = null) {
  const data = JSON.stringify(message);
  console.log('[Broadcast] Sending to clients:', wss.clients.size);

  // 发送给所有 WebSocket 客户端
  wss.clients.forEach((client, index) => {
    if (!excludeWs || client !== excludeWs && client.readyState === 1) { // WebSocket.OPEN = 1
      client.send(data);
      console.log('[Broadcast] Message sent to client', index);
    } else {
      console.log('[Broadcast] Skipped client', index, 'state:', client.readyState);
    }
  });
}

/**
 * 获取 HTML 页面
 */
function getHtmlPage() {
  return `<!DOCTYPE html>
<html lang="zh-CN">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenClaw Web Chat Test Chat</title>
  <style>
    :root {
      --primary-blue: #3b82f6;
      --primary-cyan: #06b6d4;
      --bg-dark: #0f172a;
      --bg-darker: #020617;
      --text-primary: #f8fafc;
      --text-secondary: #cbd5e1;
      --text-muted: #94a3b8;
      --border-color: rgba(59, 130, 246, 0.2);
      --input-bg: rgba(30, 41, 59, 0.8);
      --message-bg: rgba(59, 130, 246, 0.1);
      --message-border: rgba(59, 130, 246, 0.3);
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: var(--bg-darker);
      color: var(--text-primary);
      line-height: 1.6;
      overflow: hidden;
    }

    .chat-container {
      display: flex;
      flex-direction: column;
      height: 100vh;
      max-width: 100%;
    }

    .chat-header {
      background: rgba(15, 23, 42, 0.9);
      border-bottom: 1px solid var(--border-color);
      padding: 1rem 2rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      backdrop-filter: blur(10px);
    }

    .chat-header h1 {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--text-primary);
    }

    .chat-header .logo {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .chat-header .logo span {
      color: var(--primary-cyan);
    }

    .status {
      padding: 8px 20px;
      text-align: center;
      font-size: 14px;
      font-weight: bold;
    }

    .status.connected {
      background: rgba(16, 185, 129, 0.1);
      color: #34d399;
    }

    .status.disconnected {
      background: rgba(239, 68, 68, 0.1);
      color: #fca5a5;
    }

    .status.connecting {
      background: rgba(245, 158, 11, 0.1);
      color: #fbbf24;
    }

    /* 聊天主体区域 - 使用 #messages ID */
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 2rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      background: linear-gradient(135deg, var(--bg-darker) 0%, rgba(59, 130, 246, 0.03) 100%);
    }

    #messages::-webkit-scrollbar {
      width: 6px;
    }

    #messages::-webkit-scrollbar-track {
      background: transparent;
    }

    #messages::-webkit-scrollbar-thumb {
      background: rgba(59, 130, 246, 0.3);
      border-radius: 3px;
    }

    .message {
      max-width: 80%;
      padding: 1rem 1.5rem;
      border-radius: 12px;
      position: relative;
      animation: fadeIn 0.3s ease;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(10px);
      }

      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .message.own {
      align-self: flex-end;
      background: var(--message-bg);
      border: 1px solid var(--message-border);
      border-bottom-right-radius: 4px;
    }

    .message.other {
      align-self: flex-start;
      background: rgba(30, 41, 59, 0.8);
      border: 1px solid var(--border-color);
      border-bottom-left-radius: 4px;
    }

    .message.system {
      align-self: center;
      background: rgba(245, 158, 11, 0.1);
      border: 1px solid rgba(245, 158, 11, 0.3);
      color: #fbbf24;
      text-align: center;
      max-width: 100%;
      font-size: 0.875rem;
    }

    .message .sender {
      font-weight: bold;
      font-size: 0.875rem;
      color: var(--primary-blue);
      margin-bottom: 0.5rem;
    }

    .message .content {
      font-size: 1rem;
      line-height: 1.6;
      white-space: pre-wrap;
    }

    .message .time {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 0.5rem;
      text-align: right;
    }

    /* 输入区域 - 使用 #input-area */
    #input-area {
      background: rgba(15, 23, 42, 0.9);
      border-top: 1px solid var(--border-color);
      padding: 1rem 2rem;
      backdrop-filter: blur(10px);
    }

    .chat-input-container {
      max-width: 1200px;
      margin: 0 auto;
      display: flex;
      gap: 1rem;
      align-items: flex-end;
    }

    /* 输入框 - 使用 #message-input ID */
    #message-input {
      flex: 1;
      background: var(--input-bg);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 1rem;
      color: var(--text-primary);
      font-size: 1rem;
      resize: none;
      min-height: 100px;
      font-family: inherit;
      line-height: 1.5;
    }

    #message-input:focus {
      outline: none;
      border-color: var(--primary-blue);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }

    #message-input::placeholder {
      color: var(--text-muted);
    }

    #message-input:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    /* 发送按钮 - 使用 #send-btn ID */
    #send-btn {
      background: linear-gradient(135deg, var(--primary-blue), var(--primary-cyan));
      border: none;
      border-radius: 50%;
      width: 50px;
      height: 50px;
      color: white;
      font-size: 1.2rem;
      cursor: pointer;
      transition: all 0.3s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    #send-btn:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 10px 25px rgba(59, 130, 246, 0.3);
    }

    #send-btn:active:not(:disabled) {
      transform: translateY(0);
    }

    #send-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    /* 欢迎消息 */
    .welcome-message {
      text-align: center;
      color: var(--text-secondary);
      margin-top: 2rem;
    }

    .welcome-message h2 {
      font-size: 1.5rem;
      margin-bottom: 1rem;
      color: var(--text-primary);
    }

    .welcome-message p {
      font-size: 1rem;
      max-width: 600px;
      margin: 0 auto;
    }

    /* 响应式 */
    @media (max-width: 768px) {
      .chat-header {
        padding: 1rem;
      }

      #messages {
        padding: 1rem;
      }

      #input-area {
        padding: 1rem;
      }

      .message {
        max-width: 90%;
      }

      .chat-input-container {
        flex-direction: column;
        align-items: stretch;
      }

      #send-btn {
        align-self: flex-end;
      }
    }
  </style>
</head>

<body>
  <div class="chat-container">
    <!-- 聊天头部 -->
    <div class="chat-header">
      <div class="logo">
        <h1>AIMason</h1>
      </div>
      <div style="display: flex; align-items: center; gap: 1rem;">
        <div class="status disconnected" id="status">Disconnected</div>
        <a href="https://saasiot.cn/aimason/" class="back-home"
          style="color: var(--text-secondary); text-decoration: none; font-size: 1.2rem; cursor: pointer; transition: color 0.3s ease; display: flex; align-items: center; gap: 0.5rem;">
          <span>🏠</span>
        </a>
      </div>
    </div>

    <!-- 聊天主体 - 保留 #messages ID -->
    <div id="messages">
      <div class="welcome-message">
        <h2>🤖 您好！我是AIMason的小悟</h2>
        <p>我是数字建筑领域的AI智能体，具备感知·决策·执行·进化能力。
          您可以向我咨询智能建筑相关问题，我会为您提供专业的解决方案。</p>
      </div>
    </div>

    <!-- 输入区域 - 保留 #input-area, #message-input, #send-btn ID -->
    <div id="input-area">
      <div class="chat-input-container">
        <textarea id="message-input" placeholder="输入消息..." disabled rows="4"></textarea>
        <button id="send-btn" disabled>↑</button>
      </div>
    </div>
  </div>

  <script>
    let ws = null;
    let userId = null;
    let userName = null;
    let currentRoom = 'room_1';
    
    const statusEl = document.getElementById('status');
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const userIdEl = document.getElementById('user-id');
    
    // 连接 WebSocket
    function connect() {
      updateStatus('connecting', 'Connecting...');
      
      ws = new WebSocket((window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws');
      
      ws.onopen = () => {
        updateStatus('connected', 'Connected');
        inputEl.disabled = false;
        sendBtn.disabled = false;
        
        // 加入默认房间
        sendMessage({ type: 'join', roomId: currentRoom });
      };
      
      ws.onclose = () => {
        updateStatus('disconnected', 'Disconnected');
        inputEl.disabled = true;
        sendBtn.disabled = true;
        
        // 3秒后自动重连
        setTimeout(connect, 3000);
      };
      
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      };
      
      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        updateStatus('disconnected', 'Error');
      };
    }
    
    function updateStatus(state, text) {
      statusEl.className = state;
      statusEl.textContent = text;
    }
    
    function handleMessage(msg) {
      console.log('📨 handleMessage:', JSON.stringify(msg));
      if (msg.type === 'system') {
        addSystemMessage(msg.message);
      } else if (msg.senderId || msg.senderName) {
        console.log('✅ Calling addChatMessage, senderId:', msg.senderId, 'userId:', userId);
        addChatMessage(msg);
      } else {
        console.log('❌ Message skipped - no senderId or senderName');
      }
      
      // 保存用户信息
      if (!userId && msg.senderId) {
        userId = msg.senderId;
        userName = msg.senderName;
        userIdEl.textContent = userId.slice(0, 16) + '...';
      }
    }
    
    function addChatMessage(msg) {
      console.log('📝 addChatMessage called, msg:', JSON.stringify(msg), 'userId:', userId);
      const div = document.createElement('div');
      const isOwn = msg.senderId === userId;
      console.log('🔍 isOwn:', isOwn, 'msg.senderId:', msg.senderId, 'userId:', userId);
      div.className = 'message ' + (isOwn ? 'own' : 'other');
      
      const time = new Date(msg.timestamp || Date.now()).toLocaleTimeString();
      
      div.innerHTML = \`
        <div class="sender">\${msg.senderName || msg.senderId}</div>
        <div class="content">\${escapeHtml(msg.content)}</div>
        <div class="time">\${time}</div>
      \`;
      
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
    
    function addSystemMessage(text) {
      const div = document.createElement('div');
      div.className = 'message system';
      div.textContent = text;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
    
    function sendMessage(data) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
      }
    }
    
    function sendChatMessage() {
      const content = inputEl.value.trim();
      if (!content) return;
      
      // 使用 OpenClaw Web Chat Plugin 格式发送
      const msg = {
        messageId: 'msg_' + Date.now(),
        chatId: currentRoom,
        senderId: userId,
        senderName: userName,
        content: content,
        messageType: 'text',
        timestamp: Date.now(),
        isDirect: false,
      };
      
      sendMessage(msg);
      inputEl.value = '';
    }
    
    // 测试功能
    function sendTestMessage() {
      const tests = [
        '这是一条测试消息',
        'Hello from OpenClaw Web Chat!',
        '测试 emoji: 🚀 💬 ✅',
        '当前时间: ' + new Date().toLocaleString(),
      ];
      const randomMsg = tests[Math.floor(Math.random() * tests.length)];
      
      inputEl.value = randomMsg;
      sendChatMessage();
    }
    
    function reconnect() {
      if (ws) {
        ws.close();
      }
      connect();
    }
    
    function clearMessages() {
      messagesEl.innerHTML = '';
    }
    
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    // 事件监听
    sendBtn.addEventListener('click', sendChatMessage);
    inputEl.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendChatMessage();
    });
    
    // 房间切换
    document.querySelectorAll('#room-list li').forEach(li => {
      li.addEventListener('click', () => {
        document.querySelectorAll('#room-list li').forEach(l => l.classList.remove('active'));
        li.classList.add('active');
        currentRoom = li.dataset.room;
        sendMessage({ type: 'join', roomId: currentRoom });
        addSystemMessage('切换到房间: ' + li.textContent);
      });
    });
    
    // 启动连接
    connect();
  </script>
</body>
</html>`;
}

// 启动服务器
server.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('🚀 OpenClaw Web Chat Test Server 已启动');
  console.log('='.repeat(60));
  console.log(`📡 WebSocket: ws://localhost:${PORT}${WS_PATH}`);
  console.log(`🌐 Web 界面: http://localhost:${PORT}`);
  console.log(`📊 API 地址: http://localhost:${PORT}/api/messages`);
  console.log('='.repeat(60));
  console.log('使用说明:');
  console.log('1. 打开浏览器访问 http://localhost:' + PORT);
  console.log('2. 在 openclaw.json 中配置 web-chat channel:');
  console.log(`   wsUrl: "ws://localhost:${PORT}${WS_PATH}"`);
  console.log('3. 重启 OpenClaw Gateway');
  console.log('='.repeat(60));
});

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n[TestServer] 正在关闭...');
  wss.close();
  server.close();
  process.exit(0);
});
