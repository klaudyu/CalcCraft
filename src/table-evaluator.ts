// table-evaluator.ts
import { evaluate } from "mathjs";

const debug = false;

enum celltype {
    number = 1,
    formula,
    matrix,
    text
}
enum cellstatus {
    none = 1,
    computing,
    iscomputed,
    error
}

class InfiniteLoop extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InfiniteLoop";
    }
}


export interface TableResult {
    values: any[][];
    errors: (string | null)[][];
    cellTypes: celltype[][];
}

export class TableEvaluator {
    tableData: any[][] = [];
    formulaData: any[][] = [];
    celltype: celltype[][] = [];
    cellstatus: cellstatus[][] = [];
    errors: (string | null)[][] = [];
    parents: [number, number][][][] = [];
    children: [number, number][][][] = [];
    maxcols: number = 0;
    maxrows: number = 0;
    useBool = false;

    evaluateTable(gridData: string[][]): TableResult {
        // Reset all arrays
        this.tableData = [];
        this.formulaData = [];
        this.celltype = [];
        this.cellstatus = [];
        this.errors = [];
        this.parents = [];
        this.children = [];
        this.maxcols = 0;
        this.maxrows = 0;

        // Initialize arrays
        this.initializeArrays(gridData);

        // Parse grid
        this.parseGridData(gridData);

        // Compute all cells
        this.computeAllCells();

        return {
            values: this.tableData,
            errors: this.errors,
            cellTypes: this.celltype
        };
    }

    private initializeArrays(gridData: string[][]) {
        this.maxrows = gridData.length;
        this.maxcols = gridData[0]?.length || 0;

        for (let rowIndex = 0; rowIndex < this.maxrows; rowIndex++) {
            this.tableData[rowIndex] = [];
            this.formulaData[rowIndex] = [];
            this.celltype[rowIndex] = [];
            this.cellstatus[rowIndex] = [];
            this.errors[rowIndex] = [];
            this.parents[rowIndex] = [];
            this.children[rowIndex] = [];

            for (let colIndex = 0; colIndex < this.maxcols; colIndex++) {
                this.cellstatus[rowIndex][colIndex] = cellstatus.none;
                this.errors[rowIndex][colIndex] = null;
                this.parents[rowIndex][colIndex] = [];
                this.children[rowIndex][colIndex] = [];
                this.tableData[rowIndex][colIndex] = null;
            }
        }
    }

    private parseGridData(gridData: string[][]) {
        for (let rowIndex = 0; rowIndex < this.maxrows; rowIndex++) {
            for (let colIndex = 0; colIndex < this.maxcols; colIndex++) {
                const cellContent = gridData[rowIndex]?.[colIndex] || "";
                const r = this.cords2ref(rowIndex, colIndex);

                if (cellContent.startsWith("=")) {
                    // Formula cell
                    this.debug(`parseGridData ${r}: formula : ${cellContent}`);
                    this.formulaData[rowIndex][colIndex] = cellContent;
                    this.cellstatus[rowIndex][colIndex] = cellstatus.none;
                    this.celltype[rowIndex][colIndex] = celltype.formula;
                    this.tableData[rowIndex][colIndex] = cellContent;
                } else if (cellContent === "") {
                    // Empty cell
                    this.debug(`parseGridData ${r}: emptycell : ${cellContent}`);
                    this.formulaData[rowIndex][colIndex] = null;
                    this.cellstatus[rowIndex][colIndex] = cellstatus.iscomputed;
                    this.celltype[rowIndex][colIndex] = celltype.number;
                    this.tableData[rowIndex][colIndex] = null;
                } else {
                    // Value cell - could be number, unit, or text
                    this.formulaData[rowIndex][colIndex] = null;
                    this.cellstatus[rowIndex][colIndex] = cellstatus.iscomputed;

                    // Parse for units
                    const parsed = this.parseUnitValue(cellContent);

                    if (parsed.unit) {
                        // Number with unit
                        this.debug(`parseGridData ${r}: number with unit : ${cellContent}`);
                        this.celltype[rowIndex][colIndex] = celltype.number;
                        this.tableData[rowIndex][colIndex] = cellContent;
                    } else if (!isNaN(parsed.value) && isFinite(parsed.value)) {
                        // Pure number
                        this.debug(`parseGridData ${r}: pure number: ${cellContent}`);
                        this.celltype[rowIndex][colIndex] = celltype.number;
                        this.tableData[rowIndex][colIndex] = parsed.value;
                    } else {
                        // Text
                        this.debug(`parseGridData ${r}: just text: ${cellContent}`);
                        this.celltype[rowIndex][colIndex] = celltype.text;
                        this.tableData[rowIndex][colIndex] = cellContent;
                    }
                }
            }
        }
    }

    private computeAllCells() {
        for (let i = 0; i < this.tableData.length; i++) {
            for (let j = 0; j < this.tableData[i].length; j++) {
                try {
                    this.getValueByCoordinates(i, j, 0);
                } catch (error) {
                    if (error instanceof InfiniteLoop) {
                        this.errors[i][j] = "loop\n" + error.message;
                    }else{
                        this.errors[i][j] =  error.message;
                    }
                    console.log(error);
                }
            }
        }
    }

    bool2nr(value: any): any {
        return typeof value === "boolean" ? +value : value;
    }

    cords2ref(row: number, col: number): string {
        const colStr = String.fromCharCode("a".charCodeAt(0) + col);
        return colStr + (row + 1);
    }

    ref2cords(ref: string, formulaRow = 0, formulaCol = 0): [number, number] | null {
        const match = ref.match(/^([a-z]+|([+-]?)\d+c)(\d+|([+-]?)\d+r)$/);

        if (!match) {
            this.errors[formulaRow][formulaCol] = "invalid cell reference";
            return null;
        }

        const [, colPart, altColPart, rowPart, altRowPart] = match;

        let col, row;

        if (colPart && colPart[0].match(/[a-z]/)) {
            col = this.letter2col(colPart);
        } else if (colPart.endsWith("c")) {
            col = parseInt(colPart.replace("c", "")) + (altColPart ? formulaCol : -1);
        } else {
            col = parseInt(colPart);
        }

        if (rowPart && rowPart.includes("r")) {
            const rw = parseInt(rowPart.replace("r", ""));
            row = altRowPart ? formulaRow + rw : rw - 1;
        } else {
            row = parseInt(rowPart) - 1;
        }

        return [row, col];
    }

    letter2col(letter: string): number {
        return letter.charCodeAt(0) - "a".charCodeAt(0);
    }

    number2row(nr: number): number {
        return nr - 1;
    }

    copyArrayValues(sourceArray: any[][], targetArray: any[][], row: number, col: number): void {
        for (let i = 0; i < sourceArray.length; i++) {
            for (let j = 0; j < sourceArray[i].length; j++) {
                if (row + i < targetArray.length && col + j < targetArray[row + i].length) {
                    targetArray[row + i][col + j] = this.useBool
                        ? sourceArray[i][j]
                        : this.bool2nr(sourceArray[i][j]);
                }
            }
        }
    }


    private parseUnitValue(cellContent: any): { value: number; unit: string | null } {
        if (cellContent === null || cellContent === undefined) return { value: NaN, unit: null };
        if (typeof cellContent === 'number') return { value: Number.isFinite(cellContent) ? cellContent : NaN, unit: null };

        // Normalize odd whitespace / zero-width / BOM
        let s = String(cellContent)
            .replace(/\u00A0/g, ' ')
            .replace(/[\u200B\uFEFF]/g, '')
            .trim();

        // Optional: accept comma decimals like "1,5" -> "1.5" (enable if desired)
        // if (/^\d+,\d+$/.test(s)) s = s.replace(',', '.');

        // Number pattern that requires at least one digit:
        // - \d+(\.\d*)?   => 1, 1., 1.5
        // - |\.\d+        => .5
        // optional exponent part (e/E)
        const numberPattern = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';

        // pure number
        const pureNumberRe = new RegExp(`^${numberPattern}$`);
        if (pureNumberRe.test(s)) {
            const v = Number(s);
            return { value: Number.isFinite(v) ? v : NaN, unit: null };
        }

        // number + space + unit (e.g. "5 kg")
        const spacedUnitRe = new RegExp(`^(${numberPattern})[\\s\\u00A0]+(.+)$`);
        const spacedMatch = s.match(spacedUnitRe);
        if (spacedMatch) {
            const value = Number(spacedMatch[1]);
            if (Number.isFinite(value)) return { value, unit: spacedMatch[2].trim() };
        }

        // number immediately followed by unit (e.g. "5kg", "12.5m", "100%")
        const attachedUnitRe = new RegExp(`^(${numberPattern})([^\\d\\s].*)$`);
        const attachedMatch = s.match(attachedUnitRe);
        if (attachedMatch) {
            const value = Number(attachedMatch[1]);
            if (Number.isFinite(value)) return { value, unit: attachedMatch[2].trim() };
        }

        // not a number (or number-with-unit we accept)
        return { value: NaN, unit: null };
    }


    getValueByCoordinates(row: number, col: number, depth=0) {
        const r = this.cords2ref(row, col);
        this.debug(`getValueByCoordinates ${r}`, depth);

        if (this.cellstatus[row][col] == cellstatus.iscomputed) {
            const val = this.tableData[row][col];
            this.debug(`getValueByCoordinates already computed "${r}":${val}`,depth);
            //if (r==='a4') debugger;

            // Return null for empty cells
            if (val === null) return null;

            // Handle text cells - return as quoted string for mathjs
            if (this.celltype[row][col] === celltype.text) {
                return `"${val}"`;
            }

            // Handle unit values
            if (typeof val === "string") {
                const parsed = this.parseUnitValue(val);
                if (parsed.unit) {
                    // Return as mathjs unit format: "value unit"
                    return `${parsed.value} ${parsed.unit}`;
                }
                // This shouldn't happen anymore since we identify text in parseGridData
                return `"${val}"`;
            }

            if (typeof val === "number") {
                return val;
            }

            if (this.useBool) return val;
            return this.bool2nr(val);
        } else {
            if (this.cellstatus[row][col] == cellstatus.computing) {
                this.debug("********infinite loop*************",depth);
                const ref = this.cords2ref(row, col);
                this.debug(`${ref}`,depth);
                throw new InfiniteLoop(`${ref}`);
            }

            this.cellstatus[row][col] = cellstatus.computing;
            const formula = this.formulaData[row][col].slice(1);

            const ref = this.cords2ref(row, col);
            if (debug) {
                this.debug(`we are asked to fill in at ${ref} with formula: ${formula}`,depth);
            }

            let processedformula;
            try {
                processedformula = this.parsefunction(formula, [row, col],depth);
            } catch (error) {
                if (error instanceof InfiniteLoop) {
                    this.errors[row][col] = "loop\n" + error.message;
                    throw new InfiniteLoop(`${ref}`);
                }
                this.errors[row][col] = error.message;
                throw error;
            }

            // In getValueByCoordinates method, replace the result handling section:

            try {
                this.debug(`we will evaluate the formula: ${processedformula}`);
                const result = evaluate(processedformula);
                this.debug(
                    `we were asked to fill in at ${this.cords2ref(
                        row,
                        col
                    )} with formula: ${formula} ; the result is ${result}`
                );

                // Handle mathjs Matrix objects (like DenseMatrix2)
                if (result && typeof result === "object" && result.constructor?.name?.includes("Matrix")) {
                    // Convert mathjs Matrix to plain array using toArray()
                    const matrixArray = result.toArray();
                    return this.fillInMatrix(row, col, matrixArray);
                }

                // Handle mathjs Unit objects
                if (result && typeof result === "object" && result.constructor?.name === "Unit") {
                    this.cellstatus[row][col] = cellstatus.iscomputed;
                    this.tableData[row][col] = result;
                    return result;
                }

                // Check if result is already a plain JavaScript array
                if (Array.isArray(result)) {
                    return this.fillInMatrix(row, col, result);
                }

                // Try to parse as JSON only if it's a string (legacy support)
                if (typeof result === "string") {
                    try {
                        const parsed = JSON.parse(result);
                        if (Array.isArray(parsed)) {
                            return this.fillInMatrix(row, col, parsed);
                        }
                    } catch {
                        // Not JSON, continue with regular handling
                    }
                }

                // Regular scalar result
                this.cellstatus[row][col] = cellstatus.iscomputed;
                this.tableData[row][col] = result;
                return result;
            } catch (error) {
                this.errors[row][col] = error.message;
                this.cellstatus[row][col] = cellstatus.iscomputed;
                this.tableData[row][col] = null;
                const r = this.cords2ref(row, col);
                this.debug(`error computing cell ${r}`);
                return null;
            }

        }
    }

    fillInMatrix(row: number, col: number, parsed: any[][], depth=0): any {
        //now we got a matrix or vector we have to clear recompute the values of all the
        // children of these cells, but not on the main cell
        // normally if a cell depends on another cell first it asks it to calculate itself
        // but these matrices were not taken into account, as they expand more than one cell
        // Another solution would have been to parse the whole table first, to find the matrices
        // and compute the dependencies, and then again to compute

        //FIXME: if a cell is asked to recompute it's values
        // now we add the children twice. should keep track, of
        // how many times we compute and only first time add children
        const ismatrix = parsed.every((item: any[]) => Array.isArray(item));
        //if (!ismatrix) parsed=[parsed];
        if (!ismatrix) parsed = parsed.map((n: any) => [n]);

        this.copyArrayValues(parsed, this.tableData, row, col);
        //we assume here that this cell is computed
        this.cellstatus[row][col] = cellstatus.iscomputed;

        //then we clean all the children of the values that were
        //overwritten by writing the matrix
        parsed.forEach((parsedrow: any[], i: number) => {
            parsedrow.forEach((_: any, j: number) => {
                if (row + i < this.tableData.length && col + j < this.tableData[0].length) {
                    if (i || j) {
                        //if this cell contained a formula we delete it and also the parents
                        this.parents[row + i][col + j] = [];
                        this.formulaData[row + i][col + j] = null;
                        this.cellstatus[row + i][col + j] = cellstatus.iscomputed;

                        try {
                            this.cleanupchildren([row + i, col + j], [row, col]); //the children of this (and their children...) will be marked as not computed
                        } catch (error) {
                            if (error instanceof InfiniteLoop) {
                                this.errors[row][col] = error.message;
                            } else {
                                throw error;
                            }
                        }
                        //the formula cell becomes the parent of every matrix cell (i!=0 and j!=0)
                        this.parents[row + i][col + j].push([row, col]);
                        this.children[row][col].push([row + i, col + j]);

                        this.celltype[row + i][col + j] = celltype.matrix;
                        this.debug(
                            `parents of ${this.cords2ref(row + i, col + j)} are ${this.parents[row + i][col + j] }`
                        );
                    }
                }
            });
        });

        //if at this point our main cell status is not computed,
        // then it means that this cell matrix is affecting
        //the value of the formula so we throw an error
        // this should not happen though, as we implemented
        //another error checking with cleanupchildren, where we
        //pass the address of the root formula for the matrix,
        // and if a child tries to clean that, it throws an error
        if (this.cellstatus[row][col] != cellstatus.iscomputed) {
            throw new Error("matrix\nloop");
        }

        //now that we filled the values in, we can recompute the children
        //we only have to call getValueByCoordinates for each child and child's child
        //basically all cells that depend on this range that got overwritten by the matrix
        parsed.forEach((tmprow: any[], i: number) => {
            tmprow.forEach((tmpcell: any, j: number) => {
                if (
                    (i || j) &&
                    row + i < this.tableData.length &&
                    col + j < this.tableData[0].length
                ) {
                    this.computechildren(row + i, col + j); //the children of this (and their children...)
                }
            });
        });

        //this.celltype[row][col]=celltype.formula;
        return parsed[0][0];
    }




    cleanupchildren([row, col]: [number, number], [rootRow, rootCol]: [number, number], i = 0, depth=0): void {
        //set the parents for [row,col] and its parents computed to none
        //the whole process was initiated by the matrix formula at rootRow,rootCol
        //so if, one of the children or children of chilren,...
        //wants to cleanup the rootcell, it means there is a loop
        if (i++ > 10) {
            throw new Error(`too high recursivity on cleanupchildren`);
        }
        //we already cleand it up
        this.children[row][col].forEach(([r, c]) => {
            this.debug(`cleanup? status for ${this.cords2ref(r, c)} is ${this.cellstatus[r][c]} `);
            if (this.cellstatus[r][c] === cellstatus.iscomputed) {
                if (r === rootRow && c === rootCol) {
                    //we are trying to clean up the matrix cell
                    //which would force it to recompute
                    throw new InfiniteLoop(`matrix\nloop ${this.cords2ref(row, col)}`);
                }
                this.debug("yes, cleanup");
                this.cellstatus[r][c] = cellstatus.none;
                this.cleanupchildren([r, c], [rootRow, rootCol], i);
            } else {
                this.debug("nope");
            }
        });
    }
    computechildren(row: number, col: number, i = 0, depth=0): void {
        this.debug(
            `recomputing the children of ${this.cords2ref(row, col)}: ${this.children[row][col]
                .map(([r, c]) => this.cords2ref(r, c))
                .join(", ")}`,depth
        );

        if (i++ > 100) {
            throw new Error(`too high recursivity on computechildren`);
        }
        this.children[row][col].forEach(([r, c]) => {
            if (this.cellstatus[r][c] !== cellstatus.iscomputed) {
                const res = this.getValueByCoordinates(r, c, depth);
                this.debug(`value for ${this.cords2ref(r, c)} is ${res} `);
                this.debug(`status for ${this.cords2ref(r, c)} is ${this.cellstatus[r][c]} `);
                this.computechildren(r, c,i+1, depth+1);
            }
        });
    }


    getValuebyReference(ref: string, formulaRow = 0, formulaCol = 0, depth=0): string | number {
        const coords = this.ref2cords(ref, formulaRow, formulaCol);
        if (!coords) throw new Error("invalid cell reference");
        const [row, col] = coords;
        if (row < 0 || row > this.maxrows - 1 || col < 0 || col > this.maxcols - 1) {
            throw new Error("cell\nout of\ntable");
        }
        this.parents[formulaRow][formulaCol].push([row, col]);

        //this.debug(`{cords2ref[row,col]} is a parent of {cords2ref(formulaRow,formulaCol)}`);
        this.children[row][col].push([formulaRow, formulaCol]);
        return this.getValueByCoordinates(row, col, depth);
    }

    findclosingbracket(formula: string): string {
        let counter = 1;
        let pos = 0;

        while (counter > 0 && pos < formula.length) {
            if (formula[pos] === "(") counter++;
            else if (formula[pos] === ")") counter--;

            pos++;
        }
        const contentInsideParenthesis = formula.substring(0, pos - 1);
        return contentInsideParenthesis;
    }

    parsefunction(formula: string, pos: [number, number] = [0, 0], depth=0): string {
        //these are the position of the calling cell; useful for relative coordinates
        //also for puting asside the reference list for higlighting
        const [formulaRow, formulaCol] = pos;

        this.debug(`we parsefunction; ${this.cords2ref(formulaRow, formulaCol)} (location:${formulaRow},${formulaCol})`);
        let i = 0;
        let results = "";

        while (i < formula.length) {
            if (formula[i] === "(") {
                //look inside paranthesis, end expand them, recursively
                const contentInsideParenthesis = this.findclosingbracket(formula.slice(i + 1));
                //we call here the same function with the parantheses contents
                const res = this.parsefunction(contentInsideParenthesis, [formulaRow, formulaCol],depth+1);
                results += "(" + res + ")";
                i += contentInsideParenthesis.length + 2;
                this.debug(`${contentInsideParenthesis}`);
                this.debug(`the rest is ${formula.slice(i)}`);
            } else {
                const restformula = formula.slice(i);
                this.debug(`rest formula is:${restformula}`);
                const matchCell = restformula.match(/^([a-z]|[+-]?\d+c)([+-]?\d+r|\d+)/);

                //const matchOp = restformula.match(/^[+\-*/]/);

                const matchRange = restformula.match(
                    /^([a-z]|[+-]?\d+c)([+-]?\d+r|\d+):([a-z]|[+-]?\d+c)([+-]?\d+r|\d+)/
                );

                const matchMatrix = restformula.match(
                    //basically matchRange but between `[` `]`
                    /^\[([a-z]|[+-]\d+c)([+-]\d+r|\d+):([a-z]|[+-]\d+c)([+-]\d+r|\d+)\]/
                );

                const matchformula = restformula.match(/^[a-zA-Z]{3,}\(/);

                const matchNum = restformula.match(/^\d+/);

                //const matchRange=restformula.match(/^[a-z]\d+:[a-z]\d+/); //normal range
                //const matchRange = restformula.match(/^[a-z](?:\+|-)?\d+:[a-z](?:\+|-)?\d+/);

                const matchRangeCol = restformula.match(/^[a-z]:[a-z]/); //column range
                const matchRangeColMatrix = restformula.match(/^\[[a-z]:[a-z]\]/); //column range
                const matchRangeRow = restformula.match(/^\d+:\d+/); //row range

                if (matchRange) {
                    /* normal range a3:b7 or a-3:b+7, or anything in between;
                        the rows and columns are mentioned, either absolute or relative */
                    this.debug(`we matched a range`);
                    i += matchRange[0].length - 1;
                    const [start, end] = matchRange[0].split(":"); // Split the range into start and end
                    const startCoords = this.ref2cords(start, formulaRow, formulaCol);
                    const endCoords = this.ref2cords(end, formulaRow, formulaCol);
                    if (!startCoords || !endCoords) throw new Error("invalid range reference");
                    const [startRow, startCol] = startCoords;
                    const [endRow, endCol] = endCoords;
                    this.debug(`we look for range till ${this.cords2ref(endRow, endCol)}`);
                    results += this.unfoldRange(startRow, endRow, startCol, endCol, pos, undefined,undefined,depth+1);
                } else if (matchMatrix) {
                    this.debug(`we matched a matrix`);
                    i += matchMatrix[0].length - 1;
                    const [start, end] = matchMatrix[0].slice(1, -1).split(":"); // Split the range into start and end
                    const startCoords = this.ref2cords(start, formulaRow, formulaCol);
                    const endCoords = this.ref2cords(end, formulaRow, formulaCol);
                    if (!startCoords || !endCoords) throw new Error("invalid range reference");
                    const [startRow, startCol] = startCoords;
                    const [endRow, endCol] = endCoords;
                    this.debug(`we look for range till ${this.cords2ref(endRow, endCol)}`);
                    results += this.unfoldRange(startRow, endRow, startCol, endCol, pos, undefined, undefined,depth+1);
                } else if (matchRangeCol) {
                    this.debug(`we matched a column range`);
                    i += matchRangeCol[0].length - 1;
                    const [start, end] = matchRangeCol[0].split(":"); // Split the range into start and end
                    const [startCol, startRow] = [this.letter2col(start), 1];
                    const [endCol, endRow] = [this.letter2col(end), this.maxrows - 1];
                    results += this.unfoldRange(startRow, endRow, startCol, endCol, pos, undefined,undefined,depth+1);
                } else if (matchRangeColMatrix) {
                    this.debug(`we matched a column range Matrix`);
                    i += matchRangeColMatrix[0].length - 1;
                    const [start, end] = matchRangeColMatrix[0].slice(1, -1).split(":"); // Split the range into start and end
                    const [startCol, startRow] = [this.letter2col(start), 1];
                    const [endCol, endRow] = [this.letter2col(end), this.maxrows - 1];
                    results += this.unfoldRange(startRow, endRow, startCol, endCol, pos, undefined,undefined,depth+1);
                } else if (matchRangeRow) {
                    this.debug(`we matched a row range`);
                    i += matchRangeRow[0].length - 1;
                    const [start, end] = matchRangeRow[0].split(":"); // Split the range into start and end
                    const startCol = 0;
                    const endCol = this.maxcols - 1;
                    const startRow = this.number2row(parseInt(start));
                    const endRow = this.number2row(parseInt(end));
                    results += this.unfoldRange(startRow, endRow, startCol, endCol, pos,undefined, undefined,depth+1);
                } else if (matchformula) {
                    this.debug(`we matched formula ${matchformula}`);
                    const contentInsideParenthesis = this.findclosingbracket(
                        restformula.slice(matchformula[0].length)
                    );
                    this.debug(`contentInsideParenthesis ${contentInsideParenthesis}`);
                    const res = this.parsefunction(contentInsideParenthesis, [
                        formulaRow,
                        formulaCol //this keeps the referencing cell; for highlighting
                    ]);
                    results += matchformula[0] + res + ")";
                    i += matchformula[0].length + contentInsideParenthesis.length;
                } else if (matchCell) {
                    this.debug(`we matched a cell`);
                    const ref = this.getValuebyReference(matchCell[0], formulaRow, formulaCol);
                    // convert null to 0
                    results += ref===null? 0: ref.toString();
                    i += matchCell[0].length - 1;
                } else if (matchNum) {
                    this.debug(`we matched a number`);
                    results += matchNum[0];
                    i += matchNum[0].length - 1;
                } /*else if (matchOp) {
					this.debug(`we matched a operation`);
					results += matchOp[0];
					i += matchOp[0].length - 1;
				}*/ else {
                    results += restformula[0];
                    this.debug(`we didn't match anything`);
                }

                i++;
            }
        }
        this.debug(`results are:${results}`);

        return results;
    }


    unfoldRange(startRow: number, endRow: number, startCol: number, endCol: number, formulaPos: [number, number] = [0, 0], matrix = false, nullAsZero=true,depth=0): string {
        const [formulaRow, formulaCol] = formulaPos;
        [startRow, endRow] = startRow > endRow ? [endRow, startRow] : [startRow, endRow];
        [startCol, endCol] = startCol > endCol ? [endCol, startCol] : [startCol, endCol];

        endRow = Math.min(endRow, this.maxrows - 1);
        endCol = Math.min(endCol, this.maxcols - 1);

        // For matrix notation [a2:c4], preserve 2D structure
        const rowArray = [];

        for (let r = startRow; r <= endRow; r++) {
            const colArray = [];

            for (let c = startCol; c <= endCol; c++) {
                this.parents[formulaRow][formulaCol].push([r, c]);
                this.children[r][c].push([formulaRow, formulaCol]);

                const val = this.getValueByCoordinates(r, c, depth);

                // For null values in matrices, use 0 to maintain matrix structure
                //const matrixVal = val === null ? "null" : val;
                colArray.push(val);
            }
            rowArray.push(colArray);
        }

        const fmt = (v: any) => {
            if (v === null) return nullAsZero ? "0" : "null";
            // for string values wrapped in quotes, change this to: return typeof v === "string" ? `"${v}"` : String(v);
            return String(v);
        };

        if (matrix) {
            // produce e.g. [[1,2,3],[4,5,6]]
            const matrixString = rowArray
                .map(row => `[${row.map(v => fmt(v)).join(",")}]`)
                .join(",");
            return `[${matrixString}]`;
        } else {
            // flatten and produce e.g. 1,2,3,4,5
            const flat: any[] = rowArray.flat();
            return flat.map(v => fmt(v)).join(",");
        }
    }





    private sanitizeFormula(formula: string): string {
        // Remove potentially dangerous patterns
        const dangerous = [
            /import\s*\(/gi,
            /require\s*\(/gi,
            /eval\s*\(/gi,
            /Function\s*\(/gi,
            /constructor/gi,
            /prototype/gi,
            /__proto__/gi,
            /process\./gi,
            /global\./gi,
            /window\./gi,
            /document\./gi
        ];

        for (const pattern of dangerous) {
            if (pattern.test(formula)) {
                throw new Error(`Formula contains forbidden pattern: ${pattern.source}`);
            }
        }

        // Limit formula length to prevent DoS
        if (formula.length > 1000) {
            throw new Error("Formula too long");
        }

        return formula.trim();
    }

    private sanitizeProcessedFormula(processedFormula: string): string {
        // Validate the final formula before mathjs gets it

        // Check for suspicious function calls that might have been constructed
        const suspiciousPatterns = [
            /eval\s*\(/gi,
            /Function\s*\(/gi,
            /constructor\s*\(/gi,
            /\[.*["'].*["'].*\]/gi, // bracket notation with strings
        ];

        for (const pattern of suspiciousPatterns) {
            if (pattern.test(processedFormula)) {
                throw new Error("Processed formula contains suspicious patterns");
            }
        }

        return processedFormula;
    }

    debug(message: any, depth=3): void {
        if (debug) {
            console.log("_".repeat(depth), message);
        }
    }
}