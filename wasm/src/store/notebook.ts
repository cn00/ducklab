// Utilities
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { MarkdownNotebookSerializer, Notebook, NotebookCell, CellType, TabularDataSource } from '@ducklab/core';
// import { CellType, NotebookCell } from '@/entities/NotebookCell';
import { FileSystemReference } from '@/entities/FileSystemReference';
import { createReference } from './storage';
import { get, set } from 'idb-keyval';
// import { type DuckdbDataSource } from '@/entities/duckdb_wasm/DuckdbDataSource';


export const useNotebookStore = defineStore('notebook', () => {
  // const datasets = ref<TabularDataset[]>([]);
  // const cells = ref<NotebookCell[]>([]);
  const notebook = ref<Notebook>(new Notebook());
  const dsIndex = ref(1);
  let dataSource: TabularDataSource | undefined;
  const unsavedChanges = ref(false);
  const currFile = ref<FileSystemReference>({
    name: 'untitled.md',
    children: [],
    path: '',
    permission: 'denied',
    type: 'md',
    isCode: true,
  });

  function setDataSource(ds: any) {
    notebook.value.dataSource = ds;
    dataSource = ds;
  }

  async function initNotebook() {
    createCell();
    unsavedChanges.value = false;
    const sql = await get("notebook");
    if (sql) {
      loadFromText("untitled.md", sql);
    }

    setInterval(async () => {
      if (unsavedChanges.value) {
        await save(true);
      }
    }, 5000);
  }

  function createCell(afterCell: NotebookCell | null = null) {
    if (!notebook.value.dataSource) throw Error("Datasource is undefined");

    let inputQuery = "select * from '*.csv'";
    let index = -1;
    if (afterCell) {
      index = notebook.value.cells.findIndex(ds => ds.id === afterCell.id);
    }

    const cell = new NotebookCell(Math.random().toString(), `sql_${dsIndex.value}`, notebook.value as Notebook, inputQuery, CellType.SQL_RAW);
    notebook.value.cells.splice(index + 1, 0, cell);
    dsIndex.value++;
    unsavedChanges.value = true;
    return cell;
  }

  function createMarkdownCell(afterCell: NotebookCell | null = null) {
    const index = afterCell ? notebook.value.cells.findIndex(cell => cell.id === afterCell.id) : -1;
    const cell = new NotebookCell(Math.random().toString(), 'unnamed', notebook.value, '', CellType.MD);
    notebook.value.cells.splice(index + 1, 0, cell);
    unsavedChanges.value = true;
    return cell;
  }

  function deleteCell(cell: NotebookCell) {
    for (let i = 0; i < notebook.value.cells.length; i++) {
      if (notebook.value.cells[i].id === cell.id) {
        notebook.value.cells.splice(i, 1);
        unsavedChanges.value = true;
        return;
      }
    }
  }

  function getCell(cellId: string) {
    for (let i = 0; i < notebook.value.cells.length; i++) {
      if (notebook.value.cells[i].id === cellId) {
        return notebook.value.cells[i];
      }
    }
    return null;
  }

  function exportToText() {
    const serializer = new MarkdownNotebookSerializer();
    const result = serializer.serialize(notebook.value as Notebook);
    return result;
  }

  async function load(fileRef: FileSystemReference) {
    if (!fileRef.handle || fileRef.type === "folder") return;

    const file = await fileRef.handle.getFile();
    const text = await file.text();
    console.log(text);

    loadFromText(fileRef.name, text);
    currFile.value = fileRef;
  }

  function loadFromText(name: string, text: string) {
    const serializer = new MarkdownNotebookSerializer();
    const nb = serializer.parse(text, name);
    nb.dataSource = dataSource;
    notebook.value = nb;
    dsIndex.value = notebook.value.cells.length + 1;
    unsavedChanges.value = false;
  }

  async function save(auto = false) {
    const sql = exportToText();
    console.log("Saving: ", sql);
    if (!currFile.value.handle) {
      if (auto) {
        set("notebook", sql);
        unsavedChanges.value = false;
        return;
      }
      else {
        const localHandle = await getNewFileHandle();
        currFile.value = await createReference(localHandle);
      }
    }
    if (!currFile.value.handle) throw Error("Failed to save file");
    const writable = await (currFile.value.handle as FileSystemFileHandle).createWritable();
    await writable.write(sql);
    await writable.close();
    unsavedChanges.value = false;
  }

  return {
    setDataSource, createCell, createMarkdownCell, deleteCell,
    getCell, load, exportToText, save,
    cells: computed(() => notebook.value.cells), dataSource: notebook.value.dataSource,
    unsavedChanges,
    initNotebook,
    currFile
  };

});

async function getNewFileHandle(): Promise<FileSystemFileHandle> {
  const options = {
    types: [
      {
        description: 'SQL file',
        accept: {
          'text/markdown': ['.md'],
        },
      },
    ],
  };
  const handle = await window.showSaveFilePicker(options);
  return handle;
}
