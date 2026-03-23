import { basename, join, resolve } from "node:path";
import { runSuite } from "../scripts/run-tests";

type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

type ToolCallArgs = {
  filter?: string;
  timeoutMs?: number;
  verbosity?: "compact" | "normal";
};

type SuiteName = "unit" | "integration" | "smoke";

const SERVER_INFO = {
  name: "miniraft-gateway-tests",
  version: "0.1.0",
};

const TOOLS = [
  {
    name: "list_test_suites",
    description: "List the available backend gateway test suites and the scripts they map to.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "run_unit_tests",
    description: "Run fast isolated unit tests for gateway backend modules.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", description: "Optional regex for matching test names." },
        timeoutMs: { type: "number", minimum: 1, description: "Optional per-test timeout override." },
        verbosity: {
          type: "string",
          enum: ["compact", "normal"],
          description: "Compact returns shorter output previews.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "run_integration_tests",
    description: "Run gateway integration tests against mocked backend dependencies.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", description: "Optional regex for matching test names." },
        timeoutMs: { type: "number", minimum: 1, description: "Optional per-test timeout override." },
        verbosity: {
          type: "string",
          enum: ["compact", "normal"],
          description: "Compact returns shorter output previews.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "run_smoke_tests",
    description: "Run smoke tests against a live Bun server for the gateway backend.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", description: "Optional regex for matching test names." },
        timeoutMs: { type: "number", minimum: 1, description: "Optional per-test timeout override." },
        verbosity: {
          type: "string",
          enum: ["compact", "normal"],
          description: "Compact returns shorter output previews.",
        },
      },
      additionalProperties: false,
    },
  },
];

function parseToolArgs(input: unknown): ToolCallArgs {
  if (input === undefined || input === null) {
    return {};
  }

  if (typeof input !== "object") {
    throw new Error("Tool arguments must be an object.");
  }

  const record = input as Record<string, unknown>;

  if (record.filter !== undefined && typeof record.filter !== "string") {
    throw new Error("filter must be a string.");
  }

  if (record.timeoutMs !== undefined && (typeof record.timeoutMs !== "number" || Number.isNaN(record.timeoutMs) || record.timeoutMs <= 0)) {
    throw new Error("timeoutMs must be a positive number.");
  }

  if (
    record.verbosity !== undefined &&
    record.verbosity !== "compact" &&
    record.verbosity !== "normal"
  ) {
    throw new Error('verbosity must be either "compact" or "normal".');
  }

  return {
    filter: record.filter as string | undefined,
    timeoutMs: record.timeoutMs as number | undefined,
    verbosity: record.verbosity as "compact" | "normal" | undefined,
  };
}

function getSuiteCatalog() {
  return [
    {
      suite: "unit",
      script: "bun run test:unit",
      purpose: "Fast isolated coverage for LeaderTracker and schema validation.",
    },
    {
      suite: "integration",
      script: "bun run test:integration",
      purpose: "Gateway HTTP and websocket behavior with mocked leader endpoints.",
    },
    {
      suite: "smoke",
      script: "bun run test:smoke",
      purpose: "Live Bun server sanity checks for the gateway surface.",
    },
  ];
}

function renderSummary(result: Awaited<ReturnType<typeof runSuite>>, verbosity: ToolCallArgs["verbosity"]) {
  const lines = [
    `${result.suite} suite ${result.status}`,
    `tests: ${result.passed}/${result.total} passed, ${result.failed} failed, ${result.skipped} skipped`,
    `durationMs: ${result.durationMs}`,
  ];

  if (result.failures.length > 0) {
    lines.push("failures:");
    for (const failure of result.failures) {
      const location = failure.file ? `${basename(failure.file)}${failure.line ? `:${failure.line}` : ""}` : "unknown";
      lines.push(`- ${failure.name} (${location}${failure.type ? `, ${failure.type}` : ""})`);
    }
  }

  const previewLimit = verbosity === "compact" ? 6 : 12;

  if (result.outputPreview.length > 0) {
    lines.push("output:");
    for (const line of result.outputPreview.slice(-previewLimit)) {
      lines.push(line);
    }
  }

  return lines.join("\n");
}

async function executeSuite(suite: SuiteName, rawArgs: unknown) {
  const args = parseToolArgs(rawArgs);
  const outputRoot = join("/tmp", "miniraft-mcp-results");
  const id = crypto.randomUUID();
  const jsonOutput = resolve(outputRoot, `${suite}-${id}.json`);
  const junitOutput = resolve(outputRoot, `${suite}-${id}.xml`);

  const result = await runSuite({
    suite,
    filter: args.filter,
    timeoutMs: args.timeoutMs,
    jsonOutput,
    junitOutput,
    quiet: true,
  });

  return {
    content: [
      {
        type: "text",
        text: renderSummary(result, args.verbosity ?? "normal"),
      },
    ],
    structuredContent: result,
    isError: result.status === "failed",
  };
}

function sendMessage(message: Record<string, unknown>) {
  const payload = JSON.stringify(message);
  const headers = `Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n`;
  process.stdout.write(headers + payload);
}

function sendResult(id: JsonRpcId, result: Record<string, unknown>) {
  sendMessage({
    jsonrpc: "2.0",
    id,
    result,
  });
}

function sendError(id: JsonRpcId, code: number, message: string) {
  sendMessage({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  });
}

async function handleRequest(request: JsonRpcRequest) {
  if (request.method === "notifications/initialized") {
    return;
  }

  if (request.id === undefined) {
    return;
  }

  try {
    switch (request.method) {
      case "initialize":
        sendResult(request.id, {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
          },
          serverInfo: SERVER_INFO,
        });
        return;
      case "ping":
        sendResult(request.id, {});
        return;
      case "tools/list":
        sendResult(request.id, { tools: TOOLS });
        return;
      case "tools/call": {
        const name = request.params?.name;
        const argumentsInput = request.params?.arguments;

        if (typeof name !== "string") {
          throw new Error("Tool name is required.");
        }

        if (name === "list_test_suites") {
          sendResult(request.id, {
            content: [
              {
                type: "text",
                text: JSON.stringify(getSuiteCatalog(), null, 2),
              },
            ],
            structuredContent: { suites: getSuiteCatalog() },
            isError: false,
          });
          return;
        }

        if (name === "run_unit_tests") {
          sendResult(request.id, await executeSuite("unit", argumentsInput));
          return;
        }

        if (name === "run_integration_tests") {
          sendResult(request.id, await executeSuite("integration", argumentsInput));
          return;
        }

        if (name === "run_smoke_tests") {
          sendResult(request.id, await executeSuite("smoke", argumentsInput));
          return;
        }

        sendError(request.id, -32601, `Unknown tool "${name}".`);
        return;
      }
      case "shutdown":
        sendResult(request.id, {});
        process.exit(0);
      default:
        sendError(request.id, -32601, `Method not found: ${request.method}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error";
    sendError(request.id, -32000, message);
  }
}

let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, Buffer.from(chunk)]);

  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");

    if (headerEnd === -1) {
      return;
    }

    const headers = buffer.subarray(0, headerEnd).toString("utf8");
    const lengthMatch = headers.match(/Content-Length:\s*(\d+)/i);

    if (!lengthMatch) {
      buffer = Buffer.alloc(0);
      return;
    }

    const contentLength = Number(lengthMatch[1]);
    const messageStart = headerEnd + 4;
    const messageEnd = messageStart + contentLength;

    if (buffer.length < messageEnd) {
      return;
    }

    const payload = buffer.subarray(messageStart, messageEnd).toString("utf8");
    buffer = buffer.subarray(messageEnd);

    const parsed = JSON.parse(payload) as JsonRpcRequest;
    void handleRequest(parsed);
  }
});

process.stdin.resume();
