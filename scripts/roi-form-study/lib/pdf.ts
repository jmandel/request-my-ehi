import { statSync } from "fs";
import { studyDir } from "./store";

export interface PdfMetadata {
  filename: string;
  file_size_bytes: number;
  page_count: number;
  has_text_layer: boolean;
  text_preview: string;
  full_text: string;
  full_text_chars: number;
  fillable_field_count: number;
  fillable_field_names: string[];
  font_count: number;
  embedded_image_count: number;
  is_image_only_scan: boolean;
}

async function run(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}

export async function extractPdfMetadata(
  pdfPath: string
): Promise<PdfMetadata> {
  const filename = pdfPath.split("/").pop()!;
  const fileSize = statSync(pdfPath).size;

  // Page count
  const pdfInfo = await run(["pdfinfo", pdfPath]).catch(() => "");
  const pageMatch = pdfInfo.match(/Pages:\s+(\d+)/);
  const pageCount = pageMatch ? parseInt(pageMatch[1]) : 0;

  // Text extraction
  const fullText = await run(["pdftotext", pdfPath, "-"]).catch(() => "");
  const hasTextLayer = fullText.trim().length > 0;

  // Fonts
  const fontsOut = await run(["pdffonts", pdfPath]).catch(() => "");
  const fontLines = fontsOut
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("name") && !l.startsWith("---"));

  // Images
  const imagesOut = await run(["pdfimages", "-list", pdfPath]).catch(() => "");
  const imageLines = imagesOut.split("\n").filter((l) => /^\s*\d/.test(l));

  // Fillable fields via our script
  const scriptPath = studyDir("..", "list-form-fields.ts");
  const fieldsOut = await run(["bun", scriptPath, pdfPath]).catch(() => "");
  const fieldCountMatch = fieldsOut.match(/Total:\s+(\d+)/);
  const fillableFieldCount = fieldCountMatch
    ? parseInt(fieldCountMatch[1])
    : 0;
  const fieldNames = [...fieldsOut.matchAll(/^\s+\d+\.\s+(\S+)/gm)].map(
    (m) => m[1]
  );

  return {
    filename,
    file_size_bytes: fileSize,
    page_count: pageCount,
    has_text_layer: hasTextLayer,
    text_preview: fullText.slice(0, 500),
    full_text: fullText,
    full_text_chars: fullText.length,
    fillable_field_count: fillableFieldCount,
    fillable_field_names: fieldNames,
    font_count: fontLines.length,
    embedded_image_count: imageLines.length,
    is_image_only_scan: !hasTextLayer && imageLines.length > 0,
  };
}
