import { marked } from 'marked';
import { WebSocketServer } from 'ws';
import http from 'http';
import { v4 as uuidv4 } from 'uuid';

const PORT = 3456;
const WS_PATH = '/ws';

// 内存存储
const messages = [];
const clients = new Map();
const rooms = new Map();

// 创建 HTTP 服务器
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

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
    res.end(JSON.stringify(result.slice(-50)));
    return;
  }

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

  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getHtmlPage());
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

const wss = new WebSocketServer({ server, path: WS_PATH });

wss.on('connection', (ws, req) => {
  console.log('[TestServer] WebSocket client connected');
  const clientInfo = {
    userId: `user_${uuidv4().slice(0, 8)}`,
    userName: `User_${Math.floor(Math.random() * 1000)}`,
    joinedAt: Date.now(),
  };
  clients.set(ws, clientInfo);
  
  ws.send(JSON.stringify({
    type: 'system',
    message: `Welcome ${clientInfo.userName}! Connected successfully`,
  }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleWebSocketMessage(ws, msg, clientInfo);
    } catch (err) {
      console.error('[TestServer] Message parse error:', err);
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    console.log('[TestServer] WebSocket client disconnected');
    clients.delete(ws);
    rooms.forEach((members, roomId) => {
      if (members.has(ws)) members.delete(ws);
    });
  });

  ws.on('error', (err) => {
    console.error('[TestServer] WebSocket error:', err);
  });
});

function handleWebSocketMessage(ws, msg, clientInfo) {
  console.log('[TestServer] Received message:', msg);
  if (msg.type === 'send_message') {
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
    broadcast(message);
    ws.send(JSON.stringify({ requestId: msg.requestId, success: true, messageId: message.messageId }));
    console.log('[TestServer] Message broadcast:', message.content);
    return;
  }
  
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
  
  if (msg.type === 'join') {
    const roomId = msg.roomId || 'room_1';
    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    rooms.get(roomId).add(ws);
  }
}

function broadcast(message, excludeWs = null) {
  const data = JSON.stringify(message);
  console.log('[Broadcast] Sending to', wss.clients.size, 'clients');
  wss.clients.forEach((client, index) => {
    if ((!excludeWs || client !== excludeWs) && client.readyState === 1) {
      client.send(data);
      console.log('[Broadcast] Message sent to client', index);
    }
  });
}

server.listen(PORT, () => {
  console.log('🚀 OpenClaw Web Chat Test Server running on port', PORT);
  console.log('📡 WebSocket: ws://localhost:' + PORT + '/ws');
  console.log('🌐 HTTP API: http://localhost:' + PORT + '/api');
});

function getHtmlPage() {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenClaw Web Chat</title>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; display: flex; height: 100vh; }
    .sidebar { width: 260px; background: #fff; border-right: 1px solid #e0e0e0; display: flex; flex-direction: column; }
    .sidebar-header { padding: 20px; border-bottom: 1px solid #e0e0e0; }
    .sidebar-header h2 { font-size: 18px; color: #333; }
    .room-list { flex: 1; overflow-y: auto; padding: 10px; }
    .room-item { padding: 12px 16px; margin: 4px 0; border-radius: 8px; cursor: pointer; transition: background 0.2s; }
    .room-item:hover { background: #f0f0f0; }
    .room-item.active { background: #e3f2fd; color: #1976d2; }
    .main { flex: 1; display: flex; flex-direction: column; background: #fff; }
    .header { padding: 16px 24px; border-bottom: 1px solid #e0e0e0; display: flex; align-items: center; justify-content: space-between; }
    .header h3 { font-size: 16px; color: #333; }
    .status { display: flex; align-items: center; gap: 8px; font-size: 14px; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #ccc; }
    .status-dot.connected { background: #4caf50; }
    .messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 12px; }
    .message { max-width: 80%; padding: 12px 16px; border-radius: 12px; position: relative; }
    .message.own { align-self: flex-end; background: #e3f2fd; }
    .message.other { align-self: flex-start; background: #f5f5f5; }
    .message.system { align-self: center; background: #fff3e0; color: #e65100; font-size: 14px; }
    .message .sender { font-weight: 600; font-size: 13px; color: #666; margin-bottom: 4px; }
    .message .content { font-size: 15px; line-height: 1.5; word-wrap: break-word; }
    .message .content h1, .message .content h2, .message .content h3 { margin: 8px 0; }
    .message .content p { margin: 8px 0; }
    .message .content code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
    .message .content pre { background: #f5f5f5; padding: 12px; border-radius: 8px; overflow-x: auto; }
    .message .content pre code { background: none; padding: 0; }
    .message .content ul, .message .content ol { margin: 8px 0; padding-left: 20px; }
    .message .content blockquote { border-left: 4px solid #ddd; padding-left: 12px; margin: 8px 0; color: #666; }
    .message .content table { border-collapse: collapse; margin: 8px 0; }
    .message .content th, .message .content td { border: 1px solid #ddd; padding: 8px 12px; }
    .message .content th { background: #f5f5f5; }
    .message .time { font-size: 11px; color: #999; margin-top: 4px; text-align: right; }
    .input-area { padding: 16px 24px; border-top: 1px solid #e0e0e0; display: flex; gap: 12px; }
    .input-area input { flex: 1; padding: 12px 16px; border: 1px solid #ddd; border-radius: 8px; font-size: 15px; }
    .input-area button { padding: 12px 24px; background: #1976d2; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 15px; }
    .input-area button:hover { background: #1565c0; }
    .input-area button:disabled { background: #ccc; cursor: not-allowed; }
    .welcome-message { text-align: center; padding: 40px; color: #666; }
    .welcome-message h3 { margin-bottom: 12px; color: #333; }
  </style>
</head>
<body>
  <div class="container">
    <div class="sidebar">
      <div class="sidebar-header">
        <h2>💬 OpenClaw Web Chat</h2>
      </div>
      <div class="room-list" id="room-list">
        <div class="room-item active" data-room="room_1">🌐 General</div>
        <div class="room-item" data-room="room_2">💻 Tech</div>
        <div class="room-item" data-room="room_3">🎮 Gaming</div>
      </div>
    </div>
    <div class="main">
      <div class="header">
        <h3 id="room-name">General Chat</h3>
        <div class="status">
          <span class="status-dot" id="status-dot"></span>
          <span id="status-text">Disconnected</span>
        </div>
      </div>
      <div class="messages" id="messages">
        <div class="welcome-message">
          <h3>Welcome to OpenClaw Web Chat! 👋</h3>
          <p>Connect to start chatting with AI</p>
        </div>
      </div>
      <div class="input-area">
        <input type="text" id="message-input" placeholder="Type a message..." disabled>
        <button id="send-btn" onclick="sendChatMessage()" disabled>Send</button>
      </div>
    </div>
  </div>

  <script>
    let ws = null;
    let userId = 'user_' + Math.random().toString(36).slice(2, 8);
    let userName = 'User_' + Math.floor(Math.random() * 1000);
    let currentRoom = 'room_1';
    let reconnectTimer = null;

    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');

    function connect() {
      const wsUrl = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws';
      console.log('Connecting to', wsUrl);
      
      ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log('Connected');
        statusDot.classList.add('connected');
        statusText.textContent = 'Connected';
        inputEl.disabled = false;
        sendBtn.disabled = false;
        messagesEl.innerHTML = '';
        addSystemMessage('Connected to chat server');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          console.log('Received:', msg);
          
          if (msg.type === 'system') {
            addSystemMessage(msg.message);
          } else if (msg.messageId && msg.content) {
            addMessage(msg);
          }
        } catch (err) {
          console.error('Parse error:', err);
        }
      };

      ws.onclose = () => {
        console.log('Disconnected');
        statusDot.classList.remove('connected');
        statusText.textContent = 'Disconnected';
        inputEl.disabled = true;
        sendBtn.disabled = true;
        
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
      };
    }

    function addMessage(msg) {
      const div = document.createElement('div');
      const isOwn = msg.senderId === userId;
      div.className = 'message ' + (isOwn ? 'own' : 'other');
      
      const time = new Date(msg.timestamp || Date.now()).toLocaleTimeString();
      
      // Parse Markdown content
      const parsedContent = marked.parse(msg.content || '', { breaks: true });
      
      div.innerHTML = \`
        <div class="sender">\${escapeHtml(msg.senderName || msg.senderId)}</div>
        <div class="content">\${parsedContent}</div>
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

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function sendChatMessage() {
      const content = inputEl.value.trim();
      if (!content || !ws || ws.readyState !== WebSocket.OPEN) return;

      const msg = {
        messageId: 'msg_' + Date.now(),
        chatId: currentRoom,
        senderId: userId,
        senderName: userName,
        content: content,
        messageType: 'text',
        timestamp: Date.now(),
      };

      ws.send(JSON.stringify(msg));
      inputEl.value = '';
    }

    inputEl.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendChatMessage();
    });

    document.querySelectorAll('.room-item').forEach(item => {
      item.addEventListener('click', () => {
        document.querySelectorAll('.room-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        currentRoom = item.dataset.room;
        document.getElementById('room-name').textContent = item.textContent;
        messagesEl.innerHTML = '';
        addSystemMessage('Switched to: ' + item.textContent);
      });
    });

    connect();
  </script>
</body>
</html>
  `;
}
