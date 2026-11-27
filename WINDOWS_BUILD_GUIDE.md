# STRANGE v1.0 — Windows 10 Desktop Packaging & Portable Migration Guide

Designed specifically for resource-constrained hardware (**Lenovo G570, Windows 10, 6 GB RAM**) with **zero database setup**:
- **Zero external or native database required**: No MySQL, PostgreSQL, MongoDB, Docker, SQLite native binaries, or Supabase needed for STRANGE's core operation.
- **Automatic Local JSON Storage**: All conversations, projects, settings, activity logs, research, presentations, and automation configurations are automatically created and stored in `%APPDATA%/STRANGE/data/store/*.json` with atomic write protection, schema validation, and rotating automatic backups in `%APPDATA%/STRANGE/data/backups/`.
- **Separate Credential Protection**: API credentials are never stored in JSON files or exports; on Windows 10 they are encrypted at rest via Electron `safeStorage` (Windows DPAPI).
- **Portable Laptop-to-Laptop Migration**: Use **Settings > Local JSON Storage & Backups > Export Portable Data (.json)** on one Windows laptop and **Import & Restore (.json)** on another independently installed Windows laptop.

## Verified in Google AI Studio Linux Sandbox vs. Pending on Windows 10

### Verified in this environment
- Full-stack Node.js (`v22`) + Express + Vite + React + Local JSON atomic storage engine.
- Automatic JSON file creation, atomic writes, validation, rotating local backups, backup restoration, and portable export/import endpoints.
- Server-side Gemini API integration (`@google/genai`, `gemini-4-hydrogen` & `gemini-3.1-flash-lite`) with Google Search grounding.
- Isolated project workspace generation (`./workspaces/<slug>/`), Pass 1 (`node --check` + `node --test`) and Pass 2 (live HTTP asset checks), reversible backups, and PDF handover export.

### Must be executed on your Windows 10 machine
Because Google AI Studio runs in a Linux container without Windows Electron NSIS toolchains or Playwright Chromium binaries, complete these exact steps on Windows 10 to produce the standalone `.exe` installer:

1. **Install Electron packaging tools & Playwright** (one-time on your build machine; end users do not need Node.js or any database after packaging):
   ```powershell
   npm install
   npm install -D electron electron-builder playwright
   npx playwright install chromium
   ```
2. **Test the Windows desktop app locally**:
   ```powershell
   npm run build
   npm run electron:start
   ```
3. **Run full Playwright browser E2E testing (Pass 3)** on generated projects:
   ```powershell
   npx playwright test
   ```
4. **Build the standalone Windows 10 installer (`STRANGE-Setup-0.0.0-win-x64.exe`)**:
   ```powershell
   npm run electron:build:win
   ```
   The NSIS installer will be output to `release/STRANGE-Setup-0.0.0-win-x64.exe` and can be installed independently on any Windows 10/11 laptop.
