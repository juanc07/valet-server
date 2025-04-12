module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    testMatch: ["<rootDir>/src/**/*.(spec|test).[tj]s?(x)"],
    testPathIgnorePatterns: ["<rootDir>/dist/"],
    transform: {
      "^.+\\.tsx?$": "ts-jest",
    },
  };