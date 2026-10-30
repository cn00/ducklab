import { INotebookSerializer } from './INotebookSerializer';
import { Notebook } from './Notebook';
import { CellType, NotebookCell } from './NotebookCell';

const MARKDOWN_CELL_MARKER = '<!-- ducklab:cell -->';

interface SourceLine {
    start: number;
    end: number;
    text: string;
}

interface Fence {
    character: '`' | '~';
    length: number;
    language: string;
    name: string;
}

export class MarkdownNotebookSerializer implements INotebookSerializer {
    static signature(notebook: Notebook): string {
        return JSON.stringify(notebook.cells.map(cell => [cell.type, cell.name, cell.input]));
    }

    serialize(notebook: Notebook): string {
        if (notebook.sourceText !== undefined && notebook.sourceSignature === MarkdownNotebookSerializer.signature(notebook)) {
            return notebook.sourceText;
        }

        return notebook.cells.map((cell, index) => {
            if (cell.type === CellType.MD || cell.type === CellType.TEXT) {
                const previous = notebook.cells[index - 1];
                const marker = previous && (previous.type === CellType.MD || previous.type === CellType.TEXT)
                    ? `${MARKDOWN_CELL_MARKER}\n\n`
                    : '';
                return `${marker}${trimMarkdownCellEdges(cell.input)}`;
            }

            const language = cell.type === CellType.PYTHON ? 'python' : 'sql';
            const name = cell.name && cell.name !== 'unnamed' ? ` | ${cell.name}` : '';
            const fenceLength = Math.max(3, longestRun(cell.input, '`') + 1);
            const fence = '`'.repeat(fenceLength);
            const body = cell.input.endsWith('\n') || cell.input.endsWith('\r') ? cell.input : `${cell.input}\n`;
            return `${fence}${language}${name}\n${body}${fence}`;
        }).join('\n\n');
    }

    parse(content: string, id?: string): Notebook {
        const notebook = new Notebook(id);
        const lines = getLines(content);
        let markdownStart = 0;
        let cursor = 0;
        let markdownPart = '';

        const flushMarkdown = () => {
            if (markdownPart.trim().length > 0) {
                notebook.cells.push(new NotebookCell(
                    Math.random().toString(), 'unnamed', notebook, markdownPart, CellType.MD
                ));
                markdownPart = '';
            }
        };

        while (cursor < lines.length) {
            const line = lines[cursor];
            if (line.text.trim() === MARKDOWN_CELL_MARKER) {
                markdownPart += content.slice(markdownStart, line.start);
                flushMarkdown();
                markdownStart = line.end;
                cursor++;
                continue;
            }

            const fence = parseOpeningFence(line.text);
            if (!fence) {
                cursor++;
                continue;
            }

            const closingIndex = findClosingFence(lines, cursor + 1, fence);
            if (closingIndex < 0) {
                cursor = lines.length;
                break;
            }

            if (fence.language !== 'sql' && fence.language !== 'python') {
                cursor = closingIndex + 1;
                continue;
            }

            markdownPart += content.slice(markdownStart, line.start);
            flushMarkdown();

            const bodyStart = line.end;
            const bodyEnd = lines[closingIndex].start;
            const type = fence.language === 'python' ? CellType.PYTHON : CellType.SQL_RAW;
            notebook.cells.push(new NotebookCell(
                Math.random().toString(), fence.name || 'unnamed', notebook,
                content.slice(bodyStart, bodyEnd), type
            ));

            markdownStart = lines[closingIndex].end;
            cursor = closingIndex + 1;
        }

        markdownPart += content.slice(markdownStart);
        flushMarkdown();

        notebook.sourceText = content;
        notebook.sourceSignature = MarkdownNotebookSerializer.signature(notebook);
        return notebook;
    }
}

function trimMarkdownCellEdges(input: string): string {
    return input.replace(/^(?:\r\n|\r|\n)+|(?:\r\n|\r|\n)+$/g, '');
}

function getLines(content: string): SourceLine[] {
    const lines: SourceLine[] = [];
    let start = 0;
    while (start < content.length) {
        let end = start;
        while (end < content.length && content[end] !== '\r' && content[end] !== '\n') end++;
        if (content[end] === '\r' && content[end + 1] === '\n') end += 2;
        else if (end < content.length) end++;
        lines.push({
            start,
            end,
            text: content.slice(start, end).replace(/(?:\r\n|\r|\n)$/, '')
        });
        start = end;
    }
    return lines;
}

function parseOpeningFence(line: string): Fence | undefined {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!match) return undefined;
    const character = match[1][0] as '`' | '~';
    const info = match[2].trim();
    if (character === '`' && info.includes('`')) return undefined;

    const languageMatch = /^([^\s|]+)(?:\s*\|\s*(.*))?$/.exec(info);
    return {
        character,
        length: match[1].length,
        language: (languageMatch?.[1] ?? '').toLowerCase(),
        name: languageMatch?.[2]?.trim() ?? ''
    };
}

function findClosingFence(lines: SourceLine[], start: number, fence: Fence): number {
    const pattern = fence.character === '`' ? /^ {0,3}(`{3,})[ \t]*$/ : /^ {0,3}(~{3,})[ \t]*$/;
    for (let i = start; i < lines.length; i++) {
        const match = pattern.exec(lines[i].text);
        if (match && match[1].length >= fence.length) return i;
    }
    return -1;
}

function longestRun(text: string, character: string): number {
    return Math.max(0, ...(text.match(new RegExp(`${character === '`' ? '`' : '~'}+`, 'g')) ?? []).map(run => run.length));
}
