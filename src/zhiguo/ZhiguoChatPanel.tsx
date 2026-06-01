import ErrorBoundary from '../components/main-content/view/ErrorBoundary';
import ChatInterface from '../components/chat/view/ChatInterface';
import { useUiPreferences } from '../hooks/useUiPreferences';
import type { MainContentProps } from '../components/main-content/types/types';
import { PRODUCT_NAME } from '../constants/product';
import ZhiguoAvatar from './ZhiguoAvatar';

type ZhiguoChatPanelProps = Omit<
  MainContentProps,
  'activeTab' | 'setActiveTab' | 'isLoading' | 'onMenuClick'
>;

export default function ZhiguoChatPanel({
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  latestMessage,
  isMobile,
  onInputFocusChange,
  onSessionActive,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  processingSessions,
  onNavigateToSession,
  onShowSettings,
  externalMessageUpdate,
  newSessionTrigger,
}: ZhiguoChatPanelProps) {
  const { preferences } = useUiPreferences();

  if (!selectedProject) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-gradient-to-b from-[#FFFBF5] to-[#FFF0E6] px-6 text-center">
        <ZhiguoAvatar size="lg" className="justify-center" />
        <h2 className="mt-6 text-xl font-semibold text-gray-800">正在连接{PRODUCT_NAME}…</h2>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-gray-500">
          马上就好，你的专属空间正在准备中
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#FFFBF5]">
      <ErrorBoundary showDetails={false}>
        <ChatInterface
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          ws={ws}
          sendMessage={sendMessage}
          latestMessage={latestMessage}
          onInputFocusChange={onInputFocusChange}
          onSessionActive={onSessionActive}
          onSessionInactive={onSessionInactive}
          onSessionProcessing={onSessionProcessing}
          onSessionNotProcessing={onSessionNotProcessing}
          processingSessions={processingSessions}
          onNavigateToSession={onNavigateToSession}
          onShowSettings={onShowSettings}
          autoExpandTools={false}
          showRawParameters={false}
          showThinking={false}
          autoScrollToBottom={preferences.autoScrollToBottom ?? true}
          sendByCtrlEnter={false}
          externalMessageUpdate={externalMessageUpdate}
          newSessionTrigger={newSessionTrigger}
          onShowAllTasks={null}
        />
      </ErrorBoundary>
    </div>
  );
}
