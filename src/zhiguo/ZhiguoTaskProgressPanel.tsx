import { PRODUCT_NAME, ZHIGUO_MASCOT_SRC } from '../constants/product';
import type { ConsumerTaskItem } from './consumerToolProgress';
import { getActiveConsumerTask } from './consumerToolProgress';
import ZhiguoTaskProgressCard from './ZhiguoTaskProgressCard';

type ZhiguoTaskProgressPanelProps = {
  tasks: ConsumerTaskItem[];
  isLoading: boolean;
};

export default function ZhiguoTaskProgressPanel({ tasks, isLoading }: ZhiguoTaskProgressPanelProps) {
  if (!isLoading || tasks.length === 0) {
    return null;
  }

  const activeTask = getActiveConsumerTask(tasks);
  const recentTasks = tasks.slice(-4);

  return (
    <div className="mx-auto mb-2 max-w-4xl px-1">
      <div className="overflow-hidden rounded-[24px] border border-orange-100/90 bg-white/95 shadow-lg shadow-orange-100/70 backdrop-blur">
        <div className="flex items-center gap-3 border-b border-orange-50 px-4 py-3">
          <img
            src={ZHIGUO_MASCOT_SRC}
            alt={PRODUCT_NAME}
            className="h-9 w-9 rounded-2xl object-cover shadow-sm"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[#5A3A2A]">{PRODUCT_NAME}正在处理</p>
            {activeTask && (
              <p className="truncate text-xs text-[#9A6A55]">
                {activeTask.label}
                {activeTask.detail ? ` · ${activeTask.detail}` : ''}
              </p>
            )}
          </div>
          <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-[#FF6B35]" />
        </div>
        <div className="divide-y divide-orange-50 px-4 py-1">
          {recentTasks.map((task) => (
            <ZhiguoTaskProgressCard key={task.id} task={task} compact />
          ))}
        </div>
      </div>
    </div>
  );
}
