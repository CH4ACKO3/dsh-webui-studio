# Remote Docker development

Remote development runs one complete Studio Host per Agent on a Docker machine,
while the browser and source checkout remain local. Each Compose project owns
its own `DSH_HOME`, npm cache, pnpm store, Studio port, and fixed Preview port
range. SSH forwards only those loopback ports, so Studio and Draft Preview Hosts
remain unavailable directly from the LAN.

## Remote prerequisite

The remote host must provide a running Docker Engine and a `docker` CLI that is
available to non-interactive SSH sessions. Node.js and DSH are installed in the
image and are not required on the remote macOS host.

Installing Docker Desktop, OrbStack, or another system runtime changes the
remote machine and is intentionally outside this repository's setup script.
After installation, verify the daemon from the local machine:

```sh
npm run remote -- check
```

The default SSH host is `macmini`. Override it with
`DSH_STUDIO_REMOTE=user@host` when needed.

## Start isolated Agents

Choose a unique Studio port and non-overlapping Preview range for each Agent:

```sh
npm run remote -- up agent-a 13081 13100-13115
npm run remote -- up agent-b 14081 14100-14115
```

`up` sends the current checkout as the Docker build context, starts the remote
Compose project, and opens an SSH control connection that forwards the Studio
and Preview ports. Open the URL printed by the command. Re-run `up` after source
changes to rebuild the image.

Other lifecycle commands are:

```sh
npm run remote -- logs agent-a
npm run remote -- status agent-a
npm run remote -- tunnel agent-a 13081 13100-13115
npm run remote -- down agent-a
```

`down` removes the Agent's container but preserves its named volumes and Draft
state. Remove those volumes explicitly only when their data is no longer needed.

Docker Desktop must support host networking because DSH intentionally listens
on `127.0.0.1`. The fixed Preview range is enabled only in the container through
`DSH_STUDIO_PREVIEW_PORT_RANGE`; ordinary local Studio runs continue to pass
`--port 0` and use an operating-system-assigned port.

## 中文说明

远程开发模式会在 Docker 主机上为每个 Agent 运行一套完整 Studio Host，本机只保留
源码工作区、浏览器和 SSH 隧道。每个 Compose project 都有独立的 `DSH_HOME`、npm
缓存、pnpm store、Studio 端口和 Preview 端口段。DSH 仍只监听回环地址，局域网不能
直接访问这些服务。

远端只需安装并启动 Docker Engine，Node.js 和 DSH 均由镜像提供。仓库脚本不会安装
Docker Desktop、OrbStack 等系统软件。安装 Docker 后，可先运行：

```sh
npm run remote -- check
```

随后为每个 Agent 分配互不重叠的端口并启动：

```sh
npm run remote -- up agent-a 13081 13100-13115
npm run remote -- up agent-b 14081 14100-14115
```

源码改变后重新执行 `up` 即可在远端重建。`down` 只移除容器，保留该 Agent 的命名
卷和 Draft 数据。远端 Docker Desktop 需要支持 host networking，因为 DSH 会继续
绑定 `127.0.0.1`。
