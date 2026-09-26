/**
 * pi-hindsight-memory: minimal Hindsight memory for pi.
 *
 * - hindsight_retain / hindsight_recall / hindsight_reflect tools, always visible.
 * - One project-scoped recall on the first prompt of each session, persisted as a
 *   custom message (written once, then served from prompt cache).
 * - No session export: only what the agent explicitly retains goes to Hindsight.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

interface Config {
	apiUrl: string;
	apiKey?: string;
	bankId: string;
	/** Added to every retained memory, e.g. ["harness:pi", "user:ersin"]. */
	tags?: string[];
	/** Observation scopes; "{project}" expands to "project:<name>". */
	observationScopes?: string[][];
	/** Stack roots: non-git dirs holding several repos, e.g. ["~/Projects/torro"]. */
	stacks?: string[];
	/** Recall once on the first prompt of each session. Default true. */
	autoRecall?: boolean;
	/** Token cap for the auto recall. Default 1024. */
	autoRecallMaxTokens?: number;
}

interface RecallResult {
	text: string;
	type?: string;
	mentioned_at?: string;
}

const CONFIG_PATH = join(getAgentDir(), "hindsight-memory.json");
const RECALL_TYPE = "hindsight-memory";

export interface Scope {
	project: string;
	stack?: string;
}

/**
 * project = git repo name (worktree-safe via common dir), else cwd basename (matches epimetheus).
 * stack = basename of the configured stack root containing the repo (or cwd, outside git).
 */
export function scopeOf(cwd: string, stacks: string[] = []): Scope {
	let repo: string | undefined;
	try {
		const dir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		repo = basename(dir) === ".git" ? dirname(dir) : dir;
	} catch {
		// not a git repo: fall back to cwd
	}
	const at = resolve(repo ?? cwd);
	const root = stacks
		.map((s) => resolve(s.replace(/^~(?=\/|$)/, homedir())))
		.find((s) => at === s || at.startsWith(s + sep));
	return { project: basename(at).replace(/\.git$/, ""), ...(root ? { stack: basename(root) } : {}) };
}

/** Repo: own + stack-level memories. Stack root (planner): own + everything tagged with the stack. */
export function recallTags({ project, stack }: Scope): string[] {
	if (!stack) return [`project:${project}`];
	return [`project:${project}`, stack === project ? `stack:${stack}` : `project:${stack}`];
}

export function formatResults(results: RecallResult[]): string {
	return results
		.map((r) => `- [${[r.type, r.mentioned_at?.slice(0, 10)].filter(Boolean).join(", ")}] ${r.text}`)
		.join("\n");
}

function loadConfig(): Config | string {
	try {
		const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Config;
		if (!cfg.apiUrl || !cfg.bankId) return `apiUrl and bankId are required in ${CONFIG_PATH}`;
		return cfg;
	} catch (e) {
		return `cannot read ${CONFIG_PATH}: ${e instanceof Error ? e.message : e}`;
	}
}

export default function (pi: ExtensionAPI) {
	const loaded = loadConfig();
	if (typeof loaded === "string") {
		pi.on("session_start", (_e, ctx) => ctx.ui.notify(`hindsight-memory disabled: ${loaded}`, "warning"));
		return;
	}
	const cfg = loaded;

	async function api<T>(path: string, body: unknown, signal?: AbortSignal, timeoutMs = 30_000): Promise<T> {
		const timeout = AbortSignal.timeout(timeoutMs);
		const res = await fetch(`${cfg.apiUrl.replace(/\/$/, "")}/v1/default/banks/${encodeURIComponent(cfg.bankId)}${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
			body: JSON.stringify(body),
			signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
		});
		if (!res.ok) throw new Error(`Hindsight ${path} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
		return (await res.json()) as T;
	}

	const scopeTags = (cwd: string, allProjects?: boolean) =>
		allProjects ? {} : { tags: recallTags(scopeOf(cwd, cfg.stacks)), tags_match: "any_strict" };

	const recall = (query: string, cwd: string, allProjects: boolean | undefined, maxTokens: number, signal?: AbortSignal) =>
		api<{ results: RecallResult[] }>(
			"/memories/recall",
			{ query: query.slice(0, 800), budget: "mid", max_tokens: maxTokens, ...scopeTags(cwd, allProjects) },
			signal,
			15_000,
		).then((r) => r.results ?? []);

	const allProjectsParam = Type.Optional(
		Type.Boolean({ description: "Search every project instead of only the current one. Default false." }),
	);

	pi.registerTool({
		name: "hindsight_retain",
		label: "Hindsight Retain",
		description:
			"Store a durable fact in long-term memory: user preferences, project decisions, conventions, gotchas, non-obvious fixes. " +
			"Write one self-contained statement understandable without this conversation. Do not store transient task progress.",
		parameters: Type.Object({
			content: Type.String({ description: "Self-contained information to remember" }),
			context: Type.Optional(Type.String({ description: "Short note on where/why this came up; improves extraction" })),
			tags: Type.Optional(Type.Array(Type.String(), { description: "Extra tags, e.g. 'topic:auth'" })),
		}),
		async execute(_id, p, signal, _onUpdate, ctx) {
			const { project: name, stack } = scopeOf(ctx.cwd, cfg.stacks);
			const project = `project:${name}`;
			await api(
				"/memories",
				{
					async: true,
					items: [
						{
							content: p.content,
							context: p.context,
							timestamp: new Date().toISOString(),
							tags: [...(cfg.tags ?? []), project, ...(stack ? [`stack:${stack}`] : []), `session:${ctx.sessionManager.getSessionId()}`, "store_method:tool", ...(p.tags ?? [])],
							observation_scopes: cfg.observationScopes?.map((s) => s.map((t) => t.replaceAll("{project}", project))),
						},
					],
				},
				signal,
			);
			return { content: [{ type: "text", text: "Stored in long-term memory." }], details: {} };
		},
	});

	pi.registerTool({
		name: "hindsight_recall",
		label: "Hindsight Recall",
		description:
			"Search long-term memory for facts from earlier sessions (preferences, decisions, past fixes). Scoped to the current project unless allProjects is true.",
		parameters: Type.Object({
			query: Type.String({ description: "What to look for, in natural language" }),
			allProjects: allProjectsParam,
		}),
		async execute(_id, p, signal, _onUpdate, ctx) {
			const results = await recall(p.query, ctx.cwd, p.allProjects, 2048, signal);
			return {
				content: [{ type: "text", text: results.length ? formatResults(results) : "No relevant memories found." }],
				details: { count: results.length },
			};
		},
	});

	pi.registerTool({
		name: "hindsight_reflect",
		label: "Hindsight Reflect",
		description:
			"Answer a question by reasoning over many memories (slow, uses an LLM). Use for summaries like 'what did we decide about X'; use hindsight_recall for simple lookups.",
		parameters: Type.Object({
			query: Type.String({ description: "Question to answer" }),
			allProjects: allProjectsParam,
		}),
		async execute(_id, p, signal, _onUpdate, ctx) {
			const r = await api<{ text?: string }>("/reflect", { query: p.query, ...scopeTags(ctx.cwd, p.allProjects) }, signal, 120_000);
			return { content: [{ type: "text", text: r.text || "No relevant memories found." }], details: {} };
		},
	});

	// One recall per session: skip if this branch already carries a recall block (resume/reload/fork).
	// `recalled` also stops retrying every prompt when the first recall came back empty.
	let recalled = false;
	pi.on("session_start", () => {
		recalled = false;
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (recalled || cfg.autoRecall === false || !event.prompt.trim()) return;
		recalled = true;
		if (ctx.sessionManager.getBranch().some((e) => e.type === "custom_message" && e.customType === RECALL_TYPE)) return;
		try {
			const results = await recall(event.prompt, ctx.cwd, false, cfg.autoRecallMaxTokens ?? 1024, ctx.signal);
			if (!results.length) return;
			return {
				message: {
					customType: RECALL_TYPE,
					display: true,
					content:
						`<hindsight_memories>\nMemories from earlier sessions in project "${scopeOf(ctx.cwd, cfg.stacks).project}". ` +
						`Background only; they may be outdated, verify before relying on them.\n\n${formatResults(results)}\n</hindsight_memories>`,
				},
			};
		} catch (e) {
			ctx.ui.notify(`hindsight auto-recall failed: ${e instanceof Error ? e.message : e}`, "warning");
		}
	});
}
