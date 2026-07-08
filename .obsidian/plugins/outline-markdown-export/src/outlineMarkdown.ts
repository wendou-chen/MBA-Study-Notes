export interface OutlineHeading {
  heading: string;
  level: number;
}

export interface PdfBookmarkTarget extends OutlineHeading {
  pageIndex: number;
  top?: number;
}

export function buildOutlineMarkdown(headings: OutlineHeading[], sourceName?: string): string {
  const validHeadings = headings.filter((heading) => heading.heading.trim().length > 0);
  if (validHeadings.length === 0) {
    return "";
  }

  const minLevel = Math.min(...validHeadings.map((heading) => clampHeadingLevel(heading.level)));
  const lines = validHeadings.map((heading) => {
    const level = clampHeadingLevel(heading.level);
    const indent = "  ".repeat(Math.max(0, level - minLevel));
    return `${indent}- ${heading.heading.trim()}`;
  });

  if (!sourceName) {
    return lines.join("\n");
  }

  return [`# ${sourceName} 大纲`, "", ...lines].join("\n");
}

export function getOutlineExportPath(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const slashIndex = normalizedPath.lastIndexOf("/");
  const folder = slashIndex >= 0 ? normalizedPath.slice(0, slashIndex + 1) : "";
  const fileName = slashIndex >= 0 ? normalizedPath.slice(slashIndex + 1) : normalizedPath;
  const basename = fileName.endsWith(".md") ? fileName.slice(0, -3) : fileName;
  return `${folder}${basename}.outline.md`;
}

export function getBookmarkedPdfExportPath(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const slashIndex = normalizedPath.lastIndexOf("/");
  const folder = slashIndex >= 0 ? normalizedPath.slice(0, slashIndex + 1) : "";
  const fileName = slashIndex >= 0 ? normalizedPath.slice(slashIndex + 1) : normalizedPath;
  const basename = fileName.replace(/\.(md|pdf)$/i, "");
  return `${folder}${basename}.bookmarked.pdf`;
}

export function getPdfBookmarkHeadings(headings: OutlineHeading[]): OutlineHeading[] {
  return headings
    .map((heading) => ({
      heading: heading.heading.trim(),
      level: clampHeadingLevel(heading.level),
    }))
    .filter((heading) => (
      heading.heading.length > 0
      && heading.level <= 3
      && !isPdfTocHeadingTitle(heading.heading)
    ));
}

export function getPrintableBookmarkedPdfMarkdown(markdown: string, sourceName: string): string {
  if (!needsSyntheticPdfRootHeading(parseMarkdownHeadings(markdown))) {
    return markdown;
  }

  const rootHeading = `# ${sourceName.trim() || "Untitled"}`;
  const frontmatterEndIndex = getFrontmatterEndIndex(markdown);
  if (frontmatterEndIndex === null) {
    // A malformed/unclosed frontmatter block would end up below the injected
    // heading and leak into the rendered PDF body, so skip injection then.
    if (/^---\r?\n/.test(markdown)) {
      return markdown;
    }
    return [rootHeading, "", markdown].join("\n");
  }

  const frontmatter = markdown.slice(0, frontmatterEndIndex);
  const body = markdown.slice(frontmatterEndIndex).replace(/^\r?\n/, "");
  return [frontmatter.replace(/\s+$/, ""), "", rootHeading, "", body].join("\n");
}

export function hasPdfOutlines(pdfData: ArrayBuffer | Uint8Array): boolean {
  const bytes = pdfData instanceof Uint8Array ? pdfData : new Uint8Array(pdfData);
  const outlineMarker = "/Outlines";

  for (let index = 0; index <= bytes.length - outlineMarker.length; index += 1) {
    let matched = true;
    for (let markerIndex = 0; markerIndex < outlineMarker.length; markerIndex += 1) {
      if (bytes[index + markerIndex] !== outlineMarker.charCodeAt(markerIndex)) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return true;
    }
  }

  return false;
}

export function needsSyntheticPdfRootHeading(headings: OutlineHeading[]): boolean {
  return !getPdfBookmarkHeadings(headings).some((heading) => heading.level === 1);
}

export function mapPdfBookmarkHeadingsToPages(
  headings: OutlineHeading[],
  pageTexts: string[],
): PdfBookmarkTarget[] {
  const normalizedPages = pageTexts.map((text) => normalizeSearchText(text));
  const targets: PdfBookmarkTarget[] = [];

  // Headings appear in reading order, so matching scans forward from the last
  // hit (page + in-page offset). This keeps repeated heading texts ("例题",
  // "小结", ...) from all collapsing onto their first occurrence page.
  let cursorPage = 0;
  let cursorOffset = 0;

  for (const heading of getPdfBookmarkHeadings(headings)) {
    const normalizedHeading = normalizeSearchText(heading.heading);
    if (!normalizedHeading) {
      continue;
    }

    let pageIndex = cursorPage;
    let searchOffset = cursorOffset;
    let matchedPage = -1;
    let matchedOffset = -1;

    while (pageIndex < normalizedPages.length) {
      const position = normalizedPages[pageIndex].indexOf(normalizedHeading, searchOffset);
      if (position >= 0) {
        matchedPage = pageIndex;
        matchedOffset = position;
        break;
      }
      pageIndex += 1;
      searchOffset = 0;
    }

    if (matchedPage < 0) {
      continue;
    }

    targets.push({
      ...heading,
      pageIndex: matchedPage,
    });
    cursorPage = matchedPage;
    cursorOffset = matchedOffset + normalizedHeading.length;
  }

  return targets;
}

export function parseMarkdownHeadings(markdown: string): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  let inFence = false;
  let fenceMarker = "";

  for (const line of markdown.split(/\r?\n/)) {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = "";
      }
      continue;
    }

    if (inFence) {
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!headingMatch) {
      continue;
    }

    headings.push({
      heading: headingMatch[2].trim(),
      level: headingMatch[1].length,
    });
  }

  return headings;
}

function clampHeadingLevel(level: number): number {
  if (!Number.isFinite(level)) {
    return 1;
  }
  return Math.min(6, Math.max(1, Math.floor(level)));
}

export function isPdfTocHeadingTitle(heading: string): boolean {
  const normalized = heading.trim().toLowerCase();
  return normalized === "目录" || normalized === "table of contents";
}

function getFrontmatterEndIndex(markdown: string): number | null {
  if (!markdown.startsWith("---\n") && !markdown.startsWith("---\r\n")) {
    return null;
  }

  const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  return match ? match[0].length : null;
}

function normalizeSearchText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "");
}
