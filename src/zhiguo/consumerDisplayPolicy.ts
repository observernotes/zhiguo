import type { ChatMessage } from '../components/chat/types/types';
import type { ConsumerTaskItem } from './consumerToolProgress';
import { describeConsumerTool, parseToolInputRecord } from './consumerToolProgress';

export type ConsumerDisplayTier = 'silent' | 'summary' | 'process' | 'deliverable' | 'error';

const SILENT_TOOLS = new Set(['TodoRead', 'TodoWrite']);
const SUMMARY_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch']);
const PROCESS_TOOLS = new Set(['Bash', 'Skill', 'Task']);
const DELIVERABLE_TOOLS = new Set(['Write', 'Edit', 'ApplyPatch']);

export function getToolDisplayTier(message: ChatMessage): ConsumerDisplayTier {
  if (message.toolResult?.isError) {
    return 'error';
  }

  const toolName = String(message.toolName || '');
  if (SILENT_TOOLS.has(toolName)) {
    return 'silent';
  }

  const task = describeConsumerTool(message);
  if (task?.category === 'image' && message.toolResult) {
    return 'deliverable';
  }

  if (DELIVERABLE_TOOLS.has(toolName)) {
    return message.toolResult ? 'summary' : 'process';
  }

  if (SUMMARY_TOOLS.has(toolName)) {
    return 'summary';
  }

  if (PROCESS_TOOLS.has(toolName)) {
    return 'process';
  }

  return 'summary';
}

export function shouldShowTaskInTimeline(task: ConsumerTaskItem, message: ChatMessage): boolean {
  const tier = getToolDisplayTier(message);
  return tier !== 'silent';
}

export type ConsumerDeliverable = {
  id: string;
  type: 'image' | 'file' | 'presentation';
  label: string;
  path: string;
};

const SAVED_PATH_RE = /SAVED:\s*`?([^\s`]+)`?/gi;
const PRESENTATION_MANIFEST_RE = /PRESENTATION_MANIFEST:\s*`?([^\s`]+)`?/gi;
const MARKDOWN_IMAGE_RE = /!\[[^\]]*]\(([^)]+)\)/g;

function isUsefulDeliverablePath(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed || trimmed === '**' || trimmed === '<path>' || trimmed === '</path>') {
    return false;
  }
  if (trimmed.includes('${') || trimmed.includes('{') || trimmed.includes('}')) {
    return false;
  }
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return false;
  }
  if (!/[/.]/.test(trimmed)) {
    return false;
  }
  return true;
}

function collectPathsFromText(text: string): string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(PRESENTATION_MANIFEST_RE)) {
    if (match[1] && isUsefulDeliverablePath(match[1])) {
      paths.push(match[1].trim());
    }
  }
  for (const match of text.matchAll(SAVED_PATH_RE)) {
    if (match[1] && isUsefulDeliverablePath(match[1])) {
      paths.push(match[1].trim());
    }
  }
  for (const match of text.matchAll(MARKDOWN_IMAGE_RE)) {
    if (match[1] && isUsefulDeliverablePath(match[1])) {
      paths.push(match[1].trim());
    }
  }
  return paths;
}

function basename(path: string): string {
  const cleanPath = path.split('?')[0].split('#')[0];
  return cleanPath.split('/').pop() || cleanPath || path;
}

function presentationKey(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/[?#].*$/, '');
  const match = normalized.match(/^(.*?deliverables\/ppt\/[^/]+)/i);
  if (match?.[1]) {
    return match[1];
  }
  return normalized.replace(/\/(?:manifest\.json|index\.html)$/i, '');
}

export function extractDeliverablesFromMessages(messages: ChatMessage[]): ConsumerDeliverable[] {
  const seen = new Set<string>();
  const byBasename = new Map<string, ConsumerDeliverable>();

  for (const message of messages) {
    const chunks: string[] = [];
    if (message.toolResult?.content) {
      chunks.push(String(message.toolResult.content));
    }
    if (message.content) {
      chunks.push(String(message.content));
    }

    for (const chunk of chunks) {
      for (const path of collectPathsFromText(chunk)) {
        if (seen.has(path)) {
          continue;
        }
        seen.add(path);
        const lower = path.toLowerCase();
        const isImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(lower);
        const isPresentation = /manifest\.json$/i.test(lower) || /deliverables\/ppt\//i.test(path);
        const item = {
          id: path,
          type: isPresentation ? 'presentation' : isImage ? 'image' : 'file',
          label: isPresentation ? '演示文稿' : basename(path),
          path,
        } satisfies ConsumerDeliverable;

        const normalizedLabel = item.type === 'presentation'
          ? presentationKey(item.path)
          : item.label.replace(/-\d+(?=\.(png|jpe?g|gif|webp|svg)$)/i, '');
        const key = `${item.type}:${normalizedLabel}`;
        const existing = byBasename.get(key);
        const existingIsRemote = existing ? /^https?:\/\//i.test(existing.path) : false;
        const itemIsRemote = /^https?:\/\//i.test(item.path);

        // Prefer public URLs over sandbox/local paths when the same asset appears twice.
        if (!existing || (itemIsRemote && !existingIsRemote)) {
          byBasename.set(key, item);
        }
      }
    }
  }

  const deliverables = [...byBasename.values()];
  const presentations = deliverables.filter((item) => item.type === 'presentation');
  if (presentations.length > 0) {
    return presentations;
  }

  return deliverables;
}

const CODEX_NOISE_LINE_RE =
  /^(OpenAI Codex|workdir:|# Image Generation Skill|# Top-level modes|succeeded in \d|name: \"imagegen\"|```|\s*\*\s*Save the final image|\s*\d+\.\s|图片已成功生成|上传成功|SAVED:|!\[.*\]\(|.*MinIO.*|.*Codex 沙箱.*)/i;

export function sanitizeConsumerAssistantContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return '';
  }

  const lines = trimmed.split('\n');
  const kept: string[] = [];
  let inCodeFence = false;

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) {
      continue;
    }
    if (CODEX_NOISE_LINE_RE.test(line.trim())) {
      continue;
    }
    if (/^tokens used|^─+$|^═+$/.test(line.trim())) {
      continue;
    }
    kept.push(line);
  }

  let result = kept.join('\n').trim();

  // Drop duplicate saved/image metadata when deliverable cards show them.
  result = result.replace(/^[-*]\s+\*\*SAVED:\*\*.*$/gim, '').trim();
  result = result.replace(/^.*\*\*SAVED:\*\*.*$/gim, '').trim();
  result = result.replace(/^!\[[^\]]*]\([^)]+\).*$/gim, '').trim();
  result = result.replace(/^PRESENTATION_MANIFEST:.*$/gim, '').trim();
  result = result.replace(/\n{3,}/g, '\n\n');

  return result;
}

export function shortTaskLabel(task: ConsumerTaskItem): string {
  if (task.id.includes('TaskOutput')) {
    return '';
  }
  if (task.category === 'command') {
    return '';
  }
  if (task.detail) {
    if (
      task.detail.includes('TaskOutput')
      || task.detail.includes('<path>')
      || task.detail.startsWith('ls ')
      || task.detail.includes('/Users/')
    ) {
      return '';
    }
    return task.detail.length > 16 ? `${task.detail.slice(0, 15)}…` : task.detail;
  }
  return task.label.replace(/^已/, '').replace(/^正在/, '') || task.label;
}

export function summarizeCollapsedTasks(tasks: ConsumerTaskItem[], isLoading: boolean): string {
  if (tasks.length === 0) {
    return isLoading ? '正在处理…' : '';
  }

  const visibleTasks = tasks.filter((task) => shortTaskLabel(task) || task.category === 'image');
  const running = visibleTasks.find((task) => task.status === 'running');
  if (running) {
    return running.detail ? `${running.label} · ${running.detail}` : running.label;
  }

  if (isLoading) {
    return '整理回复…';
  }

  const done = visibleTasks.filter((task) => task.status === 'done');
  const labels = done.slice(0, 2).map(shortTaskLabel).filter(Boolean);
  const suffix = done.length > 2 ? '…' : '';
  const joined = labels.length > 0 ? ` · ${labels.join(' · ')}${suffix}` : '';
  return `完成 ${done.length} 步${joined}`;
}
