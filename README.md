# Bilibili Together MVP

一个只支持 B 站网页视频的双人同步看视频 MVP。

## 功能范围

- 只支持 Bilibili 网页页面
- 只支持双人固定房间
- Host / Guest 两种角色
- Host 控制页面跳转、播放、暂停、拖动和进度同步
- 基础聊天
- 不传视频流，不做语音，不做全网平台适配

## 项目结构

- `server/`: Node.js WebSocket 信令服务
- `extension/`: Chromium 扩展

## 快速开始

### 1. 本地启动服务端

```bash
npm install
npm run dev
```

默认监听：

- `http://127.0.0.1:8787/healthz`
- `ws://127.0.0.1:8787`

### 2. 加载扩展

1. 打开 `chrome://extensions/` 或 Edge 扩展管理页
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择 `extension/`
5. 打开任意 B 站页面，点击扩展图标打开面板

### 3. 配置服务器地址

扩展不会内置任何公开服务器地址，需要在设置里手动填写：

- 本地调试：`ws://127.0.0.1:8787`
- 云服务器未上 HTTPS：`ws://你的服务器IP:8787`
- 已接入 HTTPS 反代：`wss://你的域名`

### 4. 双人使用

1. 两个人都安装扩展
2. 两个人都在设置里填同一个 WebSocket 服务器地址
3. 打开 B 站任意页面
4. 填相同的房间秘钥
5. 一方选 `主人`，另一方选 `客人`
6. 点击 `进入`
7. 主人在 B 站站内切页、播放、暂停、拖动时，客人会自动跟随

## 服务端部署

下面是一套最小可用部署流程，适合 Ubuntu 22.04。

### 1. 安装依赖

```bash
sudo apt update
sudo apt install -y nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

### 2. 获取项目并安装

如果你是从自己的 GitHub 仓库部署，把下面的仓库地址换成你自己的：

```bash
git clone https://github.com/你的用户名/你的仓库名.git
cd BilibiliTogether
npm install
```

如果你的仓库地址就是这个项目：

```bash
git clone https://github.com/phenyisole/BilibiliTogether.git
cd BilibiliTogether
npm install
```

如果你不用 Git，也可以直接把项目文件上传到服务器，只要最终服务器上有 `server/`、`extension/`、`package.json` 这些内容即可。

### 3. 启动服务

```bash
PORT=8787 pm2 start server/index.js --name bilibili-together
pm2 save
pm2 startup
```

### 4. 健康检查

```bash
curl http://127.0.0.1:8787/healthz
```

正常应返回：

```json
{"ok":true,"rooms":0}
```

### 5. Nginx 反代示例

如果你想通过 `80/443` 暴露服务，可以把 WebSocket 反代到 `127.0.0.1:8787`。

```nginx
server {
    listen 80;
    server_name your-domain-or-ip;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

如果你后面接了 HTTPS，扩展里就应该填写 `wss://...`。

## 打包扩展

开发阶段推荐直接“加载已解压的扩展程序”。

只有在这些场景下才需要“打包扩展程序”：

- 你想生成 `.crx` 发给别人手动安装
- 你想固定扩展 ID
- 你准备做正式发布前的打包测试

## 消息协议

- `join`
- `presence`
- `video_state`
- `navigate`
- `chat_message`

## 当前限制

- 依赖页面中存在可控的 `video` 元素
- B 站部分番剧页和特殊播放器页面可能存在选择器差异
- 目前没有鉴权、持久化、消息回执
- 没有处理复杂抢控制权、断线后强一致恢复等问题
