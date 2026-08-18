export interface MarkdownSection {
  heading: string;
  level: number;
  content: string;
}

export interface ParsedMarkdownResult {
  text: string;
  title: string;
  sections: MarkdownSection[];
}

export class MarkdownParser {
  public static parse(content: string): ParsedMarkdownResult {
    const lines = content.split('\n');
    let title = 'Markdown Document';
    const sections: MarkdownSection[] = [];

    let currentHeading = 'Overview';
    let currentLevel = 1;
    let currentBuffer: string[] = [];

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        if (currentBuffer.length > 0) {
          sections.push({
            heading: currentHeading,
            level: currentLevel,
            content: currentBuffer.join('\n').trim(),
          });
          currentBuffer = [];
        }

        currentLevel = headingMatch[1].length;
        currentHeading = headingMatch[2].trim();

        if (title === 'Markdown Document' && currentLevel === 1) {
          title = currentHeading;
        }
      } else {
        currentBuffer.push(line);
      }
    }

    if (currentBuffer.length > 0) {
      sections.push({
        heading: currentHeading,
        level: currentLevel,
        content: currentBuffer.join('\n').trim(),
      });
    }

    return {
      text: content.trim(),
      title,
      sections: sections.length > 0 ? sections : [{ heading: 'Content', level: 1, content: content.trim() }],
    };
  }
}
