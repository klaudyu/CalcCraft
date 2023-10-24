import { Plugin, MarkdownPostProcessorContext } from "obsidian";
import { evaluate } from "mathjs";
import { CalcCraftSettingsTab, DefaultSettings } from "settings";

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
	constructor(message) {
		super(message);
		this.name = "InfiniteLoop";
	}
}

export default class CalcCraftPlugin extends Plugin {
	tableData = [];
	formulaData = [];
	celltype = [];
	cellstatus = [];
	errors = [];
	parents = [];
	children = [];
	settings = [];
	cssVariables = [];
	colOffset = 0;
	rowOffset = 0;
	htmlTable = [];
	countComputed = [];
	useBool = false; //keep true and false, otherwise convert them to 0 and 1

	async onload() {
		await this.loadSettings();
		this.registerMarkdownPostProcessor(this.postProcessor.bind(this));
        this.settings_tab=new CalcCraftSettingsTab(this.app, this)
		this.addSettingTab(this.settings_tab);
		this.debug("table formula plugin loaded");
        this.settings_tab.reloadPages();
	}

    async onunload(): void {
        this.settings_tab.reloadPages();
    }

	bool2nr(value) {
		return typeof value === "boolean" ? +value : value;
	}

	cords2ref(row, col) {
		const colStr = String.fromCharCode("a".charCodeAt(0) + col);
		return colStr + (row + 1);
	}
	ref2cords(ref, formulaRow = 0, formulaCol = 0) {
		//const match = ref.match(/^([a-z]|([+-]?\d+c))([+-]?\d+r|\d+)$/);
		const match = ref.match(/^([a-z]+|([+-]?)\d+c)(\d+|([+-]?)\d+r)$/);

		if (!match) {
			this.errors[formulaRow][formulaCol] = "invalid cell reference";
			return null; // FIXME or some error handling
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
			row = parseInt(rowPart) - 1; // Assuming rows start from 1
		}

		return [row, col];
	}

	letter2col(letter) {
		return letter.charCodeAt(0) - "a".charCodeAt(0);
	}
	number2row(nr) {
		return nr - 1;
	}

	copyArrayValues(sourceArray: [][], targetArray: [][], row: number, col: number) {
		for (let i = 0; i < sourceArray.length; i++) {
			for (let j = 0; j < sourceArray[i].length; j++) {
				// Check for out-of-bounds
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

	fillInMatrix(row, col, parsed) {
		//now we got a matrix or vector we have to clear recompute the values of all the
		// children of these cells, but not on the main cell
		// normally if a cell depends on another cell first it asks it to calculate itself
		// but these matrices were not taken into account, as they expand more than one cell
		// Another solution would have been to parse the whole table first, to find the matrices
		// and compute the dependencies, and then again to compute

		//FIXME: if a cell is asked to recompute it's values
		// now we add the children twice. should keep track, of
		// how many times we compute and only first time add children
		const ismatrix = parsed.every(item => Array.isArray(item));
		//if (!ismatrix) parsed=[parsed];
		if (!ismatrix) parsed = parsed.map(n => [n]);

		this.copyArrayValues(parsed, this.tableData, row, col);
		//we assume here that this cell is computed
		this.cellstatus[row][col] = cellstatus.iscomputed;

		//then we clean all the children of the values that were
		//overwritten by writing the matrix
		parsed.forEach((parsedrow, i) => {
			parsedrow.forEach((_, j) => {
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
							`parents of ${this.cords2ref(row + i, col + j)} are ${
								this.parents[row + i][col + j]
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
		parsed.forEach((tmprow, i) => {
			tmprow.forEach((tmpcell, j) => {
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

	cleanupchildren([row, col], [rootRow, rootCol], i = 0) {
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
	computechildren(row, col, i = 0) {
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

	debug(message) {
		if (debug) {
			console.log(message);
		}
	}

	getValuebyReference(ref: string, formulaRow = 0, formulaCol = 0): string | number {
		const [row, col] = this.ref2cords(ref, formulaRow, formulaCol);
		if (row < 0 || row > this.maxrows - 1 || col < 0 || col > this.maxcols - 1) {
			throw new Error("cell<br>out of<br>table");
		}
		this.parents[formulaRow][formulaCol].push([row, col]);

		//this.debug(`{cords2ref[row,col]} is a parent of {cords2ref(formulaRow,formulaCol)}`);
		this.children[row][col].push([formulaRow, formulaCol]);
		return this.getValueByCoordinates(row, col, (formulaRow = 0), (formulaCol = 0));
	}

	findclosingbracket(formula) {
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

		this.debug(`we parsefunction; location:${formulaRow},${formulaCol}`);
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
					const [startRow, startCol] = this.ref2cords(start, formulaRow, formulaCol);
					const [endRow, endCol] = this.ref2cords(end, formulaRow, formulaCol);
					this.debug(`we look for range till ${this.cords2ref(endRow, endCol)}`);
					results += this.unfoldRange(startRow, endRow, startCol, endCol, pos, false);
				} else if (matchMatrix) {
					this.debug(`we matched a matrix`);
					i += matchMatrix[0].length - 1;
					const [start, end] = matchMatrix[0].slice(1, -1).split(":"); // Split the range into start and end
					const [startRow, startCol] = this.ref2cords(start, formulaRow, formulaCol);
					const [endRow, endCol] = this.ref2cords(end, formulaRow, formulaCol);
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
					const startRow = this.number2row(start);
					const endRow = this.number2row(end);
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

	unfoldRange(startRow, endRow, startCol, endCol, formulaPos = [0, 0], matrix = false) {
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

	createLabels(tableEl) {
		const rows = Array.from(tableEl.querySelectorAll("tr"));
		const newRow = tableEl.insertRow(0);
		const existingCells = Array.from(rows[0].querySelectorAll("td, th"));

		// For the new top row
		for (let i = 0; i <= existingCells.length; i++) {
			const newCell = newRow.insertCell(i);
			if (i > this.colOffset)
				newCell.innerHTML = String.fromCharCode("a".charCodeAt(0) + i - 1 - this.colOffset);
			newCell.classList.add("label-cell", "column");
			newCell.CalcCraft = { parents: [], children: [] };
		}

		// For the new leftmost column in existing rows
		rows.forEach((row, index) => {
			const newCell = row.insertCell(0);
			if (index + 1 - this.rowOffset > 0) {
				newCell.innerHTML = index + 1 - this.rowOffset; // Row numbers start from 1
			}
			newCell.classList.add("label-cell", "row");
			newCell.CalcCraft = { parents: [], children: [] };
		});
	}

	async postProcessor(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		// Find tables within the rendered HTML
		el.querySelectorAll("table").forEach((tableEl, index) => {
			// 2D array to hold numerical cell values for easy access

			this.tableData = []; //numerical values
			this.errors = [];
			this.cellstatus = []; //for detecting self references
			this.formulaData = [];
			this.parents = []; //for highlighting
			this.children = [];
			this.celltype = [];
			this.countComputed = [];
			this.htmlTable = [];

			//add the settings to the table, so we can check if we have to display
			//the children and parents on mousehover
			tableEl.CalcCraft = { settings: this.settings };

			const rows = Array.from(tableEl.querySelectorAll("tr")).slice(this.rowOffset);

			rows.forEach((rowEl, i) => {
				this.htmlTable[i] = [];
				const cells = Array.from(rowEl.querySelectorAll("td, th")).slice(this.colOffset);
				cells.forEach((cellEl, j) => {
					this.htmlTable[i][j] = cellEl;
				});
			});

			if (this.settings.showLabels) {
				//create another row on top and column on the left
				this.createLabels(tableEl);
			}

			/* ***** FIRST PASS ****/
			/* initialize variables */
			for (let rowIndex = 0; rowIndex < this.htmlTable.length; rowIndex++) {
				const row = this.htmlTable[rowIndex];
				this.tableData[rowIndex] = []; //numerical values
				this.errors[rowIndex] = [];
				this.cellstatus[rowIndex] = []; //for detecting self references
				this.formulaData[rowIndex] = [];
				this.parents[rowIndex] = []; //for highlighting
				this.children[rowIndex] = [];
				this.celltype[rowIndex] = [];
				this.countComputed[rowIndex] = [];
				for (let colIndex = 0; colIndex < row.length; colIndex++) {
					const cellContent = this.htmlTable[rowIndex][colIndex].textContent || "";
					this.cellstatus[rowIndex][colIndex] = null; //this will detect errors if we visit a  formula cell twice
					this.errors[rowIndex][colIndex] = null; // this will store the errors
					this.parents[rowIndex][colIndex] = []; //this will store the parents; only for higlighting
					this.children[rowIndex][colIndex] = [];
					this.countComputed[rowIndex][colIndex] = 0;

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
					this.maxcols = colIndex + 1;
				}
				this.maxrows = rowIndex + 1;
			}

			this.debug(this.tableData);

			// *********************************************
			// ***Iterate again to perform calculations***
			// *********************************************
			for (let i = 0; i < this.tableData.length; i++) {
				for (let j = 0; j < this.tableData[i].length; j++) {
					try {
						this.getValueByCoordinates(i, j);
					} catch (error) {
						console.log(error);
					}
				}
			}

			for (let rowIndex = 0; rowIndex < this.htmlTable.length; rowIndex++) {
				const row = this.htmlTable[rowIndex];
				//const cells = Array.from(rowEl.querySelectorAll("td, th"));
				//cells.forEach((cellEl, colIndex) => {
				for (let colIndex = 0; colIndex < row.length; colIndex++) {
					//const cellContent = cellEl.textContent || "";
					const cellContent = this.htmlTable[rowIndex][colIndex].textContent || "";

					//this is the actual html cell, in which we store the parents and
					//the children
					const cellEl = this.htmlTable[rowIndex][colIndex];
					cellEl.CalcCraft = { parents: [], children: [] };

					// Check if the cell content is a formula
					if (this.celltype[rowIndex][colIndex] === celltype.formula) {
						cellEl.classList.add("formula-cell");
						if (this.settings.showBorders) {
							cellEl.classList.add("formula-cell-borderenabled");
						}
						if (this.settings.formula_background_color_toggle) {
							cellEl.classList.add("formula-cell-colorenabled");
						}
						cellEl.setAttribute("title", `${cellContent}`);
						// Evaluate the formula
						//cellEl.textContent = String(this.tableData[rowIndex][colIndex]);
						//if ((typeof data === 'number' || (!isNaN(parseFloat(data)) && isFinite(ndata))) && this.settings.precision>=0) {
						this.putDataInHtml(cellEl, rowIndex, colIndex);

						if (this.errors[rowIndex][colIndex]) {
							cellEl.classList.add("error-cell");
							if (this.settings.formula_background_error_toggle) {
								cellEl.classList.add("error-cell-colorenabled");
							}
							cellEl.innerHTML = "" + this.errors[rowIndex][colIndex];
						}
					} else {
						if (this.celltype[rowIndex][colIndex] === celltype.matrix) {
							cellEl.classList.add("matrix-cell");
							if (this.settings.formula_background_matrix_toggle) {
								cellEl.classList.add("matrix-cell-colorenabled");
							}
						}
						//cellEl.textContent=this.tableData[rowIndex][colIndex];
						this.putDataInHtml(cellEl, rowIndex, colIndex);
					}
					//for higlighting ; only formulas or matrices;FIXME add condition
					this.parents[rowIndex][colIndex].forEach(([depRow, depCol]) => {
						cellEl.CalcCraft.parents.push(this.htmlTable[depRow][depCol]);
					});

					//for hilighting; all cells can have children
					this.children[rowIndex][colIndex].forEach(([depRow, depCol]) => {
						cellEl.CalcCraft.children.push(this.htmlTable[depRow][depCol]);
					});
				}
			}
			this.debug(`max cols:${this.maxcols}`);
			this.debug(`max rows:${this.maxrows}`);

			// Attach a single 'mouseover' event listener to the table
			tableEl.addEventListener("mouseover", function (event) {
				const cellEl = event.target.closest("td, th"); // Get the closest cell element to the event target
				if (!cellEl) return; // No cell? Get outta here.
				cellEl.classList.add("cell-active");
				if (cellEl?.CalcCraft == undefined) return;

				/*
                let rect = cellEl.getBoundingClientRect();
                let svgContainer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                svgContainer.style.position = "absolute";
                svgContainer.style.top = "0";
                svgContainer.style.left = "0";
                svgContainer.style.width = "100%";
                svgContainer.style.height = "100%";
                svgContainer.style.pointerEvents = "none"; // so it doesn't interfere with other interactions
                document.body.appendChild(svgContainer);

                let ellipse = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
                ellipse.setAttribute("cx", rect.left + rect.width / 2);
                ellipse.setAttribute("cy", rect.top + rect.height / 2);
                ellipse.setAttribute("rx", rect.width / 2);
                ellipse.setAttribute("ry", rect.height / 2);
                ellipse.setAttribute("fill", "none");
                ellipse.setAttribute("stroke", "black");
                ellipse.setAttribute("stroke-width", "3");
                svgContainer.appendChild(ellipse);
                */

				//console.log(cellEl.classList)
				if (
					cellEl.classList.contains("formula-cell") ||
					cellEl.classList.contains("matrix-cell")
				) {
					if (tableEl.CalcCraft.settings.formula_background_parents_toggle) {
						cellEl.CalcCraft.parents.forEach(depCellEl => {
							depCellEl.classList.add("cell-parents-highlight");
							//console.log('we added some parents');
						});
					}
				}
				if (tableEl.CalcCraft.settings.formula_background_children_toggle) {
					cellEl.CalcCraft.children?.forEach(depCellEl => {
						depCellEl.classList.add("cell-children-highlight");
						//this.debug('we added some children');
					});
				}
			});

			// Similar approach for 'mouseout'
			tableEl.addEventListener("mouseout", function (event) {
				const cellEl = event.target.closest("td, th"); // Get the closest cell element to the event target
				if (!cellEl) return; // No cell? Get outta here.
				cellEl.classList.remove("cell-active");

				/*
                let existingSVG = document.querySelector("svg");
                if (existingSVG) {
                    existingSVG.remove();
                }*/
				if (cellEl?.CalcCraft == undefined) return;
				if (
					cellEl.classList.contains("formula-cell") ||
					cellEl.classList.contains("matrix-cell")
				) {
					if (tableEl.CalcCraft.settings.formula_background_parents_toggle) {
						cellEl.CalcCraft.parents.forEach(depCellEl => {
							depCellEl.classList.remove("cell-parents-highlight");
						});
					}
				}
				if (tableEl.CalcCraft.settings.formula_background_children_toggle) {
					cellEl.CalcCraft.children?.forEach(depCellEl => {
						depCellEl.classList.remove("cell-children-highlight");
					});
				}
			});
		});
		//console.log(this.countComputed);
	}

	putDataInHtml(cellEl, rowIndex, colIndex) {
		let data = this.tableData[rowIndex][colIndex];
		if (typeof data === "number" && this.settings.precision >= 0) {
			const decimalPart = String(data).split(".")[1];
			if (decimalPart && decimalPart.length > this.settings.precision) {
				data = data.toFixed(this.settings.precision);
			}
		}
		//cellEl.textContent = String(data);
		cellEl.textContent = data;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DefaultSettings, await this.loadData());
		this.updatecssvars();
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	updatecssvars() {
		for (const variable in this.settings) {
			if (
				typeof this.settings[variable] === "string" &&
				this.settings[variable].startsWith("#")
			) {
				document.documentElement.style.setProperty(
					"--CalcCraft_" + variable,
					this.settings[variable]
				);
			}
		}

		/*document.documentElement.style.setProperty(
			"--CalcCraft-formula-borders",
			this.settings.showBorders ? " 2px double" : ""
		);*/
	}
}
