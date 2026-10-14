// The tools the tests' helper plugins register (`peek`, `closer`, `spawner`). The generated MCP types only list the
// servers connected when they were generated, so these are declared here, for the tests only.
export {}

declare module 'claude-code' {
  interface McpToolInputs {
    'mcp__peek__run': Record<string, unknown>
    'mcp__closer__close': Record<string, unknown>
    'mcp__spawner__go': Record<string, unknown>
  }
}
