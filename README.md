# pi-hindsight-memory

Minimal [Hindsight](https://hindsight.vectorize.io/) memory for [pi](https://github.com/earendil-works/pi).

- `hindsight_retain`: the agent stores durable facts explicitly. It is always available.
- `hindsight_recall`: search memory. Results are scoped to the current project by default; pass `allProjects: true` to search everything.
- `hindsight_reflect`: an LLM-synthesized answer over memories. It is slow; use it for "what did we decide about X" questions.
- **Auto recall** runs once, on the first prompt of a session. It is scoped to the current project and persisted as a message, so it is written once and then served from prompt cache.

No session export: only what the agent explicitly retains is sent to Hindsight.

## Install

```bash
pi install git:github.com/ersintarhan/pi-hindsight-memory
```

## Config

Create `~/.pi/agent/hindsight-memory.json`:

```json
{
  "apiUrl": "https://your-hindsight",
  "apiKey": "...",
  "bankId": "default",
  "tags": ["harness:pi", "user:me"],
  "observationScopes": [["user:me"], ["{project}"]],
  "autoRecall": true,
  "autoRecallMaxTokens": 1024
}
```

The project name is the git repository name (worktree-safe), or the cwd basename outside git. Every memory is tagged `project:<name>`, `session:<id>` and `store_method:tool`. In observation scopes, `{project}` expands to `project:<name>`.
