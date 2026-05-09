const MODEL_FILENAME = "m.lp";

Module.Highs_readModel = Module["cwrap"]("Highs_readModel", "number", [
  "number",
  "string",
]);
const Highs_setIntOptionValue = Module["cwrap"](
  "Highs_setIntOptionValue",
  "number",
  ["number", "string", "number"]
);
const Highs_setDoubleOptionValue = Module["cwrap"](
  "Highs_setDoubleOptionValue",
  "number",
  ["number", "string", "number"]
);
const Highs_setStringOptionValue = Module["cwrap"](
  "Highs_setStringOptionValue",
  "number",
  ["number", "string", "string"]
);
const Highs_setBoolOptionValue = Module["cwrap"](
  "Highs_setBoolOptionValue",
  "number",
  ["number", "string", "number"]
);
Module.Highs_writeSolutionPretty = Module["cwrap"](
  "Highs_writeSolutionPretty",
  "number",
  ["number", "string"]
);

const MODEL_STATUS_CODES = /** @type {const} */ ({
  0: "Not Set",
  1: "Load error",
  2: "Model error",
  3: "Presolve error",
  4: "Solve error",
  5: "Postsolve error",
  6: "Empty",
  7: "Optimal",
  8: "Infeasible",
  9: "Primal infeasible or unbounded",
  10: "Unbounded",
  11: "Bound on objective reached",
  12: "Target for objective reached",
  13: "Time limit reached",
  14: "Iteration limit reached",
  15: "Unknown",
});

/** @typedef {Object} Highs */

var /** @type {()=>Highs} */ _Highs_create,
  /** @type {(arg0:Highs)=>void} */ _Highs_run,
  /** @type {(arg0:Highs)=>void} */ _Highs_destroy,
  /** @type {(arg0:Highs, arg1:number)=>(keyof (typeof MODEL_STATUS_CODES))} */ _Highs_getModelStatus,
  /** @type {(arg0:Highs)=>number} */ _Highs_getNumCol,
  /** @type {(arg0:Highs)=>number} */ _Highs_getNumRow,
  /** @type {(arg0:Highs, arg1:number, arg2:number, arg3:number, arg4:number, arg5:number, arg6:number, arg7:number, arg8:number)=>number} */ _Highs_getIis,
  /** @type {any}*/ FS;

/**
 * Solve a model in the CPLEX LP file format.
 * @param {string} model_str The problem to solve in the .lp format
 * @param {undefined | import("../types").HighsOptions} highs_options Options to pass the solver. See https://github.com/ERGO-Code/HiGHS/blob/v1.14.0/src/lp_data/HighsOptions.h
 * @returns {import("../types").HighsSolution} The solution
 */
Module["solve"] = function (model_str, highs_options) {
  FS.writeFile(MODEL_FILENAME, model_str);
  const highs = _Highs_create();
  assert_ok(
    () => Module.Highs_readModel(highs, MODEL_FILENAME),
    "read LP model (see http://web.mit.edu/lpsolve/doc/CPLEX-format.htm)"
  );
  const options = highs_options || {};
  // Intercept log_to_console: we always keep HiGHS logging to stdout so we
  // can capture it, but we use the user's log_to_console preference to decide
  // whether to include the raw log in the returned solution object.
  const return_log = "log_to_console" in options ? !!options["log_to_console"] : false;
  for (const option_name in options) {
    if (option_name === "log_to_console") continue; // handled above
    const option_value = options[option_name];
    const type = typeof option_value;
    let setoption;
    if (type === "number") setoption = setNumericOption;
    else if (type === "boolean") setoption = Highs_setBoolOptionValue;
    else if (type === "string") setoption = Highs_setStringOptionValue;
    else
      throw new Error(
        `Unsupported option value type ${option_value} for '${option_name}'`
      );
    assert_ok(
      () => setoption(highs, option_name, option_value),
      `set option '${option_name}'`
    );
  }
  assert_ok(() => _Highs_run(highs), "solve the problem");
  const status =
    MODEL_STATUS_CODES[_Highs_getModelStatus(highs, 0)] || "Unknown";
  // Capture solver log before flushing stdout
  const log = stdout_lines.join("\n");
  // Flush the content of stdout in order to have a clean stream before writing the solution in it
  stdout_lines.length = 0;
  assert_ok(
    () => Module.Highs_writeSolutionPretty(highs, ""),
    "write and extract solution"
  );
  _Highs_destroy(highs);
  const output = parseResult(stdout_lines, status);
  if (return_log) output["Log"] = log;
  // Flush the content of stdout and stderr because these streams are not used anymore
  stdout_lines.length = 0;
  stderr_lines.length = 0;
  return output;
};

/**
 * Compute an Irreducible Infeasible Subsystem (IIS) for an infeasible model.
 * The model must have been loaded via the filesystem before calling this.
 * Returns the indices and bound statuses of the columns and rows in the IIS,
 * or null if no IIS was found (e.g. the model is feasible).
 *
 * @param {string} model_str The infeasible problem in .lp format
 * @param {undefined | import("../types").HighsOptions} highs_options Options to pass the solver
 * @returns {import("../types").HighsIis | null}
 */
Module["getIis"] = function (model_str, highs_options) {
  FS.writeFile(MODEL_FILENAME, model_str);
  const highs = _Highs_create();
  assert_ok(
    () => Module.Highs_readModel(highs, MODEL_FILENAME),
    "read LP model (see http://web.mit.edu/lpsolve/doc/CPLEX-format.htm)"
  );
  const options = highs_options || {};
  for (const option_name in options) {
    const option_value = options[option_name];
    const type = typeof option_value;
    let setoption;
    if (type === "number") setoption = setNumericOption;
    else if (type === "boolean") setoption = Highs_setBoolOptionValue;
    else if (type === "string") setoption = Highs_setStringOptionValue;
    else
      throw new Error(
        `Unsupported option value type ${option_value} for '${option_name}'`
      );
    assert_ok(
      () => setoption(highs, option_name, option_value),
      `set option '${option_name}'`
    );
  }

  const num_col = _Highs_getNumCol(highs);
  const num_row = _Highs_getNumRow(highs);

  // Allocate output buffers on the WASM heap (HighsInt = 4 bytes)
  const INT_SIZE = 4;
  /** @type {any} */ const M = Module;
  const ptr_iis_num_col = M._malloc(INT_SIZE);
  const ptr_iis_num_row = M._malloc(INT_SIZE);
  const ptr_col_index  = M._malloc(INT_SIZE * num_col);
  const ptr_row_index  = M._malloc(INT_SIZE * num_row);
  const ptr_col_bound  = M._malloc(INT_SIZE * num_col);
  const ptr_row_bound  = M._malloc(INT_SIZE * num_row);
  const ptr_col_status = M._malloc(INT_SIZE * num_col);
  const ptr_row_status = M._malloc(INT_SIZE * num_row);

  try {
    assert_ok(
      () => _Highs_getIis(
        highs,
        ptr_iis_num_col, ptr_iis_num_row,
        ptr_col_index, ptr_row_index,
        ptr_col_bound, ptr_row_bound,
        ptr_col_status, ptr_row_status
      ),
      "compute IIS"
    );

    const iis_num_col = M.HEAP32[ptr_iis_num_col >> 2];
    const iis_num_row = M.HEAP32[ptr_iis_num_row >> 2];

    // No IIS found
    if (iis_num_col === 0 && iis_num_row === 0) return null;

    const col_index  = Array.from(M.HEAP32.subarray(ptr_col_index  >> 2, (ptr_col_index  >> 2) + iis_num_col));
    const row_index  = Array.from(M.HEAP32.subarray(ptr_row_index  >> 2, (ptr_row_index  >> 2) + iis_num_row));
    const col_bound  = Array.from(M.HEAP32.subarray(ptr_col_bound  >> 2, (ptr_col_bound  >> 2) + iis_num_col));
    const row_bound  = Array.from(M.HEAP32.subarray(ptr_row_bound  >> 2, (ptr_row_bound  >> 2) + iis_num_row));

    return { col_index, row_index, col_bound, row_bound };
  } finally {
    M._free(ptr_iis_num_col);
    M._free(ptr_iis_num_row);
    M._free(ptr_col_index);
    M._free(ptr_row_index);
    M._free(ptr_col_bound);
    M._free(ptr_row_bound);
    M._free(ptr_col_status);
    M._free(ptr_row_status);
    _Highs_destroy(highs);
    stdout_lines.length = 0;
    stderr_lines.length = 0;
  }
};

function setNumericOption(highs, option_name, option_value) {
  // Try int first for integer values to avoid HiGHS logging a spurious error
  // when the option only accepts integers (e.g. iis_strategy).
  if (option_value === (option_value | 0)) {
    const result = Highs_setIntOptionValue(highs, option_name, option_value);
    if (result !== -1) return result;
  }
  return Highs_setDoubleOptionValue(highs, option_name, option_value);
}

function parseNum(s) {
  if (s === "inf") return 1 / 0;
  else if (s === "-inf") return -1 / 0;
  else return +s;
}

const known_columns = {
  "Index": (s) => parseInt(s),
  "Lower": parseNum,
  "Upper": parseNum,
  "Primal": parseNum,
  "Dual": parseNum,
};

/**
 * @param {string} s
 * @returns {string[]} The values (words) of a line
 */
function lineValues(s) {
  return s.match(/[^\s]+/g) || [];
}

/**
 *
 * @param {string[]} headers
 * @param {string} line
 * @returns {Record<string, string | number>}
 */
function lineToObj(headers, line) {
  const values = lineValues(line);
  /** @type {Record<string, string | number>} */
  const result = {};
  for (let idx = 0; idx < values.length; idx++) {
    if (idx >= headers.length)
      throw new Error("Unable to parse solution line: " + line);
    const value = values[idx];
    const header = headers[idx];
    const parser = known_columns[header];
    const parsed = parser ? parser(value) : value;
    result[header] = parsed;
  }
  return result;
}

/**
 * Parse HiGHS output lines
 * @param {string[]} lines stdout from highs
 * @param {import("../types").HighsModelStatus} status status
 * @returns {import("../types").HighsSolution} The solution
 */
function parseResult(lines, status) {
  // Filter out WARNING lines emitted by HiGHS (e.g. for empty models or missing names)
  lines = lines.filter((l) => !l.startsWith("WARNING:"));

  if (lines.length < 3)
    throw new Error("Unable to parse solution. Too few lines.");

  let headers = headersForNonEmptyColumns(lines[1], lines[2]);

  var result = {
    "Status": /** @type {"Infeasible"} */ (status),
    "Columns": {},
    "Rows": [],
    "ObjectiveValue": NaN,
  };

  // Parse columns
  for (var i = 2; lines[i] != "Rows"; i++) {
    const obj = lineToObj(headers, lines[i]);
    if (!obj["Type"]) obj["Type"] = "Continuous";
    result["Columns"][obj["Name"]] = obj;
  }

  // Parse rows
  headers = headersForNonEmptyColumns(lines[i + 1], lines[i + 2]);
  for (var j = i + 2; lines[j] != ""; j++) {
    result["Rows"].push(lineToObj(headers, lines[j]));
  }

  // Parse objective value
  result["ObjectiveValue"] = parseNum(
    lines[j + 3].match(/Objective value: (.+)/)[1]
  );
  return result;
}

/**
 * Finds the non headers for non-empty columns in a HiGHS output
 * @param {string} headerLine The line containing the header names
 * @param {string} firstDataLine The line immediately below the header line
 * @returns {string[]} The headers for which there is data available
 */
function headersForNonEmptyColumns(headerLine, firstDataLine) {
  // Headers can correspond to empty columns. The contents of a column can be left or right
  // aligned, so we determine if a given header should be included by looking at whether
  // the row immediately below the header has any contents.
  return [...headerLine.matchAll(/[^\s]+/g)]
    .filter(
      (match) =>
        firstDataLine[match.index] !== " " ||
        firstDataLine[match.index + match[0].length - 1] !== " "
    )
    .map((match) => match[0]);
}

function assert_ok(fn, action) {
  let err;
  try {
    err = fn();
  } catch (e) {
    err = e;
  }
  // Allow HighsStatus::kOk (0) and HighsStatus::kWarning (1) but
  // disallow other values, such as e.g. HighsStatus::kError (-1).
  if (err !== 0 && err !== 1)
    throw new Error("Unable to " + action + ". HiGHS error " + err);
}
