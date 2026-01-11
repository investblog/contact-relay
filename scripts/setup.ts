import prompts from "prompts";
import { execa, ExecaError } from "execa";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const WRANGLER_TOML_PATH = join(process.cwd(), "wrangler.toml");

interface SetupConfig {
  botToken: string;
  chatId: string;
  allowedOrigins: string;
  routingJson: string;
  enableTurnstile: boolean;
  turnstileSecret: string;
  adminKey: string;
}

async function main() {
  console.log("\n🚀 Casinobot CF Worker Setup\n");

  // Check wrangler is available
  try {
    await execa("wrangler", ["--version"]);
  } catch {
    console.error("❌ wrangler CLI not found. Install with: npm install -g wrangler");
    process.exit(1);
  }

  // Check if logged in
  try {
    await execa("wrangler", ["whoami"]);
  } catch {
    console.log("📝 You need to login to Cloudflare first...\n");
    await execa("wrangler", ["login"], { stdio: "inherit" });
  }

  // Collect configuration
  const config = await collectConfig();

  if (!config) {
    console.log("\n❌ Setup cancelled.");
    process.exit(0);
  }

  // Create KV namespaces
  console.log("\n📦 Creating KV namespaces...");
  const rateLimitId = await createKvNamespace("RATE_LIMIT");
  const idempotencyId = await createKvNamespace("IDEMPOTENCY");
  const configId = await createKvNamespace("CONFIG");

  if (!rateLimitId || !idempotencyId || !configId) {
    console.error("❌ Failed to create KV namespaces");
    process.exit(1);
  }

  // Update wrangler.toml
  console.log("\n📝 Updating wrangler.toml...");
  updateWranglerToml(rateLimitId, idempotencyId, configId);

  // Set secrets
  console.log("\n🔐 Setting secrets...");
  await setSecret("BOT_TOKEN", config.botToken);
  await setSecret("TG_DEFAULT_CHAT_ID", config.chatId);
  await setSecret("ALLOWED_ORIGINS", config.allowedOrigins);

  if (config.routingJson) {
    await setSecret("ROUTING_JSON", config.routingJson);
  }

  if (config.enableTurnstile && config.turnstileSecret) {
    await setSecret("TURNSTILE_SECRET", config.turnstileSecret);
    await updateWranglerVar("ENABLE_TURNSTILE", "true");
  }

  if (config.adminKey) {
    await setSecret("ADMIN_KEY", config.adminKey);
  }

  console.log("\n✅ Setup complete!");
  console.log("\nNext steps:");
  console.log("  1. npm install");
  console.log("  2. npm run dev     # Local development");
  console.log("  3. npm run deploy  # Deploy to Cloudflare\n");
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
        message: "Allowed Origins (comma-separated, e.g. *.example.com, site.org):",
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
        message: 'Routing JSON (e.g. {"example.com": {"chat_id": "123", "bot_token": "..."}}):',
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
        validate: (v) => (v.length >= 16 ? true : "Min 16 characters for security"),
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

async function createKvNamespace(name: string): Promise<string | null> {
  try {
    const result = await execa("wrangler", ["kv:namespace", "create", name]);
    const match = result.stdout.match(/id\s*=\s*"([^"]+)"/);
    if (match) {
      console.log(`  ✓ ${name} created (id: ${match[1]})`);
      return match[1];
    }
  } catch (e) {
    const error = e as ExecaError;
    // Namespace might already exist
    if (error.stderr?.includes("already exists")) {
      // Try to get existing namespace ID
      const listResult = await execa("wrangler", ["kv:namespace", "list"]);
      const namespaces = JSON.parse(listResult.stdout);
      const existing = namespaces.find((ns: { title: string }) =>
        ns.title.includes(name)
      );
      if (existing) {
        console.log(`  ✓ ${name} already exists (id: ${existing.id})`);
        return existing.id;
      }
    }
    console.error(`  ❌ Failed to create ${name}:`, error.stderr || error.message);
  }
  return null;
}

function updateWranglerToml(rateLimitId: string, idempotencyId: string, configId: string) {
  let content = readFileSync(WRANGLER_TOML_PATH, "utf-8");

  // Remove commented KV sections and add real ones
  content = content.replace(/# \[\[kv_namespaces\]\][\s\S]*?# id = ""/g, "");

  // Add KV namespaces at the end
  const kvConfig = `
[[kv_namespaces]]
binding = "RATE_LIMIT"
id = "${rateLimitId}"

[[kv_namespaces]]
binding = "IDEMPOTENCY"
id = "${idempotencyId}"

[[kv_namespaces]]
binding = "CONFIG"
id = "${configId}"
`;

  content = content.trimEnd() + "\n" + kvConfig;
  writeFileSync(WRANGLER_TOML_PATH, content);
  console.log("  ✓ wrangler.toml updated");
}

async function setSecret(name: string, value: string) {
  try {
    await execa("wrangler", ["secret", "put", name], {
      input: value,
    });
    console.log(`  ✓ ${name} saved`);
  } catch (e) {
    const error = e as ExecaError;
    console.error(`  ❌ Failed to set ${name}:`, error.stderr || error.message);
  }
}

async function updateWranglerVar(name: string, value: string) {
  let content = readFileSync(WRANGLER_TOML_PATH, "utf-8");
  const regex = new RegExp(`${name}\\s*=\\s*"[^"]*"`);
  content = content.replace(regex, `${name} = "${value}"`);
  writeFileSync(WRANGLER_TOML_PATH, content);
}

main().catch(console.error);
