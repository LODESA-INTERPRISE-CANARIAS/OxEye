#!/usr/bin/env node
// PreToolUse guard for the Agent tool: blocks remote (cloud) agent isolation.
// Spec: doc/specs/2026-11-25-claude-code-security-setup.md, section 5.6.

import { runHook, deny } from './lib/common.mjs';

runHook('agent', (input) => {
  if (input.tool_name !== 'Agent' && input.tool_name !== 'Task') deny(`unexpected tool "${input.tool_name}"`);
  const ti = input.tool_input;
  if (!ti || typeof ti !== 'object' || Array.isArray(ti)) deny('missing tool_input');
  if (ti.isolation === 'remote') deny('remote (cloud) agents are disabled in this project');
});
