<template>
  <section class="markdown-cell">
    <textarea :value="cell.input" aria-label="Markdown cell source" @input="onInput"></textarea>
    <article class="preview" v-html="renderedMarkdown"></article>
  </section>
</template>

<script setup lang="ts">
import { computed, PropType } from 'vue';
import { NotebookCell } from '@ducklab/core';
import { useNotebookStore } from '@/store/notebook';

const props = defineProps({
  cell: { type: Object as PropType<NotebookCell>, required: true }
});
const notebookStore = useNotebookStore();
const renderedMarkdown = computed(() => renderMarkdown(props.cell.input));

function onInput(event: Event) {
  props.cell.setInput((event.target as HTMLTextAreaElement).value);
  notebookStore.unsavedChanges = true;
}

function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }

    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      const fenceChar = fence[1][0];
      const fenceSize = fence[1].length;
      const code: string[] = [];
      index++;
      while (index < lines.length && !new RegExp(`^ {0,3}${fenceChar}{${fenceSize},}[ \\t]*$`).test(lines[index])) {
        code.push(lines[index++]);
      }
      if (index < lines.length) index++;
      const language = escapeHtml(fence[2].trim().split(/[\s|]/, 1)[0] ?? '');
      blocks.push(`<pre><code${language ? ` class="language-${language}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*?)(?:\s+#+)?$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index++;
      continue;
    }

    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      blocks.push('<hr>');
      index++;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) quote.push(lines[index++].replace(/^\s*>\s?/, ''));
      blocks.push(`<blockquote><p>${renderInline(quote.join(' '))}</p></blockquote>`);
      continue;
    }

    const listMatch = /^\s*([-+*]|\d+\.)\s+(.*)$/.exec(line);
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[1]);
      const items: string[] = [];
      while (index < lines.length) {
        const item = /^\s*([-+*]|\d+\.)\s+(.*)$/.exec(lines[index]);
        if (!item || /^\d/.test(item[1]) !== ordered) break;
        items.push(`<li>${renderInline(item[2])}</li>`);
        index++;
      }
      const tag = ordered ? 'ol' : 'ul';
      blocks.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !/^(?: {0,3}#{1,6}\s| {0,3}(`{3,}|~{3,})|\s*>|\s*(?:[-+*]|\d+\.)\s|\s*(?:---+|\*\*\*+|___+)\s*$)/.test(lines[index])) {
      paragraph.push(lines[index++]);
    }
    if (paragraph.length === 0) paragraph.push(lines[index++]);
    blocks.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
  }

  return blocks.join('\n');
}

function renderInline(value: string): string {
  let escaped = escapeHtml(value);
  const codeTokens: string[] = [];
  escaped = escaped.replace(/`([^`]+)`/g, (_match, code: string) => {
    const token = `\u0000${codeTokens.length}\u0000`;
    codeTokens.push(`<code>${code}</code>`);
    return token;
  });
  escaped = escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label: string, href: string) => {
    if (!/^(https?:\/\/|mailto:)/i.test(href)) return match;
    return `<a href="${href}" rel="noopener noreferrer">${label}</a>`;
  });
  escaped = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>');
  return escaped.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => codeTokens[Number(index)]);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
</script>

<style scoped>
.markdown-cell {
  margin: 7px;
  padding: 12px;
  background: rgb(var(--theme-color-secondary));
  box-shadow: 1px 2px 3px 2px var(--theme-color-shadow);
}

textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 5rem;
  resize: vertical;
  font: inherit;
}

.preview {
  padding: 0 1rem;
  overflow-wrap: anywhere;
}

.preview :deep(pre) {
  overflow-x: auto;
  padding: 0.75rem;
  background: rgba(0, 0, 0, 0.08);
}

.preview :deep(code) {
  font-family: monospace;
}
</style>
