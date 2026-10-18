# cia-serve

English · [简体中文](README.zh-CN.md)

Start a lightweight HTTP server, recursively list Nintendo 3DS `.cia` files, and generate single-file or batch FBI install QR codes locally. Downloads are streamed; file URLs and QR payloads are never sent to third-party QR services.

## 0.2.0 development version

The 0.2.0 source includes automatic base/update/DLC identification and installation ordering. This development version has not been published to npm. npm currently provides 0.1.0, which does not include identification. Use the GitHub source command below or a local checkout to try the new functionality.

## Quick start

Requires Node.js 20 or newer, a 3DS with FBI, and a LAN that allows both devices to communicate.

Run from the directory containing your CIA files:

```sh
npx cia-serve
npx cia-serve ./cias --host 192.168.1.20
```

The current working directory is served by default. The first npm run may download the tool and its dependencies; install QR generation itself stays local.

Alternatively, run directly from the GitHub source:

```sh
npx --yes --package github:houhongxu/cia-serve cia-serve
```

1. Open the address printed in the terminal. The terminal QR opens the browser page on a phone; scan the install codes inside that page with FBI.
2. The page selects the first 1000 files and generates install codes automatically. Search, select all, clear the selection, or generate a single-file QR.
3. On the 3DS, choose **FBI → Remote Install → Scan QR Code**.
4. Scan an install code and confirm in FBI. After a batch finishes, scan the next code. Keep the computer and server running.

## Options

| Option | Purpose | Default |
| --- | --- | --- |
| `[directory]` | Directory to scan recursively | Current working directory |
| `--port, -p` | HTTP listen port, 1–65535 | `8080` |
| `--host` | IPv4 in install URLs; does not change the bind address | Automatic non-loopback IPv4 |
| `--bind` | HTTP listen IPv4 | `0.0.0.0` |
| `--public-url` | Reachable HTTP origin; overrides the advertised address | None |
| `--no-qr` | Disable the terminal browser-entry QR | Off |
| `--help, -h` | Show help | — |
| `--version, -v` | Show version | — |

```sh
# From the source checkout after npm ci
node bin/cia-serve.js /path/to/cias --host 192.168.1.20 --port 8080
node bin/cia-serve.js /path/to/cias --public-url http://192.168.1.20:8080
```

`--public-url` accepts only an `http://` origin with no path, credentials, query or fragment. This tool is designed for LAN HTTP use; the 3DS must be able to reach that address.

## FBI batch protocol

FBI's official [QR handler](https://github.com/Steveice10/FBI/blob/master/source/fbi/remoteinstall.c) passes the QR text directly to its [URL installer](https://github.com/Steveice10/FBI/blob/master/source/fbi/action/installurl.c), which splits direct download URLs on newline characters. Batch codes therefore contain newline-separated direct CIA URLs, rather than a webpage or a list-file URL.

Each code contains at most 5 files and 280 UTF-8 bytes. Larger selections become multiple codes. Select up to 1000 files per operation. Short file IDs keep Unicode names, spaces and long paths out of QR payloads. Enlarge the page or use a single-file code if scanning is difficult. Each batch requires a scan and confirmation in FBI.

All install codes and terminal browser-entry codes use a single byte segment. FBI's [bundled quirc decoder](https://github.com/Steveice10/FBI/blob/5e0924318f94543a56bbcd954312bf859a8e63a0/source/libs/quirc/decode.c#L729-L735) uses incorrect alphanumeric count widths for QR versions 7–26; automatic mixed-mode encoding can therefore produce corrupted URLs. The native-decoder regression reproduces a four-URL version-11 code decoding as `http/GZP…`, then verifies the fixed production SVG payloads byte for byte. This fixes encoding compatibility; it does not establish 3DS network connectivity.

## Type identification and install order

The catalog reads the CIA header and TMD to identify base applications (`00040000`), updates (`0004000e`) and DLC (`0004008c`). Files with the same complete low 32 bits of a supported TMD Title ID form a group and are ordered **base → update → DLC**. The server applies this order regardless of checkbox selection order. Similar filenames and different Title IDs are never merged.

Parsing uses at most 232 bytes per file: the 32-byte CIA header, the TMD signature type, and the fixed TMD header. Section sizes, 64-byte alignment, signature-dependent offsets and file boundaries are checked before reading. It supports the RSA-4096, RSA-2048 and ECDSA signature layouts with SHA-1 or SHA-256; signatures themselves are not verified. Content is never decrypted, rewritten or moved. Format references: [GodMode9 CIA offsets](https://github.com/d0k3/GodMode9/blob/master/arm9/source/game/cia.c), [GodMode9 TMD structure](https://github.com/d0k3/GodMode9/blob/master/arm9/source/game/tmd.h), and [3dbrew signature layouts](https://www.3dbrew.org/wiki/Title_metadata).

The page labels identification sources. If metadata cannot be parsed, only the filename itself is checked for a Title ID or explicit base/update/DLC hints; parent directory names are ignored. Such results are labeled **Filename guess** and are never grouped automatically. Conflicting or absent hints remain **Unknown**. A structurally readable TMD with an unsupported title category also remains Unknown, without a filename override. Identification does not establish authenticity, content integrity or installability. Restart after changing files to refresh their identification.

## LAN and WSL2

- Automatic detection may choose a VPN, virtual adapter or WSL address. Candidate addresses are printed at startup; override with `--host`.
- A page loading in your computer's browser does not prove the 3DS can reach it. Check the same LAN, guest Wi-Fi isolation, host firewall and chosen port.
- With default WSL2 NAT, the 3DS usually cannot reach WSL's private address directly. Use an already configured reachable network path with `--host` / `--public-url`, or run the tool in a host environment the 3DS can reach. This tool does not change Windows firewall rules, port forwarding or WSL network mode.
- The default bind address listens on every IPv4 adapter. Run on a trusted LAN; public hosting is unnecessary. Use `--bind 127.0.0.1` for local access only; the 3DS cannot connect in that mode.

## Scope and validation

Only regular `.cia` files discovered at startup are served, with a case-insensitive extension. Other files are not exposed, and file/directory symlinks are skipped. Requests use registered file IDs instead of joining user paths onto disk paths. Downloads recheck symlinks and file boundaries. Filenames are rendered as text. There is no authentication: devices on a reachable network can access the catalog and CIA files.

Restart after adding, deleting or renaming files. Do not modify files during downloads. The tool does not validate CIA installability or report whether an installation on the 3DS succeeded. Share only files you have the right to use; this repository and npm package contain no CIA files.

Automated tests cover synthetic CIA/TMD layouts, signature-dependent offsets, bounded metadata reads, classification/grouping, reversed selection order, recursive listing, direct downloads, HEAD, Range, sparse files over 4 GiB, batch format and capacity, traversal rejection, symlink replacement, and CLI arguments. Camera scanning and installation have not yet been tested on real 3DS hardware; QR density and connectivity still depend on the device and network.

## Development

```sh
git clone https://github.com/houhongxu/cia-serve.git
cd cia-serve
npm ci --ignore-scripts
npm run check
npm test
npm pack --dry-run
node bin/cia-serve.js /path/to/cias
```

Optional legacy-decoder regression requires a C compiler and curl. It downloads fixed upstream source into a temporary directory; the three native tests are skipped unless `FBI_QUIRC_DECODER` is set. Run from the repository root:

```sh
fbi_source=$(mktemp -d)
fbi_revision=5e0924318f94543a56bbcd954312bf859a8e63a0
for file in decode.c quirc.h quirc_internal.h version_db.c; do
  curl -fsSL "https://raw.githubusercontent.com/Steveice10/FBI/$fbi_revision/source/libs/quirc/$file" -o "$fbi_source/$file"
done
cc -std=c99 -I "$fbi_source" test/fixtures/fbi-quirc-driver.c "$fbi_source/decode.c" "$fbi_source/version_db.c" -o "$fbi_source/fbi-quirc"
FBI_QUIRC_DECODER="$fbi_source/fbi-quirc" node --test test/fbi-qr.test.js
```

[贡献指南 / Contributing](CONTRIBUTING.md) · [MIT 许可证 / License](LICENSE)

Run development, tests, Git and dependency installation in the same environment; the maintainer uses WSL Ubuntu. GitHub Actions checks Node.js 20, 22 and 24. Maintainers publish npm releases manually; CI does not publish.
