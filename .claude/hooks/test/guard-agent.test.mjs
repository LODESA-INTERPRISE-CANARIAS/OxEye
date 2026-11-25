import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from './helpers.mjs';

const run = (input) => runScript('guard-agent.mjs', input);

test('remote isolation is denied', () => {
  assert.equal(run({ tool_name: 'Agent', tool_input: { prompt: 'x', isolation: 'remote' } }).status, 2);
});

test('local agents are allowed', () => {
  assert.equal(run({ tool_name: 'Agent', tool_input: { prompt: 'x', subagent_type: 'architect' } }).status, 0);
  assert.equal(run({ tool_name: 'Agent', tool_input: { prompt: 'x', isolation: 'worktree' } }).status, 0);
});

test('malformed input is denied', () => {
  assert.equal(run('x').status, 2);
  assert.equal(run({ tool_name: 'Agent' }).status, 2);
  assert.equal(run({ tool_name: 'Bash', tool_input: {} }).status, 2);
});
