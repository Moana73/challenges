// インラインSVG（アイコンフォント等の外部依存を避けるため最小限を自前で用意）
export const ICON_SEND =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7Z"/></svg>';

export const ICON_SPARKLE =
  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.6L19.4 9.6l-5.6 1.8L12 17l-1.8-5.6L4.6 9.6l5.6-1.8L12 2z"/><path d="M19 15l.9 2.8L22.7 18.7l-2.8.9L19 22.4l-.9-2.8-2.8-.9 2.8-.9L19 15z" opacity=".6"/></svg>';

export const ICON_FLAG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 2v2"/><circle cx="12" cy="4.6" r="1.3" fill="currentColor" stroke="none"/><path d="M12 5v16" stroke-linecap="round"/><path d="M12 5.6l8 3.4-3 2.5 3 2.5-8 3.4" fill="currentColor" stroke="none"/></svg>';

export const ICON_EMPTY =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5a1 1 0 0 1 1-1h12l3 3v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"/><path d="M9 9h6M9 13h6M9 17h3"/></svg>';

export const GOOGLE_G_DATA_URI =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.5 6 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.9 19 13 24 13c3.1 0 5.8 1.1 8 3l5.7-5.7C34.5 6 29.5 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.4 0 10.3-1.8 14.1-5l-6.5-5.5C29.6 35.6 27 36.5 24 36.5c-5.2 0-9.7-3.4-11.3-8l-6.6 5.1C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.5l6.5 5.5C40.9 36.6 44 31 44 24c0-1.2-.1-2.3-.4-3.5z"/></svg>',
  );
