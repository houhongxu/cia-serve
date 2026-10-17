# 贡献指南 / Contributing

请先阅读 [中文说明](README.zh-CN.md) 或 [English README](README.md)。提交 Issue 时附上工具版本、Node 版本、操作系统、启动命令、预期与实际结果。网络问题请说明原生运行还是 WSL，以及 3DS 是否能访问广告地址；不要上传 CIA、凭据或无关的完整日志。

Read the [Chinese guide](README.zh-CN.md) or [English README](README.md). Include the tool version, Node version, OS, startup command, expected behavior and actual result in issues. For network problems, specify native or WSL execution and whether the 3DS can reach the advertised address. Do not upload CIA files, credentials or unrelated full logs.

## 修改与检查 / Changes and checks

保持依赖轻量，所有安装二维码离线生成。修改文件服务时检查路径边界、符号链接、大文件和 Range；修改批量码时根据 FBI 官方源码保留换行 URL 协议及容量限制。对相关代码添加针对性测试，并运行以下验收：

Keep dependencies small and generate every install QR locally. For file-serving changes, check path boundaries, symlinks, large files and Range. For batch codes, preserve the newline URL protocol and capacity limits based on official FBI source. Add targeted tests for relevant code and run:

```sh
npm ci --ignore-scripts
npm run check
npm test
npm pack --dry-run
```

测试使用临时生成的文本占位文件和稀疏文件，不需要真实 CIA。UI 修改优先依据代码检查及现有测试；关键行为证据不足时再进行浏览器验收。硬件测试报告应注明 FBI 版本、3DS 型号、网络环境、扫描与安装是否分别成功；不要把本地 HTTP 测试描述为真机验证。

Tests use temporary text fixtures and sparse files, without real CIA packages. Prefer code checks and existing tests for UI changes, and use browser acceptance when evidence for key behavior is insufficient. Hardware reports should include FBI version, 3DS model, network environment, and separate scan/install outcomes. Do not describe local HTTP tests as hardware validation.

## 双语维护 / Bilingual maintenance

文档、Issue、PR 标题与描述、提交说明及项目交付说明应中英双语，默认中文在前。英文 README 与中文 README 分开维护，事实、范围、验证和限制一致。命令、路径、API 标识符和原始日志保持原样。

Use Chinese and English for documentation, issues, PR titles/descriptions, commit messages and delivery notes, with Chinese first by default. Keep the separate English and Chinese READMEs aligned in facts, scope, validation and limitations. Preserve commands, paths, API identifiers and raw logs.

## 发布 / Releases

当前未发布 npm。维护者发布前需检查包内容、测试和真机验证状态，再显式执行 npm 发布；CI 不持有 npm token，也不自动发布。不要将本地 CIA 或敏感配置提交到 Git。

The package has not been published to npm. Before a release, the maintainer must inspect package contents, checks and hardware-validation status, then explicitly publish to npm. CI has no npm token and does not publish automatically. Never commit local CIA files or sensitive configuration.
