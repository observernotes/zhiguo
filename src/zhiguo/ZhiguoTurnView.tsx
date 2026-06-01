import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, Circle, FileText, ImageIcon, Loader2, Maximize2, Presentation } from 'lucide-react';

import type { ChatMessage } from '../components/chat/types/types';
import type { Project, LLMProvider } from '../types/app';
import { Markdown } from '../components/chat/view/subcomponents/Markdown';
import MessageComponent from '../components/chat/view/subcomponents/MessageComponent';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '../shared/view/ui/Dialog';
import { authenticatedFetch } from '../utils/api';
import {
  sanitizeConsumerAssistantContent,
  summarizeCollapsedTasks,
  type ConsumerDeliverable,
} from './consumerDisplayPolicy';
import type { ConsumerTaskItem } from './consumerToolProgress';

type DiffLine = {
  type: string;
  content: string;
  lineNum: number;
};

type ZhiguoTurnViewProps = {
  turnId: string;
  userMessage: ChatMessage;
  prevUserMessage: ChatMessage | null;
  replyMessages: ChatMessage[];
  tasks: ConsumerTaskItem[];
  deliverables: ConsumerDeliverable[];
  isActive: boolean;
  isLoading: boolean;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  selectedProject: Project;
  provider: LLMProvider;
};

const assistantBodyClass =
  'prose prose-stone max-w-none text-[15px] leading-7 prose-p:my-2 prose-headings:mb-2 prose-headings:mt-4 prose-headings:text-[#33241B] prose-strong:text-[#2A1A12] prose-li:my-0.5 prose-ul:my-2 prose-ol:my-2 prose-pre:my-3 prose-pre:rounded-2xl prose-pre:border prose-pre:border-orange-100 prose-pre:bg-[#2B211B] prose-code:text-[#7A3F20]';
const PRESENTATION_CANVAS_WIDTH = 1280;
const PRESENTATION_CANVAS_HEIGHT = 720;

function isAssistantReply(message: ChatMessage): boolean {
  return message.type === 'assistant' && !message.isThinking && !message.isToolUse;
}

function isRenderableReply(message: ChatMessage): boolean {
  return isAssistantReply(message) || message.type === 'error' || message.isInteractivePrompt === true;
}

function mergeAssistantText(messages: ChatMessage[]): {
  content: string;
  isStreaming: boolean;
  fallbackMessages: ChatMessage[];
} {
  const parts: string[] = [];
  const fallbackMessages: ChatMessage[] = [];
  let isStreaming = false;

  for (const message of messages) {
    if (isAssistantReply(message)) {
      const raw = String(message.content || '');
      const content = message.isStreaming ? raw : sanitizeConsumerAssistantContent(raw);
      if (content.trim()) {
        parts.push(content);
      }
      isStreaming = isStreaming || Boolean(message.isStreaming);
    } else if (isRenderableReply(message)) {
      fallbackMessages.push(message);
    }
  }

  return {
    content: parts.join('\n\n').trim(),
    isStreaming,
    fallbackMessages,
  };
}

function hasDeliverable(deliverables: ConsumerDeliverable[], type: ConsumerDeliverable['type']): boolean {
  return deliverables.some((item) => item.type === type);
}

function getCompletionText(content: string, deliverables: ConsumerDeliverable[]): string {
  const normalized = content.trim();
  if (!normalized && hasDeliverable(deliverables, 'presentation')) {
    return '演示文稿已生成。';
  }
  if (!normalized && hasDeliverable(deliverables, 'image')) {
    return '图片已生成。';
  }
  if (hasDeliverable(deliverables, 'presentation') && /我会为你|我现在|正在|生成|创建/.test(normalized)) {
    return '演示文稿已生成。';
  }
  if (hasDeliverable(deliverables, 'image') && /我会为你|我现在|运行 Codex|生成命令/.test(normalized)) {
    return '图片已生成。';
  }
  return normalized;
}

function TypingDots() {
  return (
    <span className="inline-flex gap-0.5 align-middle">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#FF6B35]/70 [animation-delay:0ms]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#FF6B35]/70 [animation-delay:150ms]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#FF6B35]/70 [animation-delay:300ms]" />
    </span>
  );
}

function StreamingBody({ content }: { content: string }) {
  return (
    <div className="whitespace-pre-wrap break-words text-[15px] leading-7 text-[#33241B]">
      {content}
      {content.trim() ? (
        <span aria-hidden className="ml-0.5 inline-block h-[1em] w-0.5 animate-pulse bg-[#FF6B35] align-[-0.1em]" />
      ) : (
        <TypingDots />
      )}
    </div>
  );
}

function ActivityStatusIcon({ task }: { task: ConsumerTaskItem }) {
  if (task.status === 'running') {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-[#FF7A3D]" />;
  }
  if (task.status === 'error') {
    return <Circle className="h-3.5 w-3.5 fill-red-400 text-red-400" />;
  }
  return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
}

function TurnActivity({
  tasks,
  isLoading,
}: {
  tasks: ConsumerTaskItem[];
  isLoading: boolean;
}) {
  const summary = summarizeCollapsedTasks(tasks, isLoading);
  if (!summary && tasks.length === 0) {
    return null;
  }

  return (
    <details className="group mt-3 rounded-2xl border border-orange-100/70 bg-[#FFF8F2]/70 px-3 py-2 text-[12px] text-[#8A5A44]">
      <summary className="flex cursor-pointer list-none items-center gap-2">
        {tasks.some((task) => task.status === 'running') && isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#FF7A3D]" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-[#FF8A5C]" />
        )}
        <span className="min-w-0 flex-1 truncate">{summary || '正在处理…'}</span>
        <ChevronDown className="h-3.5 w-3.5 text-[#C59A82] transition group-open:rotate-180" />
      </summary>
      {tasks.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-orange-100/70 pt-2">
          {tasks
            .filter((task) => !String(task.detail || '').includes('TaskOutput'))
            .map((task) => (
              <div key={task.id} className="flex min-w-0 items-center gap-2">
                <ActivityStatusIcon task={task} />
                <span className="shrink-0 text-[#6A4533]">{task.label}</span>
                {task.detail && <span className="min-w-0 truncate text-[#B0846D]">{task.detail}</span>}
              </div>
            ))}
        </div>
      )}
    </details>
  );
}

function DeliverablesShelf({
  deliverables,
  onFileOpen,
  selectedProject,
  presentationsReady,
}: {
  deliverables: ConsumerDeliverable[];
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  selectedProject: Project;
  presentationsReady: boolean;
}) {
  if (deliverables.length === 0) {
    return null;
  }

  const hasPendingPresentation = deliverables.some((item) => item.type === 'presentation') && !presentationsReady;

  return (
    <div className="mt-3 rounded-2xl border border-orange-100 bg-white/80 p-3 shadow-sm shadow-orange-100/50">
      <div className="mb-2 text-xs font-medium text-[#8A5A44]">
        {hasPendingPresentation ? '生成中' : '已生成'}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {deliverables.map((item) => {
          const Icon = item.type === 'presentation' ? Presentation : item.type === 'image' ? ImageIcon : FileText;
          const isRemoteImage = item.type === 'image' && /^https?:\/\//i.test(item.path);
          const title = item.type === 'presentation' ? '演示文稿' : item.label;
          const subtitle = item.type === 'presentation' ? 'HTML 演示 / 可继续编辑' : item.path;
          if (item.type === 'presentation') {
            return (
              <PresentationDeliverableCard
                key={item.id}
                item={item}
                selectedProject={selectedProject}
                onFileOpen={onFileOpen}
                isReady={presentationsReady}
              />
            );
          }
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onFileOpen?.(item.path)}
              className="group min-w-0 overflow-hidden rounded-xl border border-orange-100 bg-[#FFF8F2] text-left transition hover:border-orange-200 hover:bg-[#FFF3E8]"
            >
              {isRemoteImage && (
                <img src={item.path} alt={item.label} className="aspect-square w-full object-cover" />
              )}
              <span className="flex min-w-0 items-center gap-2 px-3 py-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-[#FF6B35] ring-1 ring-orange-100">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[#4A2D1F]">{title}</span>
                  <span className="block truncate text-[11px] text-[#B0846D]">{subtitle}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function cleanPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/[?#].*$/, '');
}

function dirname(path: string): string {
  const normalized = cleanPath(path);
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex >= 0 ? normalized.slice(0, slashIndex) : '.';
}

function getPresentationPaths(item: ConsumerDeliverable) {
  const normalized = cleanPath(item.path);
  const directory = /\.(html|json|svg|pdf)$/i.test(normalized) ? dirname(normalized) : normalized;
  return {
    htmlPath: `${directory}/index.html`,
    manifestPath: normalized.endsWith('/manifest.json') ? normalized : `${directory}/manifest.json`,
  };
}

function PresentationPreviewFrame({
  item,
  selectedProject,
  variant = 'card',
}: {
  item: ConsumerDeliverable;
  selectedProject: Project;
  variant?: 'card' | 'modal';
}) {
  const { htmlPath } = useMemo(() => getPresentationPaths(item), [item]);
  const [html, setHtml] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const frameHostRef = useRef<HTMLDivElement | null>(null);
  const [hostSize, setHostSize] = useState({ width: PRESENTATION_CANVAS_WIDTH, height: PRESENTATION_CANVAS_HEIGHT });

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      setIsLoading(true);
      setError('');
      setHtml('');
      try {
        const response = await authenticatedFetch(
          `/api/projects/${selectedProject.projectId}/file?filePath=${encodeURIComponent(htmlPath)}`,
        );
        if (!response.ok) {
          throw new Error(`Preview failed: ${response.status}`);
        }
        const data = await response.json();
        if (!cancelled) {
          setHtml(String(data.content || ''));
        }
      } catch {
        if (!cancelled) {
          setError('暂时无法加载预览');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadPreview();

    return () => {
      cancelled = true;
    };
  }, [htmlPath, selectedProject.projectId]);

  useEffect(() => {
    const host = frameHostRef.current;
    if (!host) {
      return undefined;
    }

    const updateSize = () => {
      const rect = host.getBoundingClientRect();
      setHostSize({
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(host);

    return () => observer.disconnect();
  }, [html, isLoading, error]);

  const frameScale = Math.min(
    hostSize.width / PRESENTATION_CANVAS_WIDTH,
    hostSize.height / PRESENTATION_CANVAS_HEIGHT,
  );
  const previewClass = variant === 'modal'
    ? 'aspect-video max-h-[calc(100vh-7rem)] w-full'
    : 'aspect-video w-full';
  const stateClass = `${previewClass} flex items-center justify-center rounded-xl bg-[#FFF8F2] text-xs text-[#B0846D]`;

  if (isLoading) {
    return (
      <div className={stateClass}>
        正在加载预览…
      </div>
    );
  }

  if (error || !html) {
    return (
      <div className={stateClass}>
        {error || '暂无预览'}
      </div>
    );
  }

  return (
    <div
      ref={frameHostRef}
      className={`${previewClass} overflow-hidden rounded-xl border border-orange-100 bg-white`}
    >
      <iframe
        title="演示文稿预览"
        srcDoc={html}
        sandbox="allow-scripts"
        className={variant === 'card' ? 'pointer-events-none border-0 bg-white' : 'border-0 bg-white'}
        style={{
          width: `${PRESENTATION_CANVAS_WIDTH}px`,
          height: `${PRESENTATION_CANVAS_HEIGHT}px`,
          transform: `scale(${frameScale})`,
          transformOrigin: 'top left',
        }}
      />
    </div>
  );
}

function PresentationDeliverableCard({
  item,
  selectedProject,
  onFileOpen,
  isReady,
}: {
  item: ConsumerDeliverable;
  selectedProject: Project;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  isReady: boolean;
}) {
  const { manifestPath } = useMemo(() => getPresentationPaths(item), [item]);

  if (!isReady) {
    return (
      <div className="group min-w-0 overflow-hidden rounded-xl border border-orange-100 bg-[#FFF8F2] text-left">
        <div className="flex aspect-video w-full items-center justify-center rounded-t-xl bg-gradient-to-br from-[#FFF8F2] to-[#FFF0E4] text-xs text-[#B0846D]">
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-[#FF7A3D]" />
            正在生成演示文稿…
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2 px-3 py-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-[#FF6B35] ring-1 ring-orange-100">
            <Presentation className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-[#4A2D1F]">演示文稿</span>
            <span className="block truncate text-[11px] text-[#B0846D]">完成后可预览 / 编辑</span>
          </span>
        </div>
        <div className="flex gap-2 border-t border-orange-100/70 px-3 py-2">
          <button
            type="button"
            disabled
            className="inline-flex flex-1 cursor-not-allowed items-center justify-center gap-1.5 rounded-lg bg-[#FFD4C2] px-3 py-1.5 text-xs font-medium text-white"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            预览
          </button>
          <button
            type="button"
            disabled
            className="inline-flex flex-1 cursor-not-allowed items-center justify-center rounded-lg bg-white/70 px-3 py-1.5 text-xs font-medium text-[#C59A82] ring-1 ring-orange-100"
          >
            编辑
          </button>
        </div>
      </div>
    );
  }

  return (
    <Dialog>
      <div className="group min-w-0 overflow-hidden rounded-xl border border-orange-100 bg-[#FFF8F2] text-left transition hover:border-orange-200 hover:bg-[#FFF3E8]">
        <PresentationPreviewFrame item={item} selectedProject={selectedProject} />
        <div className="flex min-w-0 items-center gap-2 px-3 py-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-[#FF6B35] ring-1 ring-orange-100">
            <Presentation className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-[#4A2D1F]">演示文稿</span>
            <span className="block truncate text-[11px] text-[#B0846D]">HTML 预览 / 可继续编辑</span>
          </span>
        </div>
        <div className="flex gap-2 border-t border-orange-100/70 px-3 py-2">
          <DialogTrigger asChild>
            <button
              type="button"
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#FF6B35] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[#F05F2D]"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              预览
            </button>
          </DialogTrigger>
          <button
            type="button"
            onClick={() => onFileOpen?.(manifestPath)}
            className="inline-flex flex-1 items-center justify-center rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-[#8A5A44] ring-1 ring-orange-100 transition hover:bg-[#FFF8F2]"
          >
            编辑
          </button>
        </div>
      </div>
      <DialogContent className="max-w-6xl border-orange-100 bg-[#FFF8F2] p-3">
        <DialogTitle>演示文稿预览</DialogTitle>
        <PresentationPreviewFrame item={item} selectedProject={selectedProject} variant="modal" />
      </DialogContent>
    </Dialog>
  );
}

export default function ZhiguoTurnView({
  turnId,
  userMessage,
  prevUserMessage,
  replyMessages,
  tasks,
  deliverables,
  isActive,
  isLoading,
  createDiff,
  onFileOpen,
  onShowSettings,
  onGrantToolPermission,
  selectedProject,
  provider,
}: ZhiguoTurnViewProps) {
  const waitingForReply = isActive && isLoading && replyMessages.length === 0;
  const displayReplies = waitingForReply
    ? [{
        type: 'assistant',
        content: '',
        timestamp: userMessage.timestamp,
        isStreaming: true,
      } satisfies ChatMessage]
    : replyMessages;
  const merged = mergeAssistantText(displayReplies);
  const bodyContent = getCompletionText(merged.content, deliverables);

  return (
    <section className="space-y-2">
      {!userMessage.isSyntheticConsumerAnchor && (
        <MessageComponent
          key={`${turnId}-user`}
          message={userMessage}
          prevMessage={prevUserMessage}
          createDiff={createDiff}
          onFileOpen={onFileOpen}
          onShowSettings={onShowSettings}
          onGrantToolPermission={onGrantToolPermission}
          autoExpandTools={false}
          showRawParameters={false}
          showThinking={false}
          selectedProject={selectedProject}
          provider={provider}
        />
      )}

      <div className="mx-auto w-full max-w-3xl px-3 sm:px-0">
        <article className="rounded-[22px] bg-white/65 px-4 py-3 shadow-sm shadow-orange-100/50 ring-1 ring-orange-100/70 backdrop-blur">
          {merged.isStreaming ? (
            <StreamingBody content={bodyContent} />
          ) : bodyContent ? (
            <Markdown className={assistantBodyClass}>{bodyContent}</Markdown>
          ) : merged.fallbackMessages.length === 0 ? (
            <StreamingBody content="" />
          ) : null}

          {merged.fallbackMessages.map((message, index) => (
            <MessageComponent
              key={`${turnId}-fallback-${index}`}
              message={message}
              prevMessage={index > 0 ? merged.fallbackMessages[index - 1] : userMessage}
              createDiff={createDiff}
              onFileOpen={onFileOpen}
              onShowSettings={onShowSettings}
              onGrantToolPermission={onGrantToolPermission}
              autoExpandTools={false}
              showRawParameters={false}
              showThinking={false}
              selectedProject={selectedProject}
              provider={provider}
            />
          ))}

          <TurnActivity tasks={tasks} isLoading={isActive && isLoading} />
          <DeliverablesShelf
            deliverables={deliverables}
            onFileOpen={onFileOpen}
            selectedProject={selectedProject}
            presentationsReady={!isActive}
          />
        </article>
      </div>
    </section>
  );
}
