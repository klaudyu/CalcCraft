// At the top of main.ts, add TFile to imports:
import { Plugin, MarkdownPostProcessorContext, App, MarkdownView, debounce, TFile } from "obsidian";
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

private cssClassCache = new Map<string, string[]>();

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

    this.registerEvent(
        this.app.metadataCache.on("changed", (file) => {
            // Only refresh if class filter is enabled AND cssclass actually changed
            if (this.settings.enableClassFilter) {
                this.checkCssClassChange(file);
            }
        })
    );
}

private extractCssClasses(frontmatter: any): string[] {
    const classes: string[] = [];
    
    if (frontmatter?.cssclass) {
        if (typeof frontmatter.cssclass === 'string') {
            classes.push(...frontmatter.cssclass.split(/\s+/));
        } else if (Array.isArray(frontmatter.cssclass)) {
            classes.push(...frontmatter.cssclass);
        }
    }
    
    if (frontmatter?.cssclasses) {
        if (typeof frontmatter.cssclasses === 'string') {
            classes.push(...frontmatter.cssclasses.split(/\s+/));
        } else if (Array.isArray(frontmatter.cssclasses)) {
            classes.push(...frontmatter.cssclasses);
        }
    }
    
    return classes.filter(cls => cls.trim().length > 0);
}

private checkCssClassChange(file: TFile) {
    const cache = this.app.metadataCache.getFileCache(file);
    const newClasses = cache?.frontmatter ? this.extractCssClasses(cache.frontmatter) : [];
    const oldClasses = this.cssClassCache.get(file.path) || [];
    
    // Sort both arrays for comparison
    const newSorted = [...newClasses].sort();
    const oldSorted = [...oldClasses].sort();
    
    // Check if cssclasses actually changed
    const hasChanged = newSorted.length !== oldSorted.length || 
                      !newSorted.every((cls, i) => cls === oldSorted[i]);
    
    if (hasChanged) {
        this.debug(`CSS classes changed for ${file.name}: [${oldClasses.join(', ')}] -> [${newClasses.join(', ')}]`);
        
        // Update cache
        this.cssClassCache.set(file.path, newClasses);
        
        // Only refresh if this is the active file
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && activeFile.path === file.path) {
            this.refreshPageIfNeeded(file);
        }
    } else {
        this.debug(`CSS classes unchanged for ${file.name}, skipping refresh`);
    }
}

private refreshPageIfNeeded(file: TFile) {
    this.debug("CSS classes changed, refreshing page");
    setTimeout(() => {
        this.app.workspace.getLeavesOfType("markdown").forEach((e: any) => e.rebuildView());
    }, 100); // Small delay to ensure frontmatter is fully processed
}


	async postProcessor(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    // Check if class filter is enabled
    if (this.settings.enableClassFilter) {
        const requiredClass = this.settings.requiredClass || "calccraft";
        
        try {
            let file = null;
            
            // For edit mode, we need to get the file from the active view
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (activeView) {
                file = activeView.file;
            }
            
            // Fallback methods
            if (!file && ctx.sourcePath) {
                file = this.app.vault.getAbstractFileByPath(ctx.sourcePath) as TFile;
            }
            
            if (!file) {
                file = this.app.workspace.getActiveFile();
            }
            
            if (!file) {
                this.debug("Could not determine current file, processing all tables");
                // Process anyway if we can't determine the file
            } else {
                // Get frontmatter from cache
                const fileCache = this.app.metadataCache.getFileCache(file);
                
                if (fileCache && fileCache.frontmatter) {
                    const cssclass = fileCache.frontmatter.cssclass;
                    const cssclasses = fileCache.frontmatter.cssclasses;
                    
                    let hasRequiredClass = false;
                    
                    // Check cssclass field
                    if (cssclass) {
                        if (typeof cssclass === 'string') {
                            hasRequiredClass = cssclass.split(/\s+/).includes(requiredClass);
                        } else if (Array.isArray(cssclass)) {
                            hasRequiredClass = cssclass.includes(requiredClass);
                        }
                    }
                    
                    // Check cssclasses field if not found yet
                    if (!hasRequiredClass && cssclasses) {
                        if (typeof cssclasses === 'string') {
                            hasRequiredClass = cssclasses.split(/\s+/).includes(requiredClass);
                        } else if (Array.isArray(cssclasses)) {
                            hasRequiredClass = cssclasses.includes(requiredClass);
                        }
                    }
                    
                    this.debug(`File: ${file.name}, Required: ${requiredClass}, Found: ${hasRequiredClass}`);
					this.debug(`Mode: ${activeView?.getMode()}, cssclass: ${cssclass}, cssclasses: ${cssclasses}`);

                    
                    if (!hasRequiredClass) {
                        this.debug(`Skipping page - missing cssclass '${requiredClass}'`);
                        return;
                    }
                } else {
                    this.debug("No frontmatter found, skipping page");
                    return;
                }
            }
        } catch (error) {
            console.error("CalcCraft: Error checking cssclass:", error);
            // If we can't check the class, process anyway to avoid breaking functionality
        }
    }

    el.querySelectorAll("table").forEach((tableEl, index) => {
        try {
            const gridData = this.extractTableGrid(tableEl);
			this.clearTableHighlights(tableEl);
            (tableEl as any).CalcCraft = { settings: this.settings };
            
            const evaluator = new TableEvaluator();
            const result = evaluator.evaluateTable(gridData);
            
            this.applyResultsToHTML(tableEl, result, gridData, evaluator);
        } catch (error) {
            console.error(`CalcCraft: Error processing table ${index}:`, error);
            tableEl.setAttribute('data-calccraft-error', 'true');
        }
    });
}



	private extractTableGrid(tableEl: HTMLTableElement): string[][] {
		const rows = Array.from(tableEl.querySelectorAll("tr"));
		if (rows.length === 0) return [];

		const validRows = rows.slice(this.rowOffset);
		if (validRows.length === 0) return [];

		const gridData: string[][] = [];

		validRows.forEach((rowEl, i) => {
			const cells = Array.from(rowEl.querySelectorAll("td, th"));
			const validCells = cells.slice(this.colOffset);
			gridData[i] = [];

			validCells.forEach((cellEl, j) => {
				const wrapper = cellEl.querySelector('.table-cell-wrapper');
				let cellContent = wrapper ?
					(wrapper.textContent || "") :
					(cellEl.textContent || "");

				gridData[i][j] = cellContent.trim();
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



private formatNumber(num: number): string {
	if (this.settings.digitGrouping) {
		const options: Intl.NumberFormatOptions = { useGrouping: true };
		
		// Only set precision if it's enabled AND the number actually has decimals that exceed it
		if (this.settings.precision >= 0) {
			const decimalPart = String(num).split(".")[1];
			if (decimalPart && decimalPart.length > this.settings.precision) {
				options.minimumFractionDigits = this.settings.precision;
				options.maximumFractionDigits = this.settings.precision;
			}
		}
		
		return new Intl.NumberFormat(undefined, options).format(num);
	} else if (this.settings.precision >= 0) {
		const decimalPart = String(num).split(".")[1];
		if (decimalPart && decimalPart.length > this.settings.precision) {
			return num.toFixed(this.settings.precision);
		}
		return num.toString();
	} else {
		return num.toString();
	}
}

private setFormattedCellValue(cellEl: HTMLElement, value: any, error?: string): void {
	let data = value;
	
	// Handle mathjs Unit objects - check for the presence of unit-specific properties
	if (typeof data === "object" && data !== null &&
		(data.constructor?.name === "Unit" ||
			(data.value !== undefined && data.units !== undefined))) {
		
		if (this.settings.precision >= 0 || this.settings.digitGrouping) {
			// Get the original string representation and extract the number part
			const unitString = data.toString();
			const unitMatch = unitString.match(/^(-?\d*\.?\d+)\s*(.*)$/);
			
			if (unitMatch) {
				const [, numberPart, unitPart] = unitMatch;
				const num = parseFloat(numberPart);
				const formattedNumber = this.formatNumber(num);
				data = `${formattedNumber} ${unitPart}`;
			} else {
				data = unitString;
			}
		} else {
			// Convert Unit object to string using its toString method
			data = data.toString();
		}
	} else if (typeof data === "number" && (this.settings.precision >= 0 || this.settings.digitGrouping)) {
		// Use the helper for numbers
		data = this.formatNumber(data);
	} else if (typeof data === "string" && (this.settings.precision >= 0 || this.settings.digitGrouping)) {
		// Handle unit strings like "24.123456 kg" (fallback for non-mathjs units)
		const unitMatch = data.match(/^(-?\d*\.?\d+)\s*(.*)$/);
		if (unitMatch) {
			const [, numberPart, unitPart] = unitMatch;
			const num = parseFloat(numberPart);
			if (!isNaN(num) && isFinite(num)) {
				const formattedNumber = this.formatNumber(num);
				data = unitPart ? `${formattedNumber} ${unitPart}` : formattedNumber;
			}
		}
	}
	
	// Live Preview: overlay on the wrapper
	const wrapper = cellEl.querySelector<HTMLElement>(".table-cell-wrapper");
	if (wrapper) {
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
			) {
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
	}  
	//} , 300, true);

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

		// Keep the mutation observer ggbut make it less aggressive
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

	private clearTableHighlights(tableEl: HTMLTableElement) {
		if (!tableEl) return;

		// Remove highlight classes and the "active" marker
		tableEl.querySelectorAll<HTMLElement>(
			'.cell-parents-highlight, .cell-children-highlight, .cell-active, .calc-overlay-cell'
		).forEach(el => {
			el.classList.remove('cell-parents-highlight', 'cell-children-highlight', 'cell-active', 'calc-overlay-cell');

			// remove overlay dataset if present
			const wrapper = el.querySelector<HTMLElement>('.table-cell-wrapper');
			if (wrapper) {
				wrapper.removeAttribute('data-calc-display');
				wrapper.classList.remove('calc-overlay-cell');
			}

			// clear any CalcCraft bookkeeping on the element to avoid stale references
			if ((el as any).CalcCraft) {
				try {
					(el as any).CalcCraft.parents = [];
					(el as any).CalcCraft.children = [];
					delete (el as any).CalcCraft;
				} catch (e) {
					// silence any unexpected structure
				}
			}
		});
	}


	private detachLivePreviewHooks = () => {
		this.debug("Detaching Live Preview hooks");
		this.lpCleanup.forEach(fn => fn());
		this.lpCleanup = [];
	};

}
