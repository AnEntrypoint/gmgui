module.exports = {
  apps: [{
    name: 'agentgui',
    script: 'server.js',
    interpreter: 'node',
    interpreter_args: '--experimental-vm-modules',
    watch: false,
    env: {
      NODE_ENV: 'development',
      PORT: '3000',
      HOT_RELOAD: 'false'
    },
    max_memory_restart: '512M',
    restart_delay: 2000,
    max_restarts: 10,
    exp_backoff_restart_delay: 100,
    error_file: '~/.gmgui/logs/err.log',
    out_file: '~/.gmgui/logs/out.log',
    merge_logs: true,
    time: true
  }]
};
