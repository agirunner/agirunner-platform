import { useCallback, useState } from 'react';

export type ViewMode = 'war-room' | 'dashboard-grid' | 'timeline-lanes';
export type ControlMode = 'inline' | 'command-center' | 'command-palette';
export type DepthLevel = 1 | 2 | 3;

export interface UserPreferences {
  viewMode: ViewMode;
  controlMode: ControlMode;
  depthLevel: DepthLevel;
  starredPlaybooks: string[];
}

export interface UseUserPreferencesReturn {
  preferences: UserPreferences;
  setViewMode: (mode: ViewMode) => void;
  setControlMode: (mode: ControlMode) => void;
  setDepthLevel: (level: DepthLevel) => void;
  toggleStarredPlaybook: (playbookId: string) => void;
  isPlaybookStarred: (playbookId: string) => boolean;
}

const STORAGE_KEY = 'agirunner-user-preferences';

export function buildDefaultPreferences(): UserPreferences {
  return {
    viewMode: 'war-room',
    controlMode: 'inline',
    depthLevel: 1,
    starredPlaybooks: [],
  };
}

export function loadPreferences(): UserPreferences {
  const defaults = buildDefaultPreferences();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return defaults;
    }
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

export function savePreferences(preferences: UserPreferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

export function toggleStarredPlaybookInList(
  current: string[],
  playbookId: string,
): string[] {
  if (current.includes(playbookId)) {
    return current.filter((id) => id !== playbookId);
  }
  return [...current, playbookId];
}

export function useUserPreferences(): UseUserPreferencesReturn {
  const [preferences, setPreferences] = useState<UserPreferences>(loadPreferences);

  const setViewMode = useCallback((mode: ViewMode) => {
    setPreferences((prev) => {
      const updated = { ...prev, viewMode: mode };
      savePreferences(updated);
      return updated;
    });
  }, []);

  const setControlMode = useCallback((mode: ControlMode) => {
    setPreferences((prev) => {
      const updated = { ...prev, controlMode: mode };
      savePreferences(updated);
      return updated;
    });
  }, []);

  const setDepthLevel = useCallback((level: DepthLevel) => {
    setPreferences((prev) => {
      const updated = { ...prev, depthLevel: level };
      savePreferences(updated);
      return updated;
    });
  }, []);

  const toggleStarredPlaybook = useCallback((playbookId: string) => {
    setPreferences((prev) => {
      const updated = {
        ...prev,
        starredPlaybooks: toggleStarredPlaybookInList(prev.starredPlaybooks, playbookId),
      };
      savePreferences(updated);
      return updated;
    });
  }, []);

  const isPlaybookStarred = useCallback(
    (playbookId: string) => preferences.starredPlaybooks.includes(playbookId),
    [preferences.starredPlaybooks],
  );

  return {
    preferences,
    setViewMode,
    setControlMode,
    setDepthLevel,
    toggleStarredPlaybook,
    isPlaybookStarred,
  };
}
