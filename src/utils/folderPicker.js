// Native folder selection that also shows the files inside each folder.
//
// - Windows: the standard folder picker hides all files, so the Rust command
//   `pick_folder_native` opens the system Explorer "Open" dialog configured as a
//   folder picker: it lists video / audio / image files and its button reads
//   "Select folder" (see src-tauri/src/lib.rs).
// - macOS: the native folder panel (NSOpenPanel, via the dialog plugin) already
//   shows the files in each folder (greyed out, for reference), so it's used as-is.
//
// Usage: `const folder = await pickFolder(currentPath)` → "C:/path/to/folder" or null.

import { invoke } from '@tauri-apps/api/core';
import i18n from '../locales/i18n';

const IS_WINDOWS = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);

const t = (key, fallback) => i18n.t(key, { defaultValue: fallback });

// Cross-platform native folder dialog (dialog plugin). On macOS this shows files.
async function pickFolderStandard(defaultPath) {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    directory: true,
    multiple: false,
    canCreateDirectories: true,
    title: t('folder_picker.title', 'Choose the download folder'),
    defaultPath: defaultPath || undefined,
  });
  return selected ? String(selected).replace(/\\/g, '/') : null;
}

export async function pickFolder(defaultPath) {
  if (IS_WINDOWS) {
    try {
      const folder = await invoke('pick_folder_native', {
        defaultPath: defaultPath || null,
        title: t('folder_picker.title', 'Choose the download folder'),
        okLabel: t('folder_picker.ok', 'Select folder'),
        fileName: t('folder_picker.file_name', 'This folder'),
        filterMedia: t('folder_picker.filter_media', 'Videos, audio and images'),
        filterAll: t('folder_picker.filter_all', 'All files'),
      });
      return folder ? String(folder).replace(/\\/g, '/') : null;
    } catch (err) {
      // Should never happen, but never leave the user without a way to pick a folder.
      console.warn('[pickFolder] native Windows dialog failed, using the standard one:', err);
    }
  }
  return pickFolderStandard(defaultPath);
}
