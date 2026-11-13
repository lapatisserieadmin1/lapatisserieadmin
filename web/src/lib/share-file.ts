import { whatsappLink } from "@/lib/whatsapp";

export type ChatOutcome = "copied" | "downloaded";

function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function copyImage(file: File): Promise<boolean> {
  if (file.type !== "image/png" || typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": file })]);
    return true;
  } catch {
    return false;
  }
}

// One tap opens the WhatsApp chat of the customer who placed the order (owner, 2026-11-07). WhatsApp lets no
// website attach a file to a chat, so an image is copied first (staff paste it and press send) and a PDF,
// which cannot be copied, is downloaded to attach. Must run straight after a tap.
export async function openChatWithFile(file: File, phone: string, text = ""): Promise<ChatOutcome> {
  const copied = await copyImage(file);
  if (!copied) download(file);
  window.open(whatsappLink(phone, text), "_blank", "noopener,noreferrer");
  return copied ? "copied" : "downloaded";
}

export function chatOutcomeMessage(outcome: ChatOutcome, what: string, fileName: string): string {
  return outcome === "copied"
    ? `The customer's WhatsApp chat is open and the ${what} image is copied. In the chat, paste it (Ctrl+V, Cmd+V, or long-press and Paste) and press send.`
    : `The customer's WhatsApp chat is open and ${fileName} is downloaded. Attach it in the chat (📎) and press send.`;
}
