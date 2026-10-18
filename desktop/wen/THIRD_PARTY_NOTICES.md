# 第三方软件说明

温习桌面版位于 DeepTutor 源码仓库中，是独立的 Electron 学习客户端；它不包含或启动原版 Python/Web 全功能运行时。

- DeepTutor 项目及本目录代码：Apache License 2.0，见 LICENSE。
- OpenAI Codex CLI：Apache License 2.0，https://github.com/openai/codex 。安装包包含 npm 发布的官方 Windows x64 二进制及其运行辅助文件。版本记录在 resources/codex/VERSION.txt。Codex 和 OpenAI 商标属于其各自所有者。
- Electron：MIT，https://www.electronjs.org/ 。Electron 随附 LICENSE.electron.txt 和 LICENSES.chromium.html，保留在应用安装目录。
- React、React DOM、Vite、react-markdown、remark-gfm、remark-math、rehype-katex、KaTeX：MIT。Lucide：ISC。其依赖许可随安装包和 npm 锁定文件保留。
- PDF.js（pdfjs-dist）：Apache License 2.0，https://github.com/mozilla/pdf.js 。用于在本机读取和渲染试卷 PDF。
- @napi-rs/canvas：MIT，https://github.com/Brooooooklyn/canvas 。用于本机图像处理与 PDF 页面渲染；包含 Skia 相关组件及其随附许可。
- NSIS 安装器及 electron-builder 使用各自的开源许可；具体依赖版本见 package-lock.json。

Codex 登录由官方 CLI 处理；DeepSeek API 由 DeepSeek 提供。温习不是 OpenAI 或 DeepSeek 的官方产品。用户需自行登录或配置 API Key，账户权限、额度和费用以对应服务为准。

内置题目为自编示例练习，不复制特定教科书，也不宣称与某出版社的课本逐课一致。
