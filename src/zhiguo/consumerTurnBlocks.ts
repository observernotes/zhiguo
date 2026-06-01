import type { ChatMessage } from '../components/chat/types/types';
import {
  describeConsumerTool,
  isConsumerProgressTool,
  type ConsumerTaskItem,
} from './consumerToolProgress';
import {
  extractDeliverablesFromMessages,
  shouldShowTaskInTimeline,
  type ConsumerDeliverable,
} from './consumerDisplayPolicy';

export type ConsumerTurnBlock = {
  id: string;
  userMessage: ChatMessage;
  tasks: ConsumerTaskItem[];
  deliverables: ConsumerDeliverable[];
  replyMessages: ChatMessage[];
  isActive: boolean;
};

function createSyntheticUserMessage(message: ChatMessage): ChatMessage {
  return {
    type: 'user',
    content: '',
    timestamp: message.timestamp,
    isSyntheticConsumerAnchor: true,
  };
}

function isReplyMessage(message: ChatMessage): boolean {
  if (message.type === 'user') {
    return false;
  }
  if (message.isToolUse || message.type === 'tool') {
    return false;
  }
  if (message.isThinking) {
    return false;
  }
  return message.type === 'assistant' || message.type === 'error';
}

function isInternalSkillInstruction(message: ChatMessage): boolean {
  if (message.type !== 'user') {
    return false;
  }
  const content = String(message.content || '');
  return (
    content.startsWith('Base directory for this skill:')
    || /^#\s+Zhiguo PPT\b/m.test(content)
    || content.includes('PRESENTATION_MANIFEST: deliverables/ppt/<deck-id>/manifest.json')
  );
}

function inferActiveTaskFromTurn(current: ConsumerTurnBlock): ConsumerTaskItem | null {
  const userText = String(current.userMessage.content || '').toLowerCase();
  const replyText = current.replyMessages
    .map((message) => String(message.content || ''))
    .join('\n')
    .toLowerCase();
  const combined = `${userText}\n${replyText}`;

  if (
    combined.includes('codex-image')
    || (combined.includes('codex') && (combined.includes('image') || combined.includes('图像') || combined.includes('生图')))
  ) {
    return {
      id: 'inferred-codex-image',
      label: '正在生图',
      detail: 'Codex 图片生成',
      category: 'image',
      status: 'running',
      durationHint: '约 1–3 分钟',
    };
  }

  return {
    id: 'thinking',
    label: '正在思考',
    detail: '整理下一步',
    category: 'thinking',
    status: 'running',
  };
}

export function buildConsumerTurnBlocks(
  messages: ChatMessage[],
  isLoading: boolean,
  hasLiveStream = false,
): ConsumerTurnBlock[] {
  const blocks: ConsumerTurnBlock[] = [];
  let current: ConsumerTurnBlock | null = null;
  let turnMessages: ChatMessage[] = [];

  const flush = () => {
    if (!current) {
      return;
    }
    current.deliverables = extractDeliverablesFromMessages(turnMessages);
    blocks.push(current);
    current = null;
    turnMessages = [];
  };

  for (const message of messages) {
    if (isInternalSkillInstruction(message)) {
      continue;
    }

    if (message.type === 'user') {
      flush();
      current = {
        id: `turn-${String(message.timestamp)}`,
        userMessage: message,
        tasks: [],
        deliverables: [],
        replyMessages: [],
        isActive: false,
      };
      turnMessages = [];
      continue;
    }

    if (!current) {
      current = {
        id: `turn-resumed-${String(message.timestamp)}`,
        userMessage: createSyntheticUserMessage(message),
        tasks: [],
        deliverables: [],
        replyMessages: [],
        isActive: false,
      };
    }

    turnMessages.push(message);

    if (isConsumerProgressTool(message)) {
      const task = describeConsumerTool(message);
      if (task && shouldShowTaskInTimeline(task, message)) {
        const existingIndex = current.tasks.findIndex((item) => item.id === task.id);
        if (existingIndex >= 0) {
          current.tasks[existingIndex] = task;
        } else {
          current.tasks.push(task);
        }
      }
      continue;
    }

    if (isReplyMessage(message)) {
      current.replyMessages.push(message);
    }
  }

  flush();

  if (blocks.length > 0 && (isLoading || hasLiveStream)) {
    const active = blocks[blocks.length - 1];
    active.isActive = true;
    if (active.tasks.length === 0 && isLoading) {
      const inferredTask = inferActiveTaskFromTurn(active);
      if (inferredTask) {
        active.tasks.push(inferredTask);
      }
    }
  }

  return blocks;
}
