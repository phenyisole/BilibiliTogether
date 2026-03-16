module.exports = {
  apps: [
    {
      name: "bilibili-together",
      script: "server/index.js",
      cwd: "/home/ubuntu/BilibiliTogether",
      env: {
        NODE_ENV: "production",
        PORT: "8787",
      },
    },
  ],
};
