"use strict";

import crypto from "node:crypto";
import { DaemonClient } from "@getpaseo/client";
import { mapTimelineItemToZhiguo } from "./timeline-mapper.mjs";

function makeId() {
  return crypto.randomUUID();
}

function buildProvider(model = "") {
  const trimmed = String(model || "").trim();
  return trimmed ? `claude/${trimmed}` : "claude";
}

function buildAgentEnv(settings = {}) {
  const env = {};
  const claudePath = String(settings.claudePath || "").trim();
  if (claudePath.includes("/") || claudePath.includes("\\")) {
    env.CLAUDE_CODE_EXECUTABLE = claudePath;
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

function userFacingRuntimeMessage(value) {
  const message = String(value || "").trim();
  if (!message) return "这次回复没有完成，请稍后再试。";
  if (/Stopped by user|turn_canceled|SIGTERM|SIGKILL/i.test(message)) return "已取消本次请求";
  if (/API Error:\s*402|Insufficient Balance/i.test(message)) {
    return "本机助手额度不足，请检查 Claude 账号额度后重试。";
  }
  if (/executable was not found|ENOENT|provider.*not available/i.test(message)) {
    return "没有找到本机助手，请在设置里检查连接。";
  }
  return message.length > 220 ? `${message.slice(0, 220)}...` : message;
}

export function createPaseoBridge(runtime, hooks = {}) {
  const client = new DaemonClient({
    url: runtime.url,
    clientId: `zhiguo-${crypto.randomUUID()}`,
    clientType: "browser",
    password: runtime.password || undefined,
    reconnect: { enabled: true, baseDelayMs: 500, maxDelayMs: 5000 },
  });

  const jobs = new Map();

  async function connect() {
    await client.connect();
  }

  async function close() {
    for (const job of jobs.values()) {
      cleanupJob(job);
    }
    jobs.clear();
    await client.close();
  }

  function cleanupJob(job) {
    if (job.turnTimer) clearTimeout(job.turnTimer);
    if (job.unsubscribers) {
      for (const unsubscribe of job.unsubscribers) {
        unsubscribe();
      }
    }
  }

  async function detectClaude(settings = {}) {
    try {
      await client.ensureConnected();
      const diagnostic = await client.getProviderDiagnostic("claude", {
        env: buildAgentEnv(settings),
      });
      const available = Boolean(diagnostic?.available ?? diagnostic?.status === "available");
      return {
        available,
        command: settings.claudePath || "claude",
        resolvedPath: diagnostic?.command || settings.claudePath || "claude",
        version: diagnostic?.version || null,
      };
    } catch {
      return {
        available: false,
        command: settings.claudePath || "claude",
        resolvedPath: null,
        version: null,
      };
    }
  }

  async function ensureAgent(session, { mode, model, settings }) {
    if (session.paseoAgentId) {
      try {
        const existing = await client.fetchAgent(session.paseoAgentId);
        if (existing?.agent?.id) {
          await client.setAgentMode(session.paseoAgentId, mode);
          if (model) await client.setAgentModel(session.paseoAgentId, model);
          return session.paseoAgentId;
        }
      } catch {
        session.paseoAgentId = null;
      }
    }

    const snapshot = await client.createAgent({
      provider: buildProvider(model),
      cwd: session.cwd,
      config: { modeId: mode },
      env: buildAgentEnv(settings),
      labels: {
        zhiguoSessionId: session.id,
      },
    });
    session.paseoAgentId = snapshot.id;
    return snapshot.id;
  }

  function attachJobHandlers(job) {
    const streamHandler = (event) => {
      if (event.type !== "agent_stream" || event.agentId !== job.agentId) return;
      void handleStreamEvent(job, event.event);
    };
    const updateHandler = (event) => {
      if (event.type !== "agent_update" || event.agentId !== job.agentId) return;
      const status = event.payload?.status;
      if (status === "error" && job.session.status === "running") {
        void finishJob(job, {
          ok: false,
          message: userFacingRuntimeMessage(event.payload?.error || "本机引擎运行异常"),
        });
      }
    };

    job.unsubscribers = [
      client.on("agent_stream", streamHandler),
      client.on("agent_update", updateHandler),
    ];
  }

  async function handleStreamEvent(job, streamEvent) {
    if (!streamEvent || typeof streamEvent !== "object") return;
    const session = job.session;

    if (streamEvent.type === "timeline") {
      const mapped = mapTimelineItemToZhiguo(streamEvent.item, session.messages, job.assistantId);
      if (mapped) session.messages.push(mapped);
      await job.persist(session);
      return;
    }

    if (streamEvent.type === "usage_updated" && streamEvent.usage) {
      session.usage = { ...(session.usage || {}), ...streamEvent.usage };
      await job.persist(session);
      return;
    }

    if (streamEvent.type === "turn_completed") {
      await finishJob(job, { ok: true, message: "" });
      return;
    }

    if (streamEvent.type === "turn_failed") {
      await finishJob(job, {
        ok: false,
        message: userFacingRuntimeMessage(streamEvent.error || "这次回复没有完成。"),
      });
      return;
    }

    if (streamEvent.type === "turn_canceled") {
      await finishJob(job, {
        ok: false,
        stoppedByUser: true,
        message: "已取消本次请求",
      });
    }
  }

  async function finishJob(job, result) {
    if (job.finished) return;
    job.finished = true;
    cleanupJob(job);
    jobs.delete(job.key);

    const session = job.session;
    const assistant = session.messages.find((item) => item.id === job.assistantId);
    const stoppedByUser = Boolean(result.stoppedByUser);
    const completedOk = Boolean(result.ok);

    if (assistant) {
      assistant.status = stoppedByUser ? "canceled" : completedOk ? "done" : "error";
      assistant.completedAt = new Date().toISOString();
      if (!assistant.text && result.message) assistant.text = result.message;
    }

    for (const item of session.messages) {
      if (item.type === "tool" && item.status === "running") {
        item.status = stoppedByUser ? "canceled" : completedOk ? "done" : "error";
      }
      if (item.type === "thinking" && item.status === "streaming") item.status = "done";
    }

    session.status = completedOk || stoppedByUser ? "idle" : "error";
    session.lastError = completedOk || stoppedByUser ? null : result.message;
    if (!completedOk && !stoppedByUser && result.message) {
      session.messages.push({
        id: makeId(),
        type: "error",
        message: result.message,
        createdAt: new Date().toISOString(),
      });
    }

    await job.persist(session);
    hooks.onDone?.(job.username, job.sessionId, {
      ok: completedOk,
      message: result.message || "",
    });
  }

  async function runTurn(input) {
    const {
      username,
      sessionId,
      session,
      assistantId,
      text,
      mode,
      model,
      settings,
      persist,
    } = input;
    const key = `${username}:${sessionId}`;
    if (jobs.has(key)) {
      const error = new Error("This session is already running.");
      error.status = 409;
      throw error;
    }

    await client.ensureConnected();
    const agentId = await ensureAgent(session, { mode, model, settings });
    await persist(session);

    const job = {
      key,
      username,
      sessionId,
      session,
      assistantId,
      agentId,
      finished: false,
      persist,
      turnTimer: setTimeout(() => {
        void finishJob(job, {
          ok: false,
          message: "本机助手长时间没有响应，已自动结束本轮。",
        });
      }, Math.max(15000, Number(process.env.POST_TOOL_IDLE_TIMEOUT_MS || 45000) || 45000)),
    };
    job.turnTimer.unref?.();
    attachJobHandlers(job);
    jobs.set(key, job);

    try {
      await client.sendAgentMessage(agentId, text);
    } catch (error) {
      await finishJob(job, {
        ok: false,
        message: userFacingRuntimeMessage(error.message || String(error)),
      });
      throw error;
    }

    return session;
  }

  async function stopTurn(username, sessionId) {
    const key = `${username}:${sessionId}`;
    const job = jobs.get(key);
    if (!job) return false;
    try {
      await client.cancelAgent(job.agentId);
    } catch {
      // cancel is best-effort
    }
    await finishJob(job, {
      ok: false,
      stoppedByUser: true,
      message: "已取消本次请求",
    });
    return true;
  }

  function hasLiveJob(username, sessionId) {
    return jobs.has(`${username}:${sessionId}`);
  }

  return {
    connect,
    close,
    detectClaude,
    runTurn,
    stopTurn,
    hasLiveJob,
  };
}
