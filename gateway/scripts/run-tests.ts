import { mkdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

type SuiteName = "unit" | "integration" | "smoke" | "all";
type RunOptions = {
  suite: SuiteName;
  filter?: string;
  timeoutMs?: number;
  junitOutput?: string;
  jsonOutput?: string;
  quiet?: boolean;
};

type FailureSummary = {
  name: string;
  file?: string;
  line?: number;
  type?: string;
};

type TestRunSummary = {
  suite: SuiteName;
  suitePaths: string[];
  status: "passed" | "failed";
  exitCode: number;
  durationMs: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  failures: FailureSummary[];
  outputPreview: string[];
  artifacts: {
    junit?: string;
    json?: string;
  };
};

const SUITE_PATHS: Record<SuiteName, string[]> = {
  unit: ["tests/unit"],
  integration: ["tests/integration"],
  smoke: ["tests/smoke"],
  all: ["tests"],
};

function parseArgs(argv: string[]): RunOptions {
  const suite = (argv[2] ?? "all") as SuiteName;

  if (!(suite in SUITE_PATHS)) {
    throw new Error(`Unknown suite "${suite}"`);
  }

  const options: RunOptions = { suite };

  for (let index = 3; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) {
      continue;
    }

    if (arg === "--quiet") {
      options.quiet = true;
      continue;
    }

    const value = argv[index + 1];

    if ((arg === "--filter" || arg === "--timeout" || arg === "--junit-output" || arg === "--json-output") && !value) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--filter" && value) {
      options.filter = value;
      index += 1;
      continue;
    }

    if (arg === "--timeout" && value) {
      options.timeoutMs = Number(value);
      index += 1;
      continue;
    }

    if (arg === "--junit-output" && value) {
      options.junitOutput = value;
      index += 1;
      continue;
    }

    if (arg === "--json-output" && value) {
      options.jsonOutput = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument "${arg}"`);
  }

  return options;
}

function parseXmlAttributes(input: string) {
  const attributes: Record<string, string> = {};

  for (const match of input.matchAll(/([a-zA-Z0-9:_-]+)="([^"]*)"/g)) {
    const [, key, value] = match;

    if (key && value !== undefined) {
      attributes[key] = value;
    }
  }

  return attributes;
}

function collectOutputPreview(stdout: string, stderr: string) {
  return [...stdout.split("\n"), ...stderr.split("\n")]
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-20);
}

function parseJUnitReport(xml: string) {
  const testsuitesMatch = xml.match(/<testsuites\b([^>]*)>/);
  const rootAttributes = parseXmlAttributes(testsuitesMatch?.[1] ?? "");
  const failures: FailureSummary[] = [];

  for (const match of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attributes = parseXmlAttributes(match[1] ?? "");
    const body = match[2] ?? "";
    const failureMatch = body.match(/<failure\b([^>]*)\/?>/);

    if (!failureMatch) {
      continue;
    }

    const failureAttributes = parseXmlAttributes(failureMatch[1] ?? "");

    failures.push({
      name: attributes.name ?? "unknown test",
      file: attributes.file,
      line: attributes.line ? Number(attributes.line) : undefined,
      type: failureAttributes.type,
    });
  }

  const total = Number(rootAttributes.tests ?? 0);
  const failed = Number(rootAttributes.failures ?? failures.length);
  const skipped = Number(rootAttributes.skipped ?? 0);

  return {
    total,
    failed,
    skipped,
    passed: Math.max(total - failed - skipped, 0),
    failures,
  };
}

function createTempArtifactPath(suite: SuiteName, extension: string) {
  const id = crypto.randomUUID();
  return join("/tmp", `miniraft-${suite}-${id}.${extension}`);
}

export async function runSuite(options: RunOptions): Promise<TestRunSummary> {
  const gatewayDir = resolve(import.meta.dir, "..");
  const suitePaths = SUITE_PATHS[options.suite];
  const junitOutput = options.junitOutput ?? createTempArtifactPath(options.suite, "xml");
  const jsonOutput = options.jsonOutput;

  await mkdir(resolve(junitOutput, ".."), { recursive: true });

  const command = [
    "bun",
    "test",
    ...suitePaths,
    "--reporter=junit",
    "--reporter-outfile",
    junitOutput,
  ];

  if (options.filter) {
    command.push("--test-name-pattern", options.filter);
  }

  if (options.timeoutMs !== undefined) {
    command.push("--timeout", String(options.timeoutMs));
  }

  const startedAt = Date.now();
  const subprocess = Bun.spawn(command, {
    cwd: gatewayDir,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);

  const durationMs = Date.now() - startedAt;
  const junit = await Bun.file(junitOutput).text().catch(() => "");
  const parsed = parseJUnitReport(junit);

  const summary: TestRunSummary = {
    suite: options.suite,
    suitePaths,
    status: exitCode === 0 ? "passed" : "failed",
    exitCode,
    durationMs,
    total: parsed.total,
    passed: parsed.passed,
    failed: parsed.failed,
    skipped: parsed.skipped,
    failures: parsed.failures,
    outputPreview: collectOutputPreview(stdout, stderr),
    artifacts: {
      junit: junitOutput,
      json: jsonOutput,
    },
  };

  if (jsonOutput) {
    await mkdir(resolve(jsonOutput, ".."), { recursive: true });
    await Bun.write(jsonOutput, JSON.stringify(summary, null, 2));
  }

  if (!options.quiet) {
    if (stdout) {
      process.stdout.write(stdout);
    }

    if (stderr) {
      process.stderr.write(stderr);
    }
  }

  return summary;
}

if (import.meta.main) {
  try {
    const summary = await runSuite(parseArgs(Bun.argv));

    process.exit(summary.exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown runner error";
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
