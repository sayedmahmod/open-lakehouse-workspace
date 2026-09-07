"use client";

/** CodeMirror SQL editor wired to Unity Catalog for identifier completion. */
import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { sql, SQLDialect } from "@codemirror/lang-sql";
import { EditorView, keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import CodeMirror from "@uiw/react-codemirror";
import React, { useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/lib/api";
import { useTheme } from "@/components/shell/ThemeProvider";

interface CompletionData {
  catalogs: string[];
  schemas: string[];
  tables: string[];
  columns: Record<string, { name: string; type: string }[]>;
  functions: string[];
}

/** Spark SQL dialect — @codemirror/lang-sql ships no Spark preset, so the
 *  keyword and type lists come from the Spark 4.1 SQL reference. */
const SparkSQL = SQLDialect.define({
  keywords:
    "add after all alter analyze and anti any archive array as asc at authorization between both bucket buckets by " +
    "cache cascade case cast change clear cluster clustered codegen collate collection column columns comment commit " +
    "compact compactions compute concatenate constraint cost create cross cube current current_date current_time " +
    "current_timestamp current_user data database databases day dbproperties defined delete delimited desc describe " +
    "dfs directories directory distinct distribute div drop else end escape escaped except exchange exists explain " +
    "export extended external extract false fetch fields filter fileformat first following for foreign format " +
    "formatted from full function functions global grant group grouping having hour if ignore import in index indexes " +
    "inner inpath inputformat insert intersect interval into is items join keys last lateral lazy leading left like " +
    "limit lines list load local location lock locks logical macro map matched merge minute month msck namespace " +
    "namespaces natural no not null nulls of on only option options or order out outer outputformat over overlaps " +
    "overlay overwrite partition partitioned partitions percent pivot placing position preceding primary principals " +
    "purge query range recordreader recordwriter recover reduce references refresh rename repair replace reset " +
    "restrict revoke right rlike role roles rollback rollup row rows schema schemas second select semi separated " +
    "serde serdeproperties session_user set sets show skewed some sort sorted start statistics stored stratify " +
    "struct substr substring table tables tablesample tblproperties temporary terminated then time to touch trailing " +
    "transaction transactions transform true truncate type unarchive unbounded uncache union unique unknown unlock " +
    "unset update use user using values vacuum optimize zorder version view views when where window with year",
  types:
    "boolean byte tinyint short smallint int integer long bigint float real double date timestamp timestamp_ntz " +
    "timestamp_ltz string binary decimal dec numeric void interval array struct map char varchar variant",
  builtin: "current_database current_catalog",
  backslashEscapes: true,
});

const EMPTY: CompletionData = { catalogs: [], schemas: [], tables: [], columns: {}, functions: [] };

export function useCompletionData() {
  const [data, setData] = useState<CompletionData>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    api.sql
      .completion()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        /* completion is a convenience; the editor still works without it */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return data;
}

export function SqlEditor({
  value,
  onChange,
  onRun,
  onSelectionChange,
  completion,
  height = "100%",
  placeholder,
  readOnly,
}: {
  value: string;
  onChange: (value: string) => void;
  onRun?: () => void;
  /** Reports the primary selection so a parent can drive selection-scoped edits.
   *  `rect` is the viewport position just above the selection start (for a
   *  floating affordance), or null when the selection is empty. */
  onSelectionChange?: (sel: {
    from: number;
    to: number;
    text: string;
    rect: { top: number; left: number } | null;
  }) => void;
  completion?: CompletionData;
  height?: string;
  placeholder?: string;
  readOnly?: boolean;
}) {
  const { theme } = useTheme();
  const [isDark, setIsDark] = useState(false);
  const runRef = useRef(onRun);
  runRef.current = onRun;
  const selRef = useRef(onSelectionChange);
  selRef.current = onSelectionChange;

  // Track the effective colour scheme, including "system".
  useEffect(() => {
    const compute = () => {
      const stamp = document.documentElement.getAttribute("data-theme");
      if (stamp === "dark") return true;
      if (stamp === "light") return false;
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    };
    setIsDark(compute());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChangeScheme = () => setIsDark(compute());
    mq.addEventListener("change", onChangeScheme);
    return () => mq.removeEventListener("change", onChangeScheme);
  }, [theme]);

  const extensions = useMemo(() => {
    const data = completion ?? EMPTY;

    const identifiers = (context: CompletionContext): CompletionResult | null => {
      const word = context.matchBefore(/[\w.]*/);
      if (!word || (word.from === word.to && !context.explicit)) return null;

      const options = [
        ...data.tables.map((name) => ({
          label: name,
          type: "class",
          detail: "table",
          boost: 3,
        })),
        // Bare table names, for when a catalog/schema is already in context.
        ...data.tables.map((name) => ({
          label: name.split(".").slice(-1)[0],
          type: "class",
          detail: name,
          boost: 2,
        })),
        ...data.schemas.map((name) => ({ label: name, type: "namespace", detail: "schema", boost: 1 })),
        ...data.catalogs.map((name) => ({ label: name, type: "namespace", detail: "catalog", boost: 1 })),
        ...data.functions.map((name) => ({ label: name, type: "function", detail: "function" })),
        ...Object.entries(data.columns).flatMap(([table, columns]) =>
          columns.map((column) => ({
            label: column.name,
            type: "property",
            detail: `${column.type} · ${table.split(".").slice(-1)[0]}`,
          })),
        ),
      ];

      return { from: word.from, options, validFor: /^[\w.]*$/ };
    };

    return [
      sql({ dialect: SparkSQL, upperCaseKeywords: true }),
      autocompletion({ override: [identifiers], activateOnTyping: true }),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (!selRef.current || (!update.selectionSet && !update.docChanged && !update.geometryChanged))
          return;
        const { from, to } = update.state.selection.main;
        let rect: { top: number; left: number } | null = null;
        if (to > from) {
          const c = update.view.coordsAtPos(from);
          if (c) rect = { top: c.top, left: c.left };
        }
        selRef.current({ from, to, text: update.state.doc.sliceString(from, to), rect });
      }),
      // Precedence must beat the default newline binding for Cmd/Ctrl-Enter.
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            preventDefault: true,
            run: () => {
              runRef.current?.();
              return true;
            },
          },
        ]),
      ),
    ];
  }, [completion]);

  return (
    <CodeMirror
      value={value}
      height={height}
      theme={isDark ? "dark" : "light"}
      extensions={extensions}
      onChange={onChange}
      placeholder={placeholder}
      editable={!readOnly}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: true,
        highlightActiveLineGutter: true,
        autocompletion: false,
        bracketMatching: true,
        closeBrackets: true,
        searchKeymap: false,
      }}
      style={{ height, fontSize: 13 }}
    />
  );
}
