import type { ChatMessage } from '../types/types';
import type { LiveStreamSlot, NormalizedMessage } from '../../../stores/useSessionStore';
import { normalizedToChatMessages } from './useChatMessages';

export type LiveStreamState = LiveStreamSlot | null;

type BuildArgs = {
  storeMessages: NormalizedMessage[];
  liveStream: LiveStreamState;
  sessionId: string | null;
  pendingUserMessage: ChatMessage | null;
  viewHiddenCount: number;
};

const STREAM_ID_PREFIX = '__streaming_';

function streamMessageId(sessionId: string): string {
  return `${STREAM_ID_PREFIX}${sessionId}`;
}

function stripInFlightStreamRows(messages: NormalizedMessage[]): NormalizedMessage[] {
  return messages.filter(
    (message) => !(message.kind === 'stream_delta' && message.id.startsWith(STREAM_ID_PREFIX)),
  );
}

function appendLiveStreamBubble(
  messages: ChatMessage[],
  sessionId: string,
  liveStream: LiveStreamState,
): ChatMessage[] {
  const streamId = streamMessageId(sessionId);
  const withoutStream = messages.filter(
    (message) => message.id !== streamId && !message.isStreaming,
  );

  if (!liveStream?.text) {
    return withoutStream;
  }

  return [
    ...withoutStream,
    {
      type: 'assistant',
      content: liveStream.text,
      timestamp: new Date().toISOString(),
      isStreaming: true,
      id: streamId,
    },
  ];
}

type CacheEntry = {
  storeMessages: NormalizedMessage[];
  liveRevision: number;
  liveText: string;
  viewHiddenCount: number;
  pendingKey: string;
  result: ChatMessage[];
};

let cache: CacheEntry | null = null;

/**
 * Build UI chat messages with a hot-path for live streaming:
 * - History is converted when storeMessages changes
 * - Only the streaming bubble updates when liveStream.revision changes
 */
export function buildDisplayChatMessages({
  storeMessages,
  liveStream,
  sessionId,
  pendingUserMessage,
  viewHiddenCount,
}: BuildArgs): ChatMessage[] {
  const pendingKey = pendingUserMessage
    ? `${pendingUserMessage.type}:${String(pendingUserMessage.content || '').length}`
    : '';

  if (
    cache
    && cache.storeMessages === storeMessages
    && cache.liveRevision === (liveStream?.revision ?? -1)
    && cache.liveText === (liveStream?.text ?? '')
    && cache.viewHiddenCount === viewHiddenCount
    && cache.pendingKey === pendingKey
  ) {
    return cache.result;
  }

  const historyChanged = !cache || cache.storeMessages !== storeMessages;
  const pendingChanged = cache?.pendingKey !== pendingKey;
  const hiddenChanged = cache?.viewHiddenCount !== viewHiddenCount;

  let result: ChatMessage[];

  if (historyChanged || pendingChanged || hiddenChanged || !sessionId) {
    const baseRows = stripInFlightStreamRows(storeMessages);
    let all = normalizedToChatMessages(baseRows);

    if (pendingUserMessage && all.length === 0) {
      all = [pendingUserMessage];
    }

    if (viewHiddenCount > 0 && viewHiddenCount < all.length) {
      all = all.slice(0, -viewHiddenCount);
    }

    result = sessionId
      ? appendLiveStreamBubble(all, sessionId, liveStream)
      : all;
  } else if (sessionId && liveStream) {
    result = appendLiveStreamBubble(cache!.result, sessionId, liveStream);
  } else {
    result = cache!.result.filter((message) => !message.isStreaming);
  }

  cache = {
    storeMessages,
    liveRevision: liveStream?.revision ?? -1,
    liveText: liveStream?.text ?? '',
    viewHiddenCount,
    pendingKey,
    result,
  };

  return result;
}

export function invalidateDisplayChatMessagesCache(): void {
  cache = null;
}
