// table-evaluator.ts
import { evaluate } from "mathjs";

const debug = true;

enum celltype {
    number = 1,
    formula,
    matrix
}
enum cellstatus {
    none = 1,
    computing,
    iscomputed
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

                this.tableData[rowIndex][colIndex] = cellContent === "" ? null : cellContent;

                if (cellContent.startsWith("=")) {
                    this.formulaData[rowIndex][colIndex] = cellContent;
                    this.cellstatus[rowIndex][colIndex] = cellstatus.none;
                    this.celltype[rowIndex][colIndex] = celltype.formula;
                } else { //number or text
                    this.formulaData[rowIndex][colIndex] = null;
                    this.cellstatus[rowIndex][colIndex] = cellstatus.iscomputed;
                    this.celltype[rowIndex][colIndex] = celltype.number;
                }
            }
        }
    }

    private computeAllCells() {
        for (let i = 0; i < this.tableData.length; i++) {
            for (let j = 0; j < this.tableData[i].length; j++) {
                try {
                    this.getValueByCoordinates(i, j);
                } catch (error) {
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

    getValueByCoordinates(row: number, col: number) {
        const r = this.cords2ref(row, col);
        this.debug(`getValueByCoordinates ${r}`);

        if (this.cellstatus[row][col] == cellstatus.iscomputed) {
            this.debug(`getValueByCoordinates giving the value ${this.tableData[row][col]}`);
            const val = this.tableData[row][col];
            if (val === null) return 0;
            if (typeof val === "number" || (!isNaN(parseFloat(val)) && isFinite(val))) {
                return val;
            }
            if (typeof val === "string") return `"${val}"`;
            if (this.useBool) return val;
            return this.bool2nr(val);
        } else {
            if (this.cellstatus[row][col] == cellstatus.computing) {
                //we were computing this cell but somehow we looped back to it before finishing
                this.debug("********infinite loop*************");
                const ref = this.cords2ref(row, col);
                this.debug(`${ref}`); //NOTE: do we want to throw an error or continue?
                throw new InfiniteLoop(`${ref}`);
                //this.error[row][col]='loop'
                return null;
            }
            /*if (this.countComputed[row][col]++ > 1) {
                console.log("this is getting weird, how many time do we recompute this?");
            }*/

            this.cellstatus[row][col] = cellstatus.computing;
            const formula = this.formulaData[row][col].slice(1); //skip the `=`
            if (debug) {
                this.debug(`we are asked to fill in at ${row},${col} with formula: ${formula}`);
            }
            //this.formulaData[row][col] = null;
            let processedformula;
            try {
                processedformula = this.parsefunction(formula, [row, col]);
            } catch (error) {
                if (error instanceof InfiniteLoop) {
                    const ref = this.cords2ref(row, col);
                    this.errors[row][col] = "loop<br>" + error.message;
                    throw new InfiniteLoop(`${ref}`);
                }
                this.errors[row][col] = error.message;
                throw error;
            }

            try {
                this.debug(`we will evaluate the formula: ${processedformula}`);
                const result = evaluate(processedformula);
                this.debug(
                    `we were asked to fill in at ${this.cords2ref(
                        row,
                        col
                    )} with formula: ${formula} ; the result is ${result}`
                );

                if (result.constructor.name === "Unit") {
                    /*handle units*/
                } else {
                    const parsed = JSON.parse(result);

                    if (Array.isArray(parsed)) {
                        return this.fillInMatrix(row, col, parsed);
                    }
                }

                //***********handle matrices ******************
                //check if the result is a vector or a matrix

                //this.formulaData[row][col] = null; //we filled the value, so this cell is not a formula anymore
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

fillInMatrix(row: number, col: number, parsed: any[][]): any {
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
                        `parents of ${this.cords2ref(row + i, col + j)} are ${this.parents[row + i][col + j]
                        }`
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
        throw new Error("matrix<br>loop");
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




    cleanupchildren([row, col]: [number, number], [rootRow, rootCol]: [number, number], i = 0): void {
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
                    throw new InfiniteLoop(`matrix<br>loop ${this.cords2ref(row, col)}`);
                }
                this.debug("yes, cleanup");
                this.cellstatus[r][c] = cellstatus.none;
                this.cleanupchildren([r, c], [rootRow, rootCol], i);
            } else {
                this.debug("nope");
            }
        });
    }
    computechildren(row: number, col: number, i = 0): void {
        this.debug(
            `recomputing the children of ${this.cords2ref(row, col)}: ${this.children[row][col]
                .map(([r, c]) => this.cords2ref(r, c))
                .join(", ")}`
        );

        if (i++ > 100) {
            throw new Error(`too high recursivity on computechildren`);
        }
        this.children[row][col].forEach(([r, c]) => {
            if (this.cellstatus[r][c] !== cellstatus.iscomputed) {
                const res = this.getValueByCoordinates(r, c);
                this.debug(`value for ${this.cords2ref(r, c)} is ${res} `);
                this.debug(`status for ${this.cords2ref(r, c)} is ${this.cellstatus[r][c]} `);
                this.computechildren(r, c);
            }
        });
    }


    getValuebyReference(ref: string, formulaRow = 0, formulaCol = 0): string | number {
        const coords = this.ref2cords(ref, formulaRow, formulaCol);
        if (!coords) throw new Error("invalid cell reference");
        const [row, col] = coords;
        if (row < 0 || row > this.maxrows - 1 || col < 0 || col > this.maxcols - 1) {
            throw new Error("cell<br>out of<br>table");
        }
        this.parents[formulaRow][formulaCol].push([row, col]);

        //this.debug(`{cords2ref[row,col]} is a parent of {cords2ref(formulaRow,formulaCol)}`);
        this.children[row][col].push([formulaRow, formulaCol]);
        return this.getValueByCoordinates(row, col);
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

    parsefunction(formula: string, pos: [number, number] = [0, 0]): string {
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
                const res = this.parsefunction(contentInsideParenthesis, [formulaRow, formulaCol]);
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
                    results += this.unfoldRange(startRow, endRow, startCol, endCol, pos, false);
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
                    results += this.unfoldRange(startRow, endRow, startCol, endCol, pos, true);
                } else if (matchRangeCol) {
                    this.debug(`we matched a column range`);
                    i += matchRangeCol[0].length - 1;
                    const [start, end] = matchRangeCol[0].split(":"); // Split the range into start and end
                    const [startCol, startRow] = [this.letter2col(start), 1];
                    const [endCol, endRow] = [this.letter2col(end), this.maxrows - 1];
                    results += this.unfoldRange(startRow, endRow, startCol, endCol, pos);
                } else if (matchRangeColMatrix) {
                    this.debug(`we matched a column range Matrix`);
                    i += matchRangeColMatrix[0].length - 1;
                    const [start, end] = matchRangeColMatrix[0].slice(1, -1).split(":"); // Split the range into start and end
                    const [startCol, startRow] = [this.letter2col(start), 1];
                    const [endCol, endRow] = [this.letter2col(end), this.maxrows - 1];
                    results += this.unfoldRange(startRow, endRow, startCol, endCol, pos, true);
                } else if (matchRangeRow) {
                    this.debug(`we matched a row range`);
                    i += matchRangeRow[0].length - 1;
                    const [start, end] = matchRangeRow[0].split(":"); // Split the range into start and end
                    const startCol = 0;
                    const endCol = this.maxcols - 1;
                    const startRow = this.number2row(parseInt(start));
                    const endRow = this.number2row(parseInt(end));
                    results += this.unfoldRange(startRow, endRow, startCol, endCol, pos);
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
                    results += ref.toString();
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

    unfoldRange(startRow: number, endRow: number, startCol: number, endCol: number, formulaPos: [number, number] = [0, 0], matrix = false): string {
        const [formulaRow, formulaCol] = formulaPos;
        [startRow, endRow] = startRow > endRow ? [endRow, startRow] : [startRow, endRow];
        [startCol, endCol] = startCol > endCol ? [endCol, startCol] : [startCol, endCol];

        endRow = Math.min(endRow, this.maxrows - 1);
        endCol = Math.min(endCol, this.maxcols - 1);

        // Track units in this range
        let detectedUnit: string | null = null;

        if (matrix) {
            // For matrix notation [a2:c4], preserve 2D structure
            const rowArray = [];

            for (let r = startRow; r <= endRow; r++) {
                const colArray = [];

                for (let c = startCol; c <= endCol; c++) {
                    this.parents[formulaRow][formulaCol].push([r, c]);
                    this.children[r][c].push([formulaRow, formulaCol]);

                    const val = this.getValueByCoordinates(r, c);
                    const originalVal = this.tableData[r][c];

                    // Check if this cell has a unit
                    if (typeof originalVal === "string" && originalVal) {
                        const unitMatch = originalVal.match(/^(-?\d*\.?\d+)\s*([a-zA-Z]+)/);
                        if (unitMatch && !detectedUnit) {
                            detectedUnit = unitMatch[2];
                        }
                    }

                    colArray.push(val);
                }
                rowArray.push(colArray);
            }

            // Handle units for matrix format
            if (detectedUnit) {
                const processedRows = rowArray.map(row =>
                    row.map(val => {
                        if (val === 0) return `0 ${detectedUnit}`;
                        if (typeof val === "number") return `${val} ${detectedUnit}`;
                        return val;
                    })
                );

                // Format as nested arrays: [[1,2,3],[4,5,6],[7,8,9]]
                const matrixString = processedRows.map(row => `[${row.join(",")}]`).join(",");
                return `[${matrixString}]`;
            }

            // No units - format as nested arrays
            const matrixString = rowArray.map(row => `[${row.join(",")}]`).join(",");
            return `[${matrixString}]`;

        } else {
            // For range notation a2:c4, flatten to 1D array (existing logic)
            const values = [];

            for (let r = startRow; r <= endRow; r++) {
                for (let c = startCol; c <= endCol; c++) {
                    this.parents[formulaRow][formulaCol].push([r, c]);
                    this.children[r][c].push([formulaRow, formulaCol]);

                    const val = this.getValueByCoordinates(r, c);
                    const originalVal = this.tableData[r][c];

                    // Check if this cell has a unit
                    if (typeof originalVal === "string" && originalVal) {
                        const unitMatch = originalVal.match(/^(-?\d*\.?\d+)\s*([a-zA-Z]+)/);
                        if (unitMatch && !detectedUnit) {
                            detectedUnit = unitMatch[2];
                        }
                    }

                    values.push(val);
                }
            }

            // Handle units for flat array format
            if (detectedUnit) {
                const processedValues = values.map(val => {
                    if (val === 0) return `0 ${detectedUnit}`;
                    if (typeof val === "number") return `${val} ${detectedUnit}`;
                    return val;
                });

                return processedValues.join(",");
            }

            // No units detected, return as flat array
            return values.join(",");
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

    debug(message: any): void {
        if (debug) {
            console.log(message);

        }
    }
}