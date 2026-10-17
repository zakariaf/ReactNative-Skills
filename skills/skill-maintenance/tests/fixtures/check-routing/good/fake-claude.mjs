#!/usr/bin/env node
// fake-claude.mjs: stands in for claude -p <prompt> --output-format stream-json in the self-test. It prints
// the event stream live-route.mjs reads: the init event listing the session's skills (the folders under
// skills/, task-lists as a plugin skill, plus two bundled ones; fake-loaded.json replaces the list when it
// exists), then a Skill tool call for a prompt that contains a key of fake-answers.json (in the working
// folder), otherwise a plain answer.
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const prompt = process.argv[process.argv.indexOf('-p') + 1] ?? '';
const answers = JSON.parse(readFileSync('fake-answers.json', 'utf8'));
const skill = Object.entries(answers).find(([words]) => prompt.includes(words))?.[1] ?? null;
const listed = existsSync('skills') ? readdirSync('skills').map((name) => (name === 'task-lists' ? `tasks:${name}` : name)) : [];
const loaded = existsSync('fake-loaded.json') ? JSON.parse(readFileSync('fake-loaded.json', 'utf8')) : [...listed, 'debug', 'verify'];
const say = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
say({ type: 'system', subtype: 'hook_started' });
say({ type: 'system', subtype: 'init', skills: loaded });
if (skill) say({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill } }] } });
else say({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } });
say({ type: 'result', is_error: false, result: 'done' });
