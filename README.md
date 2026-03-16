# Bilibili Together MVP

一个只支持 B 站网页视频的双人同步看视频 MVP。

## MVP 范围

- 只支持 Bilibili 网页视频页面
- 只支持双人固定会话
- 明确区分 Host / Guest，只有 Host 控制同步
- 支持播放、暂停、拖动进度同步
- 支持 B 站站内页面自动跟随
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

扩展内已写死 WebSocket 地址为 `ws://106.53.151.206:8787`，用户不需要手动输入服务器地址。

## 加载扩展

1. 打开 Chrome/Edge 的扩展管理页
2. 开启开发者模式
3. 选择“加载已解压的扩展程序”
4. 选中 `extension/`
5. 点击扩展图标，在 B 站视频页打开侧边面板

## 部署到 Chrome

如果你只是想先装到 Chrome 里自己和朋友测试，直接用“加载已解压的扩展程序”就行。

如果你后面想正式发到 Chrome Web Store，大致流程是：

1. 把 `extension/` 目录单独打成 zip
2. 注册 Chrome Web Store Developer
3. 新建扩展项目并上传 zip
4. 补齐图标、截图、描述和隐私说明
5. 提交审核

MVP 阶段建议先用本地加载，最快。

## 使用方式

1. 两个人都安装扩展
2. 打开任意 B 站页面，首页也可以
3. 点击扩展图标打开侧边面板
4. 填同一个 `Room Key`
5. 一方选择 `Host`，另一方选择 `Guest`
6. 各自填自己的 `Nickname`
7. 点击 `Join Room`
8. Host 在 B 站站内切到任何页面，Guest 都会自动跟随
9. Host 播放、暂停、拖动视频时，Guest 会自动同步
10. 如果 Host 离开 B 站，Guest 会停留在当前页，不会跟着跳走

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

## 已部署服务器

当前服务地址：

- `http://106.53.151.206/healthz`
- `ws://106.53.151.206:8787`

服务器运行方式：

- 项目目录：`/home/ubuntu/BilibiliTogether`
- PM2 进程名：`bilibili-together`
- Nginx 80 端口反代到 `127.0.0.1:8787`

## 当前已知限制

- 依赖页面中存在可控的 `video` 元素
- B 站部分番剧页和特殊播放器页面可能存在选择器或权限差异
- 现在是固定双人房间，没有鉴权、没有持久化、没有消息回执
- 还没处理更复杂的抢控制权、弱网重连一致性和边界状态
