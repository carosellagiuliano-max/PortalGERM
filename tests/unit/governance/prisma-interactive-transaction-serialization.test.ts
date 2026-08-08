import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const libraryRoot = resolve(repositoryRoot, "lib");

describe("Prisma interactive transaction serialization", () => {
  it("does not start Promise.all fan-outs inside inline transaction callbacks", () => {
    expect(findInteractiveTransactionFanOuts()).toEqual([]);
  });
});

function findInteractiveTransactionFanOuts() {
  const findings: string[] = [];
  for (const file of sourceFiles(libraryRoot)) {
    const source = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    visit(sourceFile, (transaction) => {
      if (!isInteractiveTransactionCall(transaction)) return;
      const callback = transaction.arguments[0];
      if (
        callback === undefined ||
        (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
      ) {
        return;
      }
      visit(callback.body, (candidate) => {
        if (!isPromiseAll(candidate)) return;
        const { line } = sourceFile.getLineAndCharacterOfPosition(
          candidate.getStart(sourceFile),
        );
        findings.push(
          `${relative(repositoryRoot, file).replaceAll("\\", "/")}:${line + 1}`,
        );
      });
    });
  }
  return findings.sort();
}

function isInteractiveTransactionCall(
  node: ts.Node,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "$transaction"
  );
}

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "generated") files.push(...sourceFiles(path));
    } else if (/\.tsx?$/u.test(entry.name)) {
      files.push(path);
    }
  }
  return files.sort();
}

function visit(node: ts.Node, callback: (node: ts.Node) => void) {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

function isPromiseAll(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "Promise" &&
    node.expression.name.text === "all"
  );
}
