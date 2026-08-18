import { PDFParse } from 'pdf-parse';

export interface ParsedPage {
  pageNumber: number;
  text: string;
}

export interface ParsedPDFResult {
  text: string;
  pageCount: number;
  pages: ParsedPage[];
  info?: any;
  metadata?: any;
}

export class PDFParser {
  public static async parse(buffer: Buffer): Promise<ParsedPDFResult> {
    try {
      let cleanBuffer = buffer;
      const preview = buffer.slice(0, 100).toString('utf8');
      if (preview.startsWith('data:')) {
        const str = buffer.toString('utf8');
        const commaIdx = str.indexOf(',');
        const b64 = commaIdx !== -1 ? str.slice(commaIdx + 1) : str;
        cleanBuffer = Buffer.from(b64.trim(), 'base64');
      } else if (!cleanBuffer.slice(0, 5).toString('ascii').startsWith('%PDF')) {
        const textPreview = cleanBuffer.toString('utf8').trim();
        if (textPreview.startsWith('JVBERi0') || /^[A-Za-z0-9+/=]{50,}$/.test(textPreview.slice(0, 100))) {
          try {
            const decoded = Buffer.from(textPreview, 'base64');
            if (decoded.slice(0, 5).toString('ascii').startsWith('%PDF')) {
              cleanBuffer = decoded;
            }
          } catch {
            // Keep original cleanBuffer
          }
        }
      }

      const parser = new PDFParse({ data: cleanBuffer });
      const textResult = await parser.getText();
      const infoResult: any = await parser.getInfo().catch(() => ({}));

      const rawText = textResult?.text || '';
      const pagesData = textResult?.pages || [];
      const pageCount = textResult?.total || pagesData.length || 1;

      const pages: ParsedPage[] = [];
      if (Array.isArray(pagesData) && pagesData.length > 0) {
        pagesData.forEach((p: any, idx: number) => {
          pages.push({
            pageNumber: p.num || idx + 1,
            text: (p.text || '').trim(),
          });
        });
      } else {
        pages.push({
          pageNumber: 1,
          text: rawText.trim(),
        });
      }

      return {
        text: rawText.trim(),
        pageCount,
        pages,
        info: infoResult?.info,
        metadata: infoResult?.metadata,
      };
    } catch (err: any) {
      throw new Error(`Failed to parse PDF: ${err.message || err}`);
    }
  }
}
