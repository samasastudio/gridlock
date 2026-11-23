import { existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

const PRODUCTION_TSCONFIGS = [
  "packages/core/tsconfig.json",
  "packages/widgets/tsconfig.json",
];

function isProductionSourceFile(relPath) {
  return (
    /^packages\/[^/]+\/src\/.+\.(?:ts|tsx)$/.test(relPath) &&
    !relPath.endsWith(".d.ts")
  );
}

export function evaluateProgramTypeHygiene(program, repoRoot) {
  const checker = program.getTypeChecker();
  const violations = [];

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    const relPath = relative(repoRoot, sourceFile.fileName).replace(/\\/g, "/");
    if (!isProductionSourceFile(relPath)) continue;

    const report = (node, kind, detail) => {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push(
        `${relPath}:${line + 1}: TypeScript \`any\` leak (${kind}) — ${detail}; annotate with \`unknown\` or a concrete domain type (CODING_STANDARDS.md §2)`
      );
    };

    const visit = (node) => {
      if (node.kind === ts.SyntaxKind.AnyKeyword) {
        report(node, "explicit any", "explicit `any` type keyword is prohibited");
        return;
      }

      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        const type = checker.getTypeAtLocation(node.name);
        if (type.flags & ts.TypeFlags.Any) {
          report(
            node.name,
            "inferred any variable",
            `variable "${node.name.text}" resolves to \`any\``
          );
        }
      }

      if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
        const type = checker.getTypeAtLocation(node.name);
        if (type.flags & ts.TypeFlags.Any) {
          report(
            node.name,
            "inferred any parameter",
            `parameter "${node.name.text}" resolves to \`any\``
          );
        }
      }

      if (ts.isReturnStatement(node) && node.expression) {
        const type = checker.getTypeAtLocation(node.expression);
        if (type.flags & ts.TypeFlags.Any) {
          report(
            node.expression,
            "inferred any return",
            "returned expression resolves to `any`"
          );
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return violations;
}

export function runTypeHygieneChecks(repoRoot = process.cwd()) {
  const violations = [];
  for (const relConfig of PRODUCTION_TSCONFIGS) {
    const configPath = resolve(repoRoot, relConfig);
    if (!existsSync(configPath)) continue;
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (configFile.error) {
      violations.push(
        `${relConfig}: Failed to read TypeScript config (${ts.flattenDiagnosticMessageText(configFile.error.messageText, " ")})`
      );
      continue;
    }
    const parsed = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      dirname(configPath)
    );
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    violations.push(...evaluateProgramTypeHygiene(program, repoRoot));
  }
  return violations;
}
