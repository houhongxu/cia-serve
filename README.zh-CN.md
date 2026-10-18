# cia-serve

[English](README.md) · 简体中文

在电脑上启动轻量 HTTP 服务，递归列出目录中的 Nintendo 3DS `.cia` 文件，并在本地生成 FBI 单包、批量安装二维码。文件通过流传输，二维码及文件 URL 不会发送给第三方服务。

## 快速开始

需要 Node.js 20 或更高版本、安装了 FBI 的 3DS，以及两端互通的局域网。

在包含 CIA 文件的目录中运行：

```sh
npx cia-serve
npx cia-serve ./cias --host 192.168.1.20
```

运行目录默认是当前工作目录。npm 首次运行可能需要联网下载工具和依赖；安装二维码本身在本地生成。

也可以直接从 GitHub 源码运行：

```sh
npx --yes --package github:houhongxu/cia-serve cia-serve
```

1. 浏览器打开终端显示的地址。终端二维码是手机浏览器入口；FBI 请扫描网页内的安装码。
2. 网页默认选中前 1000 个文件，并自动生成安装码。可搜索、全选、清空，也可为单个文件生成二维码。
3. 在 3DS 选择 **FBI → Remote Install → Scan QR Code**。
4. 扫描一个安装码，在 FBI 确认。每批完成后，再扫描下一码。保持电脑和服务运行。

## 参数

| 参数 | 作用 | 默认值 |
| --- | --- | --- |
| `[directory]` | 递归扫描的目录 | 当前工作目录 |
| `--port, -p` | HTTP 监听端口，1–65535 | `8080` |
| `--host` | 安装 URL 中的 IPv4；不改变监听地址 | 自动选择非回环 IPv4 |
| `--bind` | HTTP 监听 IPv4 | `0.0.0.0` |
| `--public-url` | 显式可达的 HTTP origin，覆盖广告地址 | 无 |
| `--no-qr` | 关闭终端浏览器入口码 | 否 |
| `--help, -h` | 显示帮助 | — |
| `--version, -v` | 显示版本 | — |

```sh
# 已在源码目录完成 npm ci 时
node bin/cia-serve.js /path/to/cias --host 192.168.1.20 --port 8080
node bin/cia-serve.js /path/to/cias --public-url http://192.168.1.20:8080
```

`--public-url` 只接受无路径、用户名、密码、查询和片段的 `http://` 地址。该工具为局域网 HTTP 使用设计；3DS 必须能访问该地址。

## FBI 批量协议

FBI 官方源码的 [QR 扫描处理](https://github.com/Steveice10/FBI/blob/master/source/fbi/remoteinstall.c)将二维码文字直接交给 [URL 安装器](https://github.com/Steveice10/FBI/blob/master/source/fbi/action/installurl.c)，后者按换行拆分多个直接下载 URL。因此本工具的批量码内容是直接 CIA URL 的换行列表，不是网页地址或列表文件地址。

每码最多 5 个文件、280 个 UTF-8 字节；更多文件自动分码。一次最多选择 1000 个文件。短文件 ID 避免中文、空格和长路径增加二维码密度。如果扫描困难，请放大页面或使用单包码。每批需要一次扫描和 FBI 确认。

## 类型识别与安装顺序

目录扫描会读取 CIA 头和 TMD，将支持的 Title ID 高位识别为本体（`00040000`）、更新（`0004000e`）和 DLC（`0004008c`）。支持类型的完整低 32 位相同才会分为同组，并按 **本体 → 更新 → DLC** 排序。后端会执行这一顺序，不受勾选先后影响；不会把相似文件名或不同 Title ID 强行合并。

每个文件最多读取 232 字节：32 字节 CIA 头、TMD 签名类型和固定 TMD 头。读取前检查区段长度、64 字节对齐、随签名类型变化的偏移及文件边界。支持 RSA-4096、RSA-2048 和 ECDSA 的 SHA-1 / SHA-256 签名布局，但不验证签名本身；不解密、重写或移动内容。格式依据：[GodMode9 CIA 偏移](https://github.com/d0k3/GodMode9/blob/master/arm9/source/game/cia.c)、[GodMode9 TMD 结构](https://github.com/d0k3/GodMode9/blob/master/arm9/source/game/tmd.h)、[3dbrew 签名布局](https://www.3dbrew.org/wiki/Title_metadata)。

页面会标明识别来源。元数据无法解析时，只检查文件名本身的 Title ID 或明确的本体、更新、DLC 提示，忽略父目录名；此时标为 **文件名推测**，且不自动分组。提示缺失或冲突时保持 **未知**。若 TMD 结构可读取但类型不支持，同样保持未知，不使用文件名覆盖。识别不代表来源可信、内容完整或可安装；修改文件后需重启服务刷新识别结果。

## 局域网与 WSL2

- 自动选择的网卡可能是 VPN、虚拟网卡或 WSL 地址。启动时会列出候选地址；使用 `--host` 覆盖。
- 电脑浏览器可打开页面，并不代表 3DS 能访问。检查同一局域网、访客 Wi-Fi 隔离、主机防火墙和所用端口。
- WSL2 默认 NAT 下，3DS 通常不能直接访问 WSL 私有地址。请使用已配置的可达网络路径与 `--host` / `--public-url`，或在可被 3DS 访问的宿主环境运行工具。本工具不修改 Windows 防火墙、端口转发或 WSL 网络模式。
- 默认监听所有 IPv4 网卡。仅在可信局域网运行；无需公网部署。需要仅本机访问时可使用 `--bind 127.0.0.1`，此时 3DS 无法连接。

## 范围与验证

只提供启动时扫描到的普通 `.cia` 文件（扩展名不区分大小写），不提供其他文件；忽略文件和目录符号链接。请求仅使用已登记的文件 ID，不把用户路径拼接到磁盘。下载时重新检查符号链接及文件边界。文件名通过文字节点显示。服务没有身份验证；同一可达网络中的设备可以访问目录列表和 CIA。

添加、删除或重命名文件后请重启服务。下载中的文件不应被修改。工具不校验 CIA 内容是否可安装，也不报告 3DS 安装是否成功。仅分享你有权使用的文件；仓库和 npm 包不包含 CIA。

自动化测试覆盖模拟 CIA/TMD 结构、签名偏移、有界元数据读取、类型与分组、逆序选择排序、递归列表、直接文件下载、HEAD、Range、超过 4 GiB 的稀疏文件、批次格式和容量、遍历拒绝、符号链接替换和 CLI 参数。尚未使用 3DS 真机验证相机扫描及安装成功；QR 密度和网络连通性仍取决于设备与网络。

## 开发

```sh
git clone https://github.com/houhongxu/cia-serve.git
cd cia-serve
npm ci --ignore-scripts
npm run check
npm test
npm pack --dry-run
node bin/cia-serve.js /path/to/cias
```

[贡献指南 / Contributing](CONTRIBUTING.md) · [MIT 许可证 / License](LICENSE)

开发、测试、Git 和依赖安装在同一环境执行；本项目维护环境为 WSL Ubuntu。GitHub Actions 配置了 Node.js 20、22、24 的检查。npm 版本由维护者手动发布，CI 不自动发布。
