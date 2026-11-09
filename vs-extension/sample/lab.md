```sql
from duckdb_settings()
order by name desc;
```

```sql
load excel;
copy (from duckdb_settings())
to 'c:\src\duckdb_settings.xlsx' (overwrite true, header true)
```

```sql
-- load excel;
from 'c:\src\duckdb_settings.xlsx'
```

### use postgresql

```sql
install postgres;
-- Attach to PostgreSQL using ./.env environment variables
attach 'host=${PGHOST} dbname=${PGDATABASE} user=${PGUSER} password=${PGPASSWORD}' as pg (TYPE postgres);
show schemas;
```

```sql
use pg.public;
show tables;
```

```sql
from pg.public.approval_nodes;
```

### use mssql

```sql
INSTALL mssql FROM community;
-- Set allow_unsigned_extensions = true;
LOAD mssql;
ATTACH 'Server=$MSSQL_HOST,$MSSQL_PORT;Database=$MSSQL_DATABASE;User Id=$MSSQL_USER;Password=$MSSQL_PASSWORD;TrustServerCertificate=yes' AS msql (TYPE mssql);
show schemas;
```

```sql
use msql;
show tables;
```

```sql
create schema if not exists msql.from_pg;
```

```sql
-- copy table from pg to mssql
create table if not exists msql.from_pg.approval_nodes as
from pg.public.approval_nodes;

use msql.from_pg;
show tables;
```

```sql
from msql.from_pg.approval_nodes;
```

```sql
CREATE LOGIN [weconnect]
WITH PASSWORD = '$MSSQL_PASSWORD',
    CHECK_POLICY = ON;

USE [weconnect];

CREATE USER [weconnect] FOR LOGIN [weconnect];

ALTER ROLE [db_owner] ADD MEMBER [weconnect];
```

### use local csv

```sql

create or replace view ducklab.main.myview as (
    select *
    from "data/MOCK_DATA.csv"
    limit 10
);

select * from ducklab.main.myview;

```

```sql
%view ducklab.main.myview2
-- use ducklab.main;
select *
from "data/MOCK_DATA.csv"

```

```sql
select * from myview2
```

```sql
SET memory_limit = '16GB';
SET memory_limit = '12GB';
SET enable_progress_bar = true;
SET threads = 4;
select * from myview;
```

```sql

SELECT *
FROM duckdb_settings() WHERE name like '%max%';

-- set file_search_path='c:/Users/Hassan.Akbar/Documents/VsCode/ducklab';
```

```python
!env
```

```sql
select * from 'data/MOCK_DATA.csv';
```

### pandas

```python
import time

print("Hello from python")
time.sleep(3)
print("Hello from python 2")
time.sleep(3)
print("Hello from python 3")

```

```python
!pip install pandas spark
```

```python
import pandas as pd

df = pd.DataFrame([{ "a": 1, "b": 2}, { "a": 1, "b": 2}, { "a": 1, "b": 2}])
df.describe()
```

```python
df
```

```python
print(db)
```

```python
db.execute("show schemas").df()
```

```python
db.execute("from duckdb_extensions()").df()
```

```python
import pandas as pd
from spark.sql import SparkSession
from duckdb.experimental.spark.sql.functions import lit, col


pandas_df = pd.DataFrame({
    'age': [34, 45, 23, 56],
    'name': ['Joan', 'Peter', 'John', 'Bob']
})

spark = SparkSession.builder.getOrCreate()
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

```python
df.createOrReplaceTempView("myview")
```

```sql
%view myview2

select *
from myview
limit 3
```

```sql
select * from myview
```

```sql
select * from myview
```

### spark

```python
spark.sql("select * from myview")
```

```sql
select * from pragma_version();
```