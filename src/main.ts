import { Plugin, MarkdownPostProcessorContext, App } from "obsidian";
import { CalcCraftSettingsTab, DefaultSettings } from "./settings";
import { TableEvaluator } from "./table-evaluator";

const debug = true;

export default class CalcCraftPlugin extends Plugin {
	settings: any = {};
	settings_tab: CalcCraftSettingsTab;
	cssVariables: string[] = [];
	colOffset = 0;
	rowOffset = 0;
	htmlTable: HTMLElement[][] = [];
	useBool = false; //keep true and false, otherwise convert them to 0 and 1

    async onload() {
        await this.loadSettings();
        this.registerMarkdownPostProcessor(this.postProcessor.bind(this));
        
        // ADD THIS LINE for edit mode support:
        this.registerEditorExtension(this.createEditExtension());
        
        this.settings_tab = new CalcCraftSettingsTab(this.app, this);
        this.addSettingTab(this.settings_tab);
        this.debug("table formula plugin loaded");
        this.settings_tab.reloadPages();
    }

    createEditExtension() {
        // This will be a simple extension for now - we'll build it step by step
        return [];
    }

	async onunload(): Promise<void> {
		this.settings_tab.reloadPages();
	}



	createLabels(tableEl: HTMLTableElement): void {
		const rows = Array.from(tableEl.querySelectorAll("tr"));
		const newRow = tableEl.insertRow(0);
		const existingCells = Array.from(rows[0].querySelectorAll("td, th"));

		// For the new top row
		for (let i = 0; i <= existingCells.length; i++) {
			const newCell = newRow.insertCell(i);
			if (i > this.colOffset)
				newCell.textContent = String.fromCharCode(
					"a".charCodeAt(0) + i - 1 - this.colOffset
				);
			newCell.classList.add("label-cell", "column");
			(newCell as any).CalcCraft = { parents: [], children: [] };
		}

		// For the new leftmost column in existing rows
		rows.forEach((row, index) => {
			const newCell = row.insertCell(0);
			if (index + 1 - this.rowOffset > 0) {
				newCell.textContent = (index + 1 - this.rowOffset).toString();
			}
			newCell.classList.add("label-cell", "row");
			(newCell as any).CalcCraft = { parents: [], children: [] };
		});
	}


	    // MODIFY your existing postProcessor method:
    async postProcessor(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
        el.querySelectorAll("table").forEach((tableEl, index) => {
            // 1. Extract table data into a grid
            const gridData = this.extractTableGrid(tableEl);
			(tableEl as any).CalcCraft = { settings: this.settings };
            
            // 2. Use the evaluator
            const evaluator = new TableEvaluator();
            const result = evaluator.evaluateTable(gridData);
            
            // 3. Apply results to HTML
            this.applyResultsToHTML(tableEl, result, gridData, evaluator);
        });
    }

    // ADD this new method to extract table data:
    private extractTableGrid(tableEl: HTMLTableElement): string[][] {
        const rows = Array.from(tableEl.querySelectorAll("tr")).slice(this.rowOffset);
        const gridData: string[][] = [];

        rows.forEach((rowEl, i) => {
            const cells = Array.from(rowEl.querySelectorAll("td, th")).slice(this.colOffset);
            gridData[i] = [];
            
            cells.forEach((cellEl, j) => {
                gridData[i][j] = cellEl.textContent || "";
            });
        });

        return gridData;
    }
   // MODIFY your existing display logic into this method:
 //   private applyResultsToHTML(tableEl: HTMLTableElement, result: any, gridData: string[][]) {
	private applyResultsToHTML(tableEl: HTMLTableElement, result: any, gridData: string[][], evaluator: TableEvaluator) {
        // Get HTML table structure
        this.htmlTable = [];
        const rows = Array.from(tableEl.querySelectorAll("tr")).slice(this.rowOffset);

        rows.forEach((rowEl, i) => {
            this.htmlTable[i] = [];
            const cells = Array.from(rowEl.querySelectorAll("td, th")).slice(this.colOffset) as HTMLElement[];
            cells.forEach((cellEl, j) => {
                this.htmlTable[i][j] = cellEl as HTMLElement;
            });
        });

        // Add labels if needed
        if (this.settings.showLabels) {
            this.createLabels(tableEl);
        }

        // Apply computed values and styling
        for (let rowIndex = 0; rowIndex < this.htmlTable.length; rowIndex++) {
            for (let colIndex = 0; colIndex < this.htmlTable[rowIndex].length; colIndex++) {
                const cellEl = this.htmlTable[rowIndex][colIndex];
                const cellContent = gridData[rowIndex]?.[colIndex] || "";
                const computedValue = result.values[rowIndex]?.[colIndex];
                const error = result.errors[rowIndex]?.[colIndex];
                const cellType = result.cellTypes[rowIndex]?.[colIndex];

                // Initialize CalcCraft metadata
                (cellEl as any).CalcCraft = { 
                    parents: [], 
                    children: [],
                    settings: this.settings 
                };

				// *** ADD THIS SECTION - Build HTML dependencies from evaluator ***
				// Get parents from evaluator and convert to HTML elements
				const parentCoords = evaluator.parents[rowIndex][colIndex];
				parentCoords.forEach(([parentRow, parentCol]) => {
					if (this.htmlTable[parentRow] && this.htmlTable[parentRow][parentCol]) {
						(cellEl as any).CalcCraft.parents.push(this.htmlTable[parentRow][parentCol]);
					}
				});

				// Get children from evaluator and convert to HTML elements  
				const childrenCoords = evaluator.children[rowIndex][colIndex];
				childrenCoords.forEach(([childRow, childCol]) => {
					if (this.htmlTable[childRow] && this.htmlTable[childRow][childCol]) {
						(cellEl as any).CalcCraft.children.push(this.htmlTable[childRow][childCol]);
					}
				});

                // Apply styling and content based on cell type
                if (cellType === 2) { // formula
                    cellEl.classList.add("formula-cell");
                    if (this.settings.showBorders) {
                        cellEl.classList.add("formula-cell-borderenabled");
                    }
                    if (this.settings.formula_background_color_toggle) {
                        cellEl.classList.add("formula-cell-colorenabled");
                    }
                    cellEl.setAttribute("title", cellContent);

                    if (error) {
                        cellEl.classList.add("error-cell");
                        if (this.settings.formula_background_error_toggle) {
                            cellEl.classList.add("error-cell-colorenabled");
                        }
                        cellEl.textContent = "";
                        error.split("<br>").forEach((text: string, index: number, array: string[]) => {
                            cellEl.appendChild(document.createTextNode(text));
                            if (index < array.length - 1)
                                cellEl.appendChild(document.createElement("br"));
                        });
                    } else {
                        this.setFormattedCellValue(cellEl, computedValue);
                    }
                } else if (cellType === 3) { // matrix
                    cellEl.classList.add("matrix-cell");
                    if (this.settings.formula_background_matrix_toggle) {
                        cellEl.classList.add("matrix-cell-colorenabled");
                    }
                    this.setFormattedCellValue(cellEl, computedValue);
                }
            }
        }

        // Add event listeners for hover effects
        this.addTableEventListeners(tableEl);
    }


	private setFormattedCellValue(cellEl: HTMLElement, value: any): void {
		let data = value;
		if (typeof data === "number" && this.settings.precision >= 0) {
			const decimalPart = String(data).split(".")[1];
			if (decimalPart && decimalPart.length > this.settings.precision) {
				data = data.toFixed(this.settings.precision);
			}
		}
		cellEl.textContent = String(data);
	}


	/*
	async	putDataInHtml(cellEl: HTMLElement, rowIndex: number, colIndex: number): void {
		let data = this.tableData[rowIndex][colIndex];
		if (typeof data === "number" && this.settings.precision >= 0) {
			const decimalPart = String(data).split(".")[1];
			if (decimalPart && decimalPart.length > this.settings.precision) {
				data = data.toFixed(this.settings.precision);
			}
		}
		cellEl.textContent = data;
		//cellEl.textContent = String(data);
	}*/

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

	    // ADD event listeners method:
    private addTableEventListeners(tableEl: HTMLTableElement): void {

			// Attach a single 'mouseover' event listener to the table
			tableEl.addEventListener("mouseover", function (event) {
				const target = event.target as HTMLElement;
				const cellEl = target.closest("td, th") as HTMLElement; // Get the closest cell element to the event target
				if (!cellEl) return; // No cell? Get outta here.
				cellEl.classList.add("cell-active");
				if ((cellEl as any)?.CalcCraft == undefined) {
					console.log("the cell doesnt contain calccraft")
					return;
				}

				//console.log(cellEl.classList)
				if (
					cellEl.classList.contains("formula-cell") ||
					cellEl.classList.contains("matrix-cell")
				){
					//console.log("adding some parents");
					if ((tableEl as any).CalcCraft.settings.formula_background_parents_toggle) {
						(cellEl as any).CalcCraft.parents.forEach((depCellEl: HTMLElement) => {
							depCellEl.classList.add("cell-parents-highlight");
							//console.log('we added some parents');
						});
					}
				}
			if ((tableEl as any).CalcCraft.settings.formula_background_children_toggle) {
				//console.log("adding the children");
					(cellEl as any).CalcCraft.children?.forEach((depCellEl: HTMLElement) => {
						depCellEl.classList.add("cell-children-highlight");
						//console.log('we added some children');
					});
				}
			});

			// Similar approach for 'mouseout'
			tableEl.addEventListener("mouseout", function (event) {
				const target = event.target as HTMLElement;
				const cellEl = target.closest("td, th") as HTMLElement; // Get the closest cell element to the event target
				if (!cellEl) return; // No cell? Get outta here.
				cellEl.classList.remove("cell-active");

				/*
                let existingSVG = document.querySelector("svg");
                if (existingSVG) {
                    existingSVG.remove();
                }*/
				if ((cellEl as any)?.CalcCraft == undefined) return;
				if (
					cellEl.classList.contains("formula-cell") ||
					cellEl.classList.contains("matrix-cell")
				) {
					if ((tableEl as any).CalcCraft.settings.formula_background_parents_toggle) {
						(cellEl as any).CalcCraft.parents.forEach((depCellEl: HTMLElement) => {
							depCellEl.classList.remove("cell-parents-highlight");
						});
					}
				}
				if ((tableEl as any).CalcCraft.settings.formula_background_children_toggle) {
					(cellEl as any).CalcCraft.children?.forEach((depCellEl: HTMLElement) => {
						depCellEl.classList.remove("cell-children-highlight");
					});
				}
			});
    }

	debug(message: any): void {
        if (debug) {
            console.log(message);
        }
    }

}
