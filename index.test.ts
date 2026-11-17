import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { formatResults, recallTags, scopeOf } from "./index";

test("scopeOf: git repo, worktree, stack root, plain dir", () => {
	const stack = mkdtempSync(join(tmpdir(), "phm-stack-"));
	const repo = join(stack, "svc");
	mkdirSync(repo);
	const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, stdio: "ignore" });
	git("init", "-q");
	git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "i");
	git("worktree", "add", "-q", join(tmpdir(), `phm-wt-${Date.now()}`));
	const wt = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: repo, encoding: "utf8" })
		.split("\n")
		.filter((l) => l.startsWith("worktree "))[1]!
		.slice(9);
	const name = basename(stack);

	expect(scopeOf(stack, [stack])).toEqual({ project: name, stack: name });
	expect(scopeOf(join(repo), [stack])).toEqual({ project: "svc", stack: name });
	expect(scopeOf(wt, [stack])).toEqual({ project: "svc", stack: name }); // worktree outside the stack dir
	expect(scopeOf(repo)).toEqual({ project: "svc" });
	const plain = mkdtempSync(join(tmpdir(), "phm-"));
	expect(scopeOf(plain, [stack])).toEqual({ project: basename(plain) });
});

test("recallTags", () => {
	expect(recallTags({ project: "svc" })).toEqual(["project:svc"]);
	expect(recallTags({ project: "svc", stack: "torro" })).toEqual(["project:svc", "project:torro"]);
	expect(recallTags({ project: "torro", stack: "torro" })).toEqual(["project:torro", "stack:torro"]);
});

test("formatResults", () => {
	expect(formatResults([{ text: "a", type: "world", mentioned_at: "2026-09-24T18:50:45Z" }, { text: "b" }])).toBe(
		"- [world, 2026-09-24] a\n- [] b",
	);
});

test("before_agent_start: custom-message run has no prompt", async () => {
	const dir = mkdtempSync(join(tmpdir(), "phm-cfg-"));
	writeFileSync(join(dir, "hindsight-memory.json"), JSON.stringify({ apiUrl: "http://127.0.0.1:1", bankId: "test" }));
	const prev = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	try {
		const { default: init } = await import(`./index?custom-${Date.now()}`);
		let handler: ((event: unknown, ctx: unknown) => unknown) | undefined;
		init({
			on: (name: string, h: (event: unknown, ctx: unknown) => unknown) => {
				if (name === "before_agent_start") handler = h;
			},
			registerTool: () => {},
		} as never);
		expect(await handler!({ type: "before_agent_start", messageType: "custom", message: { content: [] } }, {})).toBeUndefined();
	} finally {
		if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = prev;
	}
});
