import {
  PDFArray,
  PDFContext,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRef,
  PDFString,
} from "pdf-lib";

import type { PdfBookmarkTarget } from "./outlineMarkdown";

export const PDF_PRINT_ANCHOR_URI_PREFIX = "af://";

export interface PdfAnchorTarget {
  key: string;
  heading: string;
  level: number;
}

export interface FinalizeBookmarkedPdfResult {
  bytes: Uint8Array;
  matchedCount: number;
}

interface AnchorPosition {
  pageIndex: number;
  top?: number;
}

interface BookmarkNode {
  target: PdfBookmarkTarget;
  children: BookmarkNode[];
}

interface OutlineWriteResult {
  first: PDFRef | null;
  last: PDFRef | null;
  count: number;
}

export async function addPdfBookmarks(
  pdfData: ArrayBuffer | Uint8Array,
  targets: PdfBookmarkTarget[],
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfData);
  writePdfBookmarks(pdfDoc, targets);
  return pdfDoc.save({ useObjectStreams: false });
}

export async function finalizeBookmarkedPdf(
  pdfData: ArrayBuffer | Uint8Array,
  anchors: PdfAnchorTarget[],
): Promise<FinalizeBookmarkedPdfResult> {
  const pdfDoc = await PDFDocument.load(pdfData);
  const positions = collectAndRemoveAnchorAnnotations(pdfDoc);

  const targets: PdfBookmarkTarget[] = [];
  for (const anchor of anchors) {
    const position = positions.get(anchor.key);
    if (!position) {
      continue;
    }
    targets.push({
      heading: anchor.heading,
      level: anchor.level,
      pageIndex: position.pageIndex,
      top: position.top,
    });
  }

  writePdfBookmarks(pdfDoc, targets);

  return {
    bytes: await pdfDoc.save({ useObjectStreams: false }),
    matchedCount: targets.length,
  };
}

function writePdfBookmarks(pdfDoc: PDFDocument, targets: PdfBookmarkTarget[]): void {
  const pages = pdfDoc.getPages();
  const validTargets = targets.filter((target) => (
    Number.isInteger(target.pageIndex)
    && target.pageIndex >= 0
    && target.pageIndex < pages.length
    && target.heading.trim().length > 0
  ));

  if (validTargets.length === 0) {
    return;
  }

  const tree = buildBookmarkTree(validTargets);
  const context = pdfDoc.context;
  const outlinesDict = context.obj({
    Type: "Outlines",
    Count: 0,
  });
  const outlinesRef = context.register(outlinesDict);
  const result = writeOutlineLevel(pdfDoc, tree, outlinesRef);

  if (result.first && result.last) {
    outlinesDict.set(PDFName.of("First"), result.first);
    outlinesDict.set(PDFName.of("Last"), result.last);
    outlinesDict.set(PDFName.of("Count"), PDFNumber.of(result.count));
  }

  pdfDoc.catalog.set(PDFName.of("Outlines"), outlinesRef);
  pdfDoc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
}

function collectAndRemoveAnchorAnnotations(pdfDoc: PDFDocument): Map<string, AnchorPosition> {
  const positions = new Map<string, AnchorPosition>();
  const context = pdfDoc.context;

  pdfDoc.getPages().forEach((page, pageIndex) => {
    const annots = page.node.Annots();
    if (!annots) {
      return;
    }

    const kept: PDFObject[] = [];
    for (let index = 0; index < annots.size(); index += 1) {
      const element = annots.get(index);
      const annotDict = resolveDict(context, element);
      const key = annotDict ? getAnchorKey(context, annotDict) : null;

      if (!key) {
        kept.push(element);
        continue;
      }

      if (!positions.has(key)) {
        positions.set(key, {
          pageIndex,
          top: annotDict ? getAnnotationTop(context, annotDict) : undefined,
        });
      }
      if (element instanceof PDFRef) {
        context.delete(element);
      }
    }

    if (kept.length === annots.size()) {
      return;
    }
    if (kept.length === 0) {
      page.node.delete(PDFName.of("Annots"));
    } else {
      page.node.set(PDFName.of("Annots"), context.obj(kept));
    }
  });

  return positions;
}

function getAnchorKey(context: PDFContext, annotDict: PDFDict): string | null {
  const actionDict = resolveDict(context, annotDict.get(PDFName.of("A")));
  if (!actionDict) {
    return null;
  }

  const uri = resolveObject(context, actionDict.get(PDFName.of("URI")));
  const raw = uri instanceof PDFString
    ? uri.asString()
    : uri instanceof PDFHexString
      ? uri.decodeText()
      : null;

  if (!raw || !raw.startsWith(PDF_PRINT_ANCHOR_URI_PREFIX)) {
    return null;
  }

  return raw.slice(PDF_PRINT_ANCHOR_URI_PREFIX.length);
}

function getAnnotationTop(context: PDFContext, annotDict: PDFDict): number | undefined {
  const rect = resolveObject(context, annotDict.get(PDFName.of("Rect")));
  if (!(rect instanceof PDFArray) || rect.size() !== 4) {
    return undefined;
  }

  const y1 = toNumber(resolveObject(context, rect.get(1)));
  const y2 = toNumber(resolveObject(context, rect.get(3)));
  if (y1 === undefined && y2 === undefined) {
    return undefined;
  }

  return Math.max(y1 ?? -Infinity, y2 ?? -Infinity);
}

function toNumber(value: PDFObject | undefined): number | undefined {
  return value instanceof PDFNumber ? value.asNumber() : undefined;
}

function resolveDict(context: PDFContext, value: PDFObject | undefined): PDFDict | null {
  if (value instanceof PDFRef) {
    return context.lookupMaybe(value, PDFDict) ?? null;
  }
  return value instanceof PDFDict ? value : null;
}

function resolveObject(context: PDFContext, value: PDFObject | undefined): PDFObject | undefined {
  if (value instanceof PDFRef) {
    return context.lookup(value);
  }
  return value;
}

function buildBookmarkTree(targets: PdfBookmarkTarget[]): BookmarkNode[] {
  const roots: BookmarkNode[] = [];
  const stack: BookmarkNode[] = [];

  for (const target of targets) {
    const node: BookmarkNode = {
      target,
      children: [],
    };

    while (stack.length > 0 && stack[stack.length - 1].target.level >= target.level) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }

    stack.push(node);
  }

  return roots;
}

function writeOutlineLevel(
  pdfDoc: PDFDocument,
  nodes: BookmarkNode[],
  parentRef: PDFRef,
): OutlineWriteResult {
  if (nodes.length === 0) {
    return { first: null, last: null, count: 0 };
  }

  const context = pdfDoc.context;
  const pages = pdfDoc.getPages();
  const itemRefs = nodes.map(() => context.register(context.obj({})));
  let count = 0;

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const itemRef = itemRefs[index];
    const itemDict = context.lookup(itemRef, PDFDict);
    const page = pages[node.target.pageIndex];

    itemDict.set(PDFName.of("Title"), PDFHexString.fromText(node.target.heading));
    itemDict.set(PDFName.of("Parent"), parentRef);
    itemDict.set(PDFName.of("Dest"), buildDestination(context, page, node.target.top));

    if (index > 0) {
      itemDict.set(PDFName.of("Prev"), itemRefs[index - 1]);
    }
    if (index < nodes.length - 1) {
      itemDict.set(PDFName.of("Next"), itemRefs[index + 1]);
    }

    const childResult = writeOutlineLevel(pdfDoc, node.children, itemRef);
    if (childResult.first && childResult.last) {
      itemDict.set(PDFName.of("First"), childResult.first);
      itemDict.set(PDFName.of("Last"), childResult.last);
      itemDict.set(PDFName.of("Count"), PDFNumber.of(childResult.count));
    }

    count += 1 + childResult.count;
  }

  return {
    first: itemRefs[0],
    last: itemRefs[itemRefs.length - 1],
    count,
  };
}

function buildDestination(
  context: PDFContext,
  page: ReturnType<PDFDocument["getPages"]>[number],
  top: number | undefined,
): PDFObject {
  if (typeof top !== "number" || !Number.isFinite(top)) {
    return context.obj([page.ref, PDFName.of("Fit")]);
  }

  const clampedTop = Math.min(top + 12, page.getSize().height);
  return context.obj([page.ref, PDFName.of("XYZ"), null, PDFNumber.of(clampedTop), null]);
}
