"use strict";

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPaseoDaemon, createRootLogger, loadConfig } from "@getpaseo/server";

const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_TEMPLATE = path.join(ROOT_DIR, "config", "paseo.config.json");

function buildDaemonWebSocketUrl(listenTarget) {
  if (!listenTarget || listenTarget.type !== "tcp") {
    throw new Error("Paseo daemon must listen on TCP for Zhiguo integration.");
  }
  return `ws://127.0.0.1:${listenTarget.port}/ws`;
}

async function writePaseoConfig(target, value) {
  const next = { ...value };
  delete next.$schema;
  await fsp.writeFile(target, `${JSON.stringify(next, null, 2)}\n`);
}

async function ensurePaseoConfig(paseoHome) {
  await fsp.mkdir(paseoHome, { recursive: true });
  const target = path.join(paseoHome, "config.json");
  const template = JSON.parse(await fsp.readFile(DEFAULT_TEMPLATE, "utf8"));
  delete template.$schema;
  if (!fs.existsSync(target)) {
    await writePaseoConfig(target, template);
    return;
  }
  const current = JSON.parse(await fsp.readFile(target, "utf8"));
  delete current.$schema;
  const merged = {
    ...template,
    ...current,
    daemon: { ...template.daemon, ...(current.daemon || {}) },
    agents: {
      ...(template.agents || {}),
      ...(current.agents || {}),
      providers: {
        ...(template.agents?.providers || {}),
        ...(current.agents?.providers || {}),
      },
    },
    features: { ...(template.features || {}), ...(current.features || {}) },
  };
  await writePaseoConfig(target, merged);
}

export async function startPaseoRuntime(options = {}) {
  const paseoHome = options.paseoHome;
  const listen = options.listen || process.env.PASEO_LISTEN || "127.0.0.1:6767";
  if (!paseoHome) {
    throw new Error("startPaseoRuntime requires paseoHome");
  }

  await ensurePaseoConfig(paseoHome);

  const env = {
    ...process.env,
    PASEO_HOME: paseoHome,
    PASEO_LISTEN: listen,
    PASEO_RELAY_ENABLED: "0",
  };

  const logger = createRootLogger(undefined, { paseoHome, file: false });
  const config = loadConfig(paseoHome, {
    env,
    cli: {
      relayEnabled: false,
      mcpEnabled: false,
      mcpInjectIntoAgents: false,
    },
  });

  config.staticDir = path.join(ROOT_DIR, "public");
  config.relayEnabled = false;

  const daemon = await createPaseoDaemon(config, logger);
  await daemon.start();
  const listenTarget = daemon.getListenTarget();
  const url = buildDaemonWebSocketUrl(listenTarget);

  return {
    daemon,
    paseoHome,
    url,
    listen: listenTarget,
    password: config.auth?.password ? options.password || null : null,
  };
}

export async function stopPaseoRuntime(runtime) {
  if (!runtime?.daemon) return;
  await runtime.daemon.stop();
}
