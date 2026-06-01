import { useCallback, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Menu } from 'lucide-react';

import Settings from '../components/settings/view/Settings';
import { normalizeProjectForSettings } from '../components/sidebar/utils/utils';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useAuth } from '../components/auth/context/AuthContext';
import { useDeviceSettings } from '../hooks/useDeviceSettings';
import { useNativeShell } from '../hooks/useNativeShell';
import { useAndroidBackHandler } from '../hooks/useAndroidBackHandler';
import { useSessionProtection } from '../hooks/useSessionProtection';
import { useProjectsState } from '../hooks/useProjectsState';
import { usePaletteOpsRegister } from '../contexts/PaletteOpsContext';
import { api } from '../utils/api';
import { PRODUCT_NAME } from '../constants/product';
import { useZhiguoBootstrap } from './useZhiguoBootstrap';
import ZhiguoSidebar from './ZhiguoSidebar';
import ZhiguoAvatar from './ZhiguoAvatar';
import ZhiguoChatPanel from './ZhiguoChatPanel';

export default function ZhiguoApp() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId?: string }>();
  const { user, logout } = useAuth();
  const { isMobile, isShellApp } = useDeviceSettings({ trackPWA: true });
  useNativeShell({ isInstalledShell: isShellApp });
  const { ws, sendMessage, latestMessage, isConnected } = useWebSocket();
  const { ready: workspaceReady, error: workspaceError } = useZhiguoBootstrap(true);

  const {
    activeSessions,
    processingSessions,
    markSessionAsActive,
    markSessionAsInactive,
    markSessionAsProcessing,
    markSessionAsNotProcessing,
  } = useSessionProtection();

  const {
    projects,
    selectedProject,
    selectedSession,
    sidebarOpen,
    isLoadingProjects,
    externalMessageUpdate,
    newSessionTrigger,
    showSettings,
    setSidebarOpen,
    setShowSettings,
    openSettings,
    refreshProjectsSilently,
    registerOptimisticSession,
    promoteOptimisticSession,
    handleNewSession,
    handleSessionSelect,
    handleSessionDelete,
    handleProjectSelect,
  } = useProjectsState({
    sessionId,
    navigate,
    latestMessage,
    isMobile,
    activeSessions,
  });

  usePaletteOpsRegister({
    refreshProjects: refreshProjectsSilently,
    registerOptimisticSession,
    promoteOptimisticSession,
  });

  useAndroidBackHandler({
    showSettings,
    sidebarOpen,
    hasSessionRoute: Boolean(sessionId),
    onCloseSettings: () => setShowSettings(false),
    onCloseSidebar: () => setSidebarOpen(false),
    onNavigateHome: () => navigate('/'),
  });

  const userProject = (() => {
    if (!user?.username) {
      return selectedProject ?? projects[0] ?? null;
    }
    const match = projects.find(
      (project) =>
        project.fullPath?.includes(user.username) || project.path?.includes(user.username),
    );
    return match ?? selectedProject ?? projects[0] ?? null;
  })();

  const sessions = userProject
    ? [...(userProject.sessions ?? [])].sort((a, b) => {
        const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
        const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
        return bTime - aTime;
      })
    : [];

  const bootstrapReady = workspaceReady && !isLoadingProjects;

  const deleteSession = useCallback(
    async (sessionIdToDelete: string) => {
      try {
        const response = await api.deleteSession(sessionIdToDelete, false);
        if (!response.ok) {
          throw new Error('delete failed');
        }
        handleSessionDelete(sessionIdToDelete);
        await refreshProjectsSilently();
      } catch {
        window.alert('删除失败，请稍后再试');
      }
    },
    [handleSessionDelete, refreshProjectsSilently],
  );

  useEffect(() => {
    if (bootstrapReady && userProject && selectedProject?.projectId !== userProject.projectId) {
      handleProjectSelect(userProject);
    }
  }, [bootstrapReady, userProject, selectedProject?.projectId, handleProjectSelect]);

  useEffect(() => {
    if (isConnected && selectedSession?.id) {
      sendMessage({
        type: 'get-pending-permissions',
        sessionId: selectedSession.id,
      });
    }
  }, [isConnected, selectedSession?.id, sendMessage]);

  if (!bootstrapReady) {
    return (
      <div className="native-safe-top native-safe-bottom flex min-h-[100dvh] items-center justify-center bg-[#FFF7ED]">
        <div className="text-center">
          <ZhiguoAvatar size="lg" className="justify-center" />
          <p className="mt-4 text-sm text-gray-500">正在为你准备{PRODUCT_NAME}…</p>
          {workspaceError && <p className="mt-2 text-xs text-red-500">{workspaceError}</p>}
        </div>
      </div>
    );
  }

  const sidebar = (
    <ZhiguoSidebar
      username={user?.username ?? ''}
      project={userProject}
      sessions={sessions}
      selectedSessionId={selectedSession?.id ? String(selectedSession.id) : null}
      onNewChat={() => {
        if (userProject) {
          handleNewSession(userProject);
          if (isMobile) {
            setSidebarOpen(false);
          }
        }
      }}
      onSelectSession={(session) => {
        handleSessionSelect(session);
        if (isMobile) {
          setSidebarOpen(false);
        }
      }}
      onDeleteSession={deleteSession}
      onOpenSettings={() => openSettings()}
      onLogout={logout}
    />
  );

  return (
    <>
      <div
        className="fixed inset-0 flex bg-[#FFFBF5]"
        style={{ bottom: 'var(--keyboard-height, 0px)' }}
      >
        {!isMobile ? (
          <div className="h-full flex-shrink-0">{sidebar}</div>
        ) : (
          <div
            className={`fixed inset-0 z-50 flex transition-opacity duration-200 ${
              sidebarOpen ? 'visible opacity-100' : 'invisible pointer-events-none opacity-0'
            }`}
          >
            <button
              type="button"
              className="fixed inset-0 bg-black/25 backdrop-blur-[2px]"
              onClick={() => setSidebarOpen(false)}
              aria-label="关闭侧边栏"
            />
            <div className="relative z-10 h-full w-[min(85vw,280px)] shadow-2xl">{sidebar}</div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {isMobile && (
            <div className="zhiguo-shell-header flex shrink-0 items-center gap-3 border-b border-orange-100/80 bg-white/90 px-4 backdrop-blur-md">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="rounded-xl p-2.5 hover:bg-orange-50 active:scale-95"
              >
                <Menu className="h-5 w-5 text-gray-600" />
              </button>
              <ZhiguoAvatar size="sm" showName />
              <div className="ml-auto flex items-center gap-1.5">
                <span
                  className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-300'}`}
                  title={isConnected ? '已连接' : '连接中'}
                />
              </div>
            </div>
          )}

          <ZhiguoChatPanel
            selectedProject={userProject}
            selectedSession={selectedSession}
            ws={ws}
            sendMessage={sendMessage}
            latestMessage={latestMessage}
            isMobile={isMobile}
            onInputFocusChange={() => {}}
            onSessionActive={markSessionAsActive}
            onSessionInactive={markSessionAsInactive}
            onSessionProcessing={markSessionAsProcessing}
            onSessionNotProcessing={markSessionAsNotProcessing}
            processingSessions={processingSessions}
            onNavigateToSession={(targetSessionId, options) =>
              navigate(`/session/${targetSessionId}`, { replace: Boolean(options?.replace) })
            }
            onShowSettings={() => setShowSettings(true)}
            externalMessageUpdate={externalMessageUpdate}
            newSessionTrigger={newSessionTrigger}
          />
        </div>
      </div>

      <Settings
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        projects={projects.map(normalizeProjectForSettings)}
        initialTab="appearance"
      />
    </>
  );
}
