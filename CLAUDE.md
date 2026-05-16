# jkq-cc-connect

Mobile-first PWA for remote Claude Code operation. Chat-style interface over WebSocket.

## Stack

- **Server**: Node.js + TypeScript + Express + `ws` + `node-pty` + `better-sqlite3`
- **Client**: Vue 3 + TypeScript + Vite + Pinia + Tailwind CSS (PWA)

## Architecture

```
Phone/Desktop (PWA) --WebSocket--> Express Server --node-pty--> Claude Code Process
                       --REST API--> SQLite (sessions, messages)
```

- WebSocket for real-time CC I/O, REST for auth + file browsing
- Single active CC session, all clients share one room (multi-device sync)
- CC output parsed via `--output-format stream-json` with ANSI fallback

## Running

```bash
npm install
npm run dev -w server    # Start server (port 3000)
npm run dev -w client    # Start Vite dev server (port 5173)
```

## Project structure

```
server/src/
  index.ts            Entry point
  config.ts           Configuration (port, project dir, password, jwt secret)
  http/               Express routes + middleware
  ws/                 WebSocket gateway + protocol
  cc/                 CC process manager + output parser
  store/              SQLite database + session/message CRUD
  fs/                 File browser service
  utils/              Logger, ANSI stripping

client/src/
  views/              Login, Chat, FileBrowser, FileViewer, Sessions, Settings
  components/chat/     MessageBubble, ThinkingBubble, CodeBlockCard, DiffCard,
                       ToolUseCard, ConfirmCard, ChatHeader, ChatInput, MessageList
  components/files/    FileTree, FileViewer, Breadcrumb
  components/common/   StatusBadge, LoadingSpinner
  stores/              auth, chat, ws, files (Pinia)
  router/              Vue Router config
  utils/               API client, markdown renderer
  types/               Shared TypeScript types
```
