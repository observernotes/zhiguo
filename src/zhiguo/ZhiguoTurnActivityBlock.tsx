import { useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import type { ConsumerTaskItem } from './consumerToolProgress';
import {
  summarizeCollapsedTasks,
  type ConsumerDeliverable,
} from './consumerDisplayPolicy';
import ZhiguoDeliverableChip from './ZhiguoDeliverableChip';

type ZhiguoTurnActivityBlockProps = {
  tasks: ConsumerTaskItem[];
  deliverables: ConsumerDeliverable[];
  isLoading: boolean;
};

function StepDot({ status }: { status: ConsumerTaskItem['status'] }) {
  if (status === 'running') {
    return <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[#FF6B35]" />;
  }
  if (status === 'error') {
    return <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />;
  }
  return <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />;
}

export default function ZhiguoTurnActivityBlock({
  tasks,
  deliverables,
  isLoading,
}: ZhiguoTurnActivityBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeCollapsedTasks(tasks, isLoading);
  const hasRunning = tasks.some((task) => task.status === 'running');
  const visibleTasks = tasks.filter((task) => task.id !== 'thinking-followup' || expanded);

  if (!summary && deliverables.length === 0) {
    return null;
  }

  const canExpand = visibleTasks.length > 0;

  return (
    <div className="mx-auto max-w-3xl px-3 py-0 sm:px-0">
      <div className="rounded-md px-1 py-0.5 text-[#9A6A55]">
        {canExpand ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="flex w-full items-center gap-1.5 text-left"
          >
            <ChevronDown
              className={`h-3 w-3 shrink-0 text-[#C59A82] transition ${expanded ? 'rotate-180' : ''}`}
            />
            {hasRunning && isLoading ? (
              <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[#FF6B35]" />
            ) : (
              <span className="inline-block h-1 w-1 shrink-0 rounded-full bg-[#FF8A5C]/80" />
            )}
            <span className="min-w-0 flex-1 truncate text-[11px] leading-4 text-[#A4745D]">
              {summary}
            </span>
          </button>
        ) : (
          <div className="flex items-center gap-1.5 px-0.5">
            {hasRunning && isLoading && (
              <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[#FF6B35]" />
            )}
            <span className="truncate text-[11px] leading-4 text-[#8A5A44]">{summary}</span>
          </div>
        )}

        {expanded && canExpand && (
          <ul className="mt-1 space-y-0.5 border-l border-orange-100/80 pl-3">
            {visibleTasks.map((task) => (
              <li key={task.id} className="flex items-center gap-1.5 px-0.5 text-[11px] text-[#9A6A55]">
                <StepDot status={task.status} />
                <span className="truncate">
                  {task.label}
                  {task.detail ? ` · ${task.detail}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}

        {deliverables.length > 0 && (
          <div className={`flex flex-wrap gap-1 ${canExpand ? 'mt-1 pl-4' : 'mt-0.5'}`}>
            {deliverables.map((item) => (
              <ZhiguoDeliverableChip key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
