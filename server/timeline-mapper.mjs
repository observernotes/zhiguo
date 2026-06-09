"use strict";

import crypto from "node:crypto";

function makeId() {
  return crypto.randomUUID();
}

function mapToolStatus(status) {
  if (status === "completed") return "done";
  if (status === "failed") return "error";
  if (status === "canceled") return "canceled";
  return "running";
}

function toolSummary(detail = {}) {
  if (detail.type === "shell") return detail.command || "运行本机命令";
  if (detail.type === "read") return detail.filePath || "读取文件";
  if (detail.type === "write") return detail.filePath || "写入文件";
  if (detail.type === "edit") return detail.filePath || "修改文件";
  if (detail.type === "search") return detail.query || "搜索内容";
  if (detail.type === "fetch") return detail.url || "获取网页";
  if (detail.type === "plan") return "准备计划";
  if (detail.type === "plain_text") return detail.label || detail.text || "工具输出";
  return detail.label || detail.text || "完成了一项操作";
}

function toolDisplayName(name = "tool", detail = {}, status = "running") {
  const lower = String(name).toLowerCase();
  const done = status === "done" || status === "completed";
  if (detail.type === "shell") return done ? "已运行本机命令" : "正在运行本机命令";
  if (detail.type === "read") return done ? "已读取文件" : "正在读取文件";
  if (detail.type === "write") return done ? "已写入文件" : "正在写入文件";
  if (detail.type === "edit") return done ? "已修改文件" : "正在修改文件";
  if (detail.type === "search") return done ? "已搜索内容" : "正在搜索内容";
  if (detail.type === "fetch") return done ? "已获取网页" : "正在获取网页";
  if (lower.includes("todo")) return "任务清单";
  return name || "Tool";
}

export function mapTimelineItemToZhiguo(item, existingMessages = [], assistantId = null) {
  if (!item || typeof item !== "object") return null;

  if (item.type === "user_message") {
    const latestUser = [...existingMessages].reverse().find((entry) => entry.type === "user");
    if (latestUser && latestUser.text === item.text) return null;
    return {
      id: makeId(),
      type: "user",
      text: item.text || "",
      createdAt: new Date().toISOString(),
    };
  }

  if (item.type === "assistant_message") {
    const assistant = assistantId
      ? existingMessages.find((entry) => entry.id === assistantId)
      : [...existingMessages].reverse().find((entry) => entry.type === "assistant");
    if (assistant) {
      assistant.text = item.text || assistant.text || "";
      assistant.status = assistant.status === "done" ? "done" : "streaming";
      return null;
    }
    return {
      id: assistantId || makeId(),
      type: "assistant",
      text: item.text || "",
      status: "streaming",
      createdAt: new Date().toISOString(),
    };
  }

  if (item.type === "reasoning") {
    const parentId = assistantId || "assistant";
    const id = `thinking-${parentId}`;
    let thinking = existingMessages.find((entry) => entry.id === id);
    if (!thinking) {
      thinking = {
        id,
        type: "thinking",
        text: "",
        status: "streaming",
        createdAt: new Date().toISOString(),
      };
      existingMessages.push(thinking);
    }
    thinking.text = `${thinking.text || ""}${item.text || ""}`;
    return null;
  }

  if (item.type === "tool_call") {
    const status = mapToolStatus(item.status);
    const detail = item.detail || { type: "unknown", input: null, output: null };
    const summary = toolSummary(detail);
    const displayName = toolDisplayName(item.name, detail, status);
    let tool = existingMessages.find(
      (entry) => entry.type === "tool" && (entry.toolUseId === item.callId || entry.id === item.callId),
    );
    if (!tool) {
      tool = {
        id: makeId(),
        type: "tool",
        toolUseId: item.callId,
        name: item.name || "tool",
        displayName,
        summary,
        input: detail.input ?? null,
        output: detail.output ?? null,
        detail,
        status,
        createdAt: new Date().toISOString(),
      };
      return tool;
    }
    tool.name = item.name || tool.name;
    tool.detail = detail;
    tool.input = detail.input ?? tool.input;
    tool.output = detail.output ?? tool.output;
    tool.status = status;
    tool.displayName = displayName;
    tool.summary = summary;
    if (status === "done" || status === "error" || status === "canceled") {
      tool.completedAt = new Date().toISOString();
    }
    return null;
  }

  if (item.type === "todo") {
    const last = [...existingMessages].reverse().find((entry) => entry.type === "todo");
    if (last) {
      last.items = item.items || [];
      last.updatedAt = new Date().toISOString();
      return null;
    }
    return {
      id: makeId(),
      type: "todo",
      items: item.items || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  if (item.type === "error") {
    return {
      id: makeId(),
      type: "error",
      message: item.message || "这次回复没有完成。",
      createdAt: new Date().toISOString(),
    };
  }

  if (item.type === "compaction") {
    return {
      id: makeId(),
      type: "meta",
      label: "上下文整理",
      detail: item.status === "loading" ? "正在压缩历史上下文" : "历史上下文已整理",
      createdAt: new Date().toISOString(),
    };
  }

  return null;
}
