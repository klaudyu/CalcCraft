import { Plugin, MarkdownPostProcessorContext, App, MarkdownView, debounce } from "obsidian";
import { CalcCraftSettingsTab, DefaultSettings } from "./settings";
import { TableEvaluator } from "./table-evaluator";

const debug = false;

export default class CalcCraftPlugin extends Plugin {
	settings: any = {};
	settings_tab: CalcCraftSettingsTab;
	cssVariables: string[] = [];
	colOffset = 0;
	rowOffset = 0;
	htmlTable: HTMLElement[][] = [];
	useBool = false; //keep true and false, otherwise convert them to 0 and 1

	private lpCleanup: Array<() => void> = [];


    async onload() {
        await this.loadSettings();
        this.registerMarkdownPostProcessor(this.postProcessor.bind(this));
        
        // edit mode support:
        this.settings_tab = new CalcCraftSettingsTab(this.app, this);
        this.addSettingTab(this.settings_tab);
        this.debug("table formula plugin loaded");
        this.settings_tab.reloadPages();

		// Add Live Preview support:
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.attachLivePreviewHooks()));
		this.registerEvent(this.app.workspace.on("layout-change", () => this.attachLivePreviewHooks()));
		this.attachLivePreviewHooks();
    }

	async onunload(): Promise<void> {
		this.settings_tab.reloadPages();
	}





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

	private extractTableGrid(tableEl: HTMLTableElement): string[][] {
    const rows = Array.from(tableEl.querySelectorAll("tr")).slice(this.rowOffset);
    const gridData: string[][] = [];

    rows.forEach((rowEl, i) => {
        const cells = Array.from(rowEl.querySelectorAll("td, th")).slice(this.colOffset);
        gridData[i] = [];
        
        cells.forEach((cellEl, j) => {
            // In Live Preview, content might be inside .table-cell-wrapper
            const wrapper = cellEl.querySelector('.table-cell-wrapper');
            let cellContent;
            
            if (wrapper) {
                // Live Preview mode - get content from wrapper
                cellContent = wrapper.textContent || "";
            } else {
                // Reading mode - get content normally
                cellContent = cellEl.textContent || "";
            }
            
            gridData[i][j] = cellContent;
        });
    });

    return gridData;
}


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

		if (this.settings.showLabels) {
			this.addSimpleLabels(tableEl);
		}

        // Apply computed values and styling
        for (let rowIndex = 0; rowIndex < this.htmlTable.length; rowIndex++) {
            for (let colIndex = 0; colIndex < this.htmlTable[rowIndex].length; colIndex++) {
                const cellEl = this.htmlTable[rowIndex][colIndex];
                const cellContent = gridData[rowIndex]?.[colIndex] || "";
                const computedValue = result.values[rowIndex]?.[colIndex];
                const error = result.errors[rowIndex]?.[colIndex];
                const cellType = result.cellTypes[rowIndex]?.[colIndex];

				// Clear all previous styling classes
				cellEl.classList.remove(
					"formula-cell",
					"formula-cell-borderenabled",
					"formula-cell-colorenabled",
					"matrix-cell",
					"matrix-cell-colorenabled",
					"error-cell",
					"error-cell-colorenabled"
				);

				// Clear overlay data for non-formula cells
				const wrapper = cellEl.querySelector<HTMLElement>(".table-cell-wrapper");
				if (wrapper) {
					wrapper.classList.remove("calc-overlay-cell");
					wrapper.removeAttribute("data-calc-display");
				}

                // Initialize CalcCraft metadata
                (cellEl as any).CalcCraft = { 
                    parents: [], 
                    children: [],
                    settings: this.settings 
                };

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


					// In applyResultsToHTML:
					if (error) {
						cellEl.classList.add("error-cell");
						if (this.settings.formula_background_error_toggle) {
							cellEl.classList.add("error-cell-colorenabled");
						}
						// Pass error as separate parameter
						this.setFormattedCellValue(cellEl, computedValue, error);
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

        this.addTableEventListeners(tableEl);
    }


	private _addSimpleLabels(tableEl: HTMLTableElement): void {
		if (tableEl.dataset.labelsAdded === 'true') return;
		tableEl.dataset.labelsAdded = 'true';
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
		this.rowOffset = 0; 
		this.colOffset = 0; 

	}


	private addSimpleLabels(tableEl: HTMLTableElement): void {
		// avoid running twice
		if (tableEl.dataset.labelsAdded === 'true') return;
		tableEl.dataset.labelsAdded = 'true';
		const thead = tableEl.tHead;
		if (thead && thead.rows.length > 0) {
			const headerRow = thead.rows[0];
			Array.from(headerRow.cells).forEach((cell, colIndex) => {
				if (!cell.dataset.colLabeled) {
					cell.dataset.colLabeled = 'true';
					cell.dataset.colLetter = String.fromCharCode(97 + colIndex); // 'a' + index
				}
			});
		}
		const tbody = tableEl.tBodies && tableEl.tBodies[0];
		if (tbody) {
			Array.from(tbody.rows).forEach((row, bodyIndex) => {
				// use the first cell in the row (cells[0]) — won't touch header <th>s
				const firstCell = row.cells[0];
				if (firstCell && !firstCell.dataset.rowLabeled) {
					firstCell.dataset.rowLabeled = 'true';

					// compute the printed row number. If there is a THEAD, start from 2
					// (so tbody row 0 -> table row 2). If no THEAD, start from 1.
					const printed = thead ? bodyIndex + 2 : bodyIndex + 1;
					firstCell.dataset.rowNumber = String(printed);
				}
			});
		}
	}

private setFormattedCellValue(cellEl: HTMLElement, value: any, error?: string): void {
    let data = value;
    if (typeof data === "number" && this.settings.precision >= 0) {
        const decimalPart = String(data).split(".")[1];
        if (decimalPart && decimalPart.length > this.settings.precision) {
            data = data.toFixed(this.settings.precision);
        }
    }

    // Live Preview: overlay on the wrapper
    const wrapper = cellEl.querySelector<HTMLElement>(".table-cell-wrapper");
    if (wrapper) {
        // For errors, show error in overlay but preserve original formula in DOM
        const displayValue = error || String(data);
        wrapper.dataset.calcDisplay = displayValue;
        wrapper.classList.add("calc-overlay-cell");
        return;
    }

    // Reading view: write value directly
    cellEl.textContent = error || String(data);
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
					//console.log("the cell doesnt contain calccraft")
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

//private recomputeLivePreview = debounce(() => {
private recomputeLivePreview = () => {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const root = (view as any)?.editor?.cm?.contentDOM as HTMLElement | undefined;
    if (!root) return;
    
    this.debug("Recomputing Live Preview tables");
    
    // Reuse your existing processor here:
    this.postProcessor(root, {} as any);
} //, 300, true);

private attachLivePreviewHooks = () => {
    this.detachLivePreviewHooks();

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const root = (view as any)?.editor?.cm?.contentDOM as HTMLElement | undefined;
    if (!root) {
        this.debug("No Live Preview root found");
        return;
    }

    this.debug("Attaching Live Preview hooks");

    // Only trigger on blur (when user finishes editing), not on input
    const onCellBlur = (e: Event) => {
        const target = e.target as HTMLElement;
        if (target?.closest(".cm-table-widget")) {
            this.debug("Table cell blur detected, triggering recompute");
            // Add a small delay to ensure the DOM is stable
            setTimeout(() => this.recomputeLivePreview(), 50);
        }
    };
    
    // Remove the input listener that was causing issues
    root.addEventListener("blur", onCellBlur, true);
    this.lpCleanup.push(() => {
        root.removeEventListener("blur", onCellBlur, true);
    });

    // Keep the mutation observer but make it less aggressive
    const mo = new MutationObserver((mutations) => {
        // Only recompute if mutations don't involve active editing
        const hasActiveEdit = root.querySelector('.cm-table-widget .table-cell-wrapper:focus-within');
        if (!hasActiveEdit) {
            this.debug("DOM mutation detected (no active edit)");
            requestAnimationFrame(this.recomputeLivePreview);
        }
    });
    mo.observe(root, { childList: true, subtree: true });
    this.lpCleanup.push(() => mo.disconnect());

    // Initial pass
    this.recomputeLivePreview();
};

private detachLivePreviewHooks = () => {
    this.debug("Detaching Live Preview hooks");
    this.lpCleanup.forEach(fn => fn());
    this.lpCleanup = [];
};

}
