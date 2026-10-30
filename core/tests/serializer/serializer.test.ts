import { NotebookCell, CellType, MarkdownNotebookSerializer, Notebook } from '@/main';
import { describe, expect, test } from '@jest/globals';

const serializer = new MarkdownNotebookSerializer();

describe('Markdown Notebook serializer', () => {
    test('parses markdown, named SQL, and Python cells', () => {
        const notebook = serializer.parse([
            '# Report',
            '',
            '```sql | accounts',
            'select * from accounts;',
            '```',
            '',
            '```python | analysis',
            'print("done")',
            '```'
        ].join('\n'));

        expect(notebook.cells.map(cell => [cell.type, cell.name])).toEqual([
            [CellType.MD, 'unnamed'],
            [CellType.SQL_RAW, 'accounts'],
            [CellType.PYTHON, 'analysis']
        ]);
        expect(notebook.cells[0].input).toBe('# Report\n\n');
        expect(notebook.cells[1].input).toBe('select * from accounts;\n');
    });

    test('uses the HTML marker to split adjacent markdown cells', () => {
        const notebook = serializer.parse('first\n\n<!-- ducklab:cell -->\n\nsecond');
        expect(notebook.cells.map(cell => cell.input)).toEqual(['first\n\n', '\nsecond']);
    });

    test('leaves unknown and unclosed fences in markdown', () => {
        const notebook = serializer.parse('```javascript\nconst x = 1;\n```\n\n```sql\nselect 1;');
        expect(notebook.cells).toHaveLength(1);
        expect(notebook.cells[0].type).toBe(CellType.MD);
        expect(notebook.cells[0].input).toContain('```sql\nselect 1;');
    });

    test('ignores cell markers inside code fences', () => {
        const notebook = serializer.parse('```sql\n-- <!-- ducklab:cell -->\nselect 1;\n```');
        expect(notebook.cells).toHaveLength(1);
        expect(notebook.cells[0].type).toBe(CellType.SQL_RAW);
        expect(notebook.cells[0].input).toContain('<!-- ducklab:cell -->');
    });

    test('preserves the source exactly when an unedited notebook is serialized', () => {
        const source = '# Heading\r\n\r\n```sql | report\r\nselect 1;\r\n```\r\n';
        expect(serializer.serialize(serializer.parse(source))).toBe(source);
    });

    test('serializes newly created cells as Markdown fences', () => {
        const notebook = new Notebook();
        notebook.cells = [
            new NotebookCell('1', 'intro', notebook, '# Intro\n', CellType.MD),
            new NotebookCell('2', 'query', notebook, 'select 1;\n', CellType.SQL_RAW),
            new NotebookCell('3', 'code', notebook, 'print(1)\n', CellType.PYTHON),
            new NotebookCell('4', 'notes', notebook, 'tail', CellType.MD)
        ];

        expect(serializer.serialize(notebook)).toBe(
            '# Intro\n\n```sql | query\nselect 1;\n```\n\n```python | code\nprint(1)\n```\n\ntail'
        );
    });
});
