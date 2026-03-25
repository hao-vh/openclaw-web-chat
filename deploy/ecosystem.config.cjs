// PM2 进程管理配置
// 使用方式: pm2 start ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'openclaw-webchat',
    script: 'test-server.js',
    cwd: '/opt/openclaw-web-chat',  // 修改为实际部署路径
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '256M',
    env: {
      NODE_ENV: 'production',
      PORT: 3456,
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: '/var/log/openclaw-webchat/error.log',
    out_file: '/var/log/openclaw-webchat/out.log',
  }]
};
