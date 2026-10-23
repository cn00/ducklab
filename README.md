<p align="center">
  <a href="https://cn00.github.io/ducklab/vs-extension" rel="noopener">
 <img width=200px src="./vs-extension/assets/logo_dark.png" alt="Project logo"></a>
</p>

<!-- <h3 align="center">ducklab</h3> -->

<div align="center">

[![Status](https://img.shields.io/badge/status-active-success.svg)]()
[![License](https://img.shields.io/badge/dynamic/json?label=version&query=version&url=https://raw.githubusercontent.com/cn00/ducklab/main/core/package.json)](https://ducklake.io/ducklab)
[![GitHub Issues](https://img.shields.io/github/issues/cn00/ducklab.svg)](https://github.com/cn00/ducklab/issues)
[![License](https://img.shields.io/badge/dynamic/json?label=license&query=license&url=https://raw.githubusercontent.com/cn00/ducklab/main/core/package.json)](/LICENSE)

</div>

---

<p align="center"> Interactive SQL Notebooks | Powered by DuckDB
    <br> 
</p>

## 📝 Table of Contents

- [📝 Table of Contents](#-table-of-contents)
- [🧐 About ](#-about-)
- [🏁 Getting Started ](#-getting-started-)
  - [Prerequisites](#prerequisites)
  - [Installing](#installing)
- [🚀 Deployment ](#-deployment-)
- [💬 Contribute](#-contribute)
  - [Implement a new feature](#implement-a-new-feature)
  - [Request a new feature](#request-a-new-feature)
  - [Fix a bug](#fix-a-bug)
- [⛏️ Built Using ](#️-built-using-)
- [🎉 Acknowledgements ](#-acknowledgements-)

## 🧐 About <a name = "about"></a>

DuckLab provides local SQL notebook experience for adhoc data analysis. It uses DuckDB to process your data within browser and VS Code. No data leaves your machine.

## 🏁 Getting Started <a name = "getting_started"></a>

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

Install NodeJs 16 or above.

[https://nodejs.org/](https://nodejs.org/)

### Installing

A step by step series of examples that tell you how to get a development env running.

It is recommended to use `pnpm`,

```
# Install pnpm (if you don't have it installed already)
npm i -g pnpm

# install dependencies
pnpm install

# Start the dev server
pnpm run dev
```

Or if you are using `npm`
```
# install dependencies
npm install

# start the dev server
npm run dev
```

## 🚀 Deployment <a name = "deployment"></a>

Application has no backend, build can be generated using `pnpm run build` and `dist` folder can be deployed as a static application on any static site hosting.

## 💬 Contribute

Contributions are most welcome. There are various ways you can contribute,

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

## ⛏️ Built Using <a name = "built_using"></a>

- [VueJs](https://vuejs.org/) - Web Framework
- [Vuetify](https://vuetifyjs.com/) - Material UI Framework
- [DuckDb](https://duckdb.org/) - In-process database

## 🎉 Acknowledgements <a name = "acknowledgement"></a>

- [duckdb-wasm](https://github.com/duckdb/duckdb-wasm)
