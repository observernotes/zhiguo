import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import type { LLMProvider } from '../types/app';

export type RegisterOptimisticSessionInput = {
  projectId: string;
  sessionId: string;
  summary: string;
  provider: LLMProvider;
};

export type PaletteOps = {
  openFile: (path: string) => void;
  openSettings: (tab?: string) => void;
  refreshProjects: () => Promise<void> | void;
  registerOptimisticSession?: (input: RegisterOptimisticSessionInput) => void;
  promoteOptimisticSession?: (pendingSessionId: string, realSessionId: string) => void;
};

type Registry = MutableRefObject<Partial<PaletteOps>>;

const PaletteOpsContext = createContext<Registry | null>(null);

const defaultOps: PaletteOps = {
  openFile: () => undefined,
  openSettings: () => undefined,
  refreshProjects: () => undefined,
  registerOptimisticSession: undefined,
  promoteOptimisticSession: undefined,
};

export function PaletteOpsProvider({ children }: { children: ReactNode }) {
  const ref = useRef<Partial<PaletteOps>>({});
  return <PaletteOpsContext.Provider value={ref}>{children}</PaletteOpsContext.Provider>;
}

export function usePaletteOps(): PaletteOps {
  const ref = useContext(PaletteOpsContext);
  return useMemo<PaletteOps>(
    () => ({
      openFile: (path) => (ref?.current.openFile ?? defaultOps.openFile)(path),
      openSettings: (tab) => (ref?.current.openSettings ?? defaultOps.openSettings)(tab),
      refreshProjects: () => (ref?.current.refreshProjects ?? defaultOps.refreshProjects)(),
      registerOptimisticSession: (input) => ref?.current.registerOptimisticSession?.(input),
      promoteOptimisticSession: (pendingSessionId, realSessionId) =>
        ref?.current.promoteOptimisticSession?.(pendingSessionId, realSessionId),
    }),
    [ref],
  );
}

export function usePaletteOpsRegister(partial: Partial<PaletteOps>) {
  const ref = useContext(PaletteOpsContext);
  const {
    openFile,
    openSettings,
    refreshProjects,
    registerOptimisticSession,
    promoteOptimisticSession,
  } = partial;

  useEffect(() => {
    if (!ref) return undefined;
    const prev = { ...ref.current };
    if (openFile) ref.current.openFile = openFile;
    if (openSettings) ref.current.openSettings = openSettings;
    if (refreshProjects) ref.current.refreshProjects = refreshProjects;
    if (registerOptimisticSession) ref.current.registerOptimisticSession = registerOptimisticSession;
    if (promoteOptimisticSession) ref.current.promoteOptimisticSession = promoteOptimisticSession;
    return () => {
      if (openFile && ref.current.openFile === openFile) ref.current.openFile = prev.openFile;
      if (openSettings && ref.current.openSettings === openSettings) ref.current.openSettings = prev.openSettings;
      if (refreshProjects && ref.current.refreshProjects === refreshProjects) ref.current.refreshProjects = prev.refreshProjects;
      if (registerOptimisticSession && ref.current.registerOptimisticSession === registerOptimisticSession) {
        ref.current.registerOptimisticSession = prev.registerOptimisticSession;
      }
      if (promoteOptimisticSession && ref.current.promoteOptimisticSession === promoteOptimisticSession) {
        ref.current.promoteOptimisticSession = prev.promoteOptimisticSession;
      }
    };
  }, [ref, openFile, openSettings, refreshProjects, registerOptimisticSession, promoteOptimisticSession]);
}
