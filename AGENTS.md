# zambahola-one-agent

Placeholder repository for a future **Zambahola one-agent** product. There is no application source, dependency manifest, or runnable service in the tree yet.

## Repository state

| Item | Status |
|------|--------|
| Application code | Not present |
| `package.json` / `pyproject.toml` | Not present |
| Docker / Compose | Not present |
| Tests / lint config | Not present |
| CI workflows | Not present |

When implementation lands, extend this file with stack-specific run/lint/test commands and update the VM **update script** (see Cursor Cloud settings) to install dependencies.

## Cursor Cloud specific instructions

### What runs today

Nothing is required to start for local development. There are no backend, frontend, or worker processes defined in this repo.

### VM update script behavior

The configured startup update script is intentionally a no-op (`true`) because there are no project dependencies to refresh after `git pull`. Once a manifest exists (for example `package.json` or `requirements.txt`), change the update script to the appropriate install command (`npm ci`, `pnpm install`, `uv sync`, etc.).

### Baseline tools on the Cloud VM

These are available on the agent VM for future work but are **not** wired to this repo yet:

- **Node.js** via nvm (v22.x), **npm**, **pnpm**
- **Python 3.12**, **pip**
- **git**, **GitHub CLI** (`gh`)
- **Docker** is not installed on the default VM image

### Verification (no app yet)

Until code is added, use this quick check after clone or pull:

```bash
cd /workspace
test -f README.md
grep -q zambahola README.md
git status
```

Expected: clean working tree on `main`, README contains `zambahola-one-agent`.

### When you add an application

Document here (and in `README.md`):

1. Required services and ports
2. Environment variables (`.env.example`)
3. Install, lint, test, and dev-server commands
4. A minimal “hello world” flow (e.g. health endpoint, CLI `--help`, or first agent turn)

Do **not** put service startup (`npm run dev`, `docker compose up`, migrations) in the VM update script—only dependency refresh belongs there.
