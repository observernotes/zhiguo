import { useMemo } from 'react';
import type { ChatMessage } from '../components/chat/types/types';
import type { Project, LLMProvider } from '../types/app';
import { buildConsumerTurnBlocks } from './consumerTurnBlocks';
import ZhiguoTurnView from './ZhiguoTurnView';

type ConsumerChatMessagesListProps = {
  messages: ChatMessage[];
  isLoading: boolean;
  hasLiveStream?: boolean;
  createDiff: (oldStr: string, newStr: string) => unknown;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  selectedProject: Project;
  provider: LLMProvider;
};

export default function ConsumerChatMessagesList({
  messages,
  isLoading,
  hasLiveStream = false,
  createDiff,
  onFileOpen,
  onShowSettings,
  onGrantToolPermission,
  selectedProject,
  provider,
}: ConsumerChatMessagesListProps) {
  const turns = useMemo(
    () => buildConsumerTurnBlocks(messages, isLoading, hasLiveStream),
    [messages, isLoading, hasLiveStream],
  );

  return (
    <>
      {turns.map((turn, turnIndex) => {
        const prevUser = turnIndex > 0 ? turns[turnIndex - 1]?.userMessage ?? null : null;

        return (
          <ZhiguoTurnView
            key={turn.id}
            turnId={turn.id}
            userMessage={turn.userMessage}
            prevUserMessage={prevUser}
            replyMessages={turn.replyMessages}
            tasks={turn.tasks}
            deliverables={turn.deliverables}
            isActive={turn.isActive}
            isLoading={isLoading}
            createDiff={createDiff}
            onFileOpen={onFileOpen}
            onShowSettings={onShowSettings}
            onGrantToolPermission={onGrantToolPermission}
            selectedProject={selectedProject}
            provider={provider}
          />
        );
      })}
    </>
  );
}
