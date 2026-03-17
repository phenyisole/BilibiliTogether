# Bilibili Together MVP

这是一个“只支持 B 站网页”的双人一起看视频扩展。

它现在能做的事：

- 两个人进入同一个房间
- 主人控制页面跳转
- 主人控制播放、暂停、拖动进度
- 客人自动跟随
- 基础聊天

它不能做的事：

- 不支持语音
- 不转发视频流
- 不支持全网视频站
- 不处理复杂多人房间

---

## 一句话理解这个项目

这个项目分成两部分：

1. `extension/`
   这是浏览器扩展，装在你和朋友的 Chrome/Edge 里

2. `server/`
   这是后端程序，跑在你的电脑或者云服务器上

扩展本身不能直接互相通信，所以需要这个后端来转发“播放/暂停/进度/聊天”这些消息。

---

## 最简单的使用方式

如果你只是自己先跑通，最简单是：

1. 在一台电脑或服务器上启动后端
2. 你和朋友都安装扩展
3. 在扩展设置里填同一个服务器地址
4. 输入同一个房间号
5. 一个人选“主人”，另一个选“客人”

---

## 先看目录

```text
server/     后端服务
extension/  浏览器扩展
```

---

## 怎么在本地跑起来

### 1. 安装依赖

在项目根目录执行：

```bash
npm install
```

### 2. 启动后端

```bash
npm run dev
```

启动成功后，默认地址是：

- HTTP 健康检查：`http://127.0.0.1:8787/healthz`
- WebSocket 地址：`ws://127.0.0.1:8787`

你可以打开浏览器访问：

```text
http://127.0.0.1:8787/healthz
```

如果看到：

```json
{"ok":true,"rooms":0}
```

就说明后端已经正常启动。

---

## 怎么安装扩展

1. 打开 Chrome 或 Edge
2. 进入扩展管理页：
   `chrome://extensions/`
3. 开启“开发者模式”
4. 点击“加载已解压的扩展程序”
5. 选择本项目里的 [extension](C:\Users\Will\Desktop\BilibiliTogether_repo\extension) 目录

以后代码改了，直接在扩展管理页点“重新加载”就行。

---

## 扩展里服务器地址怎么填

这个仓库不会内置任何公开服务器地址。

你需要自己在扩展设置里填写 WebSocket 地址。

常见写法：

- 本地运行后端：
  `ws://127.0.0.1:8787`

- 用云服务器 IP：
  `ws://你的服务器IP:8787`

- 如果你后面配了 HTTPS / 域名反代：
  `wss://你的域名`

注意：

- `ws://` 用于普通 WebSocket
- `wss://` 用于 HTTPS 下的安全 WebSocket

---

## 两个人怎么一起用

1. 你和朋友都安装扩展
2. 你们都在扩展设置里填同一个服务器地址
3. 打开 B 站页面
4. 输入同一个房间秘钥
5. 一个人选“主人”，另一个选“客人”
6. 点击“进入”

之后：

- 主人切换 B 站页面，客人会跟随
- 主人播放/暂停/拖动，客人会同步
- 双方可以聊天

---

## 怎么部署到云服务器

下面用 Ubuntu 22.04 举例。

### 1. 把项目传到服务器

有两种常见办法。

#### 办法 A：直接用 Git 克隆

如果你的服务器能访问 GitHub：

```bash
git clone https://github.com/你的用户名/你的仓库名.git
cd BilibiliTogether
```

比如你的仓库如果叫：

```text
https://github.com/phenyisole/BilibiliTogether.git
```

那就执行：

```bash
git clone https://github.com/phenyisole/BilibiliTogether.git
cd BilibiliTogether
```

你刚才看到的：

```bash
git clone <your-repo-url>
```

里面的 `your-repo-url` 只是“占位符”，意思是“换成你自己的仓库地址”，不是让你真的原样复制。

#### 办法 B：手动把项目文件上传到服务器

如果你不想用 Git，也可以直接把整个项目目录传到服务器。

只要最后服务器上有这些内容就行：

- `server/`
- `extension/`
- `package.json`

---

### 2. 服务器安装 Node.js

```bash
sudo apt update
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

安装完成后可以检查：

```bash
node -v
npm -v
```

---

### 3. 安装项目依赖

进入项目目录后执行：

```bash
npm install
```

---

### 4. 直接启动后端

先测试能不能跑起来：

```bash
PORT=8787 node server/index.js
```

如果看到类似：

```text
Bilibili Together MVP server listening on :8787
```

说明程序本身没问题。

---

### 5. 用 PM2 持久运行

先安装 PM2：

```bash
sudo npm install -g pm2
```

然后启动：

```bash
PORT=8787 pm2 start server/index.js --name bilibili-together
pm2 save
```

查看状态：

```bash
pm2 status
```

---

### 6. 检查服务器是否正常

在服务器上执行：

```bash
curl http://127.0.0.1:8787/healthz
```

如果返回：

```json
{"ok":true,"rooms":0}
```

说明服务正常。

---

## 要不要配 Nginx

不是必须。

### 如果你只是自己测试

通常直接用：

```text
ws://你的服务器IP:8787
```

就够了。

### 如果你后面想更正式一些

可以加：

- Nginx
- 域名
- HTTPS
- `wss://`

这样浏览器兼容性和安全性会更好。

---

## 打包扩展是干嘛的

开发阶段一般不用“打包扩展程序”。

你最常用的是：

- 加载已解压的扩展程序
- 改完后点重新加载

“打包扩展程序”主要用于：

- 生成 `.crx` 给别人安装
- 固定扩展 ID
- 做正式发布前的打包测试

---

## 常见问题

### 1. 扩展能打开，但连不上

先检查：

- 后端有没有启动
- 扩展里服务器地址有没有填对
- 是不是 `ws://` / `wss://` 写错了
- 服务器 8787 端口有没有放开

### 2. 页面能跟随，视频不同步

可能原因：

- 当前页面视频元素结构特殊
- B 站某些页面播放器选择器不同
- 浏览器阻止了自动播放

### 3. 为什么仓库里没有内置服务器地址

因为公开仓库不应该把开发者自己的服务器地址直接写死进去。

更安全的做法是：

- 仓库公开
- 用户自己部署后端
- 用户自己在扩展设置里填写服务器地址

---

## 当前限制

- 只适合 MVP 阶段
- 只支持双人
- 没有账号系统
- 没有数据库
- 没有消息持久化
- 没有复杂冲突处理

---

## 消息协议

- `join`
- `presence`
- `video_state`
- `navigate`
- `chat_message`
