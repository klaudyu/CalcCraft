// table-evaluator.ts
import { evaluate } from "mathjs";

const debug = false;

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
                } else {
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
        if (row < 0 || row >= this.maxrows || col < 0 || col >= this.maxcols) {
            throw new Error(`Cell coordinates [${row},${col}] out of bounds`);
        }
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
                this.debug("********infinite loop*************");
                const ref = this.cords2ref(row, col);
                this.debug(`${ref}`);
                throw new InfiniteLoop(`${ref}`);
            }

            this.cellstatus[row][col] = cellstatus.computing;
            const formula = this.formulaData[row][col].slice(1);
            if (debug) {
                this.debug(`we are asked to fill in at ${this.cords2ref(row,col)} with formula: ${formula}`);
            }

            const sanitizedFormula = this.sanitizeFormula(formula);


            let processedformula;
            try {
                processedformula = this.parsefunction(sanitizedFormula, [row, col]);
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
                // SANITIZE THE PROCESSED FORMULA TOO
                const finalSanitizedFormula = this.sanitizeProcessedFormula(processedformula);
                const result = evaluate(finalSanitizedFormula);
                this.debug(`result is ${result}`);

                if (result.constructor.name === "Unit") {
                    // handle units ; TODO
                } else {
                    try {
                        let parsed;
                        if (typeof result === 'string' && result.trim().startsWith('[')) {
                            parsed = JSON.parse(result);
                        } else if (Array.isArray(result)) {
                            parsed = result;
                        } else {
                            // Single value, not an array
                            this.cellstatus[row][col] = cellstatus.iscomputed;
                            this.tableData[row][col] = result;
                            return result;
                        }

                        if (Array.isArray(parsed)) {
                            return this.fillInMatrix(row, col, parsed);
                        }
                    } catch (error) {
                        // Not JSON, treat as regular value
                        this.cellstatus[row][col] = cellstatus.iscomputed;
                        this.tableData[row][col] = result;
                        return result;
                    }
                    if (Array.isArray(parsed)) {
                        return this.fillInMatrix(row, col, parsed);
                    }
                }

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

    fillInMatrix(row: number, col: number, parsed: any): any {
        const ismatrix = parsed.every((item: any) => Array.isArray(item));
        if (!ismatrix) parsed = parsed.map((n: any) => [n]);

        // Check if matrix fits in table
        const maxRow = row + parsed.length;
        const maxCol = col + Math.max(...parsed.map((r: any[]) => r.length));

        if (maxRow > this.maxrows || maxCol > this.maxcols) {
            throw new Error("Matrix extends beyond table boundaries");
        }


        this.copyArrayValues(parsed, this.tableData, row, col);
        this.cellstatus[row][col] = cellstatus.iscomputed;

        parsed.forEach((parsedrow: any, i: number) => {
            parsedrow.forEach((_: any, j: number) => {
                if (row + i < this.tableData.length && col + j < this.tableData[0].length) {
                    if (i || j) {
                        this.parents[row + i][col + j] = [];
                        this.formulaData[row + i][col + j] = null;
                        this.cellstatus[row + i][col + j] = cellstatus.iscomputed;

                        try {
                            this.cleanupchildren([row + i, col + j], [row, col]);
                        } catch (error) {
                            if (error instanceof InfiniteLoop) {
                                this.errors[row][col] = error.message;
                            } else {
                                throw error;
                            }
                        }

                        this.parents[row + i][col + j].push([row, col]);
                        this.children[row][col].push([row + i, col + j]);
                        this.celltype[row + i][col + j] = celltype.matrix;
                    }
                }
            });
        });

        if (this.cellstatus[row][col] != cellstatus.iscomputed) {
            throw new Error("matrix<br>loop");
        }

        parsed.forEach((tmprow: any, i: number) => {
            tmprow.forEach((tmpcell: any, j: number) => {
                if ((i || j) && row + i < this.tableData.length && col + j < this.tableData[0].length) {
                    this.computechildren(row + i, col + j);
                }
            });
        });

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

		this.debug(`we parsefunction; ${this.cords2ref(formulaRow,formulaCol)} (location:${formulaRow},${formulaCol})`);
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
		//unfold ranges; if matrix is set, return as array of arrays, otherwise, just as an array
		const [formulaRow, formulaCol] = formulaPos; //for higlighting
		[startRow, endRow] = startRow > endRow ? [endRow, startRow] : [startRow, endRow];
		[startCol, endCol] = startCol > endCol ? [endCol, startCol] : [startCol, endCol];

		this.debug(`maxcols:${this.maxcols}; maxrows:${this.maxrows}`);
		this.debug(`unfoldRange searching from ${startRow},${startCol} to ${endRow},${endCol}`);
		endRow = Math.min(endRow, this.maxrows - 1);
		endCol = Math.min(endCol, this.maxcols - 1);
		const rowArray = []; // Array to store each row as a string
		for (let r = startRow; r <= endRow; r++) {
			const colArray = []; // Array to store the values in a single row
			for (let c = startCol; c <= endCol; c++) {
				this.parents[formulaRow][formulaCol].push([r, c]); //for highlighting
				this.debug(
					`we added ${this.cords2ref(r, c)} as child for ${this.cords2ref(
						formulaRow,
						formulaCol
					)}`
				);
				this.children[r][c].push([formulaRow, formulaCol]);
				const val = this.getValueByCoordinates(r, c); // Getting the value from the coordinates
				colArray.push(val);
			}
			const rowtxt = colArray.join(",");
			rowArray.push(matrix ? "[" + rowtxt + "]" : rowtxt);
		}
		const out = rowArray.join(",");
		const rangetxt = matrix ? "[" + out + "]" : out;
		this.debug("***we found a range***");
		this.debug(`range text ${rangetxt}`);
		return rangetxt;
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