import {
  CheckCircle2,
  Circle,
  FileText,
  Globe,
  ImageIcon,
  Loader2,
  Pencil,
  Search,
  Sparkles,
  Terminal,
  XCircle,
} from 'lucide-react';

import type { ConsumerTaskCategory, ConsumerTaskItem, ConsumerTaskStatus } from './consumerToolProgress';

type ZhiguoTaskProgressCardProps = {
  task: ConsumerTaskItem;
  compact?: boolean;
};

const categoryIconMap: Record<ConsumerTaskCategory, typeof Search> = {
  thinking: Sparkles,
  search: Search,
  read: FileText,
  write: Pencil,
  web: Globe,
  image: ImageIcon,
  skill: Sparkles,
  command: Terminal,
  task: Sparkles,
  other: Circle,
};

function StatusIcon({ status }: { status: ConsumerTaskStatus }) {
  if (status === 'done') {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />;
  }
  if (status === 'error') {
    return <XCircle className="h-4 w-4 shrink-0 text-red-500" />;
  }
  return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#FF6B35]" />;
}

export default function ZhiguoTaskProgressCard({ task, compact = false }: ZhiguoTaskProgressCardProps) {
  const CategoryIcon = categoryIconMap[task.category] ?? Circle;
  const isRunning = task.status === 'running';

  return (
    <div
      className={`flex items-start gap-3 ${
        compact ? 'py-1.5' : 'py-2'
      } ${isRunning ? 'opacity-100' : 'opacity-80'}`}
    >
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-[#FF6B35]">
        <CategoryIcon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <StatusIcon status={task.status} />
          <span className={`text-sm ${isRunning ? 'font-medium text-[#5A3A2A]' : 'text-[#7A5140]'}`}>
            {task.label}
          </span>
          {task.durationHint && isRunning && (
            <span className="text-xs text-[#B0846D]">{task.durationHint}</span>
          )}
        </div>
        {task.detail && (
          <p className="mt-0.5 truncate text-xs text-[#9A6A55]">{task.detail}</p>
        )}
      </div>
    </div>
  );
}
