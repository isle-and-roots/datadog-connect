import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { APP_VERSION } from "./config/constants.js";
import { setupTool, SETUP_TOOL_DEF } from "./mcp-tools/setup-tool.js";
import { resumeTool, RESUME_TOOL_DEF } from "./mcp-tools/resume-tool.js";
import { rollbackTool, ROLLBACK_TOOL_DEF } from "./mcp-tools/rollback-tool.js";
import { statusTool, STATUS_TOOL_DEF } from "./mcp-tools/status-tool.js";

// Redirect console.log to stderr (stdout is reserved for JSON-RPC)
console.log = console.error;

const server = new Server(
  { name: "datadog-connect", version: APP_VERSION },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [SETUP_TOOL_DEF, RESUME_TOOL_DEF, ROLLBACK_TOOL_DEF, STATUS_TOOL_DEF],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "datadog_setup":
        return await setupTool(args ?? {});
      case "datadog_resume":
        return await resumeTool(args ?? {});
      case "datadog_rollback":
        return await rollbackTool(args ?? {});
      case "datadog_status":
        return await statusTool(args ?? {});
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server failed to start:", err);
  process.exit(1);
});
