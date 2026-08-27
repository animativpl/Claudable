# Claudable

<img src="https://storage.googleapis.com/claudable-assets/Claudable.png" alt="Claudable" style="width: 100%;" />
<div align="center">
<h3>Connect CLI Agent • Build what you want • Preview instantly</h3>
</div>
<p align="center">
<a href="https://github.com/hesreallyhim/awesome-claude-code">
<img src="https://awesome.re/mentioned-badge.svg" alt="Mentioned in Awesome Claude Code">
</a>
<a href="https://twitter.com/aaron_xong">
<img src="https://img.shields.io/badge/Follow-@aaron__xong-000000?style=flat&logo=x&logoColor=white" alt="Follow Aaron">
</a>
<a href="https://discord.gg/NJNbafHNQC">
<img src="https://img.shields.io/badge/Discord-Join%20Community-7289da?style=flat&logo=discord&logoColor=white" alt="Join Discord Community">
</a>
<a href="https://github.com/opactorai/Claudable">
<img src="https://img.shields.io/github/stars/opactorai/Claudable?style=flat&logo=github&logoColor=white&labelColor=181717&color=f9d71c" alt="GitHub Stars">
</a>
<a href="https://github.com/opactorai/Claudable">
<img src="https://img.shields.io/github/forks/opactorai/Claudable?style=flat&logo=github&logoColor=white&labelColor=181717&color=181717" alt="GitHub Forks">
</a>
<a href="https://github.com/opactorai/Claudable/blob/main/LICENSE">
<img src="https://img.shields.io/github/license/opactorai/Claudable?style=flat&logo=github&logoColor=white&labelColor=181717&color=181717" alt="License">
</a>
</p>

## What is Claudable?

Claudable is a powerful Next.js-based web app builder that combines **C**laude Code's advanced AI agent capabilities with **Lovable**'s simple and intuitive app building experience. Just describe your app idea - "I want a task management app with dark mode" - and watch as Claudable instantly generates the code and shows you a live preview of your working app.

This open-source project empowers you to build professional web applications easily for **free**.

How to start? Simply login to Claude Code, start Claudable, and describe what you want to build. That's it. There is no additional subscription cost for app builder.

## Features

![Claudable Demo](assets/gif/Claudable_v2_cc_4_1080p.gif)

- **Powerful Agent Performance**: Leverage the full power of Claude Code's agent capabilities
- **Natural Language to Code**: Simply describe what you want to build, and Claudable generates production-ready Next.js code
- **Instant Preview**: See your changes immediately with hot-reload as AI builds your app
- **Zero Setup, Instant Launch**: No complex sandboxes, no API key, no database headaches - just start building immediately
- **Beautiful UI**: Generate beautiful UI with Tailwind CSS and shadcn/ui
- **GitHub Integration**: Automatic version control — create or connect a repository and push commits as you build

## AI Coding Agent

**[Claude Code](https://docs.anthropic.com/en/docs/claude-code/setup)** - Anthropic's advanced AI coding agent
- **Features**: Deep codebase awareness, Unix philosophy, direct terminal integration
- **Context**: 1M tokens (`claude-opus-5`, `claude-sonnet-5`), 200K tokens (`claude-haiku-4-5`)
- **Pricing**: Included with Claude Pro/Max/Team/Enterprise plans, or Anthropic API key
- **Installation**:
  ```bash
  npm install -g @anthropic-ai/claude-code
  claude  # then > /login
  ```

## Prerequisites

Before you begin, ensure you have the following installed:
- Node.js 22.12+ (`package.json` requires `>=22.12.0`; the Docker image below
  ships Node 22, and generated Astro projects also need Node ≥ 22.12 to start)
- Claude Code (already logged in)
- Git

## Quick Start

Get Claudable running on your local machine in minutes:

```bash
# Clone the repository
git clone https://github.com/opactorai/Claudable.git
cd Claudable

# Install all dependencies
npm install

# Start development server
npm run dev
```

Your application will be available at http://localhost:3000

**Note**: Ports are automatically detected. If the default port is in use, the next available port will be assigned.

## Docker

Run Claudable in a container instead of on the host.

```bash
cp .env.docker.example .env.docker
# fill in ENCRYPTION_KEY and HOST_UID/HOST_GID — see the comments in the file
docker compose --env-file .env.docker up --build -d
```

`--env-file .env.docker` is required, not optional. Compose only interpolates
`${...}` placeholders in `docker-compose.yml` from the shell environment and
from its interpolation file (`.env` by default) — never from a service's
`env_file:` entry. Without the flag, `HOST_UID`/`HOST_GID` never reach the
`user:` directive, and Compose refuses to start with a message that names the
missing variable and the flag needed to fix it. This is deliberate: a silent
default previously produced a container running under the wrong uid that took
ownership of files in the mounted `.claude` directory.

- **`HOST_UID` / `HOST_GID`**: left blank in `.env.docker.example` on purpose
  — a filled-in number looks like a deliberate choice, and nothing would tell
  you it wasn't yours. Get your own with `id -u` and `id -g`.
- **`ENCRYPTION_KEY`**: secrets go through `.env.docker`, a file outside the
  repository (git-ignored). Also left blank in the example on purpose, and
  guarded the same way as `HOST_UID`: Compose refuses to start without it. An
  empty value would not stop the app at startup — but `lib/crypto.ts` now
  throws the first time it's actually asked to encrypt or decrypt anything
  (e.g. saving an encrypted env var), rather than silently generating
  a new random key on every container start the way it used to.
- **Ports**: published on `127.0.0.1` only. The app has no authentication and
  gives the agent a Bash tool, so exposing it on every network interface
  would be remote code execution for anyone on the same network. Reaching it
  from another machine requires an explicit override of the port mapping.
- **Preview slots**: 32 of them (`3100`–`3131`). A 33rd concurrent preview
  fails loudly with a "no free port" error — that's the limit of the feature,
  not a documentation gap.
- **Node version**: the image requires Node ≥ 22.12, and this project's own
  `engines.node` in `package.json` states the same floor. The image's floor
  exists because generated projects' `astro@7` refuses to start below Node
  22.12; this project's own floor is simply declared in `package.json`, not
  derived from any dependency. The two numbers coincide; the concerns they
  describe — the platform Claudable runs on, versus the runtime it hands to
  generated projects inside the container — remain separate.
- **`CLAUDABLE_DATA`** (default `./data`): mounted to `/data` in the
  container. Holds projects, the SQLite database, and global settings. Set
  this to keep projects outside the repository, e.g.
  `CLAUDABLE_DATA=/srv/claudable-data` in `.env.docker`.
- **`CLAUDABLE_CLAUDE_DIR`** (default `${HOME}/.claude`): mounted to
  `/data/home/.claude` in the container, which is also where `CLAUDE_CONFIG_DIR`
  points inside the container — the agent's `CLAUDE.md`, skills, subagents,
  hooks, MCP config, and credentials. The mount must be writable: refreshing
  the OAuth token writes to `.credentials.json`, and a read-only mount makes
  the agent fail once that token expires.

### What you get from the mounted `.claude`

Skills, subagents, `CLAUDE.md`, commands, and hooks all pass through from the
mounted host `.claude` directory. Subagent count follows a fixed rule: 4
built-in (`general-purpose`, `statusline-setup`, `Explore`, `Plan`) plus one
per definition file in the mounted `agents/` directory, plus any
project-level agent definitions the project itself supplies — true for any
`agents/` directory, not just this one. Three things make a file not count:
missing or unparseable frontmatter (a `name` and a `description` are
required), a `name` that collides with one of the four built-ins, and a
project definition reusing a user definition's name — the project one wins,
and the pair counts once. Each skipped file is logged. Skills and commands don't reduce to
as clean a formula (commands also pick up one entry per tool a connected MCP
server exposes), so their numbers below are a measurement of this branch's
own `~/.claude` configuration, not a portability promise: skills went from 5
to 24, commands from 15 to 36. A deny-type hook actually blocked a write
attempted by the agent inside the container.

Two things don't have full parity:
- **MCP servers configured locally do not pass through.** Claude Code keeps
  them in `~/.claude.json`, outside the `.claude` directory that gets
  mounted. MCP servers configured on a claude.ai account load normally. This
  is a known limitation, not a dead end — the Claude Agent SDK exposes an
  `mcpServers` option that could wire local servers through, but doing so is
  separate work.
- **Hook parity is 11 of 12.** The twelfth hook entry in a user's
  `settings.json` has an absolute host path with no container equivalent
  under any mount layout, so it doesn't fire inside the container.

**Symlinks inside `.claude` that point outside it will silently not work.**
Docker's bind mount only brings in the mounted directory itself — a symlink
inside `.claude` that targets a path elsewhere on the host (common with
dotfiles managers) resolves to nothing in the container. The symptom is
exactly that: settings that appear configured on the host have no effect
inside the container, with no error anywhere. Workaround: add a
`docker-compose.override.yml` that bind-mounts the symlink's real target at
the same absolute path inside the container, so the link resolves the same
way it does on the host.

### Updating an existing installation

Two pitfalls when running `docker compose up` against a `./data` directory
that already exists from before:

- **`data/home` must exist before the first `docker compose up`.**
  `scripts/setup-env.js` creates it, so running the install once
  (`npm install`) is enough. If it's missing on an existing `./data`, the
  container still comes up, but `~/.claude.json` inside it is unwritable —
  a silent failure. On a clean checkout with no `./data` at all, the
  container exits with code 1 instead — a loud one.
- **A stale `.env.local` can win over `.env`.** An installation from before
  Docker support may have a frozen `.env.local` (for example
  `PREVIEW_PORT_END=3999`) that some loading paths prefer over `.env`.
  `scripts/setup-env.js` prunes its managed keys from `.env.local`
  automatically on `npm install`. If the file has a value that spans
  multiple lines or an unterminated quote, it deliberately leaves the file
  untouched and prints a warning instead — fix those by hand. `.env` is now
  the only place to pin values; a pin left in `.env.local` will stop taking
  effect.

Two smaller things worth knowing:
- The npm cache lives on the data mount (`/data/.npm`) and grows by hundreds
  of megabytes as projects install dependencies. That's expected, not a leak.
- After `docker compose down`, an empty `data/home/.claude` directory owned
  by root is left behind. It's harmless and can be removed by hand.

### What's been verified

The image was built and run end-to-end on arm64. x86_64 has not been
verified — no QEMU was available to test it, so don't assume it works.

Asset mirroring (serving a project's uploaded assets back through the app)
works under normal conditions, but under a host/container uid mismatch it
degrades silently to a missing `publicUrl` instead of failing loudly.

## Setup

The `npm install` command automatically handles the complete setup:

1. **Port Configuration**: Detects available ports and creates `.env` files
2. **Dependencies**: Installs all required Node.js packages
3. **Database Setup**: SQLite database auto-creates at `data/cc.db` on first run

### Additional Commands
```bash
npm run db:backup   # Create a backup of your SQLite database
                    # Use when: Before major changes or upgrades
                    # Creates: data/backups/cc_backup_[timestamp].db

npm run prisma:reset # Reset database to initial state
                    # Use when: Need fresh start or corrupted data
                    # Warning: This will delete all your data!

npm run clean       # Remove all dependencies
                    # Use when: Dependencies conflict or need fresh install
                    # Removes: node_modules/, package-lock.json
                    # After running: npm install to reinstall everything
```

## Usage

### Getting Started with Development

1. **Connect Claude Code**: Link your Claude Code CLI to enable AI assistance
2. **Pick a Template**: A new project starts from one of two templates —
   Next.js (App Router) or Astro. The template scaffolds a minimal project
   and writes a `CLAUDE.md` into it with that framework's conventions, which
   the agent reads from the project directory on every run.
3. **Describe Your Project**: Use natural language to describe what you want to build
4. **AI Generation**: Watch as the AI generates your project structure and code
5. **Live Preview**: See changes instantly with hot reload functionality

### Database Operations

Claudable uses SQLite for local development. The database automatically initializes on first run.

## Troubleshooting

### Upgrading from a Previous Version

This branch drops two tables (`commits`, `tool_usages`) and six columns
(`Message.durationMs`/`tokenCount`/`costUsd`/`commitSha`,
`ProjectServiceConnection.lastSyncAt`, `Project.settings`). On an existing
installation, the next `npm run dev` runs `prisma db push` without a
data-loss flag, so Prisma asks for confirmation: an interactive terminal
gets a prompt, a non-interactive one gets an error. Nothing is deleted
silently — but the fix isn't written down anywhere else, so run this first:

```bash
npm run db:backup          # copies your database to data/backups/, exits non-zero if there's nothing to copy
npm run db:migrate-legacy  # removes rows for providers the product no longer supports (Vercel, Supabase)
npx prisma db push --accept-data-loss
```

`--accept-data-loss` is safe here: the columns being dropped are no longer
read by anything, and the backup step above already ran. On the local path
(`npm run dev`) it is deliberately **not** part of automatic startup — there,
any future schema drift asks instead of deleting.

**In the container it is part of startup.** The image runs `prisma db push
--accept-data-loss` against the mounted database on *every* start, with no
backup and no prompt — a container has nobody to answer one. Nothing inside
the container runs the backup or the legacy-row cleanup for you either. On an
existing installation, run both from a normal checkout *before* the first
`docker compose up`, against the same database file you are about to mount at
`/data` — `./data/cc.db` by default, which is what a checkout already uses.
With a custom `CLAUDABLE_DATA`, point `DATABASE_URL` in `.env` at that file
first: these scripts read it from `.env`/`.env.local`, not from the shell.

```bash
npm run db:backup
npm run db:migrate-legacy
```

Skipping this leaves the legacy `ServiceToken` rows for `vercel` and
`supabase` in place, holding plaintext tokens the app can no longer delete
through the UI: `GET /api/tokens/:provider` only recognizes `github` and
rejects anything else, so there's no listing path to their delete button,
and `DELETE /api/tokens/:id` matches by primary key, not provider name, so
`DELETE /api/tokens/vercel` 404s rather than deleting anything.

### Database Migration Conflicts

If the steps above don't apply and you still hit database errors, reset the
Prisma database so it matches the latest schema:

```bash
npm run prisma:reset
```

The command drops and recreates the local database, so back up any data you
need before running it.

### Port Already in Use

The application automatically finds available ports. Check the `.env` file to see which ports were assigned.

### Installation Failures

```bash
# Clean all dependencies and retry
npm run clean
npm install
```

### Claude Code Permission Issues (Windows/WSL)

If you encounter the error: `Error output dangerously skip permissions cannot be used which is root sudo privileges for security reasons`

**Solution:**
1. Do not run Claude Code with `sudo` or as root user
2. Ensure proper file ownership in WSL:
   ```bash
   # Check current user
   whoami
   
   # Change ownership of project directory to current user
   sudo chown -R $(whoami):$(whoami) ~/Claudable
   ```
3. If using WSL, make sure you're running Claude Code from your user account, not root
4. Verify Claude Code installation permissions:
   ```bash
   # Reinstall Claude Code without sudo
   npm install -g @anthropic-ai/claude-code --unsafe-perm=false
   ```

## Integration Guide

### GitHub
**Get Token:** [GitHub Personal Access Tokens](https://github.com/settings/tokens) → Generate new token (classic) → Select `repo` scope

**Connect:** Settings → Service Integrations → GitHub → Enter token → Create or connect repository

## License

MIT License.

## Upcoming Features
These features are in development and will be opened soon.
- **Native MCP Support** - Model Context Protocol integration for enhanced agent capabilities
- **Checkpoints for Chat** - Save and restore conversation/codebase states
- **Enhanced Agent System** - Subagents, AGENTS.md integration
- **Website Cloning** - You can start a project from a reference URL.
- Various bug fixes and community PR merges

We're working hard to deliver the features you've been asking for. Stay tuned!

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=opactorai/Claudable&type=Date)](https://www.star-history.com/#opactorai/Claudable&Date)
