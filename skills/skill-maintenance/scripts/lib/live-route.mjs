// live-route.mjs: asks Claude Code itself which skill it would load for a prompt. Runs
// `claude -p <prompt> --output-format stream-json --verbose` in the repo, reads the event stream,
// and stops the run at the first tool call: a Skill call names the chosen skill; any other first
// tool (Read, Bash ...) or a plain answer counts as "no skill". A plugin skill arrives as
// "<plugin>:<skill>" and is read as <skill>. The stream's first system event with subtype "init" lists
// the session's skills (`skills`, plugin skills as "<plugin>:<skill>"; verified with Claude Code
// 2.1.299 on 2026-10-14: re-verify by reading that event of `claude -p "hi" --output-format stream-json
// --verbose`); it is returned as `loaded` (bare names), or null when the event has no list. Costs one
// short model call per run. A claude command ending in .mjs runs with this Node (a stand-in that prints
// the same event stream, for the self-test).
import { spawn } from 'node:child_process';

/**
 * Resolves { skill: string | null, firstTool: string | null, loaded: string[] | null, error?: string } for one
 * prompt. With `expect`, a session whose init list lacks that skill stops at once (no model call).
 */
export function routeLive(prompt, { cwd, claude = 'claude', timeoutMs = 120000, pluginDir = null, expect = null } = {}) {
  return new Promise((resolvePromise) => {
    const env = { ...process.env };
    // A nested Claude Code refuses to start while these point at the parent session.
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    let child;
    try {
      const [command, prefix] = claude.endsWith('.mjs') ? [process.execPath, [claude]] : [claude, []];
      child = spawn(command, [...prefix, '-p', prompt, '--output-format', 'stream-json', '--verbose', ...(pluginDir ? ['--plugin-dir', pluginDir] : [])], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolvePromise({ skill: null, firstTool: null, loaded: null, error: error.message });
      return;
    }
    let buffer = '';
    let stderr = '';
    let settled = false;
    let loaded = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGTERM');
      resolvePromise({ ...result, loaded });
    };
    const timer = setTimeout(() => finish({ skill: null, firstTool: null, error: `no answer within ${timeoutMs / 1000} s` }), timeoutMs);
    child.on('error', (error) => finish({ skill: null, firstTool: null, error: error.code === 'ENOENT' ? `${claude} is not installed or not on PATH` : error.message }));
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line.startsWith('{')) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.type === 'system' && event.subtype === 'init' && Array.isArray(event.skills)) {
          loaded = event.skills.map((name) => String(name).replace(/^.*:/, ''));
          // The expected skill is not in this session: stop before the model call, the caller reports it.
          if (expect !== null && !loaded.includes(expect)) finish({ skill: null, firstTool: null });
        } else if (event.type === 'assistant') {
          const call = (event.message?.content ?? []).find((block) => block.type === 'tool_use');
          if (call) finish({ skill: call.name === 'Skill' ? String(call.input?.skill ?? '').replace(/^.*:/, '') || null : null, firstTool: call.name });
        } else if (event.type === 'result') {
          finish({ skill: null, firstTool: null, error: event.is_error ? String(event.result ?? 'error result') : undefined });
        }
      }
    });
    child.on('close', (code) => finish({ skill: null, firstTool: null, error: code === 0 ? undefined : `claude exited ${code}: ${stderr.trim().split('\n').pop() ?? ''}` }));
  });
}
