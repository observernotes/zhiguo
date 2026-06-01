import type { ReactNode } from 'react';
import { IS_PLATFORM } from '../../../constants/config';
import { IS_CONSUMER_MODE } from '../../../constants/product';
import { useAuth } from '../context/AuthContext';
import Onboarding from '../../onboarding/view/Onboarding';
import ConsumerOnboarding from '../../onboarding/view/ConsumerOnboarding';
import ZhiguoAuthPage from '../../../zhiguo/ZhiguoAuthPage';
import AuthLoadingScreen from './AuthLoadingScreen';
import LoginForm from './LoginForm';
import SetupForm from './SetupForm';

type ProtectedRouteProps = {
  children: ReactNode;
};

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, isLoading, needsSetup, hasCompletedOnboarding, refreshOnboardingStatus } = useAuth();

  if (isLoading) {
    return <AuthLoadingScreen />;
  }

  if (IS_CONSUMER_MODE) {
    if (!user) {
      return <ZhiguoAuthPage />;
    }
    return <>{children}</>;
  }

  if (IS_PLATFORM) {
    if (!hasCompletedOnboarding) {
      return IS_CONSUMER_MODE ? (
        <ConsumerOnboarding onComplete={refreshOnboardingStatus} />
      ) : (
        <Onboarding onComplete={refreshOnboardingStatus} />
      );
    }

    return <>{children}</>;
  }

  if (needsSetup) {
    return <SetupForm />;
  }

  if (!user) {
    return <LoginForm />;
  }

  if (!hasCompletedOnboarding) {
    return IS_CONSUMER_MODE ? (
      <ConsumerOnboarding onComplete={refreshOnboardingStatus} />
    ) : (
      <Onboarding onComplete={refreshOnboardingStatus} />
    );
  }

  return <>{children}</>;
}
