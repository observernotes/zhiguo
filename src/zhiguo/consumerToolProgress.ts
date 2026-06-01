import type { ChatMessage } from '../components/chat/types/types';

export type ConsumerTaskCategory =
  | 'thinking'
  | 'search'
  | 'read'
  | 'write'
  | 'web'
  | 'image'
  | 'skill'
  | 'command'
  | 'task'
  | 'other';

export type ConsumerTaskStatus = 'running' | 'done' | 'error';

export type ConsumerTaskItem = {
  id: string;
  label: string;
  detail?: string;
  category: ConsumerTaskCategory;
  status: ConsumerTaskStatus;
  durationHint?: string;
};

function basename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || filePath;
}

function truncate(text: string, max = 48): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 1)}…`;
}

export function parseToolInputRecord(message: ChatMessage): Record<string, unknown> {
  if (message.toolInput && typeof message.toolInput === 'object' && !Array.isArray(message.toolInput)) {
    return message.toolInput as Record<string, unknown>;
  }
  if (typeof message.toolInput === 'string') {
    const raw = message.toolInput.trim();
    if (!raw) {
      return {};
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { command: raw };
    }
  }
  return {};
}

function readStringField(input: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function getTaskStatus(message: ChatMessage): ConsumerTaskStatus {
  if (!message.toolResult) {
    return 'running';
  }
  if (message.toolResult.isError) {
    return 'error';
  }
  return 'done';
}

function describeBashTask(input: Record<string, unknown>): Omit<ConsumerTaskItem, 'id' | 'status'> {
  const command = readStringField(input, 'command');
  const lower = command.toLowerCase();

  if (lower.includes('codex') && (lower.includes(' image') || lower.includes('imagegen') || lower.includes('codex-image'))) {
    return {
      label: '正在生图',
      detail: '通过 Codex 生成图片',
      category: 'image',
      durationHint: '约 1–3 分钟',
    };
  }
  if (lower.includes('codex') && lower.includes('search')) {
    return {
      label: '联网搜索',
      detail: '通过 Codex 检索资料',
      category: 'web',
      durationHint: '约 30 秒–2 分钟',
    };
  }
  if (lower.includes('codex-bridge')) {
    return {
      label: '正在处理',
      detail: '调用 Codex 技能',
      category: 'skill',
      durationHint: '约 1–3 分钟',
    };
  }
  if (
    lower.includes('zhiguo-ppt')
    || lower.includes('create-deck.mjs')
    || lower.includes('presentation_manifest')
    || lower.includes('deliverables/ppt')
  ) {
    return {
      label: '正在制作演示文稿',
      detail: '生成 PPT 交付物',
      category: 'skill',
      durationHint: '约 30 秒–2 分钟',
    };
  }
  if (lower.includes('grep') || lower.includes('rg ')) {
    return {
      label: '搜索内容',
      detail: truncate(command),
      category: 'search',
    };
  }
  if (lower.includes('curl') || lower.includes('wget')) {
    return {
      label: '获取网络内容',
      detail: truncate(command),
      category: 'web',
    };
  }

  return {
    label: '执行命令',
    detail: truncate(command) || '运行系统命令',
    category: 'command',
  };
}

function describeSkillTask(input: Record<string, unknown>, inputText: string): Omit<ConsumerTaskItem, 'id' | 'status'> {
  const skillName = readStringField(input, 'skill', 'name', 'skill_name');
  const combined = `${skillName} ${inputText}`.toLowerCase();

  if (combined.includes('codex-image') || combined.includes('image')) {
    return {
      label: '正在生图',
      detail: skillName ? `技能 · ${skillName}` : 'Codex 生图',
      category: 'image',
      durationHint: '约 1–3 分钟',
    };
  }
  if (combined.includes('codex-search') || combined.includes('search')) {
    return {
      label: '联网搜索',
      detail: skillName ? `技能 · ${skillName}` : 'Codex 搜索',
      category: 'web',
      durationHint: '约 30 秒–2 分钟',
    };
  }
  if (combined.includes('zhiguo-ppt') || combined.includes('ppt') || combined.includes('slides') || combined.includes('演示文稿')) {
    return {
      label: '正在制作演示文稿',
      detail: skillName ? `技能 · ${skillName}` : '智果 PPT',
      category: 'skill',
      durationHint: '约 30 秒–2 分钟',
    };
  }

  return {
    label: '执行技能',
    detail: skillName || truncate(inputText) || 'Claude Code 技能',
    category: 'skill',
  };
}

export function describeConsumerTool(message: ChatMessage): ConsumerTaskItem | null {
  const toolName = String(message.toolName || '').trim();
  if (!toolName && !message.isToolUse && message.type !== 'tool') {
    return null;
  }

  const input = parseToolInputRecord(message);
  const inputText = typeof message.toolInput === 'string'
    ? message.toolInput
    : JSON.stringify(input);
  const status = getTaskStatus(message);
  const id = String(message.toolId || `${toolName}-${message.timestamp}`);

  let described: Omit<ConsumerTaskItem, 'id' | 'status'> | null = null;

  switch (toolName) {
    case 'Read':
      described = {
        label: status === 'done' ? '已读取文件' : '正在读取文件',
        detail: basename(readStringField(input, 'file_path', 'path') || '文件'),
        category: 'read',
      };
      break;
    case 'Write':
      described = {
        label: status === 'done' ? '已创建文件' : '正在创建文件',
        detail: basename(readStringField(input, 'file_path', 'path') || '文件'),
        category: 'write',
      };
      break;
    case 'Edit':
    case 'ApplyPatch':
      described = {
        label: status === 'done' ? '已修改文件' : '正在修改文件',
        detail: basename(readStringField(input, 'file_path', 'path') || '文件'),
        category: 'write',
      };
      break;
    case 'Grep':
      described = {
        label: status === 'done' ? '已完成搜索' : '正在搜索内容',
        detail: truncate(readStringField(input, 'pattern', 'query') || '项目文件'),
        category: 'search',
      };
      break;
    case 'Glob':
      described = {
        label: status === 'done' ? '已找到文件' : '正在查找文件',
        detail: truncate(readStringField(input, 'pattern', 'glob_pattern') || '匹配项'),
        category: 'search',
      };
      break;
    case 'WebFetch':
      described = {
        label: status === 'done' ? '已获取网页' : '正在获取网页',
        detail: truncate(readStringField(input, 'url') || '网页内容'),
        category: 'web',
      };
      break;
    case 'WebSearch':
      described = {
        label: status === 'done' ? '已完成搜索' : '正在联网搜索',
        detail: truncate(readStringField(input, 'query', 'search_query') || '相关资料'),
        category: 'web',
      };
      break;
    case 'Task':
      described = {
        label: status === 'done' ? '子任务完成' : '正在处理子任务',
        detail: truncate(readStringField(input, 'description', 'prompt') || '复杂步骤'),
        category: 'task',
        durationHint: '可能需要几分钟',
      };
      break;
    case 'Bash':
      described = describeBashTask(input);
      if (status === 'done' && described.category === 'image') {
        described = { ...described, label: '生图完成' };
      }
      break;
    case 'Skill':
      described = describeSkillTask(input, inputText);
      if (status === 'done' && described.category === 'image') {
        described = { ...described, label: '生图完成' };
      }
      break;
    case 'TodoRead':
    case 'TodoWrite':
      described = {
        label: status === 'done' ? '已更新计划' : '正在整理计划',
        category: 'other',
      };
      break;
    default:
      if (toolName) {
        described = {
          label: status === 'done' ? '步骤完成' : '正在处理',
          detail: toolName,
          category: 'other',
        };
      }
      break;
  }

  if (!described) {
    return null;
  }

  return {
    id,
    status,
    ...described,
  };
}

export function isConsumerProgressTool(message: ChatMessage): boolean {
  return Boolean(message.isToolUse || message.type === 'tool' || message.toolName);
}

export function extractConsumerTasksFromMessages(
  messages: ChatMessage[],
  isLoading: boolean,
): ConsumerTaskItem[] {
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.type === 'user') {
      lastUserIndex = i;
      break;
    }
  }

  const turnMessages = lastUserIndex >= 0 ? messages.slice(lastUserIndex + 1) : messages;
  const tasks: ConsumerTaskItem[] = [];
  const seen = new Set<string>();

  for (const message of turnMessages) {
    if (!isConsumerProgressTool(message)) {
      continue;
    }
    const task = describeConsumerTool(message);
    if (!task || seen.has(task.id)) {
      continue;
    }
    seen.add(task.id);
    tasks.push(task);
  }

  if (isLoading && tasks.length === 0) {
    tasks.push({
      id: 'thinking',
      label: '正在思考',
      detail: '理解你的问题',
      category: 'thinking',
      status: 'running',
    });
  }

  if (isLoading && tasks.length > 0 && tasks.every((task) => task.status !== 'running')) {
    tasks.push({
      id: 'thinking-followup',
      label: '正在整理回复',
      category: 'thinking',
      status: 'running',
    });
  }

  return tasks;
}

export function getActiveConsumerTask(tasks: ConsumerTaskItem[]): ConsumerTaskItem | null {
  return tasks.find((task) => task.status === 'running') ?? tasks[tasks.length - 1] ?? null;
}
