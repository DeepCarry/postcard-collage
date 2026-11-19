# 仓库协作指南

## 项目结构

- `src/main.tsx` 挂载 React 编辑器。`src/App.tsx` 管理编辑器状态和交互。`src/style.css` 包含 Tailwind 和响应式样式。
- `src/layout.ts` 计算拼图布局。`src/photos.ts` 解码图片并生成缩略图。`src/render.ts` 使用同一套裁切和排版逻辑绘制预览与导出图片。
- `public/demo/` 存放内置样片，也用作测试素材。`tests/` 存放 Node.js 和 Playwright 测试。浏览器测试产物默认写入 Git 忽略的 `test-results/` 目录。

## 构建、测试与开发

使用 Node.js 22.18 或更新版本。

- `npm ci` 根据锁文件安装依赖。
- `npm run dev` 启动 Vite，默认地址为 `http://127.0.0.1:5173/`。
- `npm run build` 执行 TypeScript 类型检查，并将生产构建输出到 `dist/`。
- `npm test` 使用 Node.js 内置测试运行器验证拼图布局。
- `npm run test:browser` 在 Google Chrome 中运行 Playwright 测试。运行时保持 Vite 服务开启。使用其他端口时，设置 `POSTCARD_URL`。

## 编码风格

TypeScript 使用两个空格缩进和单引号，沿用现有省略语句末尾分号的写法。React 组件和类型使用 PascalCase，函数和变量使用 camelCase，CSS 类名使用 kebab-case。将布局计算放在 `layout.ts`，让预览和导出共用渲染逻辑，在浏览器内处理用户照片。界面文案使用简体中文。
网页中的字体全部使用“平方简”。

## 测试与评审

新增 Node.js 测试文件使用 `*.test.mjs` 命名，测试名称应描述可观察的行为。修改布局时，检查横竖图混排、典型照片数量和画布边界。修改界面或导出时，运行浏览器测试，查看桌面和移动端预览，并打开实际下载的图片。核对导出尺寸，确认裁切和排版与预览一致。测试后单独审查差异，修复问题后重跑受影响的检查。

## 提交与拉取请求

仓库已有 `main` 分支时，从最新的 `main` 创建独立分支开发新功能。提交标题应简洁，使用动词开头，例如「放大拼图预览」。在拉取请求中说明用户可感知的变化，列出已运行的检查，并在有对应议题时附上链接。视觉变更附截图，导出结果有变化时附样例。
