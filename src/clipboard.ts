export interface ClipboardHostLike {
  clipboard?: { writeText?: (text: string) => void | Promise<void> };
  ui?: { copyToClipboard?: (text: string) => void | Promise<void> };
}

export type ClipboardResult =
  | { ok: true }
  | { ok: false; message: string };

export async function copyTextToClipboard(text: string, host: ClipboardHostLike): Promise<ClipboardResult> {
  try {
    if (typeof host.clipboard?.writeText === "function") {
      await host.clipboard.writeText(text);
      return { ok: true };
    }
    if (typeof host.ui?.copyToClipboard === "function") {
      await host.ui.copyToClipboard(text);
      return { ok: true };
    }
    return { ok: false, message: "Clipboard unavailable in this Pi host." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Clipboard write failed.";
    return { ok: false, message };
  }
}
