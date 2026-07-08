import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const rootDir = path.resolve(import.meta.dirname, "..");
const tempDir = await mkdtemp(path.join(tmpdir(), "outline-markdown-export-test-"));

try {
  const bundlePath = path.join(tempDir, "outlineMarkdown.mjs");
  const pdfBundlePath = path.join(tempDir, "pdfOutline.mjs");
  await build({
    entryPoints: [path.join(rootDir, "src/outlineMarkdown.ts")],
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    write: true,
    logLevel: "silent",
  });
  await build({
    entryPoints: [path.join(rootDir, "src/pdfOutline.ts")],
    outfile: pdfBundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    write: true,
    logLevel: "silent",
  });

  const {
    buildOutlineMarkdown,
    getBookmarkedPdfExportPath,
    getOutlineExportPath,
    getPdfBookmarkHeadings,
    getPrintableBookmarkedPdfMarkdown,
    hasPdfOutlines,
    mapPdfBookmarkHeadingsToPages,
    needsSyntheticPdfRootHeading,
    parseMarkdownHeadings,
  } = await import(pathToFileURL(bundlePath).href);
  const { PDFDocument, PDFName, PDFString } = await import("pdf-lib");
  const { addPdfBookmarks, finalizeBookmarkedPdf } = await import(pathToFileURL(pdfBundlePath).href);

  assert.equal(
    buildOutlineMarkdown(
      [
        { heading: "Probability", level: 2 },
        { heading: "Random variables", level: 3 },
        { heading: "Joint distribution", level: 4 },
        { heading: "Marginal distribution", level: 4 },
      ],
      "Chapter 3",
    ),
    [
      "# Chapter 3 大纲",
      "",
      "- Probability",
      "  - Random variables",
      "    - Joint distribution",
      "    - Marginal distribution",
    ].join("\n"),
  );

  assert.equal(
    buildOutlineMarkdown([
      { heading: "Starts at H3", level: 3 },
      { heading: "H4 child", level: 4 },
    ]),
    ["- Starts at H3", "  - H4 child"].join("\n"),
  );

  assert.equal(
    getOutlineExportPath("math/probability/chapter-3.md"),
    "math/probability/chapter-3.outline.md",
  );

  assert.equal(
    getBookmarkedPdfExportPath("a/b.md"),
    "a/b.bookmarked.pdf",
  );

  assert.equal(
    getBookmarkedPdfExportPath("a/b.pdf"),
    "a/b.bookmarked.pdf",
  );

  assert.deepEqual(
    getPdfBookmarkHeadings([
      { heading: "Document", level: 1 },
      { heading: "目录", level: 2 },
      { heading: "Table of Contents", level: 2 },
      { heading: "Section", level: 2 },
      { heading: "Detail", level: 3 },
      { heading: "Too deep", level: 4 },
      { heading: "   ", level: 2 },
    ]),
    [
      { heading: "Document", level: 1 },
      { heading: "Section", level: 2 },
      { heading: "Detail", level: 3 },
    ],
  );

  assert.equal(needsSyntheticPdfRootHeading([{ heading: "Section", level: 2 }]), true);
  assert.equal(needsSyntheticPdfRootHeading([{ heading: "Document", level: 1 }]), false);

  assert.equal(
    getPrintableBookmarkedPdfMarkdown("## Section\n\nBody", "Source Note"),
    "# Source Note\n\n## Section\n\nBody",
  );

  assert.equal(
    getPrintableBookmarkedPdfMarkdown(
      ["---", "cssclasses: export", "---", "", "## Section"].join("\n"),
      "Source Note",
    ),
    ["---", "cssclasses: export", "---", "", "# Source Note", "", "## Section"].join("\n"),
  );

  assert.equal(
    getPrintableBookmarkedPdfMarkdown("# Existing root\n\n## Section", "Source Note"),
    "# Existing root\n\n## Section",
  );

  assert.deepEqual(
    mapPdfBookmarkHeadingsToPages(
      [
        { heading: "Document", level: 1 },
        { heading: "Section", level: 2 },
        { heading: "Missing", level: 2 },
        { heading: "Detail", level: 3 },
      ],
      ["Document intro", "Section body with Detail"],
    ),
    [
      { heading: "Document", level: 1, pageIndex: 0 },
      { heading: "Section", level: 2, pageIndex: 1 },
      { heading: "Detail", level: 3, pageIndex: 1 },
    ],
  );

  assert.deepEqual(
    mapPdfBookmarkHeadingsToPages(
      [
        { heading: "例题", level: 2 },
        { heading: "例题", level: 2 },
        { heading: "例题", level: 2 },
      ],
      ["intro 例题 first", "body 例题 second", "tail 例题 third"],
    ),
    [
      { heading: "例题", level: 2, pageIndex: 0 },
      { heading: "例题", level: 2, pageIndex: 1 },
      { heading: "例题", level: 2, pageIndex: 2 },
    ],
  );

  assert.deepEqual(
    mapPdfBookmarkHeadingsToPages(
      [
        { heading: "A", level: 2 },
        { heading: "ZZZ", level: 2 },
        { heading: "A", level: 2 },
      ],
      ["A first", "A second"],
    ),
    [
      { heading: "A", level: 2, pageIndex: 0 },
      { heading: "A", level: 2, pageIndex: 1 },
    ],
  );

  assert.equal(
    getPrintableBookmarkedPdfMarkdown(
      ["---", "unclosed frontmatter", "", "## Section"].join("\n"),
      "Source Note",
    ),
    ["---", "unclosed frontmatter", "", "## Section"].join("\n"),
  );

  assert.deepEqual(parseMarkdownHeadings(["# Title", "", "### H3", "#### H4"].join("\n")), [
    { heading: "Title", level: 1 },
    { heading: "H3", level: 3 },
    { heading: "H4", level: 4 },
  ]);

  assert.deepEqual(
    parseMarkdownHeadings(["```", "### Fake heading", "```", "## Real heading"].join("\n")),
    [{ heading: "Real heading", level: 2 }],
  );

  const sourcePdf = await PDFDocument.create();
  sourcePdf.addPage();
  sourcePdf.addPage();
  const sourcePdfBytes = await sourcePdf.save({ useObjectStreams: false });
  const bookmarkedPdfBytes = await addPdfBookmarks(sourcePdfBytes, [
    { heading: "Document", level: 1, pageIndex: 0 },
    { heading: "Section", level: 2, pageIndex: 1 },
  ]);
  const bookmarkedPdfText = Buffer.from(bookmarkedPdfBytes).toString("latin1");
  assert.match(bookmarkedPdfText, /\/Outlines/);
  assert.match(bookmarkedPdfText, /Document|0044006F00630075006D0065006E0074/);
  assert.match(bookmarkedPdfText, /Section|00530065006300740069006F006E/);
  assert.equal(hasPdfOutlines(bookmarkedPdfBytes), true);
  assert.equal(hasPdfOutlines(sourcePdfBytes), false);

  const anchorPdf = await PDFDocument.create();
  const anchorPage0 = anchorPdf.addPage();
  const anchorPage1 = anchorPdf.addPage();
  const anchorContext = anchorPdf.context;
  const addAnchorAnnotation = (page, key, top) => {
    const annotation = anchorContext.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [50, top - 2, 52, top],
      Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(`af://${key}`) },
    });
    const annotationRef = anchorContext.register(annotation);
    page.node.set(PDFName.of("Annots"), anchorContext.obj([annotationRef]));
  };
  addAnchorAnnotation(anchorPage0, "omx-0", 700);
  addAnchorAnnotation(anchorPage1, "omx-1", 650);
  const anchorPdfBytes = await anchorPdf.save({ useObjectStreams: false });

  const finalized = await finalizeBookmarkedPdf(anchorPdfBytes, [
    { key: "omx-0", heading: "第一章", level: 1 },
    { key: "omx-1", heading: "第一节", level: 2 },
    { key: "omx-missing", heading: "Ghost", level: 2 },
  ]);
  assert.equal(finalized.matchedCount, 2);
  assert.equal(hasPdfOutlines(finalized.bytes), true);
  const finalizedText = Buffer.from(finalized.bytes).toString("latin1");
  assert.match(finalizedText, /\/XYZ/);
  assert.ok(!finalizedText.includes("af://"), "anchor annotations should be removed");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
