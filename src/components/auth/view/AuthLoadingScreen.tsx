import { IS_CONSUMER_MODE, PRODUCT_NAME } from '../../../constants/product';
import ZhiguoAvatar from '../../../zhiguo/ZhiguoAvatar';

const loadingDotAnimationDelays = ['0s', '0.1s', '0.2s'];

export default function AuthLoadingScreen() {
  if (IS_CONSUMER_MODE) {
    return (
      <div className="native-safe-top native-safe-bottom flex min-h-[100dvh] items-center justify-center bg-[#FFF7ED] bg-[radial-gradient(circle_at_top,#FFE8D6_0%,#FFF7ED_42%,#FFFDF8_100%)] p-4">
        <div className="text-center">
          <ZhiguoAvatar size="xl" ring className="justify-center" />
          <div className="mt-6 flex items-center justify-center gap-1.5">
            {loadingDotAnimationDelays.map((delay) => (
              <div
                key={delay}
                className="h-2 w-2 animate-bounce rounded-full bg-[#FF6B35]"
                style={{ animationDelay: delay }}
              />
            ))}
          </div>
          <p className="mt-3 text-sm text-[#8A5A44]">正在打开{PRODUCT_NAME}…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="text-center">
        <div className="mb-4 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-primary shadow-sm">
            <svg className="h-8 w-8 text-primary-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeWidth="2" d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
          </div>
        </div>
        <h1 className="mb-2 text-2xl font-bold text-foreground">CloudCLI</h1>
        <div className="flex items-center justify-center space-x-2">
          {loadingDotAnimationDelays.map((delay) => (
            <div
              key={delay}
              className="h-2 w-2 animate-bounce rounded-full bg-blue-500"
              style={{ animationDelay: delay }}
            />
          ))}
        </div>
        <p className="mt-2 text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}
