<p align="center">
  <a href="https://cn00.github.io/ducklab/" rel="noopener">
 <img width=200px src="./assets/logo_dark.png" alt="Project logo"></a>
</p>

<!-- <h3 align="center">ducklab</h3> -->

<div align="center">

[![Status](https://img.shields.io/badge/status-active-success.svg)]()
[![License](https://img.shields.io/badge/dynamic/json?label=version&query=version&url=https://raw.githubusercontent.com/cn00/ducklab/main/vs-extension/package.json)](https://ducklake.io)
[![GitHub Issues](https://img.shields.io/github/issues/cn00/ducklab.svg)](https://github.com/cn00/ducklab/issues)
[![License](https://img.shields.io/badge/dynamic/json?label=license&query=license&url=https://raw.githubusercontent.com/cn00/ducklab/main/vs-extension/package.json)](/LICENSE)

</div>

---

<p align="center"> Interactive SQL and PySpark Notebooks | Powered by DuckDB
    <br> 
</p>

## 📝 Table of Contents

- [📝 Table of Contents](#-table-of-contents)
- [🧐 About ](#-about-)
- [🔥 Features ](#-features-)
- [🏁 Getting Started ](#-getting-started-)
  - [Using Ducklab SQL Kernel (no dependencies required)](#using-ducklab-sql-kernel-no-dependencies-required)
    - [Using Cell Magics](#using-cell-magics)
  - [Using Ducklab Python Kernel](#using-ducklab-python-kernel)
  - [Using Ducklab Spark Kernel](#using-ducklab-spark-kernel)
  - [Import Databricks Notebook](#import-databricks-notebook)
- [💬 Contribute](#-contribute)
  - [Implement a new feature](#implement-a-new-feature)
  - [Request a new feature](#request-a-new-feature)
  - [Fix a bug](#fix-a-bug)
- [🎉 Acknowledgements ](#-acknowledgements-)

## 🧐 About <a name = "about"></a>

DuckLab for VS Code provides data analysis features for SQL, PySpark and Python. It uses DuckDB to process your data locally.

## 🔥 Features <a name = "features"></a>

- Run SQL and Python in the same notebook using same duckdb instance (exposed as `db` variable in python)
- Ducklab Spark Kernel allows running pyspark code using `duckdb.experimental.spark` module (exposed as `spark`, a `SparkSession` instance).
- Import Databricks `.py` notebooks and preview in a user-friendly VS Code Notebook window.
- Use any python, venv or conda environment detected by VS Code Python extension.
- Git-friendly `.isql` format. This format is plain text and human readable. 
- Ducklab doesn't use `ipynb` format which stores cell outputs in the file and pollutes git. It also makes diff in pull requests unreadable.
- Cell magics for convenience.

## 🏁 Getting Started <a name = "getting_started"></a>

### Using Ducklab SQL Kernel (no dependencies required)

1. Create a new `.isql` file.
2. Select kernel `SQL Only`
3. Run SQL queries e.g. `select * from 'data/MOCK_DATA.csv';`

The SQL Only kernel stores each notebook's database in `~/.ducklab` (the `.ducklab` directory in your home directory). Ducklab creates this directory automatically when opening the database. Existing databases in the system temporary directory are not migrated automatically.

#### Unsigned DuckDB extensions

To load a trusted unsigned extension, enable **Ducklab: Allow Unsigned Extensions** in VS Code User Settings, or add the following to your user settings:

```json
{
  "ducklab.allowUnsignedExtensions": true
}
```

This setting defaults to `false` and applies to SQL Only, Python/SQL, and PySpark/SQL kernels. It sets DuckDB's startup option `allow_unsigned_extensions`, equivalent to the CLI `-unsigned` flag. Reload the VS Code window after changing it. This is a user-level setting, not a workspace setting.

Unsigned extensions execute native code with your user permissions. Only enable this for extensions you trust. PySpark/SQL uses a configured SparkContext connection when enabled because DuckDB's experimental Spark builder does not apply `config()` options.

#### SQL environment variables

Place a `.env` file next to the `.isql` notebook to provide values for SQL cells. Ducklab expands `$NAME` and `${NAME}` before running SQL in the SQL Only, Python/SQL, and PySpark/SQL kernels. Python cells are not modified. The `.env` file is re-read for each SQL cell; its values override matching extension process environment variables. If a referenced name is missing from both sources, execution stops and reports the missing name.

For example, copy `sample/.env.example` to the directory containing your notebook and use:

```sql
ATTACH 'host=$PGHOST dbname=$PGDATABASE user=$PGUSER password=$PGPASSWORD' AS duckspm (TYPE postgres);
```

Keep credentials in `.env`, which is ignored by Git. Variable values are substituted as SQL text and must be valid in the surrounding SQL syntax.

#### Large query results

Single-query tabular results use backend pagination in the SQL Only, Python/SQL, and PySpark/SQL kernels. Only the visible page is sent to the interactive table; page navigation, global search, column filters, sorting, row counts, and Explore statistics are evaluated by the kernel. Value-filter suggestions are loaded on demand and capped at 200 per search. CSV export fetches the filtered result in pages. DDL and multi-statement cells keep their existing output behavior.

<img src="./assets/sql_query.png">

#### Using Cell Magics

- Use '%view myview' cell magic to create a view from your SELECT query and preview the results.
<img src="./assets/screenshot_2.png">

### Using Ducklab Python Kernel

1. Make sure python or Anaconda is installed.
2. Create a new `.isql` file.
3. Select kernel `Python/SQL`
4. Select Python environment from bottom-right corner
5. `ducklab-python` kernel will have `db` variable (duckdb connection) already initialized for you.
6. Run python or SQL code

### Using Ducklab Spark Kernel

1. Make sure python or Anaconda is installed.
2. Create a new `.isql` file.
3. Select kernel `PySpark/SQL`
4. Select Python environment from bottom-right corner
5. `ducklab-spark` kernel will have `spark` variable (SparkSession) already initialized for you.
6. Run spark code,

```
import pandas as pd
from duckdb.experimental.spark.sql.functions import lit, col

pandas_df = pd.DataFrame({
    'age': [34, 45, 23, 56],
    'name': ['Joan', 'Peter', 'John', 'Bob']
})

df = spark.createDataFrame(pandas_df)
df = df.withColumn(
    'location', lit('Seattle')
)
df = df.select(
    col('age'),
    col('location')
)

display(df)
```

### Import Databricks Notebook

1. Right click on a Databricks `.py` notebook file
2. Click `Import Databricks Notebook`

## 💬 Contribute

Contributions are most welcome. There are various ways you can contribute,

### Installing extension dependencies

Use pnpm `10.33.3` and run `pnpm install --frozen-lockfile` from `vs-extension`. The checked-in `pnpm-workspace.yaml` approves installation scripts only for `@vscode/vsce-sign`, `keytar`, and `zeromq`, so CI does not require interactive `pnpm approve-builds`. Review any new dependency build scripts before adding them to this list.

VSIX packages retain only their target operating system's native binaries under `extension/build`: Darwin packages exclude Linux and Windows binaries, Linux packages exclude Darwin and Windows binaries, and Windows packages exclude Darwin and Linux binaries.

### Implement a new feature
1. Create an issue and provide your reasoning on why you want to add this feature.
2. Discuss your approach and design.
3. Implement the feature and submit your PR.

### Request a new feature
1. Open an issue and provide details about your feature request.
2. In case other tools implement that functionality then it will be helpful to share the reference for inspiration and design.

### Fix a bug
1. If you are resolving an issue, please add fix: #<issue number> <short message> in your PR title (e.g.fix: #3899 update entities encoding/decoding).
2. Provide a short description of the bug in your PR and/or link to the issue.

## 🎉 Acknowledgements <a name = "acknowledgement"></a>

- [DuckDb](https://duckdb.org/) - In-process analytics database
