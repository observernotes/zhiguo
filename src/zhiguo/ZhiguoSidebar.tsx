import { LogOut, MessageSquarePlus, Settings2, Trash2 } from 'lucide-react';
import type { Project, ProjectSession } from '../types/app';
import { PRODUCT_NAME } from '../constants/product';
import ZhiguoAvatar from './ZhiguoAvatar';

type ZhiguoSidebarProps = {
  username: string;
  project: Project | null;
  sessions: ProjectSession[];
  selectedSessionId: string | null;
  onNewChat: () => void;
  onSelectSession: (session: ProjectSession) => void;
  onDeleteSession: (sessionId: string) => void;
  onOpenSettings: () => void;
  onLogout: () => void;
};

function formatSessionTitle(session: ProjectSession): string {
  const custom = typeof session.custom_name === 'string' ? session.custom_name.trim() : '';
  if (custom) {
    return custom;
  }
  const summary = typeof session.summary === 'string' ? session.summary.trim() : '';
  if (summary) {
    return summary.length > 24 ? `${summary.slice(0, 24)}…` : summary;
  }
  return '新对话';
}

export default function ZhiguoSidebar({
  username,
  project,
  sessions,
  selectedSessionId,
  onNewChat,
  onSelectSession,
  onDeleteSession,
  onOpenSettings,
  onLogout,
}: ZhiguoSidebarProps) {
  return (
    <aside className="flex h-full w-[280px] flex-col border-r border-orange-100/80 bg-gradient-to-b from-[#FFFBF5] to-[#FFF1E5]">
      <div className="zhiguo-shell-header flex items-center justify-between border-b border-orange-100/60 px-4 pb-4">
        <ZhiguoAvatar size="md" showName ring />
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onOpenSettings}
            className="rounded-xl p-2.5 text-[#9A6A55] transition hover:bg-white/80 hover:text-[#FF6B35] active:scale-95"
            title="设置"
          >
            <Settings2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="rounded-xl p-2.5 text-[#9A6A55] transition hover:bg-white/80 hover:text-[#FF6B35] active:scale-95"
            title="退出登录"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="px-3 py-3">
        <button
          type="button"
          onClick={onNewChat}
          disabled={!project}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#FF6B35] px-4 py-3.5 text-sm font-semibold text-white shadow-md shadow-orange-200/80 transition hover:bg-[#F15F2B] active:scale-[0.98] disabled:opacity-50"
        >
          <MessageSquarePlus className="h-4 w-4" />
          新建对话
        </button>
      </div>

      <div className="px-4 pb-1 text-xs font-medium text-[#B0846D]">你好，{username}</div>

      <div className="flex-1 overflow-y-auto px-2 pb-4 pt-2">
        {sessions.length === 0 ? (
          <div className="mx-2 rounded-3xl border border-dashed border-orange-100 bg-white/60 px-4 py-8 text-center shadow-sm shadow-orange-100/50">
            <p className="text-sm text-[#8A5A44]">还没有对话</p>
            <p className="mt-1 text-xs text-[#B0846D]">点击「新建对话」开始聊天</p>
          </div>
        ) : (
          <ul className="space-y-1">
            {sessions.map((session) => {
              const active = selectedSessionId === session.id;
              return (
                <li key={session.id}>
                  <div
                    className={`group flex items-center gap-1 rounded-2xl px-2 py-1 transition ${
                      active ? 'bg-white shadow-sm shadow-orange-100/70 ring-1 ring-orange-100' : 'hover:bg-white/70'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectSession(session)}
                      className={`min-w-0 flex-1 rounded-xl px-2 py-2 text-left text-sm transition ${
                        active ? 'font-medium text-[#5A3A2A]' : 'text-[#7A5140]'
                      }`}
                    >
                      <span className="block truncate">{formatSessionTitle(session)}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteSession(String(session.id))}
                      className="rounded-lg p-2 text-[#B0846D] opacity-0 transition hover:bg-orange-50 hover:text-[#FF6B35] group-hover:opacity-100"
                      title="删除对话"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="native-safe-bottom border-t border-orange-100/60 px-4 py-3 text-center text-[11px] text-[#B0846D]">
        {PRODUCT_NAME} · 你的 AI 小伙伴
      </div>
    </aside>
  );
}
