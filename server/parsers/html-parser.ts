import * as cheerio from 'cheerio';

export interface ParsedHTMLResult {
  title: string;
  description?: string;
  text: string;
  headings: Array<{ level: number; text: string }>;
  sections: Array<{ heading: string; content: string }>;
  links: Array<{ text: string; href: string }>;
}

export class HTMLParser {
  public static parse(htmlContent: string, baseUrl?: string): ParsedHTMLResult {
    try {
      const $ = cheerio.load(htmlContent);

      // Remove noise and irrelevant page chrome
      $('script, style, noscript, iframe, svg, nav, footer, header, aside, .cookie-banner, .advertisement, [aria-hidden="true"]').remove();

      const title = $('title').text().trim() || $('h1').first().text().trim() || 'Web Document';
      const description = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '';

      const headings: Array<{ level: number; text: string }> = [];
      $('h1, h2, h3, h4, h5, h6').each((_, el) => {
        const tagName = el.tagName.toLowerCase();
        const level = parseInt(tagName.replace('h', ''), 10) || 1;
        const text = $(el).text().trim();
        if (text) {
          headings.push({ level, text });
        }
      });

      const sections: Array<{ heading: string; content: string }> = [];
      let currentHeading = title;
      let currentBuffer: string[] = [];

      $('body').find('h1, h2, h3, p, li, blockquote, pre, code, table').each((_, el) => {
        const tagName = el.tagName.toLowerCase();
        const text = $(el).text().trim();

        if (!text) return;

        if (tagName.startsWith('h')) {
          if (currentBuffer.length > 0) {
            sections.push({
              heading: currentHeading,
              content: currentBuffer.join('\n\n'),
            });
            currentBuffer = [];
          }
          currentHeading = text;
        } else {
          currentBuffer.push(text);
        }
      });

      if (currentBuffer.length > 0) {
        sections.push({
          heading: currentHeading,
          content: currentBuffer.join('\n\n'),
        });
      }

      // Collect links
      const links: Array<{ text: string; href: string }> = [];
      $('a[href]').each((_, el) => {
        const text = $(el).text().trim();
        const href = $(el).attr('href') || '';
        if (text && href && !href.startsWith('#') && !href.startsWith('javascript:')) {
          links.push({ text, href });
        }
      });

      // Assemble full clean text
      const fullText = sections.map(s => `## ${s.heading}\n${s.content}`).join('\n\n');

      return {
        title,
        description,
        text: fullText || $('body').text().replace(/\s+/g, ' ').trim(),
        headings,
        sections: sections.length > 0 ? sections : [{ heading: title, content: $('body').text().trim() }],
        links: links.slice(0, 20),
      };
    } catch (err: any) {
      throw new Error(`Failed to parse HTML: ${err.message || err}`);
    }
  }
}
