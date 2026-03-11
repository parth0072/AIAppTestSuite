# AppTest Suite (Ollama + Appium MCP)

This app is wired as:

- React UI: test management + execution view
- Local API (`server/index.mjs`): orchestrates Ollama + Appium MCP
- Ollama: generates test cases
- Appium MCP: runs steps against your mobile app

## 1. Configure

Copy env template:

```bash
cp .env.example .env
```

Edit `server/capabilities.example.json` with your real device/simulator data:

- iOS: `appium:udid`, `appium:bundleId`, `appium:platformVersion`
- Android: `appium:appPackage`, `appium:appActivity`, etc.

## 2. Start required services

In separate terminals:

1. Start Appium server
```bash
appium
```

2. Ensure Ollama is running and model exists
```bash
ollama serve
ollama pull qwen2.5:3b
```

## 3. Run this project

```bash
npm install
npm run server
npm run dev
```

Or run both server + UI together:

```bash
npm run dev:all
```

## 4. Use from UI

Top bar values:

- Backend API URL: `http://127.0.0.1:8787`
- Ollama URL: `http://127.0.0.1:11434`
- Ollama model: `qwen2.5:3b`
- Bundle/App ID: your app id

Click `Check Infra`:

- `API:ok | Ollama:up | AppiumMCP:up` means backend path is healthy.

## Important for executable steps

For MCP execution, test steps should include selectors, for example:

- `Tap element by id 'login_btn'`
- `Type 'user@test.com' into element by accessibility id 'Email'`
- `Wait for text 'Home'`

Natural-language-only steps (without selectors) are skipped or may fail.
