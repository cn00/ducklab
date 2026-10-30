<template>
  <MarkdownCellComponent v-if="cell.type === CellType.MD || cell.type === CellType.TEXT" :cell="cell" />
  <pre v-else-if="cell.type === CellType.PYTHON" class="python-cell"><code>{{ cell.input }}</code></pre>
  <CellComponent v-else :cell="cell" @new-cell="emit('new-cell')" @delete-cell="emit('delete-cell')" />
</template>

<script setup lang="ts">
import { PropType } from 'vue';
import { CellType, NotebookCell } from '@ducklab/core';
import CellComponent from '@/components/CellComponent.vue';
import MarkdownCellComponent from '@/components/MarkdownCellComponent.vue';

defineProps({
  cell: { type: Object as PropType<NotebookCell>, required: true }
});
const emit = defineEmits(['new-cell', 'delete-cell']);
</script>

<style scoped>
.python-cell {
  margin: 7px;
  padding: 12px;
  overflow-x: auto;
  background: rgb(var(--theme-color-secondary));
  box-shadow: 1px 2px 3px 2px var(--theme-color-shadow);
}
</style>
