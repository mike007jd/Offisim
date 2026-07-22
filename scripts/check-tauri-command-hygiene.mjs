#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RENDERER_SRC = join(ROOT, 'apps/desktop/renderer/src');
const FACADE = 'apps/desktop/renderer/src/lib/tauri-commands.ts';
const CORE_MODULE = '@tauri-apps/api/core';
const failures = [];
const GH_PERMISSION = 'apps/desktop/src-tauri/permissions/github.toml';
const GH_CAPABILITY = 'apps/desktop/src-tauri/capabilities/github.json';
const PERMISSIONS_DIR = join(ROOT, 'apps/desktop/src-tauri/permissions');

function collectTypeScriptFiles(directory) {
  const files = [];
  const stack = [directory];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      const stats = statSync(path);
      if (stats.isDirectory()) {
        stack.push(path);
      } else if (stats.isFile() && /\.(?:ts|tsx)$/.test(entry)) {
        files.push(path);
      }
    }
  }
  return files.sort();
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function report(sourceFile, node, message) {
  failures.push({
    file: relative(ROOT, sourceFile.fileName),
    line: lineOf(sourceFile, node),
    message,
  });
}

function moduleName(node) {
  return node && ts.isStringLiteral(node) ? node.text : null;
}

function dynamicImportModule(node) {
  if (
    !ts.isCallExpression(node) ||
    node.expression.kind !== ts.SyntaxKind.ImportKeyword ||
    node.arguments.length !== 1
  ) {
    return null;
  }
  return moduleName(node.arguments[0]);
}

function unwrapExpression(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function functionContainer(node) {
  let current = node.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

function parameterTypeForIdentifier(node, identifier) {
  const container = functionContainer(node);
  const parameter = container?.parameters.find(
    (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === identifier.text,
  );
  return parameter?.type;
}

function scanRendererFile(file) {
  const text = readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const rel = relative(ROOT, file);
  const isFacade = rel === FACADE;
  const variableDeclarations = [];

  function collectVariableDeclarations(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      variableDeclarations.push(node);
    }
    ts.forEachChild(node, collectVariableDeclarations);
  }

  collectVariableDeclarations(sourceFile);

  function resolvesToStringParameter(callNode, expression, seen = new Set()) {
    const unwrapped = unwrapExpression(expression);
    if (!ts.isIdentifier(unwrapped) || seen.has(unwrapped.text)) return false;
    seen.add(unwrapped.text);

    if (parameterTypeForIdentifier(callNode, unwrapped)?.kind === ts.SyntaxKind.StringKeyword) {
      return true;
    }

    const container = functionContainer(callNode);
    const declaration = variableDeclarations
      .filter(
        (candidate) =>
          candidate.name.text === unwrapped.text &&
          candidate.getStart(sourceFile) < callNode.getStart(sourceFile) &&
          functionContainer(candidate) === container,
      )
      .sort((left, right) => right.getStart(sourceFile) - left.getStart(sourceFile))[0];

    return declaration?.initializer
      ? resolvesToStringParameter(callNode, declaration.initializer, seen)
      : false;
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) && moduleName(node.moduleSpecifier) === CORE_MODULE) {
      const bindings = node.importClause?.namedBindings;
      if (!isFacade && bindings && ts.isNamespaceImport(bindings)) {
        report(
          sourceFile,
          node,
          'namespace import from Tauri core is forbidden outside the facade',
        );
      }
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const imported = (element.propertyName ?? element.name).text;
          if (imported === 'invoke') {
            report(sourceFile, element, 'raw Tauri invoke import is forbidden');
          }
        }
      }
      if (!isFacade && node.importClause?.name) {
        report(sourceFile, node, 'default import from Tauri core is forbidden outside the facade');
      }
    }

    if (
      !isFacade &&
      ts.isExportDeclaration(node) &&
      moduleName(node.moduleSpecifier) === CORE_MODULE
    ) {
      report(sourceFile, node, 're-export from Tauri core is forbidden outside the facade');
    }

    if (!isFacade && dynamicImportModule(node) === CORE_MODULE) {
      report(sourceFile, node, 'dynamic Tauri core import is forbidden outside the facade');
    }

    if (
      !isFacade &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      moduleName(node.arguments[0]) === CORE_MODULE
    ) {
      report(sourceFile, node, 'CommonJS Tauri core import is forbidden outside the facade');
    }

    if (
      !isFacade &&
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isIdentifier(unwrapExpression(node.initializer)) &&
      unwrapExpression(node.initializer).text === 'invokeCommand'
    ) {
      report(sourceFile, node, 'aliasing invokeCommand is forbidden outside the facade');
    }

    if (
      !isFacade &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'invokeCommand' &&
      node.arguments[0]
    ) {
      if (resolvesToStringParameter(node, node.arguments[0])) {
        report(
          sourceFile,
          node.arguments[0],
          'invokeCommand forwarding keys must be a CommandMap key union, not string',
        );
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { sourceFile, text };
}

const scanned = collectTypeScriptFiles(RENDERER_SRC).map(scanRendererFile);
const facade = scanned.find(({ sourceFile }) => relative(ROOT, sourceFile.fileName) === FACADE);
if (!facade) {
  failures.push({ file: FACADE, line: 1, message: 'typed command facade is missing' });
}

const commandMapKeys = [];
let hasConstrainedInvokeCommand = false;
let hasLazyCoreImport = false;

if (facade) {
  function visitFacade(node) {
    if (ts.isInterfaceDeclaration(node) && node.name.text === 'CommandMap') {
      for (const member of node.members) {
        if (!ts.isPropertySignature(member) || !member.name) continue;
        if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) {
          commandMapKeys.push(member.name.text);
        }
      }
    }

    if (ts.isFunctionDeclaration(node) && node.name?.text === 'invokeCommand' && node.body) {
      const keyType = node.typeParameters?.find((parameter) => parameter.name.text === 'K');
      const constraint = keyType?.constraint?.getText(facade.sourceFile).replace(/\s+/g, ' ');
      if (constraint === 'keyof CommandMap') {
        hasConstrainedInvokeCommand = true;
      }
    }

    if (dynamicImportModule(node) === CORE_MODULE) {
      hasLazyCoreImport = true;
    }

    ts.forEachChild(node, visitFacade);
  }
  visitFacade(facade.sourceFile);

  if (!hasConstrainedInvokeCommand) {
    failures.push({
      file: FACADE,
      line: 1,
      message: 'invokeCommand implementation must declare K extends keyof CommandMap',
    });
  }
  if (!hasLazyCoreImport || !facade.text.includes('invokePromise ??=')) {
    failures.push({
      file: FACADE,
      line: 1,
      message: 'facade must lazy-load and cache Tauri invoke',
    });
  }
}

const rustPath = join(ROOT, 'apps/desktop/src-tauri/src/lib.rs');
const rustText = readFileSync(rustPath, 'utf8');
const handlerBlock = rustText.match(/tauri::generate_handler!\[([\s\S]*?)\]\)/)?.[1];
if (!handlerBlock) {
  failures.push({
    file: relative(ROOT, rustPath),
    line: 1,
    message: 'could not parse tauri::generate_handler! command registration',
  });
}

const rustCommandKeys = handlerBlock
  ? handlerBlock
      .split('\n')
      .map((line) => line.trim().replace(/,$/, ''))
      .filter(Boolean)
      .map((entry) => entry.split('::').at(-1))
  : [];

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].sort();
}

for (const duplicate of duplicates(commandMapKeys)) {
  failures.push({ file: FACADE, line: 1, message: `duplicate CommandMap key: ${duplicate}` });
}
for (const duplicate of duplicates(rustCommandKeys)) {
  failures.push({
    file: relative(ROOT, rustPath),
    line: 1,
    message: `duplicate generate_handler command: ${duplicate}`,
  });
}

const mapSet = new Set(commandMapKeys);
const rustSet = new Set(rustCommandKeys);
for (const command of rustCommandKeys.filter((key) => !mapSet.has(key))) {
  failures.push({ file: FACADE, line: 1, message: `CommandMap missing Rust command: ${command}` });
}
for (const command of commandMapKeys.filter((key) => !rustSet.has(key))) {
  failures.push({
    file: FACADE,
    line: 1,
    message: `CommandMap has unregistered command: ${command}`,
  });
}

const permissionCommandKeys = readdirSync(PERMISSIONS_DIR)
  .filter((entry) => entry.endsWith('.toml'))
  .flatMap((entry) => {
    const text = readFileSync(join(PERMISSIONS_DIR, entry), 'utf8');
    return [...text.matchAll(/commands\.allow\s*=\s*\[([\s\S]*?)\]/g)].flatMap((match) =>
      [...match[1].matchAll(/"([^"]+)"/g)].map((command) => command[1]),
    );
  });
const permissionSet = new Set(permissionCommandKeys);

for (const duplicate of duplicates(permissionCommandKeys)) {
  failures.push({
    file: relative(ROOT, PERMISSIONS_DIR),
    line: 1,
    message: `custom command appears in multiple permission files: ${duplicate}`,
  });
}

for (const command of rustCommandKeys.filter((key) => !permissionSet.has(key))) {
  failures.push({
    file: relative(ROOT, PERMISSIONS_DIR),
    line: 1,
    message: `custom permissions missing registered command: ${command}`,
  });
}
for (const command of permissionSet.difference(rustSet)) {
  failures.push({
    file: relative(ROOT, PERMISSIONS_DIR),
    line: 1,
    message: `custom permissions expose unregistered command: ${command}`,
  });
}

const ghPermissionText = readFileSync(join(ROOT, GH_PERMISSION), 'utf8');
if (
  !ghPermissionText.includes('identifier = "github"') ||
  !ghPermissionText.includes('"gh_exec"')
) {
  failures.push({
    file: GH_PERMISSION,
    line: 1,
    message: 'github permission must exclusively expose the gh_exec command',
  });
}
const ghCapability = JSON.parse(readFileSync(join(ROOT, GH_CAPABILITY), 'utf8'));
if (
  ghCapability.identifier !== 'offisim:github' ||
  JSON.stringify(ghCapability.webviews) !== JSON.stringify(['main', 'main-live']) ||
  ghCapability.windows !== undefined ||
  ghCapability.remote !== undefined ||
  JSON.stringify(ghCapability.permissions) !== JSON.stringify(['github'])
) {
  failures.push({
    file: GH_CAPABILITY,
    line: 1,
    message: 'github capability must mount only on the main and main-live renderer webviews',
  });
}

if (failures.length > 0) {
  console.error('[check-tauri-command-hygiene] failed');
  for (const failure of failures) {
    console.error(`  ${failure.file}:${failure.line} ${failure.message}`);
  }
  process.exit(1);
}

console.log(
  `[check-tauri-command-hygiene] ok (${rustCommandKeys.length} registered commands, ${commandMapKeys.length} typed commands, ${permissionSet.size} permitted commands)`,
);
