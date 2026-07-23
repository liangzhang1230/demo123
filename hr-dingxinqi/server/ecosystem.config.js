// pm2 配置：进程崩了自动拉起 + 内存超限重启。用法见 SETUP.md
module.exports = {
  apps: [{
    name: 'dx-famaqi',
    script: 'server.js',
    cwd: __dirname,
    instances: 1,
    autorestart: true,
    max_memory_restart: '200M',
    env: {
      PORT: '8787',
      // ↓↓↓ 上线前务必改成你自己的值（也可以用系统环境变量注入，别提交到仓库）
      DX_SECRET: '9c2f7e14ab5d380c6f1e9b4a2d7c5f80e3a1b6d94c8f2e70',
      DX_ADMIN_PW: 'change-me-admin',
      DX_ISSUE_TOKEN: 'change-me-issue-token',
      DX_MAX_REISSUE: '3',
      DX_DATA_DIR: __dirname,
      DX_NOTIFY_URL: ''   // 可选：server酱/企业微信机器人 webhook，填了就推新订单提醒
    }
  }]
};
