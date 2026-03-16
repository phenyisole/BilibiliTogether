# Bilibili Together MVP

一个只支持 B 站网页视频的双人同步看视频 MVP。

## MVP 范围

- 只支持 Bilibili 网页视频页面
- 只支持双人固定会话
- 支持播放、暂停、拖动进度同步
- 支持 URL 自动跟随
- 支持基础聊天
- 不支持语音、不转发视频流、不做全网通用

## 项目结构

- `server/`: Node.js WebSocket 信令/聊天服务
- `extension/`: Chromium 扩展

## 本地启动

```bash
npm install
npm run dev
```

默认 WebSocket 地址为 `ws://106.53.151.206:8787`。本地开发时可以把扩展面板里的 Server 改成 `ws://localhost:8787`。

## 加载扩展

1. 打开 Chrome/Edge 的扩展管理页
2. 开启开发者模式
3. 选择“加载已解压的扩展程序”
4. 选中 `extension/`

## 使用方式

1. 两个人都安装扩展
2. 打开同一个 B 站视频页面
3. 点击扩展图标打开侧边面板
4. 填相同的 `Session`，各自填自己的 `Nickname`
5. 点击 `Save & Reconnect`
6. 任意一方播放、暂停、拖动、切换页面，另一方会自动跟随
7. 在面板底部输入消息即可聊天

## 消息协议

- `join`
- `presence`
- `video_state`
- `navigate`
- `chat_message`

## 服务端部署建议

腾讯云 Ubuntu 22.04 上跑 MVP 的最小流程：

```bash
sudo apt update
sudo apt install -y nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

启动服务：

```bash
npm install
PORT=8787 pm2 start server/index.js --name bilibili-together
pm2 save
pm2 startup
```

Nginx 可以后续再反代到 `8787`，并加上域名和 HTTPS/WSS。

## 当前已知限制

- 依赖页面中存在可控的 `video` 元素
- B 站部分番剧页和特殊播放器页面可能存在选择器或权限差异
- 现在是固定双人房间，没有鉴权、没有持久化、没有消息回执
- 还没处理更复杂的抢控制权、弱网重连一致性和边界状态
