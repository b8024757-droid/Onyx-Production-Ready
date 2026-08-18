export interface ParsedSlide {
  slideNumber: number;
  title: string;
  content: string;
  notes?: string;
}

export interface ParsedPPTXResult {
  text: string;
  slideCount: number;
  slides: ParsedSlide[];
}

export class PPTXParser {
  public static async parse(buffer: Buffer): Promise<ParsedPPTXResult> {
    try {
      // Decode UTF-8 and XML structures if text or extract XML elements
      const str = buffer.toString('utf-8');
      
      // Match text tags <a:t>...</a:t> commonly found in PPTX slide XMLs
      const textMatches = str.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi) || [];
      const extractedWords: string[] = [];

      for (const m of textMatches) {
        const text = m.replace(/<[^>]+>/g, '').trim();
        if (text.length > 0) {
          extractedWords.push(text);
        }
      }

      // If no XML tags match (or raw text format)
      let fullText = extractedWords.join(' ');
      if (fullText.trim().length === 0) {
        fullText = buffer.toString('utf-8').replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim();
      }

      // Segment into slides
      const slideChunks = fullText.split(/(?:Slide\s+\d+|---|\f)/i).filter(s => s.trim().length > 0);
      const slides: ParsedSlide[] = [];

      if (slideChunks.length > 0) {
        slideChunks.forEach((s, idx) => {
          const lines = s.trim().split('\n').filter(Boolean);
          const title = lines[0]?.slice(0, 60) || `Slide ${idx + 1}`;
          slides.push({
            slideNumber: idx + 1,
            title,
            content: s.trim(),
          });
        });
      } else {
        slides.push({
          slideNumber: 1,
          title: 'Presentation Slide',
          content: fullText.trim() || 'Slide Content',
        });
      }

      return {
        text: fullText.trim(),
        slideCount: slides.length,
        slides,
      };
    } catch (err: any) {
      return {
        text: buffer.toString('utf-8'),
        slideCount: 1,
        slides: [{ slideNumber: 1, title: 'Presentation', content: buffer.toString('utf-8') }],
      };
    }
  }
}
