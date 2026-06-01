import { FileText, ImageIcon } from 'lucide-react';
import type { ConsumerDeliverable } from './consumerDisplayPolicy';

type ZhiguoDeliverableChipProps = {
  item: ConsumerDeliverable;
};

export default function ZhiguoDeliverableChip({ item }: ZhiguoDeliverableChipProps) {
  const Icon = item.type === 'image' ? ImageIcon : FileText;

  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[11px] text-[#9A6A55] ring-1 ring-orange-100">
      <Icon className="h-3 w-3 shrink-0 text-[#FF6B35]" />
      <span className="truncate">{item.label}</span>
    </span>
  );
}
