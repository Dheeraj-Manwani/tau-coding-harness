import { describe, expect, test } from "bun:test";

import {
  isLocallyParsable,
  parseDocumentLocally,
  DOCX_MIME,
  DOC_MIME,
  PDF_MIME,
} from "./documentParsers";

/**
 * These build real files rather than mocking the libraries. A mock would prove
 * we call `unpdf`, not that a PDF actually comes back as text — and the whole
 * point of parsing locally is that it genuinely works on real bytes.
 */

/** A minimal but valid PDF carrying a text layer. */
function buildPdf(body: string): Uint8Array {
  const objs: string[] = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  objs[3] =
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>";
  const stream = `BT /F1 18 Tf 72 720 Td (${body}) Tj ET`;
  objs[4] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  objs[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) {
    out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

/** A real DOCX: a zip of OOXML parts. */
async function buildDocx(paragraphs: string[]): Promise<Uint8Array> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip
    .folder("_rels")!
    .file(
      ".rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`)
    .join("");
  zip
    .folder("word")!
    .file(
      "document.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    );
  return zip.generateAsync({ type: "uint8array" });
}

describe("isLocallyParsable", () => {
  test("claims exactly PDF and DOCX", () => {
    expect(isLocallyParsable(PDF_MIME)).toBe(true);
    expect(isLocallyParsable(DOCX_MIME)).toBe(true);
  });

  test("does NOT claim the formats we route to Kimi on purpose", () => {
    // SheetJS (the obvious xlsx library) is abandoned with unfixed ReDoS and
    // prototype-pollution advisories, both triggered by a crafted file. Legacy
    // .doc is binary and mammoth only reads OOXML.
    expect(isLocallyParsable("application/vnd.ms-excel")).toBe(false);
    expect(
      isLocallyParsable(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe(false);
    expect(isLocallyParsable(DOC_MIME)).toBe(false);
  });
});

describe("parseDocumentLocally", () => {
  test("reads the text layer out of a real PDF", async () => {
    const pdf = buildPdf("Invoice 4471 total 250 USD due on the 30th.");
    const res = await parseDocumentLocally(pdf, PDF_MIME);
    expect(res?.usable).toBe(true);
    expect(res?.text).toContain("Invoice 4471");
  });

  test("reads paragraphs out of a real DOCX", async () => {
    const docx = await buildDocx([
      "Quarterly Report",
      "Revenue grew by 12 percent this quarter.",
    ]);
    const res = await parseDocumentLocally(docx, DOCX_MIME);
    expect(res?.usable).toBe(true);
    expect(res?.text).toContain("Quarterly Report");
    expect(res?.text).toContain("Revenue grew by 12 percent");
  });

  // The fallback trigger: a scan is images of paper with no text layer, so a
  // local parse yields nothing and the caller must hand off to Kimi.
  test("a PDF with no text layer reports unusable rather than empty-success", async () => {
    const res = await parseDocumentLocally(buildPdf(" "), PDF_MIME);
    expect(res).not.toBeNull();
    expect(res?.usable).toBe(false);
  });

  // pdf.js TRANSFERS the array it's given, detaching the caller's buffer to
  // zero length. That silently broke the Kimi fallback: after an empty local
  // parse we'd upload 0 bytes and get back "File size is zero" — on files that
  // were 10MB. The parser must not consume its input.
  test("does not detach the caller's buffer (PDF)", async () => {
    const pdf = buildPdf("Some real text so the parse succeeds.");
    const before = pdf.byteLength;
    expect(before).toBeGreaterThan(0);
    await parseDocumentLocally(pdf, PDF_MIME);
    expect(pdf.byteLength).toBe(before);
  });

  test("does not detach the caller's buffer when the parse finds nothing", async () => {
    // The case that matters most — this is precisely when we need to fall back.
    const blank = buildPdf(" ");
    const before = blank.byteLength;
    const res = await parseDocumentLocally(blank, PDF_MIME);
    expect(res?.usable).toBe(false);
    expect(blank.byteLength).toBe(before);
  });

  test("does not detach the caller's buffer (DOCX)", async () => {
    const docx = await buildDocx(["Some text"]);
    const before = docx.byteLength;
    await parseDocumentLocally(docx, DOCX_MIME);
    expect(docx.byteLength).toBe(before);
  });

  test("returns null for formats that aren't ours, so the caller can route on", async () => {
    const res = await parseDocumentLocally(new Uint8Array([1, 2, 3]), DOC_MIME);
    expect(res).toBeNull();
  });

  // A library throwing on a malformed upload must be a fallback trigger, not a
  // 500 — the user's message should still send.
  test("garbage bytes degrade to unusable instead of throwing", async () => {
    const junk = new TextEncoder().encode("this is definitely not a pdf");
    const res = await parseDocumentLocally(junk, PDF_MIME);
    expect(res?.usable).toBe(false);
  });
});
