import { PRODUCT_NAME, ZHIGUO_MASCOT_SRC } from '../constants/product';

type ZhiguoAvatarProps = {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showName?: boolean;
  ring?: boolean;
  className?: string;
};

const sizeMap = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-16 w-16',
  xl: 'h-24 w-24',
};

export default function ZhiguoAvatar({ size = 'md', showName = false, ring = false, className = '' }: ZhiguoAvatarProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className={ring ? 'rounded-[28px] bg-white p-1 shadow-lg shadow-orange-200/60 ring-1 ring-orange-100' : ''}>
        <img
          src={ZHIGUO_MASCOT_SRC}
          alt={PRODUCT_NAME}
          className={`${sizeMap[size]} rounded-[24px] object-cover shadow-sm`}
        />
      </div>
      {showName && <span className="text-sm font-semibold text-foreground">{PRODUCT_NAME}</span>}
    </div>
  );
}
