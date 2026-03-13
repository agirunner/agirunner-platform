import { useEffect } from 'react';

/**
 * Registers a `beforeunload` listener that warns the user when they attempt
 * to close or reload the tab while a form has unsaved changes.
 *
 * This is the interim protection layer until the router is migrated to a
 * data router that supports `useBlocker` for in-app navigation guards.
 */
export function useUnsavedChanges(isDirty: boolean): void {
  useEffect(() => {
    if (!isDirty) {
      return;
    }
    function handleBeforeUnload(event: BeforeUnloadEvent): void {
      event.preventDefault();
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isDirty]);
}
