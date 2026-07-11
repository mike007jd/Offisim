#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SQL, getTableName, is, isTable } from 'drizzle-orm';
import { SQLiteSyncDialect, getTableConfig } from 'drizzle-orm/sqlite-core';
import * as productionSchema from '../packages/db-local/src/schema.js';

type Query = {
  all: (...params: unknown[]) => unknown[];
  get: (...params: unknown[]) => unknown;
};

type DatabaseConnection = {
  close: () => void;
  exec: (sql: string) => void;
  prepare: (sql: string) => Query;
};

type DatabaseConstructor = new (filename: string) => DatabaseConnection;

type SqlColumnRow = {
  cid: number;
  dflt_value: string | null;
  name: string;
  notnull: 0 | 1;
  pk: number;
  type: string;
};

type SqlForeignKeyRow = {
  from: string;
  id: number;
  match: string;
  on_delete: string;
  on_update: string;
  seq: number;
  table: string;
  to: string;
};

type SqlIndexRow = {
  name: string;
  origin: 'c' | 'pk' | 'u';
  partial: 0 | 1;
  unique: 0 | 1;
};

type SqlIndexInfoRow = {
  name: string | null;
  seqno: number;
};

type SqlMasterRow = {
  name: string;
  sql: string | null;
};

type CanonicalForeignKey = {
  columns: string[];
  foreignColumns: string[];
  foreignTable: string;
  onDelete: string;
  onUpdate: string;
};

type CanonicalIndex = {
  columns: string[];
  name: string;
  partialPredicate: string | null;
  unique: boolean;
};

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SQL_SCHEMA_PATH = `${ROOT}/packages/db-local/src/schema.sql`;
const DIALECT = new SQLiteSyncDialect();
const ABI_ERROR = /NODE_MODULE_VERSION|compiled against a different Node\.js version/iu;

function stringify(value: unknown): string {
  return JSON.stringify(value);
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function stripWholeOuterParentheses(value: string): string {
  let current = value.trim();
  while (current.startsWith('(') && current.endsWith(')')) {
    let depth = 0;
    let singleQuoted = false;
    let enclosesWholeValue = true;
    for (let index = 0; index < current.length; index += 1) {
      const char = current[index];
      if (char === "'" && singleQuoted && current[index + 1] === "'") {
        index += 1;
        continue;
      }
      if (char === "'") singleQuoted = !singleQuoted;
      if (singleQuoted) continue;
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      if (depth === 0 && index < current.length - 1) {
        enclosesWholeValue = false;
        break;
      }
    }
    if (!enclosesWholeValue) break;
    current = current.slice(1, -1).trim();
  }
  return current;
}

function normalizeSqlExpression(value: string): string {
  const input = stripWholeOuterParentheses(value)
    .replace(/"[^"]+"\./gu, '')
    .replace(/"([^"]+)"/gu, '$1')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/\[([^\]]+)\]/gu, '$1');
  let normalized = '';
  let singleQuoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === "'" && singleQuoted && input[index + 1] === "'") {
      normalized += "''";
      index += 1;
      continue;
    }
    if (char === "'") {
      singleQuoted = !singleQuoted;
      normalized += char;
      continue;
    }
    normalized += singleQuoted ? char : char.toLowerCase();
  }
  return normalized
    .replace(/\s+/gu, ' ')
    .replace(/\s*([(),=<>])\s*/gu, '$1')
    .trim();
}

function normalizeDefaultSql(value: string | null): string | null {
  if (value === null) return null;
  const stripped = stripWholeOuterParentheses(value);
  if (/^'(?:[^']|'')*'$/u.test(stripped)) {
    return `string:${stripped.slice(1, -1).replace(/''/gu, "'")}`;
  }
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(stripped)) {
    return `number:${Number(stripped)}`;
  }
  if (/^0x[\da-f]+$/iu.test(stripped)) return `number:${Number.parseInt(stripped.slice(2), 16)}`;
  if (/^null$/iu.test(stripped)) return 'null';
  return `expression:${normalizeSqlExpression(stripped)}`;
}

function normalizeDrizzleDefault(value: unknown): string | null {
  if (value === undefined) return null;
  if (value === null) return 'null';
  if (typeof value === 'string') return `string:${value}`;
  if (typeof value === 'number') return `number:${value}`;
  if (typeof value === 'boolean') return `number:${value ? 1 : 0}`;
  if (is(value, SQL)) return normalizeDefaultSql(DIALECT.sqlToQuery(value).sql);
  throw new Error(`Unsupported Drizzle default value: ${String(value)}`);
}

function normalizeStorageType(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toUpperCase();
}

function sqliteAffinity(value: string): string {
  const type = normalizeStorageType(value);
  if (type.includes('INT')) return 'INTEGER';
  if (type.includes('CHAR') || type.includes('CLOB') || type.includes('TEXT')) return 'TEXT';
  if (type === '' || type.includes('BLOB')) return 'BLOB';
  if (type.includes('REAL') || type.includes('FLOA') || type.includes('DOUB')) return 'REAL';
  return 'NUMERIC';
}

function normalizeAction(value: string | undefined): string {
  return (value ?? 'no action').trim().toLowerCase().replace(/\s+/gu, ' ');
}

function indexPredicate(createSql: string | null): string | null {
  if (!createSql) return null;
  const match = /\bWHERE\b([\s\S]+)$/iu.exec(createSql);
  return match ? normalizeSqlExpression(match[1]) : null;
}

function indexColumnName(column: unknown): string | null {
  if (
    typeof column === 'object' &&
    column !== null &&
    'name' in column &&
    typeof column.name === 'string'
  ) {
    return column.name;
  }
  return null;
}

function extractCheckExpressions(createSql: string | null): string[] {
  if (!createSql) return [];
  const checks: string[] = [];
  const pattern = /\bCHECK\s*\(/giu;
  for (let match = pattern.exec(createSql); match; match = pattern.exec(createSql)) {
    const start = pattern.lastIndex;
    let depth = 1;
    let singleQuoted = false;
    let end = start;
    for (; end < createSql.length; end += 1) {
      const char = createSql[end];
      if (char === "'" && singleQuoted && createSql[end + 1] === "'") {
        end += 1;
        continue;
      }
      if (char === "'") singleQuoted = !singleQuoted;
      if (singleQuoted) continue;
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      if (depth === 0) break;
    }
    if (depth !== 0) throw new Error('Unbalanced CHECK constraint in schema.sql');
    checks.push(normalizeSqlExpression(createSql.slice(start, end)));
    pattern.lastIndex = end + 1;
  }
  return sorted(checks);
}

async function loadDatabaseConstructor(): Promise<DatabaseConstructor> {
  const loaded = await import('better-sqlite3');
  return loaded.default as unknown as DatabaseConstructor;
}

function tableRows(database: DatabaseConnection): SqlMasterRow[] {
  return database
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as SqlMasterRow[];
}

function sqlForeignKeys(database: DatabaseConnection, tableName: string): CanonicalForeignKey[] {
  const rows = database
    .prepare(
      'SELECT id, seq, "table", "from", "to", on_update, on_delete, "match" FROM pragma_foreign_key_list(?) ORDER BY id, seq',
    )
    .all(tableName) as SqlForeignKeyRow[];
  const grouped = new Map<number, SqlForeignKeyRow[]>();
  for (const row of rows) grouped.set(row.id, [...(grouped.get(row.id) ?? []), row]);
  return [...grouped.values()]
    .map((group) => ({
      columns: group.map((row) => row.from),
      foreignColumns: group.map((row) => row.to),
      foreignTable: group[0].table,
      onDelete: normalizeAction(group[0].on_delete),
      onUpdate: normalizeAction(group[0].on_update),
    }))
    .sort((left, right) => stringify(left).localeCompare(stringify(right)));
}

function sqlIndexes(
  database: DatabaseConnection,
  tableName: string,
): { explicit: CanonicalIndex[]; inlineUniqueColumns: string[][] } {
  const indexRows = database
    .prepare('SELECT name, "unique", origin, partial FROM pragma_index_list(?) ORDER BY name')
    .all(tableName) as SqlIndexRow[];
  const explicit: CanonicalIndex[] = [];
  const inlineUniqueColumns: string[][] = [];
  for (const index of indexRows) {
    if (index.origin === 'pk') continue;
    const columns = (
      database
        .prepare('SELECT seqno, name FROM pragma_index_info(?) ORDER BY seqno')
        .all(index.name) as SqlIndexInfoRow[]
    ).map((row) => row.name);
    if (columns.some((column) => column === null)) {
      throw new Error(`Expression index ${index.name} is not supported by the drift gate`);
    }
    const concreteColumns = columns as string[];
    if (index.origin === 'u') {
      inlineUniqueColumns.push(concreteColumns);
      continue;
    }
    const master = database
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get(index.name) as SqlMasterRow | undefined;
    explicit.push({
      columns: concreteColumns,
      name: index.name,
      partialPredicate: indexPredicate(master?.sql ?? null),
      unique: index.unique === 1,
    });
  }
  return {
    explicit: explicit.sort((left, right) => left.name.localeCompare(right.name)),
    inlineUniqueColumns: inlineUniqueColumns.sort((left, right) =>
      stringify(left).localeCompare(stringify(right)),
    ),
  };
}

async function main(): Promise<void> {
  const Database = await loadDatabaseConstructor();
  const database = new Database(':memory:');
  try {
    database.exec(readFileSync(SQL_SCHEMA_PATH, 'utf8'));
    const sqlTables = tableRows(database);
    const sqlTableByName = new Map(sqlTables.map((table) => [table.name, table]));
    const drizzleTables = Object.values(productionSchema)
      .filter(isTable)
      .map((table) => getTableConfig(table));
    const drizzleTableByName = new Map(drizzleTables.map((table) => [table.name, table]));
    const differences: string[] = [];
    const sqlTableNames = sorted(sqlTableByName.keys());
    const drizzleTableNames = sorted(drizzleTableByName.keys());
    if (stringify(sqlTableNames) !== stringify(drizzleTableNames)) {
      differences.push(
        `table set differs\n  SQL: ${stringify(sqlTableNames)}\n  Drizzle: ${stringify(drizzleTableNames)}`,
      );
    }

    let columnCount = 0;
    let foreignKeyCount = 0;
    let indexCount = 0;
    let sqlCheckCount = 0;

    for (const tableName of sorted(new Set([...sqlTableNames, ...drizzleTableNames]))) {
      const sqlTable = sqlTableByName.get(tableName);
      const drizzleTable = drizzleTableByName.get(tableName);
      if (!sqlTable || !drizzleTable) continue;

      const sqlColumns = database
        .prepare(
          'SELECT cid, name, type, "notnull", dflt_value, pk FROM pragma_table_xinfo(?) WHERE hidden = 0 ORDER BY cid',
        )
        .all(tableName) as SqlColumnRow[];
      columnCount += sqlColumns.length;
      const sqlColumnByName = new Map(sqlColumns.map((column) => [column.name, column]));
      const drizzleColumnByName = new Map(
        drizzleTable.columns.map((column) => [column.name, column]),
      );
      const sqlColumnNames = sorted(sqlColumnByName.keys());
      const drizzleColumnNames = sorted(drizzleColumnByName.keys());
      if (stringify(sqlColumnNames) !== stringify(drizzleColumnNames)) {
        differences.push(
          `${tableName}: column set differs\n  SQL: ${stringify(sqlColumnNames)}\n  Drizzle: ${stringify(drizzleColumnNames)}`,
        );
      }

      for (const columnName of sorted(new Set([...sqlColumnNames, ...drizzleColumnNames]))) {
        const sqlColumn = sqlColumnByName.get(columnName);
        const drizzleColumn = drizzleColumnByName.get(columnName);
        if (!sqlColumn || !drizzleColumn) continue;
        const sqlType = normalizeStorageType(sqlColumn.type);
        const drizzleType = normalizeStorageType(drizzleColumn.getSQLType());
        if (sqlType !== drizzleType || sqliteAffinity(sqlType) !== sqliteAffinity(drizzleType)) {
          differences.push(
            `${tableName}.${columnName}: storage type differs (SQL ${sqlType}/${sqliteAffinity(sqlType)}, Drizzle ${drizzleType}/${sqliteAffinity(drizzleType)})`,
          );
        }
        if ((sqlColumn.notnull === 1) !== drizzleColumn.notNull) {
          differences.push(
            `${tableName}.${columnName}: nullability differs (SQL notNull=${sqlColumn.notnull === 1}, Drizzle notNull=${drizzleColumn.notNull})`,
          );
        }
        const sqlDefault = normalizeDefaultSql(sqlColumn.dflt_value);
        const drizzleDefault = normalizeDrizzleDefault(drizzleColumn.default);
        // Compare unconditionally: one side declaring a default while the other
        // omits it IS drift — a null-guarded comparison silently passes it.
        if (sqlDefault !== drizzleDefault) {
          differences.push(
            `${tableName}.${columnName}: default differs (SQL ${stringify(sqlDefault)}, Drizzle ${stringify(drizzleDefault)})`,
          );
        }
      }

      const sqlPrimaryKey = sqlColumns
        .filter((column) => column.pk > 0)
        .sort((left, right) => left.pk - right.pk)
        .map((column) => column.name);
      const drizzlePrimaryKey =
        drizzleTable.primaryKeys.length > 0
          ? drizzleTable.primaryKeys.flatMap((key) => key.columns.map((column) => column.name))
          : drizzleTable.columns.filter((column) => column.primary).map((column) => column.name);
      if (stringify(sqlPrimaryKey) !== stringify(drizzlePrimaryKey)) {
        differences.push(
          `${tableName}: ordered primary key differs (SQL ${stringify(sqlPrimaryKey)}, Drizzle ${stringify(drizzlePrimaryKey)})`,
        );
      }

      const sqlFks = sqlForeignKeys(database, tableName);
      const drizzleFks = drizzleTable.foreignKeys
        .map((foreignKey) => {
          const reference = foreignKey.reference();
          return {
            columns: reference.columns.map((column) => column.name),
            foreignColumns: reference.foreignColumns.map((column) => column.name),
            foreignTable: getTableName(reference.foreignTable),
            onDelete: normalizeAction(foreignKey.onDelete),
            onUpdate: normalizeAction(foreignKey.onUpdate),
          } satisfies CanonicalForeignKey;
        })
        .sort((left, right) => stringify(left).localeCompare(stringify(right)));
      foreignKeyCount += sqlFks.length;
      // Compare unconditionally: an empty FK set on exactly one side is the
      // classic drift this gate exists for (a dropped .references() call would
      // otherwise short-circuit the whole comparison and pass silently).
      if (stringify(sqlFks) !== stringify(drizzleFks)) {
        differences.push(
          `${tableName}: foreign keys differ\n  SQL: ${stringify(sqlFks)}\n  Drizzle: ${stringify(drizzleFks)}`,
        );
      }

      const sqlIndexConfig = sqlIndexes(database, tableName);
      const drizzleIndexes = drizzleTable.indexes
        .map((index) => {
          const columns = index.config.columns.map(indexColumnName);
          if (columns.some((column) => !column)) {
            throw new Error(
              `Expression index ${index.config.name} is not supported by the drift gate`,
            );
          }
          return {
            columns,
            name: index.config.name,
            partialPredicate: index.config.where
              ? normalizeSqlExpression(DIALECT.sqlToQuery(index.config.where).sql)
              : null,
            unique: index.config.unique,
          } satisfies CanonicalIndex;
        })
        .sort((left, right) => left.name.localeCompare(right.name));
      const sqlExplicitNames = new Set(sqlIndexConfig.explicit.map((index) => index.name));
      const drizzleExplicit = drizzleIndexes.filter((index) => sqlExplicitNames.has(index.name));
      if (stringify(sqlIndexConfig.explicit) !== stringify(drizzleExplicit)) {
        differences.push(
          `${tableName}: explicit indexes differ\n  SQL: ${stringify(sqlIndexConfig.explicit)}\n  Drizzle: ${stringify(drizzleExplicit)}`,
        );
      }
      const drizzleInlineUniqueColumns = [
        ...drizzleIndexes
          .filter((index) => !sqlExplicitNames.has(index.name) && index.unique)
          .map((index) => index.columns),
        ...drizzleTable.uniqueConstraints.map((constraint) =>
          constraint.columns.map((column) => column.name),
        ),
        ...drizzleTable.columns.filter((column) => column.isUnique).map((column) => [column.name]),
      ].sort((left, right) => stringify(left).localeCompare(stringify(right)));
      if (stringify(sqlIndexConfig.inlineUniqueColumns) !== stringify(drizzleInlineUniqueColumns)) {
        differences.push(
          `${tableName}: inline UNIQUE constraints differ\n  SQL: ${stringify(sqlIndexConfig.inlineUniqueColumns)}\n  Drizzle: ${stringify(drizzleInlineUniqueColumns)}`,
        );
      }
      const unmatchedDrizzleIndexes = drizzleIndexes.filter(
        (index) => !sqlExplicitNames.has(index.name) && !index.unique,
      );
      if (unmatchedDrizzleIndexes.length > 0) {
        differences.push(
          `${tableName}: Drizzle-only non-unique indexes ${stringify(unmatchedDrizzleIndexes)}`,
        );
      }
      indexCount += sqlIndexConfig.explicit.length + sqlIndexConfig.inlineUniqueColumns.length;

      const sqlChecks = extractCheckExpressions(sqlTable.sql);
      sqlCheckCount += sqlChecks.length;
      if (sqlChecks.some((check) => check.length === 0)) {
        differences.push(`${tableName}: empty SQL CHECK constraint after normalization`);
      }
    }

    if (differences.length > 0) {
      console.error(`[check-local-schema-drift] failed (${differences.length} differences)`);
      for (const difference of differences) console.error(`- ${difference}`);
      process.exitCode = 1;
      return;
    }

    console.log(
      `[check-local-schema-drift] ok (${sqlTables.length} tables, ${columnCount} columns, ${foreignKeyCount} mirrored foreign keys, ${indexCount} indexes/unique constraints, ${sqlCheckCount} SQL CHECK constraints parsed)`,
    );
  } finally {
    database.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error('[check-local-schema-drift] failed');
  console.error(message);
  if (ABI_ERROR.test(message)) {
    console.error(
      'better-sqlite3 was built for a different Node ABI; run `pnpm rebuild better-sqlite3` and retry.',
    );
  }
  process.exitCode = 1;
});
