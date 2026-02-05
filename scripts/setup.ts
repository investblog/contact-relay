import prompts from "prompts";
import { execFileSync, execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WRANGLER_TOML_PATH = join(__dirname, "..", "wrangler.toml");

interface SetupConfig {
  botToken: string;
  chatId: string;
  allowedOrigins: string;
  routingJson: string;
  enableTurnstile: boolean;
  turnstileSecret: string;
  adminKey: string;
}

function run(cmd: string, args: string[], input?: string): string {
  try {
    const opts: { encoding: BufferEncoding; input?: string; cwd: string } = {
      encoding: "utf-8",
      cwd: join(__dirname, ".."),
    };
    if (input !== undefined) opts.input = input;
    return execFileSync(cmd, args, opts).trim();
  } catch (e: any) {
    const msg = e.stderr?.toString().trim() || e.message;
    throw new Error(msg);
  }
}

function runShell(cmd: string): string {
  return execSync(cmd, {
    encoding: "utf-8",
    cwd: join(__dirname, ".."),
  }).trim();
}

function wranglerBin(): string {
  const local = join(__dirname, "..", "node_modules", ".bin", "wrangler");
  try {
    execFileSync(local, ["--version"], { encoding: "utf-8" });
    return local;
  } catch {
    // fall back to global
  }
  try {
    execFileSync("wrangler", ["--version"], { encoding: "utf-8" });
    return "wrangler";
  } catch {
    // not found
  }
  console.error("wrangler CLI not found. Run: npm install");
  process.exit(1);
}

async function main() {
  console.log("\nContact-Relay Setup\n");

  const wrangler = wranglerBin();

  // Check if logged in
  try {
    const who = run(wrangler, ["whoami"]);
    console.log(`  Logged in: ${who.split("\n").pop()}\n`);
  } catch {
    console.log("  You need to login to Cloudflare first...\n");
    execSync(`"${wrangler}" login`, { stdio: "inherit" });
    // Verify login succeeded
    try {
      run(wrangler, ["whoami"]);
    } catch {
      console.error("  Login failed. Run: wrangler login");
      process.exit(1);
    }
  }

  // Collect configuration
  const config = await collectConfig();
  if (!config) {
    console.log("\n  Setup cancelled.");
    process.exit(0);
  }

  // Create or find KV namespaces
  console.log("\n  Creating KV namespaces...");
  const kvIds = await ensureKvNamespaces(wrangler, [
    "RATE_LIMIT",
    "IDEMPOTENCY",
    "CONFIG",
  ]);

  if (!kvIds) {
    console.error("  Failed to create KV namespaces");
    process.exit(1);
  }

  // Update wrangler.toml
  console.log("\n  Updating wrangler.toml...");
  updateWranglerToml(kvIds);

  // Set secrets
  console.log("\n  Setting secrets...");
  setSecret(wrangler, "BOT_TOKEN", config.botToken);
  setSecret(wrangler, "TG_DEFAULT_CHAT_ID", config.chatId);
  setSecret(wrangler, "ALLOWED_ORIGINS", config.allowedOrigins);

  if (config.routingJson) {
    setSecret(wrangler, "ROUTING_JSON", config.routingJson);
  }

  if (config.enableTurnstile && config.turnstileSecret) {
    setSecret(wrangler, "TURNSTILE_SECRET", config.turnstileSecret);
    updateWranglerVar("ENABLE_TURNSTILE", "true");
  }

  if (config.adminKey) {
    setSecret(wrangler, "ADMIN_KEY", config.adminKey);
  }

  console.log("\n  Setup complete!\n");
  console.log("  Next steps:");
  console.log("    npm run dev     # Local development");
  console.log("    npm run deploy  # Deploy to Cloudflare\n");
}

async function collectConfig(): Promise<SetupConfig | null> {
  const response = await prompts(
    [
      {
        type: "password",
        name: "botToken",
        message: "Telegram Bot Token (from @BotFather):",
        validate: (v) => (v.includes(":") ? true : "Invalid token format"),
      },
      {
        type: "text",
        name: "chatId",
        message: "Default Telegram Chat ID:",
        validate: (v) => (v.match(/^-?\d+$/) ? true : "Must be a number"),
      },
      {
        type: "text",
        name: "allowedOrigins",
        message:
          "Allowed Origins (comma-separated, e.g. *.example.com, site.org):",
        initial: "*",
      },
      {
        type: "confirm",
        name: "hasRouting",
        message: "Configure multi-tenant routing?",
        initial: false,
      },
      {
        type: (prev) => (prev ? "text" : null),
        name: "routingJson",
        message:
          'Routing JSON (e.g. {"example.com": {"chat_id": "123", "bot_token": "..."}}):',
        validate: (v) => {
          try {
            JSON.parse(v);
            return true;
          } catch {
            return "Invalid JSON";
          }
        },
      },
      {
        type: "confirm",
        name: "enableTurnstile",
        message: "Enable Cloudflare Turnstile captcha?",
        initial: false,
      },
      {
        type: (prev) => (prev ? "password" : null),
        name: "turnstileSecret",
        message: "Turnstile Secret Key:",
      },
      {
        type: "password",
        name: "adminKey",
        message: "Admin API Key (for /admin/* endpoints):",
        validate: (v) =>
          v.length >= 16 ? true : "Min 16 characters for security",
      },
    ],
    {
      onCancel: () => {
        return false;
      },
    }
  );

  if (!response.botToken || !response.chatId || !response.adminKey) {
    return null;
  }

  return {
    botToken: response.botToken,
    chatId: response.chatId,
    allowedOrigins: response.allowedOrigins || "*",
    routingJson: response.routingJson || "",
    enableTurnstile: response.enableTurnstile || false,
    turnstileSecret: response.turnstileSecret || "",
    adminKey: response.adminKey,
  };
}

interface KvNamespace {
  id: string;
  title: string;
}

function listKvNamespaces(wrangler: string): KvNamespace[] {
  try {
    const out = run(wrangler, ["kv", "namespace", "list"]);
    const parsed = JSON.parse(out);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // ignore parse errors
  }
  return [];
}

async function ensureKvNamespaces(
  wrangler: string,
  bindings: string[]
): Promise<Record<string, string> | null> {
  // Load existing namespaces first
  let existing = listKvNamespaces(wrangler);
  const result: Record<string, string> = {};

  for (const binding of bindings) {
    const title = `contact-relay-${binding}`;

    // Check if already exists
    const found = existing.find((ns) => ns.title === title);
    if (found) {
      console.log(`    ${binding} already exists (${found.id})`);
      result[binding] = found.id;
      continue;
    }

    // Create new namespace
    try {
      const out = run(wrangler, ["kv", "namespace", "create", binding]);
      // Try to extract ID from output — format varies across wrangler versions:
      //   id = "abc123..."   (older)
      //   id: "abc123..."    (newer)
      //   { id: "abc123..." }
      const match = out.match(/id\s*[:=]\s*"?([a-f0-9]{32})"?/);
      if (match) {
        console.log(`    ${binding} created (${match[1]})`);
        result[binding] = match[1];
        continue;
      }

      // Regex didn't match — re-list to find it
      existing = listKvNamespaces(wrangler);
      const retry = existing.find((ns) => ns.title === title);
      if (retry) {
        console.log(`    ${binding} created (${retry.id})`);
        result[binding] = retry.id;
        continue;
      }

      console.error(`    Failed to find ID for ${binding} after creation`);
      return null;
    } catch (e: any) {
      // If "already exists", re-list
      if (e.message?.includes("already exists")) {
        existing = listKvNamespaces(wrangler);
        const retry = existing.find((ns) => ns.title === title);
        if (retry) {
          console.log(`    ${binding} already exists (${retry.id})`);
          result[binding] = retry.id;
          continue;
        }
      }
      console.error(`    Failed to create ${binding}: ${e.message}`);
      return null;
    }
  }

  return result;
}

function updateWranglerToml(kvIds: Record<string, string>) {
  let content = readFileSync(WRANGLER_TOML_PATH, "utf-8");

  // Remove any existing KV namespace blocks (commented or not)
  // Remove lines: # [[kv_namespaces]], # binding = "...", # id = "..."
  // and uncommented [[kv_namespaces]] blocks
  const lines = content.split("\n");
  const cleaned: string[] = [];
  let inKvBlock = false;

  for (const line of lines) {
    const trimmed = line.replace(/^#\s?/, "").trim();

    if (trimmed === "[[kv_namespaces]]") {
      inKvBlock = true;
      continue;
    }

    if (inKvBlock) {
      // KV block lines: binding = "..." and id = "..."
      if (
        trimmed.startsWith("binding") ||
        trimmed.startsWith("id") ||
        trimmed === ""
      ) {
        continue;
      }
      inKvBlock = false;
    }

    cleaned.push(line);
  }

  // Remove the comment line about KV setup if present
  const filtered = cleaned.filter(
    (l) => !l.includes("KV Namespaces") || !l.startsWith("#")
  );

  // Build KV config
  const kvLines: string[] = [""];
  for (const [binding, id] of Object.entries(kvIds)) {
    kvLines.push("[[kv_namespaces]]");
    kvLines.push(`binding = "${binding}"`);
    kvLines.push(`id = "${id}"`);
    kvLines.push("");
  }

  const final = filtered.join("\n").trimEnd() + "\n" + kvLines.join("\n");
  writeFileSync(WRANGLER_TOML_PATH, final);
  console.log("    wrangler.toml updated");
}

function setSecret(wrangler: string, name: string, value: string) {
  try {
    // Use execFileSync with input option — more reliable than execa stdin piping
    execFileSync(wrangler, ["secret", "put", name], {
      input: value,
      encoding: "utf-8",
      cwd: join(__dirname, ".."),
      stdio: ["pipe", "pipe", "pipe"],
    });
    console.log(`    ${name} saved`);
  } catch (e: any) {
    const stderr = e.stderr?.toString().trim() || "";
    // wrangler secret put exits non-zero but still saves the secret sometimes
    if (stderr.includes("Success")) {
      console.log(`    ${name} saved`);
      return;
    }
    console.error(`    Failed to set ${name}: ${stderr || e.message}`);
  }
}

function updateWranglerVar(name: string, value: string) {
  let content = readFileSync(WRANGLER_TOML_PATH, "utf-8");
  const regex = new RegExp(`${name}\\s*=\\s*"[^"]*"`);
  if (regex.test(content)) {
    content = content.replace(regex, `${name} = "${value}"`);
  } else {
    // Append to [vars] section
    content = content.replace(
      /\[vars\]/,
      `[vars]\n${name} = "${value}"`
    );
  }
  writeFileSync(WRANGLER_TOML_PATH, content);
}

main().catch(console.error);
