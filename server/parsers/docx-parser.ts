import mammoth from 'mammoth';

export interface ParsedDocxResult {
  text: string;
  html?: string;
  sections: Array<{
    heading: string;
    content: string;
  }>;
}

export class DocxParser {
  public static async parse(buffer: Buffer): Promise<ParsedDocxResult> {
    try {
      let cleanBuffer = buffer;
      const preview = buffer.slice(0, 100).toString('utf8');
      if (preview.startsWith('data:')) {
        const str = buffer.toString('utf8');
        const commaIdx = str.indexOf(',');
        const b64 = commaIdx !== -1 ? str.slice(commaIdx + 1) : str;
        cleanBuffer = Buffer.from(b64.trim(), 'base64');
      }

      const textResult = await mammoth.extractRawText({ buffer: cleanBuffer });
      const htmlResult = await mammoth.convertToHtml({ buffer: cleanBuffer });

      const rawText = textResult.value || '';
      const html = htmlResult.value || '';

      // Extract sections based on common heading patterns
      const paragraphs = rawText.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
      const sections: Array<{ heading: string; content: string }> = [];

      let currentHeading = 'Overview';
      let currentContent: string[] = [];

      for (const p of paragraphs) {
        // If line is short and looks like a heading
        if (p.length < 80 && !p.endsWith('.') && (p.toUpperCase() === p || /^[0-9]+(\.[0-9]+)*\s+[A-Z]/.test(p))) {
          if (currentContent.length > 0) {
            sections.push({
              heading: currentHeading,
              content: currentContent.join('\n\n'),
            });
            currentContent = [];
          }
          currentHeading = p;
        } else {
          currentContent.push(p);
        }
      }

      if (currentContent.length > 0) {
        sections.push({
          heading: currentHeading,
          content: currentContent.join('\n\n'),
        });
      }

      return {
        text: rawText.trim(),
        html,
        sections: sections.length > 0 ? sections : [{ heading: 'Content', content: rawText.trim() }],
      };
    } catch (err: any) {
      throw new Error(`Failed to parse DOCX: ${err.message || err}`);
    }
  }
}
