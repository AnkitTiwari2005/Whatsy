module.exports = {
  apps: [
    {
      name: "whatsy",
      script: "dist/index.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
      },
      // Restart delay — gives WhatsApp connection time to clean up before restart
      restart_delay: 3000,
      // Log settings
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "logs/error.log",
      out_file: "logs/out.log",
      merge_logs: true,
    },
  ],
};
