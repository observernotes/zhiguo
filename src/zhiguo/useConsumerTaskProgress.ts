import { useMemo } from 'react';

import type { ChatMessage } from '../components/chat/types/types';
import { extractConsumerTasksFromMessages } from './consumerToolProgress';
import type { ConsumerTaskItem } from './consumerToolProgress';

export function useConsumerTaskProgress(
  messages: ChatMessage[],
  isLoading: boolean,
): ConsumerTaskItem[] {
  return useMemo(
    () => extractConsumerTasksFromMessages(messages, isLoading),
    [messages, isLoading],
  );
}
