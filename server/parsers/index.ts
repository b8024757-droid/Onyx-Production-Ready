import { PDFParser } from './pdf-parser';
import { DocxParser } from './docx-parser';
import { PPTXParser } from './pptx-parser';
import { SpreadsheetParser } from './xlsx-parser';
import { HTMLParser } from './html-parser';
import { URLFetcher } from './url-fetcher';
import { MarkdownParser } from './markdown-parser';
import { OCRParser } from './ocr-parser';
import { DocumentType } from '../../src/types';

export interface NormalizedSection {
  heading: string;
  content: string;
  pageNumber?: number;
  slideNumber?: number;
  sheetName?: string;
}

export interface NormalizedDocument {
  title: string;
  rawText: string;
  documentType: DocumentType;
  pageCount?: number;
  slideCount?: number;
  sheetCount?: number;
  sections: NormalizedSection[];
  metadata: Record<string, any>;
}

export class DocumentParserService {
  public static async parseFile(
    filename: string,
    rawBuffer: Buffer,
    mimeType?: string
  ): Promise<NormalizedDocument> {
    let buffer = rawBuffer;
    const preview = rawBuffer.slice(0, 100).toString('utf8');
    if (preview.startsWith('data:')) {
      const fullStr = rawBuffer.toString('utf8');
      const commaIdx = fullStr.indexOf(',');
      const b64 = commaIdx !== -1 ? fullStr.slice(commaIdx + 1) : fullStr;
      buffer = Buffer.from(b64, 'base64');
    }

    const ext = filename.split('.').pop()?.toLowerCase() || '';

    // 1. PDF
    if (ext === 'pdf' || mimeType === 'application/pdf') {
      const parsed = await PDFParser.parse(buffer);
      const sections: NormalizedSection[] = parsed.pages.map(p => ({
        heading: `Page ${p.pageNumber}`,
        content: p.text,
        pageNumber: p.pageNumber,
      }));

      return {
        title: filename.replace(/\.[^/.]+$/, ''),
        rawText: parsed.text,
        documentType: 'PDF',
        pageCount: parsed.pageCount,
        sections,
        metadata: { ...parsed.info, ...parsed.metadata },
      };
    }

    // 2. DOCX
    if (ext === 'docx' || ext === 'doc' || mimeType?.includes('word')) {
      const parsed = await DocxParser.parse(buffer);
      const sections: NormalizedSection[] = parsed.sections.map(s => ({
        heading: s.heading,
        content: s.content,
      }));

      return {
        title: filename.replace(/\.[^/.]+$/, ''),
        rawText: parsed.text,
        documentType: 'DOC',
        sections,
        metadata: {},
      };
    }

    // 3. PPTX
    if (ext === 'pptx' || ext === 'ppt' || mimeType?.includes('presentation')) {
      const parsed = await PPTXParser.parse(buffer);
      const sections: NormalizedSection[] = parsed.slides.map(s => ({
        heading: s.title,
        content: s.content,
        slideNumber: s.slideNumber,
      }));

      return {
        title: filename.replace(/\.[^/.]+$/, ''),
        rawText: parsed.text,
        documentType: 'PPT',
        slideCount: parsed.slideCount,
        sections,
        metadata: {},
      };
    }

    // 4. XLSX / XLS / CSV
    if (ext === 'xlsx' || ext === 'xls' || ext === 'csv' || mimeType?.includes('spreadsheet') || mimeType === 'text/csv') {
      const parsed = SpreadsheetParser.parse(buffer);
      const sections: NormalizedSection[] = parsed.sheets.map(s => ({
        heading: s.sheetName,
        content: s.text,
        sheetName: s.sheetName,
      }));

      return {
        title: filename.replace(/\.[^/.]+$/, ''),
        rawText: parsed.text,
        documentType: ext === 'csv' ? 'CSV' : 'XLS',
        sheetCount: parsed.sheetCount,
        sections,
        metadata: {},
      };
    }

    // 5. HTML
    if (ext === 'html' || ext === 'htm' || mimeType === 'text/html') {
      const str = buffer.toString('utf-8');
      const parsed = HTMLParser.parse(str);
      const sections: NormalizedSection[] = parsed.sections.map(s => ({
        heading: s.heading,
        content: s.content,
      }));

      return {
        title: parsed.title || filename,
        rawText: parsed.text,
        documentType: 'HTML',
        sections,
        metadata: { description: parsed.description },
      };
    }

    // 6. Image / Scanned
    if (
      ext === 'png' ||
      ext === 'jpg' ||
      ext === 'jpeg' ||
      ext === 'webp' ||
      mimeType?.startsWith('image/')
    ) {
      const parsed = await OCRParser.parseImage(buffer, mimeType || `image/${ext}`);
      return {
        title: filename.replace(/\.[^/.]+$/, ''),
        rawText: parsed.text,
        documentType: 'IMAGE',
        sections: [{ heading: 'Extracted Image Content', content: parsed.text }],
        metadata: { description: parsed.description },
      };
    }

    // 7. Markdown
    if (ext === 'md' || ext === 'markdown') {
      const str = buffer.toString('utf-8');
      const parsed = MarkdownParser.parse(str);
      const sections: NormalizedSection[] = parsed.sections.map(s => ({
        heading: s.heading,
        content: s.content,
      }));

      return {
        title: parsed.title || filename.replace(/\.[^/.]+$/, ''),
        rawText: parsed.text,
        documentType: 'MD',
        sections,
        metadata: {},
      };
    }

    // 8. Plain Text Fallback (TXT, JSON, Code, etc.)
    const str = buffer.toString('utf-8');
    const paragraphs = str.split(/\n\s*\n/).filter(Boolean);
    const sections: NormalizedSection[] = paragraphs.map((p, idx) => ({
      heading: `Section ${idx + 1}`,
      content: p.trim(),
    }));

    return {
      title: filename.replace(/\.[^/.]+$/, ''),
      rawText: str.trim(),
      documentType: 'TXT',
      sections: sections.length > 0 ? sections : [{ heading: 'Text Content', content: str.trim() }],
      metadata: {},
    };
  }

  public static async parseUrl(urlString: string): Promise<NormalizedDocument> {
    const fetched = await URLFetcher.fetch(urlString);
    const sections: NormalizedSection[] = fetched.parsed.sections.map(s => ({
      heading: s.heading,
      content: s.content,
    }));

    return {
      title: fetched.title,
      rawText: fetched.content,
      documentType: 'URL',
      sections,
      metadata: {
        url: urlString,
        contentType: fetched.contentType,
        description: fetched.parsed.description,
      },
    };
  }
}
