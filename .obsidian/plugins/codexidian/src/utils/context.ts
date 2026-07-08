import type { EditorContext } from "../types";

interface AttachedFileContent {
  path: string;
  content: string;
}

/**
 * Format editor context as XML tags for prompt injection.
 */
export function formatContextXml(
  notePath: string | null,
  editorContext: EditorContext | null,
  fileContents: AttachedFileContent[] = [],
): string {
  const parts: string[] = [];

  if (notePath) {
    parts.push(`<current_note>${notePath}</current_note>`);
  }

  if (editorContext && editorContext.selectedText.trim()) {
    const startLine = editorContext.startLine;
    const endLine = startLine + editorContext.lineCount - 1;
    parts.push(
      `<editor_selection path="${editorContext.notePath}" lines="${startLine}-${endLine}">${editorContext.selectedText}</editor_selection>`,
    );
  }

  for (const file of fileContents) {
    parts.push(
      `<attached_file path="${file.path}">${file.content}</attached_file>`,
    );
  }

  return parts.join("\n");
}

/**
 * Build an augmented prompt with context XML prepended.
 */
export function buildAugmentedPrompt(
  userText: string,
  notePath: string | null,
  editorContext: EditorContext | null,
  fileContents: AttachedFileContent[] = [],
): string {
  const contextXml = formatContextXml(notePath, editorContext, fileContents);
  if (!contextXml) {
    return userText;
  }
  return `${contextXml}\n\n${userText}`;
}
