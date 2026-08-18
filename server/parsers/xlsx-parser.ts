import * as XLSX from 'xlsx';

export interface ParsedSheet {
  sheetName: string;
  rowCount: number;
  columnCount: number;
  headers: string[];
  text: string;
  data: any[];
}

export interface ParsedSpreadsheetResult {
  text: string;
  sheetCount: number;
  sheets: ParsedSheet[];
}

export class SpreadsheetParser {
  public static parse(buffer: Buffer): ParsedSpreadsheetResult {
    try {
      let cleanBuffer = buffer;
      const preview = buffer.slice(0, 100).toString('utf8');
      if (preview.startsWith('data:')) {
        const str = buffer.toString('utf8');
        const commaIdx = str.indexOf(',');
        const b64 = commaIdx !== -1 ? str.slice(commaIdx + 1) : str;
        cleanBuffer = Buffer.from(b64.trim(), 'base64');
      }

      const workbook = XLSX.read(cleanBuffer, { type: 'buffer' });
      const sheets: ParsedSheet[] = [];
      const textParts: string[] = [];

      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) continue;

        const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        const csvText = XLSX.utils.sheet_to_csv(worksheet);

        const headers = Array.isArray(jsonData[0]) ? (jsonData[0] as string[]).map(String) : [];
        const rowCount = jsonData.length;
        const columnCount = headers.length;

        const sheetText = `[Sheet: ${sheetName}]\nHeaders: ${headers.join(', ')}\n\n${csvText}`;
        textParts.push(sheetText);

        sheets.push({
          sheetName,
          rowCount,
          columnCount,
          headers,
          text: sheetText,
          data: jsonData,
        });
      }

      const fullText = textParts.join('\n\n---\n\n');

      return {
        text: fullText,
        sheetCount: sheets.length,
        sheets,
      };
    } catch (err: any) {
      throw new Error(`Failed to parse Spreadsheet: ${err.message || err}`);
    }
  }
}
