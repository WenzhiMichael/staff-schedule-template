"use client";

import { assignmentKey, isStandardAssignment, shortDate, type ScheduleAssignment, type ShiftCode } from "../schedule-utils";

type Record = { employeeId: number; displayName: string };
type ExportData = { records: Record[]; assignments: ScheduleAssignment[]; weekStart: string; publishedAt: string | null; language: "zh" | "en" };

const encoder = new TextEncoder();

export function ScheduleExports(props: ExportData) {
  const english = props.language === "en";
  const exportJpg = () => downloadCanvas(props, "jpeg");
  const exportPdf = () => downloadPdf(props);
  const exportExcel = () => downloadExcel(props);
  return <div className="export-actions" aria-label={english ? "Export schedule" : "导出班表"}><span>{english ? "Export" : "导出"}</span><button type="button" onClick={exportPdf}>PDF</button><button type="button" onClick={exportJpg}>JPG</button><button type="button" onClick={exportExcel}>Excel</button></div>;
}

function downloadCanvas(data: ExportData, format: "jpeg") {
  const canvas = scheduleCanvas(data);
  canvas.toBlob((blob) => { if (blob) download(blob, filename(data.weekStart, "jpg")); }, `image/${format}`, 0.95);
}

function downloadPdf(data: ExportData) {
  const canvas = scheduleCanvas(data);
  const jpeg = base64Bytes(canvas.toDataURL("image/jpeg", 0.95).split(",")[1]);
  download(new Blob([pdfFromJpeg(jpeg, canvas.width, canvas.height)], { type: "application/pdf" }), filename(data.weekStart, "pdf"));
}

function scheduleCanvas(data: ExportData) {
  const cellWidth = 82;
  const nameWidth = 154;
  const headerHeight = 45;
  const shiftHeight = 34;
  const rowHeight = 47;
  const width = nameWidth + cellWidth * 14;
  const height = 56 + headerHeight + shiftHeight + rowHeight * data.records.length + 38;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale; canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Unable to create export image.");
  ctx.scale(scale, scale);
  ctx.fillStyle = "#fffdf9"; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#191716"; ctx.fillRect(0, 0, width, 56);
  ctx.fillStyle = "#fffdf9"; ctx.font = "700 20px Segoe UI, Arial, sans-serif"; ctx.fillText("Staff Schedule", 20, 33);
  ctx.fillStyle = "#d5cbc0"; ctx.font = "600 12px Segoe UI, Arial, sans-serif";
  ctx.fillText(`Weekly schedule · ${data.weekStart} · ${data.publishedAt ? "Published" : "Manager draft"}`, 20, 49);

  const top = 56;
  ctx.fillStyle = "#292522"; ctx.fillRect(0, top, width, headerHeight + shiftHeight);
  ctx.strokeStyle = "#756d65"; ctx.lineWidth = 1;
  ctx.fillStyle = "#ffffff"; ctx.font = "700 12px Segoe UI, Arial, sans-serif"; ctx.textAlign = "left"; ctx.fillText("Name", 12, top + 48);
  ctx.textAlign = "center";
  for (let day = 0; day < 7; day++) {
    const x = nameWidth + day * 2 * cellWidth;
    const date = isoDay(data.weekStart, day);
    ctx.fillStyle = "#ffffff"; ctx.font = "700 12px Segoe UI, Arial, sans-serif"; ctx.fillText(shortDate(date, "en"), x + cellWidth, top + 19);
    ctx.fillStyle = "#d5cbc0"; ctx.font = "600 10px Segoe UI, Arial, sans-serif";
    ctx.fillText(day < 5 ? "11-6" : "11:30-6", x + cellWidth / 2, top + headerHeight + 21);
    ctx.fillText("6-C", x + cellWidth * 1.5, top + headerHeight + 21);
  }
  ctx.strokeStyle = "#6e655e";
  for (let column = 0; column <= 14; column++) { const x = nameWidth + column * cellWidth; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + headerHeight + shiftHeight + rowHeight * data.records.length); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(0, top + headerHeight); ctx.lineTo(width, top + headerHeight); ctx.stroke();

  data.records.forEach((record, row) => {
    const y = top + headerHeight + shiftHeight + row * rowHeight;
    ctx.fillStyle = row % 2 ? "#f5f1ea" : "#faf6ef"; ctx.fillRect(0, y, nameWidth, rowHeight);
    ctx.fillStyle = "#2a2724"; ctx.textAlign = "left"; ctx.font = "700 13px Segoe UI, Arial, sans-serif"; ctx.fillText(record.displayName, 12, y + 29);
    for (let day = 0; day < 7; day++) {
      const date = isoDay(data.weekStart, day);
      (["early", "late"] as ShiftCode[]).forEach((shift, slot) => {
        const x = nameWidth + (day * 2 + slot) * cellWidth;
        const assignment = data.assignments.find((item) => assignmentKey(item.shiftDate, item.shiftCode, item.employeeId) === assignmentKey(date, shift, record.employeeId));
        ctx.fillStyle = assignment ? "#237a45" : "#ece9e4"; ctx.fillRect(x + 2, y + 2, cellWidth - 4, rowHeight - 4);
        if (assignment) { ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.font = "800 16px Segoe UI, Arial, sans-serif"; ctx.fillText(isStandardAssignment(assignment, day) ? "✓" : displayAssignment(assignment), x + cellWidth / 2, y + 30); }
      });
    }
    ctx.strokeStyle = "#d9d1c7"; ctx.beginPath(); ctx.moveTo(0, y + rowHeight); ctx.lineTo(width, y + rowHeight); ctx.stroke();
  });
  ctx.fillStyle = "#756d65"; ctx.textAlign = "left"; ctx.font = "600 11px Segoe UI, Arial, sans-serif"; ctx.fillText("C = 12:00 AM · Exported from Staff Schedule", 12, height - 15);
  return canvas;
}

function downloadExcel(data: ExportData) {
  const rows = data.records.map((record) => [record.displayName, ...Array.from({ length: 7 }, (_, day) => (["early", "late"] as ShiftCode[]).map((shift) => {
    const item = data.assignments.find((assignment) => assignmentKey(assignment.shiftDate, assignment.shiftCode, assignment.employeeId) === assignmentKey(isoDay(data.weekStart, day), shift, record.employeeId));
    return item ? (isStandardAssignment(item, day) ? " " : displayAssignment(item)) : "";
  })).flat()]);
  const dayHeaders = Array.from({ length: 7 }, (_, day) => imageDateLabel(isoDay(data.weekStart, day)));
  const sheet = spreadsheetXml(data, rows, dayHeaders);
  download(new Blob([zip([
    { name: "[Content_Types].xml", body: contentTypesXml }, { name: "_rels/.rels", body: rootRelsXml }, { name: "xl/workbook.xml", body: workbookXml },
    { name: "xl/_rels/workbook.xml.rels", body: workbookRelsXml }, { name: "xl/styles.xml", body: stylesXml }, { name: "xl/worksheets/sheet1.xml", body: sheet },
  ])], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename(data.weekStart, "xlsx"));
}

function spreadsheetXml(data: ExportData, rows: string[][], dayHeaders: string[]) {
  const rowXml = rows.map((row, rowIndex) => `<row r="${rowIndex + 3}" ht="24" customHeight="1">${row.map((value, column) => cell(column, rowIndex + 3, value, column === 0 ? 3 : value ? 4 : 0)).join("")}</row>`).join("");
  const dates = dayHeaders.map((value, index) => cell(1 + index * 2, 1, value, 1)).join("");
  const shifts = Array.from({ length: 7 }, (_, day) => [cell(1 + day * 2, 2, day < 5 ? "11-6" : "11:30-6", 2), cell(2 + day * 2, 2, "6-C", 2)]).flat().join("");
  const merges = dayHeaders.map((_, index) => `<mergeCell ref="${columnName(1 + index * 2)}1:${columnName(2 + index * 2)}1"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews><cols><col min="1" max="1" width="18" customWidth="1"/><col min="2" max="15" width="12" customWidth="1"/></cols><sheetData><row r="1" ht="28" customHeight="1">${cell(0, 1, "", 1)}${dates}</row><row r="2" ht="24" customHeight="1">${cell(0, 2, "", 2)}${shifts}</row>${rowXml}</sheetData><mergeCells count="${dayHeaders.length}">${merges}</mergeCells><pageMargins left="0.2" right="0.2" top="0.3" bottom="0.3" header="0" footer="0"/></worksheet>`;
}

function cell(column: number, row: number, value: string, style: number) { return `<c r="${columnName(column)}${row}" t="inlineStr" s="${style}"><is><t>${xml(value)}</t></is></c>`; }
function columnName(column: number) { return String.fromCharCode(65 + column); }
function xml(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function isoDay(weekStart: string, day: number) { const date = new Date(`${weekStart}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + day); return date.toISOString().slice(0, 10); }
function imageDateLabel(iso: string) { const date = new Date(`${iso}T12:00:00Z`); const day = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(date); return `${shortDate(iso, "en")} (${day})`; }
function displayAssignment(item: ScheduleAssignment) { return `${displayMinutes(item.startMinutes)}-${displayMinutes(item.endMinutes)}`; }
function displayMinutes(minutes: number) { if (minutes === 1440) return "C"; const hour = Math.floor(minutes / 60); return `${hour > 12 ? hour - 12 : hour}${minutes % 60 ? `:${String(minutes % 60).padStart(2, "0")}` : ""}`; }
function filename(weekStart: string, extension: string) { return `Staff-Schedule-${weekStart}.${extension}`; }
function download(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 500); }

function base64Bytes(value: string) { const binary = atob(value); return Uint8Array.from(binary, (character) => character.charCodeAt(0)); }
function pdfFromJpeg(jpeg: Uint8Array, width: number, height: number) {
  const pageWidth = 842; const pageHeight = Math.max(420, Math.round(pageWidth * height / width));
  const content = encoder.encode(`q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`);
  const chunks: Uint8Array[] = []; const offsets: number[] = [0]; let length = 0;
  const push = (value: Uint8Array) => { chunks.push(value); length += value.length; };
  const text = (value: string) => encoder.encode(value);
  push(text("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"));
  const object = (number: number, parts: Uint8Array[]) => { offsets[number] = length; push(text(`${number} 0 obj\n`)); parts.forEach(push); push(text("\nendobj\n")); };
  object(1, [text("<< /Type /Catalog /Pages 2 0 R >>")]);
  object(2, [text("<< /Type /Pages /Kids [3 0 R] /Count 1 >>")]);
  object(3, [text(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`)]);
  object(4, [text(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, text("\nendstream")]);
  object(5, [text(`<< /Length ${content.length} >>\nstream\n`), content, text("endstream")]);
  const startXref = length; push(text(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((index) => `${String(offsets[index]).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF`));
  return concat(chunks);
}

function zip(entries: Array<{ name: string; body: string }>) {
  const files = entries.map((entry) => ({ name: encoder.encode(entry.name), body: encoder.encode(entry.body) }));
  const chunks: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0;
  for (const file of files) { const crc = crc32(file.body); const header = localZipHeader(crc, file.body.length, file.name.length); chunks.push(header, file.name, file.body); central.push(centralZipHeader(crc, file.body.length, file.name.length, offset), file.name); offset += header.length + file.name.length + file.body.length; }
  const centralLength = central.reduce((total, value) => total + value.length, 0); return concat([...chunks, ...central, endZipHeader(files.length, centralLength, offset)]);
}

function localZipHeader(crc: number, size: number, nameLength: number) { const bytes = new Uint8Array(30); const view = new DataView(bytes.buffer); view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint32(14, crc, true); view.setUint32(18, size, true); view.setUint32(22, size, true); view.setUint16(26, nameLength, true); return bytes; }
function centralZipHeader(crc: number, size: number, nameLength: number, offset: number) { const bytes = new Uint8Array(46); const view = new DataView(bytes.buffer); view.setUint32(0, 0x02014b50, true); view.setUint16(4, 20, true); view.setUint16(6, 20, true); view.setUint32(16, crc, true); view.setUint32(20, size, true); view.setUint32(24, size, true); view.setUint16(28, nameLength, true); view.setUint32(42, offset, true); return bytes; }
function endZipHeader(count: number, centralSize: number, centralOffset: number) { const bytes = new Uint8Array(22); const view = new DataView(bytes.buffer); view.setUint32(0, 0x06054b50, true); view.setUint16(8, count, true); view.setUint16(10, count, true); view.setUint32(12, centralSize, true); view.setUint32(16, centralOffset, true); return bytes; }
function crc32(bytes: Uint8Array) { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; }
function concat(chunks: Uint8Array[]) { const output = new Uint8Array(chunks.reduce((total, value) => total + value.length, 0)); let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; } return output; }

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Schedule" sheetId="1" r:id="rId1"/></sheets></workbook>`;
const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2E2E2"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF178B15"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/></border><border><left style="thin"><color rgb="FF222222"/></left><right style="thin"><color rgb="FF222222"/></right><top style="thin"><color rgb="FF222222"/></top><bottom style="thin"><color rgb="FF222222"/></bottom></border></borders><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="1" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="1" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="1" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="3" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs></styleSheet>`;
