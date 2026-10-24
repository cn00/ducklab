/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
  moduleDirectories: [
    "node_modules",
    "src",
  ],
  moduleNameMapper: {
    "@/(.*)": "<rootDir>/src/$1",
  },
  testEnvironment: "node",
  transform: {
    "^.+\\.[tj]sx?$": ["ts-jest", {}],
  },
  transformIgnorePatterns: [
    "node_modules/(?!(@apache-arrow/ts|.*@ducklab[+/]core))"
  ]
};
